# Keith (discord-keith-ai)

Discord AI bot: chats in text, speaks in voice via Piper TTS, listens in voice via Whisper STT. Runs on Windows.

A change is done when `npm run typecheck` and `npm test` pass. Say what is left for the owner to check in
Discord: tests can't cover the live connection, playback or the real model.

## Working style

- **Readable code is a requirement:** the owner reads and edits this code without help. Clear names, small
  functions, explicit code over clever one-liners; comment the *why* of anything non-obvious.
- **Test-first for logic:** write or extend the `*.test.ts` next to the module, watch it fail, then make it
  pass (`npm run test:watch`). Node's built-in runner; plain-English test names; explain expected values.
- **Thin edges, tested middle:** Discord, the LLM and processes stay in small adapters
  (`chat/discordMessages.ts`, `llm/client.ts`, `voice/session.ts`, `index.ts`). Logic behind them takes its
  outside world as parameters (`createResponder(deps)`, `new SpeechQueue(options)`) so tests pass fakes.
  Modules that tests import must not import `config.ts`: it throws without a `.env`.

## Stages

1. Text bot: working (owner confirmed in Discord, 2026-10-30).
2. Voice out (Piper TTS): working: `/join` and `/say` confirmed in Discord, 2026-10-30.
3. Voice in (STT): built 2026-11-04, not yet confirmed in Discord. `voice/session.ts` subscribes to each
   speaker (ends after 700 ms of silence) → `voice/listener.ts` decodes Opus, converts to 16 kHz mono,
   transcribes, passes text on in order → `handleSpokenMessage` posts the transcript in the /join text
   channel and answers it through the normal `respond` path, so the reply is spoken. `STT_ENGINE`: `local`
   (faster-whisper worker, base.en, Silero VAD on) or `api` (Groq `whisper-large-v3-turbo`).
4. Polish: `/listen` switches between answering only sentences with Keith's name (default) and everything
   (`voice/addressing.ts`, per guild, in memory). Name matching allows one wrong letter
   ("Keeith"). `STT_PROMPT` defaults to "A voice chat with Keith and friends." for local and none for Groq:
   prompts made Groq drop or misspell the name in testing. A transcript that only echoes it counts as nothing.
   `/musings` (off by default, per guild) says a random `personality/phrases.ts` line after 1.5 to 6 min of
   quiet; any talking restarts the wait. Personality: `prompts/jarvis.md` (`SYSTEM_PROMPT_FILE`, re-read per reply by `personality/promptFile.ts`) (a self-proclaimed
   ancient god with dark humor, inspired by the Dagoth Ur mod; original lines, no game lore).
   Music: with `MUSIC_BOT_KEY`, the model gets tools (`music/musicTools.ts`) to control Brick Maback
   (`../discord-music-bot`) through its web API, acting as the asker (`X-Acting-User-Id`), and
   `voice/ducker.ts` turns Brick down while the bot speaks. Tool calls run in `llm/toolLoop.ts`.
   TODO: barge-in via `VoiceSession.stop()`. Members see each answered transcript.

## Gotchas

- **DAVE:** Discord requires end-to-end voice encryption since 2026-03-01. `@snazzah/davey` stays a real
  dependency; `daveEncryption` defaults to true in @discordjs/voice. Without it, joining fails (close code 4017).
- **Stopping speech:** a reply that streams into voice goes through `startReply()`, which goes quiet after
  `stop()`. Feeding sentences to `speak()` yourself would keep talking after `/shutup`.
- **The reply only grows:** `hideThinking` (llm/thinking.ts) holds back half-written `<think>` tags so each
  "reply so far" extends the previous one. `ReplySpeech` relies on that to speak only the new part.
- **Audio receive** is undocumented by Discord; @discordjs/voice support may be fragile. Its `AfterSilence`
  end timer only starts on the first packet, so a speaker whose packets never get through (DAVE) kept a
  stream open forever and was never heard again. So streams are `Manual`: `listener.ts` ends a sentence
  after 700 ms of hush (no packets, or quiet ones per `speechDetector.ts`, since open mics never stop
  sending), keeps reading for the next sentence, and destroys the stream once packets stop. Keith logs one
  `[listen]` line per utterance. Only `[DAVE]` debug lines are logged: the others contain the voice key.
- **opusscript** shares one fixed-size WebAssembly heap per loaded copy; ~54 live decoders fill it and it
  corrupts itself. Listening loads its own copy (`voice/opusDecoder.ts`) so it can't break playback.
- **Python workers:** Piper and faster-whisper each run as one long-lived process through
  `workers/pythonWorker.ts` (JSON lines). Both live in `.venv`; `WHISPER_PYTHON` defaults to `PIPER_PYTHON`.
- **Piper:** `piper-tts` (1.8.0) lives in `.venv`. Loading a voice takes ~4 s; synthesis then runs at ~0.2×
  realtime. So `src/tts/piper.ts` keeps one `piper_worker.py` process alive (JSON lines over stdin/stdout) and
  warms it up on `/join`; spawning Piper per sentence would add that 4 s to every sentence.
- **Opus** uses `opusscript` (pure JS) to avoid native builds on Windows; `@discordjs/opus` is faster if build
  tools exist.
- **Machines:** development happens on a laptop (i7-1165G7, 16 GB, Intel Iris Xe, no usable GPU for LLMs) that
  uses Groq with `openai/gpt-oss-120b`. The owner's Groq account has no Llama models (Enterprise only), so list
  what the key can use (`GET /openai/v1/models`) before suggesting one. The desktop PC runs a local LLM: llama.cpp with the Vulkan backend
  (RX 6650 XT, 8 GB), 7–8B model at Q4_K_M. Piper runs on CPU on both, so the GPU stays free for the model.

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
