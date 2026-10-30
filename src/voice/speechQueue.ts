import { SentenceSplitter, cleanForSpeech } from '../tts/text.js';

export interface SpeechQueueOptions {
  /** Turns text into a WAV file and returns its path. */
  synthesize(text: string): Promise<string>;
  /** Plays a WAV file. Resolves once it has finished, or been cut off by stopPlaying(). */
  play(file: string): Promise<void>;
  /** Cuts off whatever is playing right now. */
  stopPlaying(): void;
  deleteFile(file: string): Promise<void>;
}

/**
 * The sentences waiting to be spoken in one voice channel.
 *
 * Every sentence starts synthesizing as soon as it's queued, so the next one is usually ready
 * by the time the current one finishes, but they always play one at a time, in order.
 */
export class SpeechQueue {
  /** The end of the line: each new sentence plays after this promise settles. */
  private lastInLine: Promise<void> = Promise.resolve();
  /**
   * Bumped by stop(). Each sentence remembers the round it was queued in, and is skipped if a
   * stop() happened since then.
   */
  private round = 0;

  constructor(private readonly options: SpeechQueueOptions) {}

  speak(text: string): void {
    const clean = cleanForSpeech(text);
    if (!clean) return;

    const round = this.round;
    // Start now, not when it's this sentence's turn: synthesis overlaps the sentences before it.
    const file = this.options.synthesize(clean).catch((err: Error) => {
      console.error('[tts]', err.message);
      return null;
    });

    this.lastInLine = this.lastInLine.then(async () => {
      const path = await file;
      if (!path) return;
      try {
        if (round === this.round) await this.options.play(path);
      } finally {
        await this.options.deleteFile(path).catch(() => {});
      }
    });
  }

  /** Stops speaking right now and drops everything queued (barge-in, /shutup). */
  stop(): void {
    this.round++;
    this.options.stopPlaying();
  }

  /** Speaks a reply that is still being written. See ReplySpeech. */
  startReply(): ReplySpeech {
    const round = this.round;
    return new ReplySpeech((sentence) => {
      // After a stop(), the rest of this reply stays quiet; later replies speak normally.
      if (round === this.round) this.speak(sentence);
    });
  }
}

/**
 * Speaks a reply sentence by sentence while the model is still writing it, so the voice starts
 * long before the reply is finished.
 */
export class ReplySpeech {
  private readonly splitter = new SentenceSplitter();
  private heard = '';

  constructor(private readonly say: (sentence: string) => void) {}

  /**
   * Call with the whole reply so far, each time it grows. Only the new part is used: the reply
   * only ever grows (hideThinking in llm/thinking.ts guarantees it), so nothing is said twice.
   */
  update(replySoFar: string): void {
    const newText = replySoFar.slice(this.heard.length);
    this.heard = replySoFar;
    for (const sentence of this.splitter.push(newText)) this.say(sentence);
  }

  /** Speaks whatever is left once the reply is complete. */
  finish(): void {
    const rest = this.splitter.flush();
    if (rest) this.say(rest);
  }
}
