// Runs a tiny real Python script, so it needs some Python on this machine; it skips itself if none.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PythonWorker } from './pythonWorker.js';

/** The first Python that runs: the project's venv, or one on PATH. */
const python = ['.venv/Scripts/python.exe', 'python', 'python3'].find(
  (candidate) =>
    (candidate.includes('/') ? existsSync(candidate) : true) &&
    spawnSync(candidate, ['--version'], { windowsHide: true }).status === 0,
);

/**
 * Follows the same protocol as piper_worker.py and whisper_worker.py: one JSON request per line
 * in, one JSON reply per line out. It shouts the text back, fails on "fail", dies on "die", and
 * prints a line that isn't JSON first, like a chatty library might.
 */
const SHOUT_WORKER = `
import json, sys
print("loading... (not JSON, should be ignored)", flush=True)
for line in sys.stdin:
    request = json.loads(line)
    if request["text"] == "die":
        sys.exit(3)
    if request["text"] == "fail":
        print(json.dumps({"id": request["id"], "error": "asked to fail"}), flush=True)
    else:
        print(json.dumps({"id": request["id"], "shouted": request["text"].upper()}), flush=True)
`;

describe('PythonWorker', { skip: python ? false : 'no Python found' }, () => {
  let dir: string;
  let script: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'keith-worker-test-'));
    script = join(dir, 'shout_worker.py');
    await writeFile(script, SHOUT_WORKER);
  });
  after(() => rm(dir, { recursive: true, force: true }));

  function shoutWorker() {
    return new PythonWorker<{ text: string }, { shouted: string }>({
      name: 'Shouter',
      python: python!,
      args: [script],
    });
  }

  it('sends a request and gets its reply back', async () => {
    const worker = shoutWorker();
    assert.deepEqual(await worker.request({ text: 'hi' }), { shouted: 'HI' });
    worker.close();
  });

  it('matches each reply to its own request when several are sent at once', async () => {
    const worker = shoutWorker();
    const replies = await Promise.all(['a', 'b', 'c'].map((text) => worker.request({ text })));
    assert.deepEqual(replies, [{ shouted: 'A' }, { shouted: 'B' }, { shouted: 'C' }]);
    worker.close();
  });

  it('turns an error reply into a rejected promise that names the worker', async () => {
    const worker = shoutWorker();
    await assert.rejects(worker.request({ text: 'fail' }), /Shouter failed: asked to fail/);
    worker.close();
  });

  it('fails waiting requests when the process dies, then starts a fresh one', async () => {
    const worker = shoutWorker();
    await assert.rejects(worker.request({ text: 'die' }), /Shouter exited with code 3/);
    assert.deepEqual(await worker.request({ text: 'back' }), { shouted: 'BACK' });
    worker.close();
  });
});

describe('PythonWorker with a wrong Python path', () => {
  it('fails with an error that names the worker and the path', async () => {
    const worker = new PythonWorker({ name: 'Shouter', python: 'no/such/python.exe', args: ['x.py'] });
    await assert.rejects(worker.request({}), /Could not start Shouter with "no\/such\/python\.exe"/);
  });
});
