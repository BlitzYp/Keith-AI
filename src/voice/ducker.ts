export interface DuckerOptions {
  /** Asks the music bot to turn the music down (true) or back up (false). */
  setDucked(on: boolean): void;
  /** How long after Keith stops before the music comes back up. Default 800 ms. */
  releaseAfterMs?: number;
  /**
   * How often to repeat "music down" while Keith keeps talking. The music bot lets the music back
   * up by itself after 20 s (in case Keith crashed mid-sentence), so this stays well under that.
   * Default 10 s.
   */
  refreshEveryMs?: number;
}

/**
 * Turns the music bot's music down while Keith speaks, so he can be heard over it.
 *
 * The music goes down when Keith starts speaking and comes back up shortly after he stops. The
 * wait covers the small gaps between sentences, so the music doesn't jump up and down mid-reply.
 */
export class Ducker {
  private ducked = false;
  private lastSentAt = 0;
  private releaseTimer: NodeJS.Timeout | null = null;
  private readonly releaseAfterMs: number;
  private readonly refreshEveryMs: number;

  constructor(private readonly options: DuckerOptions) {
    this.releaseAfterMs = options.releaseAfterMs ?? 800;
    this.refreshEveryMs = options.refreshEveryMs ?? 10_000;
  }

  /** Keith started saying something (a sentence, a /say, a musing). */
  speaking(): void {
    this.cancelRelease();
    const due = !this.ducked || Date.now() - this.lastSentAt >= this.refreshEveryMs;
    if (!due) return;
    this.ducked = true;
    this.lastSentAt = Date.now();
    this.options.setDucked(true);
  }

  /** Keith finished saying it. The music comes back up unless he starts again soon. */
  quiet(): void {
    this.cancelRelease();
    this.releaseTimer = setTimeout(() => this.release(), this.releaseAfterMs);
  }

  /** Music back up right away, e.g. when Keith leaves the channel. */
  stop(): void {
    this.cancelRelease();
    this.release();
  }

  private release(): void {
    this.releaseTimer = null;
    if (!this.ducked) return;
    this.ducked = false;
    this.options.setDucked(false);
  }

  private cancelRelease(): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
  }
}
