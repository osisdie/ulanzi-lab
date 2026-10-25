#!/usr/bin/env python3
"""Local speech-to-text for the ulanzi-lab Voice profile: Breeze-ASR on CPU behind an OpenAI-style endpoint.

  POST /v1/audio/transcriptions  multipart: file, model (breeze-asr-25 | breeze-asr-26), language (zh | en | auto),
                                 response_format (json | text | verbose_json)
  GET  /health                   {"ok": true, "model": <loaded or null>, "busy": bool}

Binds 127.0.0.1 only. One transcription at a time (a second request gets 503 "busy"); one model in memory, loaded on
first use. Exits after --idle-exit seconds without requests, and, with --exit-on-stdin-eof, when its parent closes
stdin (the plugin starts it on demand and holds the pipe open while it runs).
"""
import argparse
import os
import sys
import tempfile
import threading
import time

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

HOME = os.path.expanduser(os.environ.get("VOICE_ASR_HOME", "~/.local/share/ulanzi-lab/voice-asr"))
MODELS = {"breeze-asr-25": "breeze-asr-25-ct2-int8", "breeze-asr-26": "breeze-asr-26-ct2-int8"}
MAX_BYTES = 500 * 2**20

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=39312)
ap.add_argument("--models", default=os.path.join(HOME, "models"))
ap.add_argument("--threads", type=int, default=os.cpu_count())
ap.add_argument("--idle-exit", type=int, default=0, help="seconds without requests before exiting (0 = never)")
ap.add_argument("--exit-on-stdin-eof", action="store_true")
ap.add_argument("--preload", default="", help="model to load at startup, e.g. breeze-asr-25")
args = ap.parse_args()

app = FastAPI()
lock = threading.Lock()


@app.middleware("http")
async def guard(request: Request, call_next):
    # Browsers send Origin on cross-site POSTs; the plugin never does. Without this, any web page could make the
    # service transcribe (a simple multipart POST needs no preflight).
    if request.headers.get("origin"):
        return JSONResponse({"detail": "cross-origin requests are not accepted"}, status_code=403)
    # Reject oversized uploads before the multipart parser spools them to disk.
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_BYTES:
        return JSONResponse({"detail": "file too large (500 MB max)"}, status_code=413)
    return await call_next(request)


state = {"name": None, "model": None, "last": time.monotonic()}


def load(name):
    """The WhisperModel for `name`, replacing whichever model is loaded (only one fits comfortably in RAM)."""
    if state["name"] == name:
        return state["model"]
    path = os.path.join(args.models, MODELS[name])
    if not os.path.isfile(os.path.join(path, "model.bin")):
        flag = " --taigi" if name == "breeze-asr-26" else ""
        raise HTTPException(404, f"model {name} is not installed; run services/voice-asr/install.sh{flag}")
    from faster_whisper import WhisperModel  # slow import; keep /health instant

    state["name"], state["model"] = None, None  # free the old one first; a failed load leaves nothing half-set
    state["model"] = WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=args.threads)
    state["name"] = name
    return state["model"]


@app.get("/health")
def health():
    return {"ok": True, "model": state["name"], "busy": lock.locked()}


@app.post("/v1/audio/transcriptions")
def transcribe(file: UploadFile = File(...), model: str = Form("breeze-asr-25"), language: str = Form("zh"),
               response_format: str = Form("json")):
    if model not in MODELS:
        raise HTTPException(400, f"unknown model {model}; one of {', '.join(MODELS)}")
    if response_format not in ("json", "text", "verbose_json"):
        raise HTTPException(400, "response_format must be json, text or verbose_json")
    if not lock.acquire(blocking=False):
        return JSONResponse({"error": "busy"}, status_code=503)
    try:
        state["last"] = time.monotonic()
        suffix = os.path.splitext(file.filename or "")[1] or ".wav"
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
            size = 0
            while chunk := file.file.read(1 << 20):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "file too large (500 MB max)")
                tmp.write(chunk)
            tmp.flush()
            t0 = time.monotonic()
            m = load(model)
            # Taigi model: Taiwanese Hokkien in, Mandarin characters out, so always decode as zh.
            lang = "zh" if model == "breeze-asr-26" else (None if language == "auto" else language)
            segs, info = m.transcribe(tmp.name, language=lang, beam_size=1, vad_filter=True,
                                      vad_parameters={"min_silence_duration_ms": 500, "max_speech_duration_s": 25},
                                      condition_on_previous_text=False)
            segments = [{"id": i, "start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for i, s in enumerate(segs)]
        text = "".join(s["text"] for s in segments)
        if response_format == "text":
            return PlainTextResponse(text)
        out = {"text": text}
        if response_format == "verbose_json":
            out.update(task="transcribe", language=info.language, duration=round(info.duration, 2), model=model,
                       elapsed=round(time.monotonic() - t0, 2), segments=segments)
        return out
    finally:
        state["last"] = time.monotonic()
        lock.release()


def watchdogs():
    def idle():
        while True:
            time.sleep(15)
            if not lock.locked() and time.monotonic() - state["last"] > args.idle_exit:
                print(f"idle for {args.idle_exit} s, exiting", flush=True)
                os._exit(0)

    def stdin_eof():
        for _ in sys.stdin:
            pass
        print("stdin closed, exiting", flush=True)
        os._exit(0)

    if args.idle_exit > 0:
        threading.Thread(target=idle, daemon=True).start()
    if args.exit_on_stdin_eof:
        threading.Thread(target=stdin_eof, daemon=True).start()


if __name__ == "__main__":
    watchdogs()
    if args.preload:
        load(args.preload)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
