import type { ChatMessage, ContentPart } from '../llm/client.js';
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
  /** What they said, without the @Keith mention. Can be empty when they only sent pictures. */
  text: string;
  /** Pictures that came with it, as data: URLs (see chat/images.ts). */
  images?: string[];
}

export interface ResponderDeps {
  /** Fixed text, or a function asked before every reply (prompts/jarvis.md, re-read on edits). */
  systemPrompt: string | (() => string);
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
      const prompt: ChatMessage[] = [
        {
          role: 'system',
          content: typeof deps.systemPrompt === 'function' ? deps.systemPrompt() : deps.systemPrompt,
        },
        ...deps.history.get(request.channelId),
        { role: 'user', content: questionWithImages(request) },
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

      // History keeps a note instead of the pictures: they'd be sent again with every later message.
      deps.history.push(request.channelId, { role: 'user', content: questionForHistory(request) });
      deps.history.push(request.channelId, { role: 'assistant', content: answer });
    });
  };
}

export type Respond = ReturnType<typeof createResponder>;

/** "Alice: what is this", or "Alice: [sent an image]" when there's no text. */
function questionText(request: ChatRequest): string {
  return `${request.speaker}: ${request.text || '[sent an image]'}`;
}

/** The question as the model sees it now: plain text, or text followed by the pictures. */
function questionWithImages(request: ChatRequest): string | ContentPart[] {
  const images = request.images ?? [];
  if (images.length === 0) return questionText(request);
  return [
    { type: 'text', text: questionText(request) },
    ...images.map((url): ContentPart => ({ type: 'image_url', image_url: { url } })),
  ];
}

/** The question as remembered: the text plus a note like "[sent 2 images]". */
function questionForHistory(request: ChatRequest): string {
  const count = request.images?.length ?? 0;
  if (count === 0) return questionText(request);
  if (!request.text) return questionText(request);
  return `${questionText(request)} [sent ${count === 1 ? 'an image' : `${count} images`}]`;
}
