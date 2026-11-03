"""Keeps one faster-whisper model loaded and transcribes requests from stdin, in order.

Started by src/stt/whisper.ts as: python whisper_worker.py <model> [language] [prompt]
  model:    a faster-whisper model name (tiny.en, base.en, small.en, ...) or a folder with one.
            Named models download from Hugging Face on first use.
  language: e.g. "en"; leave it out (or "") to let Whisper guess (less reliable on short clips).
  prompt:   text Whisper treats as what was said just before, e.g. "Hey Keith." It nudges
            Whisper to spell names that way. Leave it out (or "") for none.
Protocol, one JSON object per line:
  in:  {"id": 1, "audio": "<base64 of 16 kHz mono 16-bit little-endian PCM>"}
  out: {"id": 1, "text": "..."} on success, {"id": 1, "error": "..."} on failure
"""

import base64
import json
import sys

import numpy as np
from faster_whisper import WhisperModel

# Windows defaults pipes to the ANSI code page; Node reads UTF-8.
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

model_name = sys.argv[1]
language = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
prompt = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None

# CPU keeps the GPU free for the LLM. int8 is the fastest CPU setting and barely hurts accuracy.
model = WhisperModel(model_name, device="cpu", compute_type="int8")

for line in sys.stdin:
    request = json.loads(line)
    try:
        pcm = np.frombuffer(base64.b64decode(request["audio"]), dtype=np.int16)
        audio = pcm.astype(np.float32) / 32768.0  # Whisper wants floats from -1 to 1
        segments, _info = model.transcribe(
            audio,
            language=language,
            initial_prompt=prompt,
            # Silero VAD cuts out the non-speech parts first: Whisper makes up words in silence.
            vad_filter=True,
            # Greedy decoding: noticeably faster than the default beam search on a CPU, and
            # short voice-chat sentences rarely gain from the search.
            beam_size=1,
        )
        text = " ".join(segment.text.strip() for segment in segments)
        print(json.dumps({"id": request["id"], "text": text}), flush=True)
    except Exception as err:
        print(json.dumps({"id": request["id"], "error": str(err)}), flush=True)
