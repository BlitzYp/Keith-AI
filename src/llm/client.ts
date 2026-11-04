import OpenAI from 'openai';
import { config } from '../config.js';
import { hideThinking } from './thinking.js';

/** One piece of a message that has pictures in it: some text, or one picture. */
export type ContentPart =
  | { type: 'text'; text: string }
  /** `url` is a data: URL (the picture itself) or a link the model's provider can fetch. */
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  /** Plain text, or text and pictures (for models that can see, like GLM 5.3 Flash). */
  content: string | ContentPart[];
};

/**
 * Works with any OpenAI-compatible server: llama.cpp's llama-server, LM Studio,
 * Ollama, OpenRouter, Groq, etc. Switching between local and cloud is just
 * LLM_BASE_URL + LLM_MODEL in .env.
 */
const openai = new OpenAI({
  baseURL: config.llm.baseURL,
  apiKey: config.llm.apiKey,
});

/** Streams the reply as the visible text so far, with any <think> reasoning hidden. */
export function streamReply(messages: ChatMessage[]): AsyncGenerator<string> {
  return hideThinking(streamChunks(messages));
}

async function* streamChunks(messages: ChatMessage[]): AsyncGenerator<string> {
  const stream = await openai.chat.completions.create({
    model: config.llm.model,
    // Our ChatMessage matches OpenAI's format, but TypeScript can't tell which role goes with
    // which kind of content, so it's cast here once.
    messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
