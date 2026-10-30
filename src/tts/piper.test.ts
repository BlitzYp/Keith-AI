// Runs the real Piper (Python + voice model), so it takes a few seconds while the voice loads.
// Skipped when Piper isn't set up on this machine; see README step 4.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { after, describe, it } from 'node:test';
import { PiperWorker } from './piper.js';

const settings = {
  python: '.venv/Scripts/python.exe',
  model: './models/en_US-lessac-medium.onnx',
};
const missing = [settings.python, settings.model].find((path) => !existsSync(path));
const skip = missing ? `Piper isn't set up here (no ${missing})` : false;

/** Checks that `file` is a WAV with some audio in it, then deletes it. */
async function assertWavWithAudio(file: string) {
  const bytes = await readFile(file);
  await unlink(file);
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WAVE');
  // A 44-byte header plus at least ~0.1 s of 22050 Hz 16-bit audio.
  assert.ok(bytes.length > 44 + 4_000, `only ${bytes.length} bytes`);
}

describe('PiperWorker (real Piper)', { skip }, () => {
  const piper = new PiperWorker(settings);
  after(() => piper.close());

  it('turns text into a WAV file', { timeout: 60_000 }, async () => {
    await assertWavWithAudio(await piper.synthesize('Hello, this is Keith.'));
  });

  it('handles several sentences sent at once', { timeout: 30_000 }, async () => {
    const files = await Promise.all([
      piper.synthesize('First sentence.'),
      piper.synthesize('Second sentence.'),
      piper.synthesize('Third sentence.'),
    ]);
    assert.equal(new Set(files).size, 3, 'each sentence gets its own file');
    for (const file of files) await assertWavWithAudio(file);
  });

  it('copes with accents and emoji (Windows pipes would mangle them without UTF-8)', { timeout: 30_000 }, async () => {
    await assertWavWithAudio(await piper.synthesize('Café crème, naïve résumé 😀'));
  });
});

describe('PiperWorker with a wrong Python path', () => {
  it('fails with an error that names the path', async () => {
    const piper = new PiperWorker({ python: 'no/such/python.exe', model: settings.model });
    await assert.rejects(piper.synthesize('hi'), /Could not start Piper with "no\/such\/python\.exe"/);
  });
});
