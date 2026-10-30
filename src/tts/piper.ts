import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const WORKER_SCRIPT = fileURLToPath(new URL('./piper_worker.py', import.meta.url));

type Pending = { resolve: () => void; reject: (err: Error) => void };

export interface PiperSettings {
  /** Python that has piper-tts installed. */
  python: string;
  /** Voice model (.onnx, with its .onnx.json next to it). */
  model: string;
}

/**
 * One long-lived Python process (piper_worker.py) with the voice loaded, so
 * the ~4 s model load is paid once instead of per sentence. Requests are
 * handled in the order they're sent. If the process dies, pending requests
 * fail and the next request starts a fresh one.
 */
export class PiperWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private stderr = '';

  constructor(private readonly settings: PiperSettings) {}

  /** Starts the process early so the first sentence doesn't wait for the model to load. */
  warmUp(): void {
    this.proc ??= this.start();
  }

  /** Synthesizes `text` to a temporary WAV file and returns its path. The caller deletes it. */
  synthesize(text: string): Promise<string> {
    const proc = (this.proc ??= this.start());
    const id = this.nextId++;
    const out = join(tmpdir(), `keith-tts-${randomUUID()}.wav`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(out), reject });
      proc.stdin.write(JSON.stringify({ id, text, out }) + '\n');
    });
  }

  /** Ends the process: with its input closed, piper_worker.py's read loop finishes. */
  close(): void {
    this.proc?.stdin.end();
  }

  private start(): ChildProcessWithoutNullStreams {
    const proc = spawn(this.settings.python, [WORKER_SCRIPT, this.settings.model], {
      windowsHide: true,
    });
    this.stderr = '';

    createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg: { id: number; error?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        return; // not one of our replies
      }
      const request = this.pending.get(msg.id);
      if (!request) return;
      this.pending.delete(msg.id);
      if (msg.error) request.reject(new Error(`Piper failed: ${msg.error}`));
      else request.resolve();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-2000);
    });
    proc.stdin.on('error', () => {}); // EPIPE once it has died; 'close' reports why
    proc.on('error', (err) => {
      this.fail(proc, new Error(`Could not start Piper with "${this.settings.python}": ${err.message}`));
    });
    proc.on('close', (code) => {
      this.fail(proc, new Error(`Piper exited with code ${code}: ${this.stderr.trim().slice(-500)}`));
    });
    return proc;
  }

  private fail(proc: ChildProcessWithoutNullStreams, err: Error): void {
    if (this.proc !== proc) return;
    this.proc = null;
    for (const request of this.pending.values()) request.reject(err);
    this.pending.clear();
  }
}
