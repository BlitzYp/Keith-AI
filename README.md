# Keith — Discord AI bot

Talks in text channels and speaks its replies in a voice channel using Piper TTS.
Works with any OpenAI-compatible LLM endpoint (local llama.cpp / Ollama, or OpenRouter, Groq, etc.).

## Setup (Windows)

1. **Node.js 22.12+**.
2. `npm install` (run it on this machine so native voice packages match your OS).
3. **Discord app** at https://discord.com/developers/applications:
   - Bot tab: copy the token, enable **Message Content Intent**.
   - OAuth2 → URL Generator: scopes `bot` + `applications.commands`; permissions: Send Messages, Read Message History, Connect, Speak. Invite it to your server.
4. **Piper**: either the standalone `piper.exe` release or `pip install piper-tts`. Download a voice (`.onnx` + `.onnx.json`) into `models/`.
5. Copy `.env.example` to `.env` and fill it in.
6. `npm run voice:report` should show `@snazzah/davey` and FFmpeg as found.
7. `npm run dev`.

## Use

- Mention the bot or reply to it to chat. Replies stream in by editing the message.
- `/join` — joins your VC; replies in that text channel are also spoken.
- `/say text`, `/shutup`, `/leave`, `/reset` (forget channel history).

## Layout

```
src/
  index.ts          client, intents, event wiring
  config.ts         env vars
  chat.ts           mention/reply trigger, per-channel lock, streaming reply, feeds TTS
  commands.ts       slash commands
  llm/client.ts     OpenAI-compatible streaming client, strips <think> blocks
  llm/history.ts    per-channel rolling history
  tts/piper.ts      runs Piper -> temp WAV
  tts/text.ts       markdown-to-speech cleanup, sentence splitter
  voice/session.ts  voice connection (DAVE), ordered TTS queue, ffmpeg resample to 48 kHz
  voice/manager.ts  one session per guild
```
