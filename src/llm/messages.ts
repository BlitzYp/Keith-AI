/** One piece of a message that has pictures in it: some text, or one picture. */
export type ContentPart =
  | { type: 'text'; text: string }
  /** `url` is a data: URL (the picture itself) or a link the model's provider can fetch. */
  | { type: 'image_url'; image_url: { url: string } };

/** A tool call as it's sent back to the model (OpenAI's format). */
export interface ToolCallMessage {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * One message in a conversation with the model, in OpenAI's format:
 * - system / user / assistant: the usual. Content is text, or text and pictures.
 * - an assistant message with tool_calls: the model asking for tools (see llm/toolLoop.ts).
 * - tool: the result of one of those tool calls.
 */
export type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCallMessage[] }
  | { role: 'tool'; tool_call_id: string; content: string };
