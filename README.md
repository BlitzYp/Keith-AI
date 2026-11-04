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
- Keith sees pictures attached to the message, or to the message it replies to (up to 4, 8 MB each).
  Needs a model that takes images; set `LLM_SEES_IMAGES=false` for a text-only one.
- `/join` joins your VC. Keith listens: when someone stops talking (0.7 s of quiet), what they
  said is transcribed, posted in the text channel you used `/join` in, and answered out loud.
  Keith's replies in that text channel are spoken too. He doesn't listen to other bots.
- `/musings mode` (off by default): when the voice channel has been quiet for a while (1.5 to 6
  minutes, at random), Keith says something ominous from his phrase bank.
- **Personality:** edit `prompts/jarvis.md` while Keith runs; the next reply uses it. `{{name}}`
  becomes `BOT_NAME`, and `<!-- comments -->` are left out. Point `SYSTEM_PROMPT_FILE` at another
  `.md` file to swap personalities.
- **Music (Brick Maback):** with `MUSIC_BOT_KEY` set (same key as `INTEGRATION_KEY` in the music
  bot's `.env`), the bot can control Brick: "play daft punk", "skip this", "pause", "turn it down",
  "what song is this?", "queue something like this", "make it nightcore" / "slowed" (daycore),
  "what's in the queue?", "play the third one" / "play the Daft Punk song from the queue",
  "remove the Avicii song" / "take out everything Capitano queued", "what playlists do we have?",
  "play the touhou playlist" (added to the queue, or "instead of the queue" to replace it), and
  whole YouTube playlist links. It acts as whoever asked, so Brick's DJ-role
  and same-voice-channel rules still apply. While the bot talks in voice, Brick's music goes down,
  and comes back up shortly after.
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
prompts/
  jarvis.md                 who Keith is: the system prompt (SYSTEM_PROMPT_FILE)
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
    images.ts               which attachments are pictures; downloads them for the model
  personality/
    promptFile.ts           loads the system prompt from a Markdown file, re-read on edits
    phrases.ts              Keith's phrase bank for /musings
  music/
    brickClient.ts          talks to the music bot's API, acting as whoever asked
    musicTools.ts           the music tools the model can call (play, skip, now_playing, ...)
    brick.ts                the one client, if MUSIC_BOT_KEY is set
  llm/
    client.ts               OpenAI-compatible streaming client, one round at a time
    toolLoop.ts             runs the tools the model asks for, until it answers
    messages.ts             chat message types
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
    idleChatter.ts          /musings: a random line after a random quiet stretch
    ducker.ts               turns the music bot down while the bot speaks
    speechQueue.ts          what to speak when: ordered sentences, /shutup, streaming replies
    manager.ts              one session per guild
  workers/
    pythonWorker.ts         one long-lived Python process, JSON lines in and out
```

Each `*.test.ts` sits next to the file it tests.
