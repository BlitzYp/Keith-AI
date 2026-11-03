import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pcmDurationMs, toWhisperPcm, wavFile } from './audio.js';

/** 16-bit little-endian samples, the format both Discord and Whisper use. */
function samples(...values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, i) => buffer.writeInt16LE(value, i * 2));
  return buffer;
}

function readSamples(buffer: Buffer): number[] {
  const values: number[] = [];
  for (let offset = 0; offset < buffer.length; offset += 2) values.push(buffer.readInt16LE(offset));
  return values;
}

describe('toWhisperPcm', () => {
  it('turns every 3 stereo frames (48 kHz) into 1 mono sample (16 kHz) by averaging them', () => {
    // Stereo frames are [left, right]. The first 3 frames average to (100+200+...+600)/6 = 350,
    // the next 3 are all -1000.
    const discord = samples(100, 200, 300, 400, 500, 600, -1000, -1000, -1000, -1000, -1000, -1000);
    assert.deepEqual(readSamples(toWhisperPcm(discord)), [350, -1000]);
  });

  it('drops a leftover of fewer than 3 frames at the end (under 0.1 ms of sound)', () => {
    const discord = samples(10, 10, 10, 10, 10, 10, 999, 999);
    assert.deepEqual(readSamples(toWhisperPcm(discord)), [10]);
  });

  it('gives a third as many samples, at half the bytes per sample: 1 s in, 1 s out', () => {
    const oneSecondOfDiscord = Buffer.alloc(48_000 * 2 * 2); // 48k frames × 2 channels × 2 bytes
    const whisper = toWhisperPcm(oneSecondOfDiscord);
    assert.equal(whisper.length, 16_000 * 2); // 16k samples × 2 bytes
  });
});

describe('pcmDurationMs', () => {
  it('works out how long 16 kHz mono audio lasts', () => {
    assert.equal(pcmDurationMs(Buffer.alloc(16_000 * 2), 16_000, 1), 1000);
  });

  it('works out how long 48 kHz stereo audio lasts', () => {
    // One 20 ms Discord packet decodes to 960 stereo frames.
    assert.equal(pcmDurationMs(Buffer.alloc(960 * 2 * 2), 48_000, 2), 20);
  });
});

describe('wavFile', () => {
  it('wraps 16 kHz mono samples in a 44-byte WAV header', () => {
    const pcm = samples(1, 2, 3, 4);
    const wav = wavFile(pcm, 16_000);

    assert.equal(wav.length, 44 + pcm.length);
    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.readUInt32LE(4), 36 + pcm.length, 'RIFF size counts everything after it');
    assert.equal(wav.subarray(8, 16).toString('ascii'), 'WAVEfmt ');
    assert.equal(wav.readUInt16LE(20), 1, 'plain PCM');
    assert.equal(wav.readUInt16LE(22), 1, 'mono');
    assert.equal(wav.readUInt32LE(24), 16_000, 'sample rate');
    assert.equal(wav.readUInt32LE(28), 32_000, 'bytes per second: 16k samples × 2 bytes');
    assert.equal(wav.readUInt16LE(34), 16, 'bits per sample');
    assert.equal(wav.subarray(36, 40).toString('ascii'), 'data');
    assert.equal(wav.readUInt32LE(40), pcm.length);
    assert.deepEqual(wav.subarray(44), pcm);
  });
});
