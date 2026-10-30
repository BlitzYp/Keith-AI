import type { ChatMessage } from '../llm/client.js';
import type { ReplySpeech } from '../voice/speechQueue.js';
import { ChannelLock } from './channelLock.js';
import type { HistoryStore } from './history.js';
import { StreamingReply, type ReplyTarget } from './streamingReply.js';

/** A message Keith should answer, already pulled out of Discord. */
export interface ChatRequest {
  guildId: string;
  channelId: string;
  /** Display name of whoever wrote it. */
  speaker: string;
  /** What they said, without the @Keith mention. */
  text: string;
}

export interface ResponderDeps {
  systemPrompt: string;
  history: HistoryStore;
  /** Streams the model's reply as the visible text so far (see llm/client.ts). */
  streamReply(messages: ChatMessage[]): AsyncIterable<string>;
  /** Where to speak the reply aloud, or undefined when Keith isn't in voice for this channel. */
  speechFor(request: ChatRequest): ReplySpeech | undefined;
}

/**
 * Builds the function that answers a chat message: it asks the model, shows the reply as it
 * streams in, speaks it in voice if Keith is there, and remembers the exchange.
 *
 * Everything outside Keith (the model, Discord, the voice) comes in through `deps`, which is
 * what lets respond.test.ts run all of this with fakes.
 */
export function createResponder(deps: ResponderDeps) {
  const lock = new ChannelLock();

  return function respond(request: ChatRequest, userMessage: ReplyTarget): Promise<void> {
    // One reply per channel at a time, so the history never interleaves.
    return lock.run(request.channelId, async () => {
      const question: ChatMessage = { role: 'user', content: `${request.speaker}: ${request.text}` };
      const prompt: ChatMessage[] = [
        { role: 'system', content: deps.systemPrompt },
        ...deps.history.get(request.channelId),
        question,
      ];

      const display = new StreamingReply(userMessage);
      const speech = deps.speechFor(request);
      let replySoFar = '';
      try {
        for await (replySoFar of deps.streamReply(prompt)) {
          display.update(replySoFar);
          speech?.update(replySoFar);
        }
      } catch (err) {
        console.error('[llm]', err);
        display.update(`(Couldn't reach the model: ${(err as Error).message})`);
        await display.finish();
        return; // nothing saved: half an exchange would confuse the next prompt
      }

      const answer = replySoFar.trim() || '...';
      display.update(answer);
      speech?.finish();
      await display.finish();

      deps.history.push(request.channelId, question);
      deps.history.push(request.channelId, { role: 'assistant', content: answer });
    });
  };
}

export type Respond = ReturnType<typeof createResponder>;
