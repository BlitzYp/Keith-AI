import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/** Which speech-to-text runs: see src/stt/transcriber.ts. */
function sttEngine(): 'local' | 'api' {
  const engine = optional('STT_ENGINE', 'local');
  if (engine !== 'local' && engine !== 'api') {
    throw new Error(`STT_ENGINE must be "local" or "api", not "${engine}".`);
  }
  return engine;
}

/** "auto" lets Whisper guess the language; anything else is a language code like "en". */
function sttLanguage(): string | undefined {
  const language = optional('STT_LANGUAGE', 'en');
  return language === 'auto' ? undefined : language;
}

/**
 * The default depends on the engine because they react differently (tested on 4 sentences
 * with the name at the start, middle and end): local base.en sometimes dropped a leading
 * "Keith," without a prompt and got all 4 right with this one, while every prompt tried made
 * Groq's large model worse (names dropped or spelled "Keeith"), so Groq gets none.
 */
function sttPrompt(): string | undefined {
  const fallback = sttEngine() === 'local' ? `A voice chat with ${botName} and friends.` : 'none';
  const prompt = optional('STT_PROMPT', fallback);
  return prompt === 'none' ? undefined : prompt;
}

const llmBaseURL = optional('LLM_BASE_URL', 'http://localhost:11434/v1');
const llmApiKey = optional('LLM_API_KEY', 'not-needed');
const piperPython = optional('PIPER_PYTHON', '.venv/Scripts/python.exe');
const botName = optional('BOT_NAME', 'Jarvis');

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: process.env.DISCORD_GUILD_ID || undefined,
  },
  llm: {
    baseURL: llmBaseURL,
    apiKey: llmApiKey,
    model: required('LLM_MODEL'),
    /** Whether the model can look at pictures. Set LLM_SEES_IMAGES=false for text-only models. */
    seesImages: optional('LLM_SEES_IMAGES', 'true') !== 'false',
  },
  bot: {
    name: botName,
    /** Markdown file with Keith's personality (see prompts/jarvis.md). Re-read for every reply. */
    systemPromptFile: optional('SYSTEM_PROMPT_FILE', './prompts/jarvis.md'),
    /** A prompt written straight into .env. If set, it's used instead of the file. */
    systemPromptText: process.env.SYSTEM_PROMPT || undefined,
    historyMaxMessages: Number(optional('HISTORY_MAX_MESSAGES', '20')),
  },
  piper: {
    /** Python that has piper-tts installed; runs src/tts/piper_worker.py. */
    python: piperPython,
    model: optional('PIPER_MODEL', './models/en_US-lessac-medium.onnx'),
  },
  stt: {
    engine: sttEngine(),
    language: sttLanguage(),
    /**
     * Whisper reads this as what was said just before, which helps it spell Keith's name right
     * (/listen's name mode depends on that). "none" turns it off.
     */
    prompt: sttPrompt(),
    /** STT_ENGINE=local: faster-whisper, run by src/stt/whisper_worker.py. */
    local: {
      /** The Piper venv works fine for faster-whisper too. */
      python: optional('WHISPER_PYTHON', piperPython),
      model: optional('WHISPER_MODEL', 'base.en'),
    },
    /** STT_ENGINE=api: an OpenAI-compatible transcription endpoint, the LLM's by default. */
    api: {
      baseURL: optional('STT_BASE_URL', llmBaseURL),
      apiKey: optional('STT_API_KEY', llmApiKey),
      model: optional('STT_MODEL', 'whisper-large-v3-turbo'),
    },
  },
};
