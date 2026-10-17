#!/usr/bin/env python3
"""
Transcriptie voor Video Intelligence met faster-whisper.

Aanroep:  vi_transcribe.py <audio.wav> <out.json> [taal]

Schrijft JSON in hetzelfde formaat dat de pijplijn verwacht:
  { "text": str, "language": str,
    "segments": [ { "start": float(s), "end": float(s), "text": str,
                    "words": [ { "word": str, "start": float(s), "end": float(s) } ] } ] }

Het model ("base") wordt bij de eerste run gedownload en daarna gecachet.
Alleen gesproken tekst wordt getranscribeerd; er wordt niets verzonnen.
"""
import json
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: vi_transcribe.py <audio> <out.json> [language]", file=sys.stderr)
        return 2
    audio_path = sys.argv[1]
    out_path = sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else "nl"

    import wave
    import numpy as np
    from faster_whisper import WhisperModel

    # Lees de 16kHz mono WAV zelf in (door ffmpeg aangeleverd) en geef hem als
    # float32-array door. Zo omzeilen we PyAV-versieconflicten.
    with wave.open(audio_path, "rb") as wf:
        n = wf.getnframes()
        channels = wf.getnchannels()
        raw = wf.readframes(n)
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        audio,
        language=language,
        word_timestamps=True,
        vad_filter=True,
    )

    out_segments = []
    full_text_parts = []
    for seg in segments:
        words = []
        for w in (seg.words or []):
            words.append({"word": w.word, "start": float(w.start), "end": float(w.end)})
        out_segments.append({
            "start": float(seg.start),
            "end": float(seg.end),
            "text": seg.text,
            "words": words,
        })
        full_text_parts.append(seg.text)

    result = {
        "text": "".join(full_text_parts).strip(),
        "language": info.language or language,
        "segments": out_segments,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
