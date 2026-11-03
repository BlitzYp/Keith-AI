/**
 * Speech-to-text. Two kinds, picked by STT_ENGINE in .env:
 *   local: faster-whisper on this machine (whisper.ts)
 *   api:   any OpenAI-compatible transcription endpoint, such as Groq (apiTranscriber.ts)
 */
export interface Transcriber {
  /** Gets 16 kHz mono 16-bit PCM and returns what was said. */
  transcribe(pcm: Buffer): Promise<string>;
  /** Gets ready ahead of time (loads the model), so the first sentence isn't slow. */
  warmUp(): void;
}
