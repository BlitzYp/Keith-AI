# Keith — Discord AI bot

Talks in text channels and speaks its replies in a voice channel using Piper TTS.
Works with any OpenAI-compatible LLM endpoint (local llama.cpp / Ollama, or OpenRouter, Groq, etc.).

## Setup (Windows)

1. **Node.js 22.12+**.
2. `npm install` (run it on this machine so native voice packages match your OS).
3. **Discord app** at https://discord.com/developers/applications:
   - Bot tab: copy the token, enable **Message Content Intent**.
   - OAuth2 → URL Generator: scopes `bot` + `applications.commands`; permissions: Send Messages, Read Message History, Connect, Speak. Invite it to your server.
4. **Piper**, in a project venv:
   ```
   python -m venv .venv
   .venv\Scripts\python -m pip install piper-tts
   .venv\Scripts\python -m piper.download_voices en_US-lessac-medium --data-dir models
   ```
5. Copy `.env.example` to `.env` and fill it in.
6. `npm run voice:report` should show `@snazzah/davey` and FFmpeg as found.
7. `npm run dev`.

## Use

- Mention the bot or reply to it to chat. Replies stream in by editing the message.
- `/join` — joins your VC; replies in that text channel are also spoken.
- `/say text`, `/shutup`, `/leave`, `/reset` (forget channel history).

## Tests

- `npm test` runs every `*.test.ts` file (Node's built-in test runner).
- `npm run test:watch` re-runs them on every save: handy for writing a test first, then the code.
- `src/tts/piper.test.ts` runs the real Piper, so it takes a few seconds; it skips itself if Piper isn't set up.
- What tests can't cover: the real Discord connection, voice playback and the real model. Check those in Discord.

## Layout

```
src/
  index.ts                  puts the pieces together: client, history, responder, events
  config.ts                 env vars
  commands.ts               slash commands
  chat/
    discordMessages.ts      is this message for Keith? turns it into a ChatRequest
    respond.ts              answers a ChatRequest: prompt, stream, speak, remember
    streamingReply.ts       shows a streaming reply by editing Discord messages
    channelLock.ts          one reply per channel at a time
    history.ts              per-channel rolling history
  llm/
    client.ts               OpenAI-compatible streaming client
    thinking.ts             hides <think> reasoning from the reply
  tts/
    piper.ts                keeps one Piper process running (piper_worker.py)
    text.ts                 markdown-to-speech cleanup, sentence splitter
  voice/
    session.ts              Discord voice connection (DAVE), ffmpeg resample to 48 kHz
    speechQueue.ts          what to speak when: ordered sentences, /shutup, streaming replies
    manager.ts              one session per guild
```

Each `*.test.ts` sits next to the file it tests.
