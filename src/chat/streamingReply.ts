/** Something Keith can reply to: the user's Discord message, or one of Keith's own. */
export interface ReplyTarget {
  reply(content: string): Promise<PostedMessage>;
}

/** A message Keith posted. Long replies continue in a reply to the previous part. */
export interface PostedMessage extends ReplyTarget {
  edit(content: string): Promise<unknown>;
}

export interface StreamingReplyOptions {
  /** Discord's limit is 2000 characters; the default leaves some headroom. */
  maxLength?: number;
  /** Discord rate-limits edits; about one a second is safe. */
  editIntervalMs?: number;
}

/**
 * Shows a reply while the model is still writing it, by editing a Discord message about once a
 * second. Text past the length limit continues in extra messages.
 */
export class StreamingReply {
  private readonly maxLength: number;
  private readonly editIntervalMs: number;
  /** Each part posted so far, with the text it currently shows. */
  private readonly parts: { message: PostedMessage; content: string }[] = [];
  private text = '';
  private timer: NodeJS.Timeout | null = null;
  /** Renders run one after another, never overlapping. */
  private lastRender: Promise<void> = Promise.resolve();

  constructor(
    private readonly userMessage: ReplyTarget,
    { maxLength = 1900, editIntervalMs = 1000 }: StreamingReplyOptions = {},
  ) {
    this.maxLength = maxLength;
    this.editIntervalMs = editIntervalMs;
  }

  /** Call with the whole reply so far. It is shown at the next render. */
  update(text: string): void {
    this.text = text;
    if (this.timer || !text.trim()) return;
    // The first post goes out straight away; edits after it wait for the interval.
    const delay = this.parts.length === 0 ? 0 : this.editIntervalMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scheduleRender();
    }, delay);
  }

  /** Shows the latest text right away and waits until Discord has it. */
  async finish(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.scheduleRender();
    await this.lastRender;
  }

  private scheduleRender(): void {
    this.lastRender = this.lastRender.then(() => this.render());
  }

  private async render(): Promise<void> {
    const text = this.text.trim();
    if (!text) return;

    try {
      const pieces = splitForDiscord(text, this.maxLength);
      for (const [i, content] of pieces.entries()) {
        const part = this.parts[i];
        if (!part) {
          const replyTo = i === 0 ? this.userMessage : this.parts[i - 1]!.message;
          this.parts.push({ message: await replyTo.reply(content), content });
        } else if (part.content !== content) {
          await part.message.edit(content);
          part.content = content;
        }
      }
    } catch (err) {
      console.error('[discord] failed to send/edit reply:', (err as Error).message);
    }
  }
}

/** Splits text into pieces of at most `maxLength`, preferring to break at a newline, then a space. */
export function splitForDiscord(text: string, maxLength: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxLength) {
    // Only break at a newline or space in the second half, so pieces don't end up tiny.
    let cut = rest.lastIndexOf('\n', maxLength);
    if (cut < maxLength / 2) cut = rest.lastIndexOf(' ', maxLength);
    if (cut < maxLength / 2) cut = maxLength;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  pieces.push(rest);
  return pieces;
}
