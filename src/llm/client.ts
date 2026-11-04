import OpenAI from 'openai';
import { config } from '../config.js';
import type { ChatMessage } from './messages.js';
import { hideThinking } from './thinking.js';
import {
  ToolCallAssembler,
  runWithTools,
  type RoundEvent,
  type ToolDefinition,
  type Tools,
} from './toolLoop.js';

export type { ChatMessage, ContentPart } from './messages.js';

/**
 * Works with any OpenAI-compatible server: llama.cpp's llama-server, LM Studio,
 * Ollama, OpenRouter, Groq, etc. Switching between local and cloud is just
 * LLM_BASE_URL + LLM_MODEL in .env.
 */
const openai = new OpenAI({
  baseURL: config.llm.baseURL,
  apiKey: config.llm.apiKey,
});

/**
 * Streams the reply as the visible text so far, with any <think> reasoning hidden. With `tools`,
 * the model may call them along the way (llm/toolLoop.ts); the reply still only grows.
 */
export function streamReply(messages: ChatMessage[], tools?: Tools): AsyncGenerator<string> {
  return hideThinking(runWithTools(messages, tools, streamRound));
}

/** One request to the model: streams its text, then any tool calls once they're complete. */
async function* streamRound(messages: ChatMessage[], tools: ToolDefinition[]): AsyncGenerator<RoundEvent> {
  const stream = await openai.chat.completions.create({
    model: config.llm.model,
    // Our ChatMessage matches OpenAI's format, but TypeScript can't tell which role goes with
    // which kind of content, so it's cast here once.
    messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
    // Some servers reject an empty tools list, so it's left out when there are none.
    ...(tools.length > 0 ? { tools } : {}),
    stream: true,
  });

  const toolCalls = new ToolCallAssembler();
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) yield { type: 'text', text: delta.content };
    for (const piece of delta?.tool_calls ?? []) toolCalls.add(piece);
  }
  for (const call of toolCalls.calls()) yield { type: 'toolCall', call };
}
