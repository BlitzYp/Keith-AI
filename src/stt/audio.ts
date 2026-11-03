/** Discord's decoded voice: 48 kHz, 2 channels, 16-bit little-endian samples. */
export const DISCORD_SAMPLE_RATE = 48_000;
export const DISCORD_CHANNELS = 2;

/** What Whisper is trained on: 16 kHz, 1 channel, 16-bit little-endian samples. */
export const WHISPER_SAMPLE_RATE = 16_000;

const BYTES_PER_SAMPLE = 2;
/** 48 kHz / 16 kHz: every 3 Discord frames become 1 Whisper sample. */
const FRAMES_PER_WHISPER_SAMPLE = DISCORD_SAMPLE_RATE / WHISPER_SAMPLE_RATE;

/**
 * Converts Discord's 48 kHz stereo PCM to Whisper's 16 kHz mono PCM.
 *
 * Each output sample is the average of 3 stereo frames (6 values). Averaging works as a simple
 * low-pass filter, which stops high frequencies from folding down into noise; it isn't studio
 * quality, but it's plenty for recognising speech.
 */
export function toWhisperPcm(discordPcm: Buffer): Buffer {
  const bytesPerFrame = DISCORD_CHANNELS * BYTES_PER_SAMPLE;
  const bytesPerGroup = FRAMES_PER_WHISPER_SAMPLE * bytesPerFrame;
  const groups = Math.floor(discordPcm.length / bytesPerGroup);
  const out = Buffer.alloc(groups * BYTES_PER_SAMPLE);

  for (let group = 0; group < groups; group++) {
    const start = group * bytesPerGroup;
    let sum = 0;
    for (let offset = start; offset < start + bytesPerGroup; offset += BYTES_PER_SAMPLE) {
      sum += discordPcm.readInt16LE(offset);
    }
    const valuesPerGroup = FRAMES_PER_WHISPER_SAMPLE * DISCORD_CHANNELS;
    out.writeInt16LE(Math.round(sum / valuesPerGroup), group * BYTES_PER_SAMPLE);
  }
  return out;
}

/** How long 16-bit PCM audio lasts, in milliseconds. */
export function pcmDurationMs(pcm: Buffer, sampleRate: number, channels: number): number {
  const frames = pcm.length / (BYTES_PER_SAMPLE * channels);
  return (frames / sampleRate) * 1000;
}

/** Wraps 16-bit mono PCM in a WAV header, for speech-to-text APIs that want a file. */
export function wavFile(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4); // size of everything after this field
  header.write('WAVE', 8, 'ascii');

  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // size of this "fmt " section
  header.writeUInt16LE(1, 20); // 1 = plain PCM
  header.writeUInt16LE(1, 22); // channels: mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28); // bytes per second
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32); // bytes per frame
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34); // bits per sample

  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
