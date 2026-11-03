import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface PythonWorkerSettings {
  /** Used in error messages, e.g. "Piper failed: ...". */
  name: string;
  /** Python to run the script with (a venv's python.exe, usually). */
  python: string;
  /** The script, then its arguments. */
  args: string[];
}

type Pending = { resolve: (reply: unknown) => void; reject: (err: Error) => void };

/**
 * One long-lived Python process that answers requests, one JSON object per line each way:
 *   in:  {"id": 1, ...request}
 *   out: {"id": 1, ...reply}   or   {"id": 1, "error": "..."}
 *
 * Keeping the process alive matters because loading a model (a Piper voice, a Whisper model)
 * takes seconds; paying that once beats paying it per request. If the process dies, waiting
 * requests fail and the next request starts a fresh one.
 */
export class PythonWorker<Request extends object, Reply> {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private stderr = '';

  constructor(private readonly settings: PythonWorkerSettings) {}

  /** Starts the process early so the first request doesn't wait for the model to load. */
  warmUp(): void {
    this.proc ??= this.start();
  }

  request(request: Request): Promise<Reply> {
    const proc = (this.proc ??= this.start());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (reply: unknown) => void, reject });
      proc.stdin.write(JSON.stringify({ id, ...request }) + '\n');
    });
  }

  /** Ends the process: with its input closed, the script's read loop finishes. */
  close(): void {
    this.proc?.stdin.end();
  }

  private start(): ChildProcessWithoutNullStreams {
    const { name, python, args } = this.settings;
    const proc = spawn(python, args, { windowsHide: true });
    this.stderr = '';

    createInterface({ input: proc.stdout }).on('line', (line) => this.onReplyLine(line));

    proc.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-2000);
    });
    proc.stdin.on('error', () => {}); // EPIPE once it has died; 'close' reports why
    proc.on('error', (err) => {
      this.fail(proc, new Error(`Could not start ${name} with "${python}": ${err.message}`));
    });
    proc.on('close', (code) => {
      this.fail(proc, new Error(`${name} exited with code ${code}: ${this.stderr.trim().slice(-500)}`));
    });
    return proc;
  }

  private onReplyLine(line: string): void {
    let message: { id: number; error?: string };
    try {
      message = JSON.parse(line);
    } catch {
      return; // not one of our replies, e.g. a library printing progress
    }
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);

    const { id: _id, error, ...reply } = message;
    if (error) request.reject(new Error(`${this.settings.name} failed: ${error}`));
    else request.resolve(reply);
  }

  private fail(proc: ChildProcessWithoutNullStreams, err: Error): void {
    if (this.proc !== proc) return;
    this.proc = null;
    for (const request of this.pending.values()) request.reject(err);
    this.pending.clear();
  }
}
