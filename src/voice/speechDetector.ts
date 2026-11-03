/**
 * Below this level a frame is never speech: room tone and hiss. About -44 dBFS.
 * Levels are the RMS of 16-bit samples, from 0 (silence) to 32,767 (as loud as it gets).
 */
const MIN_SPEECH_LEVEL = 200;
/** Speech has to be this many times louder than the background noise: 3× is about 10 dB. */
const SPEECH_OVER_NOISE = 3;
/**
 * How fast the noise estimate rises towards a louder level, per 20 ms frame. Slow on purpose:
 * a steady fan is learned in about 4 s, while a 3 s sentence barely moves it.
 */
const NOISE_RISE_PER_FRAME = 0.002;

/**
 * Tells talking from background noise in one person's audio, 20 ms at a time.
 *
 * Usually Discord only sends packets while someone talks, so this isn't needed. But an open mic
 * (sensitivity turned down, noise suppression off) sends packets all the time, and then
 * loudness is the only way to tell when a sentence has ended.
 *
 * It keeps a running estimate of the background noise: it drops at once to anything quieter,
 * and creeps up slowly towards anything louder. A frame is speech when it's well above that.
 */
export class SpeechDetector {
  private noiseLevel = 0;

  /** `pcm`: one decoded frame of 16-bit audio (any channel count). */
  isSpeech(pcm: Buffer): boolean {
    const level = rmsLevel(pcm);
    const speech = level > Math.max(MIN_SPEECH_LEVEL, this.noiseLevel * SPEECH_OVER_NOISE);

    if (level < this.noiseLevel) this.noiseLevel = level;
    else this.noiseLevel += (level - this.noiseLevel) * NOISE_RISE_PER_FRAME;

    return speech;
  }
}

/** Root-mean-square of 16-bit little-endian samples: how loud they are on average. */
function rmsLevel(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return 0;
  let sumOfSquares = 0;
  for (let offset = 0; offset < samples * 2; offset += 2) {
    const sample = pcm.readInt16LE(offset);
    sumOfSquares += sample * sample;
  }
  return Math.sqrt(sumOfSquares / samples);
}

/**
 * 20 ms of 48 kHz stereo audio at exactly `level` RMS (samples alternating +level and -level).
 * For tests, which need sound of a known loudness.
 */
export function loudFrame(level: number): Buffer {
  const frame = Buffer.alloc(960 * 2 * 2);
  for (let i = 0; i < frame.length / 2; i++) frame.writeInt16LE(i % 2 === 0 ? level : -level, i * 2);
  return frame;
}
