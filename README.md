# Keith — Discord AI bot

Talks in text channels, and in voice channels: it listens (Whisper speech-to-text) and answers
out loud (Piper TTS).
Works with any OpenAI-compatible LLM endpoint (local llama.cpp / Ollama, or OpenRouter, Groq, etc.).

## Setup (Windows)

1. **Node.js 22.12+**.
2. `npm install` (run it on this machine so native voice packages match your OS).
3. **Discord app** at https://discord.com/developers/applications:
   - Bot tab: copy the token, enable **Message Content Intent**.
   - OAuth2 → URL Generator: scopes `bot` + `applications.commands`; permissions: Send Messages, Read Message History, Connect, Speak. Invite it to your server.
4. **Piper** (speaking) and **faster-whisper** (listening), in a project venv:
   ```
   python -m venv .venv
   .venv\Scripts\python -m pip install piper-tts faster-whisper
   .venv\Scripts\python -m piper.download_voices en_US-lessac-medium --data-dir models
   ```
   The Whisper model (`WHISPER_MODEL`, default `base.en`) downloads by itself the first time.
   Skip faster-whisper if you set `STT_ENGINE=api` to transcribe through Groq instead.
5. Copy `.env.example` to `.env` and fill it in.
6. `npm run voice:report` should show `@snazzah/davey` and FFmpeg as found.
7. `npm run dev`.

## Use

- Mention the bot or reply to it to chat. Replies stream in by editing the message.
- `/join` joins your VC. Keith listens: when someone stops talking (0.7 s of quiet), what they
  said is transcribed, posted in the text channel you used `/join` in, and answered out loud.
  Keith's replies in that text channel are spoken too. He doesn't listen to other bots.
- `/listen mode` picks who Keith answers in voice: only sentences with his name in them (the
  default), or everything anyone says. Each server keeps its own choice until Keith restarts.
- `/say text`, `/shutup`, `/leave`, `/reset` (forget channel history).

## Tests

- `npm test` runs every `*.test.ts` file (Node's built-in test runner).
- `npm run test:watch` re-runs them on every save: handy for writing a test first, then the code.
- `src/tts/piper.test.ts` and `src/stt/whisper.test.ts` run the real Piper and faster-whisper, so they
  take a few seconds; they skip themselves if those aren't set up.
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
  stt/
    transcriber.ts          the speech-to-text interface: local or api
    whisper.ts              keeps one faster-whisper process running (whisper_worker.py)
    apiTranscriber.ts       OpenAI-compatible /audio/transcriptions (Groq)
    audio.ts                48 kHz stereo to 16 kHz mono, WAV header
    transcript.ts           drops sound tags and phrases Whisper makes up from noise
  voice/
    session.ts              Discord voice connection (DAVE): playback and receiving audio
    listener.ts             records an utterance, transcribes it, passes the text on in order
    speechDetector.ts       talking vs background noise, for mics that never stop sending
    addressing.ts           /listen modes: was that sentence for Keith?
    speechQueue.ts          what to speak when: ordered sentences, /shutup, streaming replies
    manager.ts              one session per guild
  workers/
    pythonWorker.ts         one long-lived Python process, JSON lines in and out
```

Each `*.test.ts` sits next to the file it tests.
