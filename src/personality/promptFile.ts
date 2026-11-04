import { readFileSync } from 'node:fs';

/**
 * Keith's system prompt, read from a Markdown file (SYSTEM_PROMPT_FILE, default prompts/jarvis.md).
 *
 * - `{{name}}` in the file becomes the bot's name (BOT_NAME).
 * - `<!-- comments -->` are left out, so the file can carry notes for whoever edits it.
 * - The file is read again for every reply, so edits apply without restarting Keith. Reading a
 *   small file per message costs next to nothing next to the model call.
 */
export class PromptFile {
  /** The last prompt read successfully, used if the file can't be read for a moment. */
  private lastGood: string;

  constructor(
    private readonly path: string,
    private readonly name: string,
    private readonly readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
  ) {
    // At startup there's nothing to fall back on, so a missing or empty file is an error.
    const prompt = this.read();
    if (prompt instanceof Error) {
      throw new Error(`Could not load the system prompt from ${path}: ${prompt.message}`);
    }
    this.lastGood = prompt;
  }

  get(): string {
    const prompt = this.read();
    if (prompt instanceof Error) {
      // An editor saving the file can leave it empty or locked for a moment: keep the last one.
      console.error(`[prompt] couldn't read ${this.path} (${prompt.message}); using the last good version`);
      return this.lastGood;
    }
    this.lastGood = prompt;
    return prompt;
  }

  /** The finished prompt, or an Error saying why there isn't one. */
  private read(): string | Error {
    let text: string;
    try {
      text = this.readFile(this.path);
    } catch (err) {
      return err as Error;
    }
    const prompt = text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replaceAll('{{name}}', this.name)
      .trim();
    return prompt || new Error('the file is empty');
  }
}
