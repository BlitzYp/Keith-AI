import {
  DISCORD_CHANNELS,
  DISCORD_SAMPLE_RATE,
  WHISPER_SAMPLE_RATE,
  pcmDurationMs,
  toWhisperPcm,
} from '../stt/audio.js';
import { cleanTranscript } from '../stt/transcript.js';
import { SpeechDetector } from './speechDetector.js';

/** Turns Opus packets back into 48 kHz stereo PCM. */
export interface OpusDecoder {
  decode(packet: Buffer): Buffer;
  /** Frees the decoder (opusscript keeps it in WebAssembly memory). */
  close(): void;
}

/** Something a person said in voice, as text. */
export interface HeardSpeech {
  userId: string;
  text: string;
}

export interface ListenerOptions {
  /** Whose voice to transcribe: false for bots (music bots, other AIs). */
  shouldListenTo(userId: string): boolean;
  /** A fresh decoder for each stream: Opus decoders carry state from one packet to the next. */
  createDecoder(): OpusDecoder;
  /** Speech-to-text. Gets 16 kHz mono 16-bit PCM, returns what was said. */
  transcribe(pcm: Buffer): Promise<string>;
  /** Called with each thing someone said, in the order they finished saying it. */
  onHeard(speech: HeardSpeech): void | Promise<void>;
  /** A name for log lines. Default: the user id. */
  nameOf?(userId: string): string;
  /** Where log lines go. Default: console.log. */
  log?(line: string): void;
  /**
   * How long of hush (no packets, or only quiet ones) before Keith takes it someone has finished
   * their sentence. Shorter answers sooner but cuts people off when they pause. Default 700 ms.
   */
  silenceMs?: number;
  /** Less talking than this is a click, cough or keyboard noise, not speech. Default 300 ms. */
  minSpeechMs?: number;
  /** A sentence is cut here (the rest becomes the next one), to keep memory in check. Default 30 s. */
  maxSpeechMs?: number;
}

/** One person's Opus packets. Discord's streams have destroy(); plain iterables (tests) may not. */
export type PacketStream = AsyncIterable<Buffer> & { destroy?(): void };

/** One sentence (or so) recorded from someone's stream. */
interface Utterance {
  /** 48 kHz stereo PCM, from just before they started talking until they stopped. */
  frames: Buffer[];
  /** How much of it was talking, as opposed to hush. */
  speechMs: number;
}

/** Hush kept from just before someone starts talking, so their first word isn't clipped. */
const LEAD_IN_FRAMES = 10; // 10 × 20 ms = 200 ms

/**
 * Keith's ears in one voice channel: records what someone says, has it transcribed, and passes
 * the text on.
 *
 * session.ts hands over one stream of Opus packets per person. A sentence ends after `silenceMs`
 * of hush: either no packets at all (Discord stops sending when someone stops talking), or only
 * quiet ones (an open mic keeps sending). One stream can hold several sentences; once packets
 * stop coming, the stream is let go of. Everything about Discord stays in session.ts; this
 * class only sees packets, which is what lets listener.test.ts run it with fakes.
 */
export class VoiceListener {
  private readonly silenceMs: number;
  private readonly minSpeechMs: number;
  private readonly maxSpeechMs: number;
  /** The last sentence in line to be passed on: each new one waits for it. */
  private lastInLine: Promise<void> = Promise.resolve();

  constructor(private readonly options: ListenerOptions) {
    this.silenceMs = options.silenceMs ?? 700;
    this.minSpeechMs = options.minSpeechMs ?? 300;
    this.maxSpeechMs = options.maxSpeechMs ?? 30_000;
  }

  /**
   * Listens to one person's stream until their packets stop coming. Resolves once everything they
   * said has been passed on (or dropped). Never rejects: errors are logged, so one bad stream
   * doesn't stop Keith listening.
   */
  async hear(userId: string, packets: PacketStream): Promise<void> {
    if (!this.options.shouldListenTo(userId)) return;
    const name = this.options.nameOf?.(userId) ?? userId;

    let decoder: OpusDecoder;
    try {
      decoder = this.options.createDecoder();
    } catch (err) {
      console.error("[listen] couldn't make an Opus decoder:", (err as Error).message);
      return;
    }

    const reader = new PacketReader(packets[Symbol.asyncIterator](), decoder, this.silenceMs);
    const detector = new SpeechDetector();
    const passedOn: Promise<void>[] = [];
    try {
      while (!reader.finished) {
        const utterance = await this.recordUtterance(reader, detector);
        if (utterance) passedOn.push(this.passOn(userId, name, utterance));
      }
    } catch (err) {
      // e.g. Keith left the channel mid-sentence: half a sentence isn't worth answering.
      console.error('[listen] audio stream broke:', (err as Error).message);
    } finally {
      decoder.close();
      // Discord's stream only ends when destroyed, and until it ends @discordjs/voice won't start
      // a new one for this person, so Keith wouldn't hear their next sentence.
      packets.destroy?.();
    }

    if (reader.stillEncrypted > 0) {
      this.log(`${name}: skipped ${reader.stillEncrypted} packets still encrypted (Discord's DAVE wasn't ready)`);
    }
    await Promise.all(passedOn);
  }

  /**
   * Waits for someone to start talking, then records until `silenceMs` of hush or the length
   * limit. Returns null if the packets stop before anyone said anything.
   */
  private async recordUtterance(reader: PacketReader, detector: SpeechDetector): Promise<Utterance | null> {
    const leadIn: Buffer[] = [];
    const frames: Buffer[] = [];
    let started = false;
    let speechMs = 0;
    let recordedMs = 0;
    /** Quiet frames since the last bit of talking: cut off at the end, as they're just hush. */
    let quietFrames = 0;

    while (recordedMs < this.maxSpeechMs) {
      const pcm = await reader.nextFrame();
      if (!pcm) break; // packets stopped coming: that ends the sentence too
      const ms = pcmDurationMs(pcm, DISCORD_SAMPLE_RATE, DISCORD_CHANNELS);
      const talking = detector.isSpeech(pcm);

      if (!started) {
        if (!talking) {
          leadIn.push(pcm);
          if (leadIn.length > LEAD_IN_FRAMES) leadIn.shift();
          continue;
        }
        started = true;
        frames.push(...leadIn);
      }

      frames.push(pcm);
      recordedMs += ms;
      if (talking) {
        speechMs += ms;
        quietFrames = 0;
      } else if (++quietFrames * ms >= this.silenceMs) {
        break; // quiet for long enough: the sentence is over
      }
    }

    if (!started) return null;
    return { frames: frames.slice(0, frames.length - quietFrames), speechMs };
  }

  /** Transcribes one utterance and passes the text on, in the order utterances ended. */
  private passOn(userId: string, name: string, utterance: Utterance): Promise<void> {
    if (utterance.speechMs < this.minSpeechMs) {
      this.log(`${name}: ${(utterance.speechMs / 1000).toFixed(1)} s, too short to be speech`);
      return Promise.resolve();
    }
    const pcm = toWhisperPcm(Buffer.concat(utterance.frames));
    const seconds = (pcmDurationMs(pcm, WHISPER_SAMPLE_RATE, 1) / 1000).toFixed(1);

    // Transcription starts right away, so two people's speech is transcribed at the same time...
    const text = this.options.transcribe(pcm).then(
      (raw) => {
        const said = cleanTranscript(raw);
        this.log(
          said
            ? `${name}: ${seconds} s → "${said}"`
            : `${name}: ${seconds} s → nothing (Whisper heard "${raw.trim()}")`,
        );
        return said;
      },
      (err: Error) => {
        console.error('[stt]', err.message);
        return '';
      },
    );

    // ...but what they said is passed on in the order they finished saying it, even when the
    // shorter transcription comes back first.
    const turn = this.lastInLine.then(async () => {
      const said = await text;
      if (said) await this.options.onHeard({ userId, text: said });
    });
    this.lastInLine = turn.catch((err: Error) => console.error('[listen]', err));
    return this.lastInLine;
  }

  private log(line: string): void {
    (this.options.log ?? console.log)(`[listen] ${line}`);
  }
}

/**
 * Reads decoded 20 ms frames from one person's packets, skips packets it can't use, and notices
 * when the packets stop coming.
 */
class PacketReader {
  /** True once the stream ended or no packet came for `silenceMs`. */
  finished = false;
  /** Packets skipped because Discord hadn't decrypted them yet. */
  stillEncrypted = 0;

  constructor(
    private readonly iterator: AsyncIterator<Buffer>,
    private readonly decoder: OpusDecoder,
    private readonly silenceMs: number,
  ) {}

  /** The next frame, or null (and `finished`) once packets stop coming. */
  async nextFrame(): Promise<Buffer | null> {
    while (!this.finished) {
      const packet = await nextPacketOrSilence(this.iterator, this.silenceMs);
      if (packet === null) {
        this.finished = true;
        break;
      }
      if (isStillEncrypted(packet)) {
        this.stillEncrypted++;
        continue;
      }
      const pcm = decodeOrSkip(this.decoder, packet);
      if (pcm) return pcm;
    }
    return null;
  }
}

/**
 * The next packet, or null once the stream ends or no packet has come for `silenceMs`.
 *
 * Keith keeps this timer itself instead of trusting Discord's stream to end: that stream only
 * starts its own timer when the first packet arrives, so if someone's packets never get through,
 * it never ends, and Keith would wait on that person forever and never hear them again.
 */
async function nextPacketOrSilence(
  iterator: AsyncIterator<Buffer>,
  silenceMs: number,
): Promise<Buffer | null> {
  let timer: NodeJS.Timeout | undefined;
  const silence = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), silenceMs);
  });
  try {
    const next = await Promise.race([iterator.next(), silence]);
    return next === null || next.done ? null : next.value;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discord's end-to-end encryption (DAVE) ends every encrypted frame with the marker bytes FA FA.
 * While a DAVE session is still being set up (just after joining, or when someone joins the
 * channel), @discordjs/voice passes frames on without decrypting them. Decoded, they're noise
 * that Whisper would turn into made-up words. A real Opus packet ending in FA FA is rare, and
 * losing one costs 20 ms.
 */
function isStillEncrypted(packet: Buffer): boolean {
  return packet.length >= 2 && packet[packet.length - 2] === 0xfa && packet[packet.length - 1] === 0xfa;
}

/** A corrupt or lost packet is 20 ms of sound: skipping it is better than losing the sentence. */
function decodeOrSkip(decoder: OpusDecoder, packet: Buffer): Buffer | null {
  try {
    return decoder.decode(packet);
  } catch {
    return null;
  }
}
