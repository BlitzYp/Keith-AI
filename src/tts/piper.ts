import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PythonWorker } from '../workers/pythonWorker.js';

const WORKER_SCRIPT = fileURLToPath(new URL('./piper_worker.py', import.meta.url));

export interface PiperSettings {
  /** Python that has piper-tts installed. */
  python: string;
  /** Voice model (.onnx, with its .onnx.json next to it). */
  model: string;
}

/**
 * One long-lived Python process (piper_worker.py) with the voice loaded, so the ~4 s model load
 * is paid once instead of per sentence. Requests are handled in the order they're sent.
 */
export class PiperWorker {
  private readonly worker: PythonWorker<{ text: string; out: string }, object>;

  constructor(settings: PiperSettings) {
    this.worker = new PythonWorker({
      name: 'Piper',
      python: settings.python,
      args: [WORKER_SCRIPT, settings.model],
    });
  }

  /** Starts the process early so the first sentence doesn't wait for the model to load. */
  warmUp(): void {
    this.worker.warmUp();
  }

  /** Synthesizes `text` to a temporary WAV file and returns its path. The caller deletes it. */
  async synthesize(text: string): Promise<string> {
    const out = join(tmpdir(), `keith-tts-${randomUUID()}.wav`);
    await this.worker.request({ text, out });
    return out;
  }

  close(): void {
    this.worker.close();
  }
}
