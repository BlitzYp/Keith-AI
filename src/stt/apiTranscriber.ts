import OpenAI, { toFile } from 'openai';
import { WHISPER_SAMPLE_RATE, wavFile } from './audio.js';
import { withoutEchoedPrompt } from './transcript.js';
import type { Transcriber } from './transcriber.js';

export interface ApiTranscriberSettings {
  baseURL: string;
  apiKey: string;
  /** e.g. whisper-large-v3-turbo on Groq. */
  model: string;
  /** e.g. "en". Undefined lets the model guess the language. */
  language?: string;
  /**
   * Text Whisper treats as what was said just before, e.g. "Hey Keith.": it nudges Whisper to
   * spell names the same way. Undefined for none.
   */
  prompt?: string;
}

/**
 * Speech-to-text over an OpenAI-compatible API (POST /audio/transcriptions). Groq runs
 * whisper-large-v3-turbo this way, fast and without using this machine's CPU.
 */
export class ApiTranscriber implements Transcriber {
  private readonly client: OpenAI;

  constructor(private readonly settings: ApiTranscriberSettings) {
    this.client = new OpenAI({ baseURL: settings.baseURL, apiKey: settings.apiKey });
  }

  warmUp(): void {
    // Nothing to load: the model runs on the API's side.
  }

  async transcribe(pcm: Buffer): Promise<string> {
    const file = await toFile(wavFile(pcm, WHISPER_SAMPLE_RATE), 'speech.wav', { type: 'audio/wav' });
    const result = await this.client.audio.transcriptions.create({
      file,
      model: this.settings.model,
      language: this.settings.language,
      prompt: this.settings.prompt,
    });
    return withoutEchoedPrompt(result.text, this.settings.prompt);
  }
}
