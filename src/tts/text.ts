/**
 * Turns Discord-flavoured markdown into something that sounds right when read aloud.
 */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<a?:(\w+):\d+>/g, '$1') // custom emoji <:name:id> -> name
    .replace(/<[@#][!&]?\d+>/g, '') // raw mentions
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[*_~|>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collects streamed LLM text and emits complete sentences as soon as they end,
 * so TTS can start speaking before the whole reply has been generated.
 */
export class SentenceSplitter {
  private buffer = '';

  /** Adds a chunk; returns any sentences completed by it. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    // A sentence ends at . ! ? (optionally followed by quotes/brackets) + whitespace, or at a newline.
    const boundary = /[.!?…]+["')\]]*\s+|\n+/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = boundary.exec(this.buffer)) !== null) {
      const end = match.index + match[0].length;
      const sentence = this.buffer.slice(last, end).trim();
      // Avoid sending tiny fragments like "Hi." on their own; merge them forward.
      if (sentence.length >= 12 || /\n/.test(match[0])) {
        if (sentence) out.push(sentence);
        last = end;
      }
    }
    this.buffer = this.buffer.slice(last);
    return out;
  }

  /** Returns whatever is left once the stream has finished. */
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest || null;
  }
}
