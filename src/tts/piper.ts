import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';

/**
 * Synthesizes `text` to a temporary WAV file with Piper and returns its path.
 * The caller deletes the file once it has been played.
 *
 * Reads text from stdin with -m <model> -f <output.wav>. Confirmed for the
 * standalone piper binary (piper.exe); not yet checked against the Python
 * package's CLI (`pip install piper-tts`).
 */
export function synthesize(text: string): Promise<string> {
  const outFile = join(tmpdir(), `keith-tts-${randomUUID()}.wav`);

  return new Promise((resolve, reject) => {
    const proc = spawn(config.piper.path, ['-m', config.piper.model, '-f', outFile], {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Could not start Piper at "${config.piper.path}": ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(outFile);
      else reject(new Error(`Piper exited with code ${code}: ${stderr.trim().slice(-500)}`));
    });

    proc.stdin.end(text + '\n');
  });
}
