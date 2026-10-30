# Keith (discord-keith-ai)

Discord AI bot: chats in text, speaks in voice via Piper TTS, will listen in voice via STT. Runs on Windows.

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
3. Voice in (STT): TODO. Per-user Opus stream from `connection.receiver` → decode to PCM → 16 kHz mono →
   end-of-speech detection (speaking end + ~700 ms silence, or Silero VAD) → faster-whisper / whisper.cpp →
   LLM → existing TTS path. The connection already joins with `selfDeaf: false`.
4. Polish: wake word / respond only when addressed, barge-in via `VoiceSession.stop()`,
   tell server members the bot listens and transcribes.

## Gotchas

- **DAVE:** Discord requires end-to-end voice encryption since 2026-03-01. `@snazzah/davey` stays a real
  dependency; `daveEncryption` defaults to true in @discordjs/voice. Without it, joining fails (close code 4017).
- **Stopping speech:** a reply that streams into voice goes through `startReply()`, which goes quiet after
  `stop()`. Feeding sentences to `speak()` yourself would keep talking after `/shutup`.
- **The reply only grows:** `hideThinking` (llm/thinking.ts) holds back half-written `<think>` tags so each
  "reply so far" extends the previous one. `ReplySpeech` relies on that to speak only the new part.
- **Audio receive** is undocumented by Discord; @discordjs/voice support may be fragile.
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
