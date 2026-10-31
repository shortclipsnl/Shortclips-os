#!/usr/bin/env python3
"""
Transcriptie voor de Shortclips AI Editor (faster-whisper, woordtijden).

Aanroep:  ai_editor_transcribe.py <audio.wav> <out.json> [taal] [model] [prompt_file] [clips.json]

Verschil met vi_transcribe.py: groter model (standaard "medium") voor betere
Nederlandse herkenning, geen VAD-filter (we willen elk woord, ook in valse
starts, zodat takes goed herkend worden) en optioneel het script als
initial_prompt, zodat namen en vaktermen goed gespeld worden. Met clips.json
(spraakdelen tussen stiltes) wordt elk deel los getranscribeerd: anders voegt
Whisper herhaalde zinnen (valse starts, tweede takes) samen tot één zin met
verkeerde woordtijden. Er wordt niets
verzonnen: alleen gesproken tekst komt in de uitvoer.

Uitvoer: { "language": str, "model": str,
           "words": [ { "w": str, "s": float, "e": float, "p": float } ] }
"""
import json
import sys
import wave


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: ai_editor_transcribe.py <audio.wav> <out.json> [taal] [model] [prompt_file]", file=sys.stderr)
        return 2
    audio_path, out_path = sys.argv[1], sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else "nl"
    model_name = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else "medium"
    prompt = None
    if len(sys.argv) > 5 and sys.argv[5]:
        with open(sys.argv[5], encoding="utf-8") as f:
            prompt = f.read().strip()[:800] or None

    clips = None
    if len(sys.argv) > 6 and sys.argv[6]:
        with open(sys.argv[6], encoding="utf-8") as f:
            clips = [float(x) for pair in json.load(f) for x in pair]

    import numpy as np
    from faster_whisper import WhisperModel

    with wave.open(audio_path, "rb") as wf:
        n = wf.getnframes()
        channels = wf.getnchannels()
        raw = wf.readframes(n)
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        audio,
        language=language,
        word_timestamps=True,
        vad_filter=False,
        condition_on_previous_text=False,
        initial_prompt=prompt,
        **({"clip_timestamps": clips} if clips else {}),
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if not text:
                continue
            words.append({"w": text, "s": round(float(w.start), 3), "e": round(float(w.end), 3), "p": round(float(w.probability), 3)})

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"language": info.language or language, "model": model_name, "words": words}, f, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
