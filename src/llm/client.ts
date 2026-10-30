import OpenAI from 'openai';
import { config } from '../config.js';
import { hideThinking } from './thinking.js';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
