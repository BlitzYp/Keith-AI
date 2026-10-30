"""Keeps one Piper voice loaded and synthesizes requests from stdin, in order.

Started by src/tts/piper.ts as: python piper_worker.py <model.onnx>
Protocol, one JSON object per line:
  in:  {"id": 1, "text": "Hello.", "out": "C:/.../file.wav"}
  out: {"id": 1} on success, {"id": 1, "error": "..."} on failure
"""

import json
import sys
import wave

from piper import PiperVoice

# Windows defaults pipes to the ANSI code page; Node sends UTF-8.
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

voice = PiperVoice.load(sys.argv[1])

for line in sys.stdin:
    request = json.loads(line)
    try:
        with wave.open(request["out"], "wb") as wav:
            voice.synthesize_wav(request["text"], wav)
        print(json.dumps({"id": request["id"]}), flush=True)
    except Exception as err:
        print(json.dumps({"id": request["id"], "error": str(err)}), flush=True)
