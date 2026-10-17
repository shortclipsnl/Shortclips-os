#!/usr/bin/env python3
"""
OCR (teksten in beeld) voor Video Intelligence met rapidocr-onnxruntime.

Aanroep:  vi_ocr.py <out.json> <img1> [img2 ...]

Schrijft JSON:
  { "frames": [ { "image": "<basename>", "text": "<samengevoegde regels>" }, ... ] }

Herkent uitsluitend wat daadwerkelijk leesbaar in beeld staat; verzint niets.
Modellen zitten in het pakket (geen aparte download).
"""
import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: vi_ocr.py <out.json> <img...>", file=sys.stderr)
        return 2
    out_path = sys.argv[1]
    images = sys.argv[2:]

    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
    frames = []
    for img in images:
        text = ""
        try:
            result, _ = engine(img)
            if result:
                # result: list van [box, text, score]
                lines = [str(line[1]).strip() for line in result if line and line[1]]
                text = " ".join([ln for ln in lines if ln])
        except Exception as e:  # noqa: BLE001 — per frame falen mag de rest niet stoppen
            print(f"ocr error {img}: {e}", file=sys.stderr)
        frames.append({"image": os.path.basename(img), "text": text})

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"frames": frames}, f, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
