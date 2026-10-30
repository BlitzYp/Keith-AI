import type { ChatMessage } from './client.js';

/**
 * Per-channel rolling conversation history.
 * Kept in memory only; restarting the bot clears it.
 */
export class HistoryStore {
  private readonly channels = new Map<string, ChatMessage[]>();

  constructor(private readonly maxMessages: number) {}

  get(channelId: string): ChatMessage[] {
    return this.channels.get(channelId) ?? [];
  }

  push(channelId: string, message: ChatMessage): void {
    const list = this.channels.get(channelId) ?? [];
    list.push(message);
    // Drop the oldest messages once over the cap.
    while (list.length > this.maxMessages) list.shift();
    this.channels.set(channelId, list);
  }

  clear(channelId: string): void {
    this.channels.delete(channelId);
  }
}
