import { createRequire } from 'node:module';
import type OpusScript from 'opusscript';
import type { OpusDecoder } from './listener.js';

const require = createRequire(import.meta.url);

/**
 * Loads a copy of opusscript that only listening uses.
 *
 * Why a copy: opusscript runs libopus in one WebAssembly instance per loaded copy, shared by every
 * decoder and encoder made from it. That includes the encoder @discordjs/voice uses to play Keith's
 * voice. Its memory can't grow: once it's full, libopus overwrites itself and every later call
 * fails ("Aborted()", "memory access out of bounds"). With its own copy, listening can't break
 * playback, and a broken copy can be thrown away and replaced.
 *
 * How: Node keeps one copy of each module in require.cache. Taking opusscript out of the cache
 * before require() loads a new copy with a new WebAssembly instance; putting the old entry back
 * afterwards means everyone else still gets the shared one.
 */
function loadPrivateOpusScript(): typeof OpusScript {
  const path = require.resolve('opusscript');
  const shared = require.cache[path];
  delete require.cache[path];
  try {
    return require(path);
  } finally {
    if (shared) require.cache[path] = shared;
    else delete require.cache[path];
  }
}

/** Makes Opus decoders for 48 kHz stereo (what Discord sends) from listening's own opusscript. */
export class OpusDecoders {
  private opus = loadPrivateOpusScript();
  /** Decoders made and not yet closed, so a log line can say whether something leaks them. */
  private open = 0;

  create(): OpusDecoder {
    const decoder = this.newDecoder();
    const opus = this.opus;
    this.open++;
    let closed = false;
    return {
      decode: (packet) => {
        try {
          return decoder.decode(packet);
        } catch (err) {
          if (err instanceof WebAssembly.RuntimeError) this.replaceBroken(opus, err);
          throw err;
        }
      },
      close: () => {
        if (closed) return;
        closed = true;
        this.open--;
        try {
          decoder.delete();
        } catch {
          // Its copy of opusscript broke; it's being thrown away anyway.
        }
      },
    };
  }

  private newDecoder(): OpusScript {
    try {
      return new this.opus(48_000, 2, this.opus.Application.AUDIO);
    } catch (err) {
      if (!(err instanceof WebAssembly.RuntimeError)) throw err;
      this.replaceBroken(this.opus, err);
      return new this.opus(48_000, 2, this.opus.Application.AUDIO);
    }
  }

  /**
   * A WebAssembly RuntimeError means the copy is broken for good: load a fresh one. Decoders still
   * open on the broken copy fail from now on, which drops what they were recording.
   */
  private replaceBroken(broken: typeof OpusScript, err: Error): void {
    if (this.opus !== broken) return; // already replaced
    console.error(
      `[listen] opusscript broke (${err.message}) with ${this.open} decoders open; loading a fresh copy`,
    );
    this.opus = loadPrivateOpusScript();
  }
}
