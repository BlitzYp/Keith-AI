// Runs the real faster-whisper, and Piper to make something for it to hear. Slow: loading the
// models takes a few seconds (and the Whisper model downloads on the very first run).
// Skipped when faster-whisper or Piper isn't set up on this machine; see README step 4.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { after, describe, it } from 'node:test';
import ffmpegPath from 'ffmpeg-static';
import { PiperWorker } from '../tts/piper.js';
import { cleanTranscript } from './transcript.js';
import { WhisperWorker } from './whisper.js';

// Same env vars and defaults as the bot (config.ts), which this test can't import.
const piperSettings = {
  python: process.env.PIPER_PYTHON || '.venv/Scripts/python.exe',
  model: process.env.PIPER_MODEL || './models/en_US-lessac-medium.onnx',
};
const whisperSettings = {
  python: process.env.WHISPER_PYTHON || piperSettings.python,
  model: process.env.WHISPER_MODEL || 'base.en',
  language: 'en',
  prompt: 'A voice chat with Keith and friends.', // the bot's default STT_PROMPT for local
};

function whySkip(): string | false {
  const missing = [piperSettings.python, piperSettings.model, whisperSettings.python].find(
    (path) => !existsSync(path),
  );
  if (missing) return `faster-whisper or Piper isn't set up here (no ${missing})`;
  const check = spawnSync(whisperSettings.python, ['-c', 'import faster_whisper'], { windowsHide: true });
  if (check.status !== 0) return `faster-whisper isn't installed in ${whisperSettings.python}`;
  return false;
}

/** Reads any audio file as 16 kHz mono 16-bit PCM, the way Keith hands audio to Whisper. */
function readAs16kMono(file: string): Promise<Buffer> {
  const bin = (ffmpegPath as unknown as string | null) ?? 'ffmpeg';
  const ff = spawn(bin, ['-loglevel', 'error', '-i', file, '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1'], {
    windowsHide: true,
  });
  const chunks: Buffer[] = [];
  ff.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

/** Lowercase letters and spaces only, so the comparison ignores punctuation Whisper adds. */
function words(text: string): string {
  return text.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

describe('WhisperWorker (real faster-whisper)', { skip: whySkip() }, () => {
  const whisper = new WhisperWorker(whisperSettings);
  const piper = new PiperWorker(piperSettings);
  after(() => {
    whisper.close();
    piper.close();
  });

  it('hears what Piper said', { timeout: 180_000 }, async () => {
    const wav = await piper.synthesize('The quick brown fox jumps over the lazy dog.');
    const pcm = await readAs16kMono(wav);
    await unlink(wav);

    const text = await whisper.transcribe(pcm);
    assert.match(words(text), /quick brown fox jumps over the lazy dog/);
  });

  it('hears nothing in silence', { timeout: 60_000 }, async () => {
    const oneSecondOfSilence = Buffer.alloc(16_000 * 2);
    assert.equal(cleanTranscript(await whisper.transcribe(oneSecondOfSilence)), '');
  });
});
