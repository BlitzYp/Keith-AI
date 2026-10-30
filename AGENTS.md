# Keith (discord-keith-ai)

Discord AI bot: chats in text, speaks in voice via Piper TTS, will listen in voice via STT. Runs on Windows.

A change is done when `npm run typecheck` is clean. Nothing has run against Discord yet, so say which
behaviour is verified only by typecheck.

## Stages

1. Text bot: built.
2. Voice out (Piper TTS): built.
3. Voice in (STT): TODO. Per-user Opus stream from `connection.receiver` → decode to PCM → 16 kHz mono →
   end-of-speech detection (speaking end + ~700 ms silence, or Silero VAD) → faster-whisper / whisper.cpp →
   LLM → existing TTS path. The connection already joins with `selfDeaf: false`.
4. Polish: wake word / respond only when addressed, barge-in via `VoiceSession.stop()`,
   tell server members the bot listens and transcribes.

## Gotchas

- **DAVE:** Discord requires end-to-end voice encryption since 2026-03-01. `@snazzah/davey` stays a real
  dependency; `daveEncryption` defaults to true in @discordjs/voice. Without it, joining fails (close code 4017).
- **Speech generation:** `VoiceSession.stop()` bumps `generation`. Any code feeding a reply into `speak()`
  over time captures `generation` first and stops feeding once it changes (see `src/chat.ts`).
- **Audio receive** is undocumented by Discord; @discordjs/voice support may be fragile.
- **Piper CLI:** `src/tts/piper.ts` passes text on stdin with `-m <model> -f <out.wav>`. Confirmed for the
  standalone binary only; verify against the `pip install piper-tts` CLI before relying on it.
- **Opus** uses `opusscript` (pure JS) to avoid native builds on Windows; `@discordjs/opus` is faster if build
  tools exist.
- **Local LLM on this PC:** llama.cpp/Ollama with the Vulkan backend (RX 6650 XT, 8 GB), 7–8B model at Q4_K_M.
  Piper runs on CPU so the GPU stays free for the model.

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
