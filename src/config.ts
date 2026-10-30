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

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: process.env.DISCORD_GUILD_ID || undefined,
  },
  llm: {
    baseURL: optional('LLM_BASE_URL', 'http://localhost:11434/v1'),
    apiKey: optional('LLM_API_KEY', 'not-needed'),
    model: required('LLM_MODEL'),
  },
  bot: {
    name: optional('BOT_NAME', 'Keith'),
    systemPrompt: optional(
      'SYSTEM_PROMPT',
      'You are Keith, a friendly member of this Discord server. Keep replies short and conversational.',
    ),
    historyMaxMessages: Number(optional('HISTORY_MAX_MESSAGES', '20')),
  },
  piper: {
    /** Python that has piper-tts installed; runs src/tts/piper_worker.py. */
    python: optional('PIPER_PYTHON', '.venv/Scripts/python.exe'),
    model: optional('PIPER_MODEL', './models/en_US-lessac-medium.onnx'),
  },
};
