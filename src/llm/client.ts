import OpenAI from 'openai';
import { config } from '../config.js';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/**
 * Works with any OpenAI-compatible server: llama.cpp's llama-server, Ollama,
 * OpenRouter, Groq, etc. Switching between local and cloud is just
 * LLM_BASE_URL + LLM_MODEL in .env.
 */
const openai = new OpenAI({
  baseURL: config.llm.baseURL,
  apiKey: config.llm.apiKey,
});

/** Streams the reply, yielding text chunks as they arrive. */
export async function* streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
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

/**
 * Some local models (Qwen3, DeepSeek-R1 style) emit <think>...</think> blocks.
 * Strip them so they never reach chat or TTS.
 */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .trimStart();
}

/**
 * While streaming, hides a trailing "<", "<th", ... that may be the start of a
 * <think> tag, so text never appears and then vanishes once the tag completes.
 */
export function holdBackPartialTag(text: string): string {
  return text.replace(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/, '');
}
