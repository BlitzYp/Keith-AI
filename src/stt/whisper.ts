import { fileURLToPath } from 'node:url';
import { PythonWorker } from '../workers/pythonWorker.js';
import { withoutEchoedPrompt } from './transcript.js';
import type { Transcriber } from './transcriber.js';

const WORKER_SCRIPT = fileURLToPath(new URL('./whisper_worker.py', import.meta.url));

export interface WhisperSettings {
  /** Python that has faster-whisper installed. */
  python: string;
  /** faster-whisper model name (base.en, small.en, ...) or a folder with a converted model. */
  model: string;
  /** e.g. "en". Undefined lets Whisper guess the language. */
  language?: string;
  /**
   * Text Whisper treats as what was said just before, e.g. "Hey Keith.": it nudges Whisper to
   * spell names the same way. Undefined for none.
   */
  prompt?: string;
}

/**
 * Local speech-to-text: one long-lived Python process (whisper_worker.py) with the model loaded,
 * the same way PiperWorker keeps the voice loaded.
 */
export class WhisperWorker implements Transcriber {
  private readonly worker: PythonWorker<{ audio: string }, { text: string }>;

  constructor(private readonly settings: WhisperSettings) {
    this.worker = new PythonWorker({
      name: 'Whisper',
      python: settings.python,
      args: [WORKER_SCRIPT, settings.model, settings.language ?? '', settings.prompt ?? ''],
    });
  }

  warmUp(): void {
    this.worker.warmUp();
  }

  async transcribe(pcm: Buffer): Promise<string> {
    // Base64 fits PCM into a JSON line: a 10 s sentence is about 430 KB, no temp file needed.
    const reply = await this.worker.request({ audio: pcm.toString('base64') });
    return withoutEchoedPrompt(reply.text, this.settings.prompt);
  }

  close(): void {
    this.worker.close();
  }
}
