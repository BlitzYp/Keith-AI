export interface IdleChatterOptions {
  /** What Keith might say. */
  phrases: readonly string[];
  /** Speaks a phrase in the voice channel. */
  say(text: string): void;
  /** The shortest quiet stretch before Keith pipes up. */
  minQuietMs: number;
  /** The longest. Each wait is picked at random between the two. */
  maxQuietMs: number;
  /** A number from 0 (inclusive) to 1 (exclusive). Default Math.random; tests pass a fixed one. */
  random?(): number;
}

/**
 * Keith piping up with a random line when a voice channel has gone quiet for a while (/musings).
 *
 * After each quiet stretch of random length, Keith says a random phrase, then waits again.
 * Any talking (someone in the channel, or Keith himself) restarts the wait, so he only ever
 * fills silence and never talks over anyone.
 */
export class IdleChatter {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastPhrase = -1;
  private readonly random: () => number;

  constructor(private readonly options: IdleChatterOptions) {
    this.random = options.random ?? Math.random;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.waitForQuiet();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
  }

  /** Someone talked (or Keith did): the quiet stretch starts over. */
  heardActivity(): void {
    if (this.running) this.waitForQuiet();
  }

  private waitForQuiet(): void {
    this.clearTimer();
    const { minQuietMs, maxQuietMs } = this.options;
    const wait = minQuietMs + this.random() * (maxQuietMs - minQuietMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.options.say(this.pickPhrase());
      this.waitForQuiet();
    }, wait);
  }

  /** A random phrase, never the one said last time. */
  private pickPhrase(): string {
    const { phrases } = this.options;
    let index = Math.floor(this.random() * phrases.length);
    if (index === this.lastPhrase && phrases.length > 1) index = (index + 1) % phrases.length;
    this.lastPhrase = index;
    return phrases[index]!;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
