# Video Intelligence — opzet & afhankelijkheden

Diepe analyse van organische short video's: shots, montage, transcriptie (woordtijden),
en — zodra er een AI-sleutel is — visuele duiding + conclusies. Strikt per klant gescheiden.

## Onderdelen & afhankelijkheden

| Stap | Levert | Afhankelijkheid | Hoe geregeld |
|---|---|---|---|
| Bron ophalen (upload) | Opgeslagen bestand | — | Upload-route schrijft naar `.data/video-intelligence/<id>/` |
| Bron ophalen (platform-URL) | Gedownload bestand | `yt-dlp` | `uv tool install yt-dlp` → `~/.local/bin/yt-dlp` |
| Video uitlezen / shots / thumbnails / montage | Duur, resolutie, shots, montagetempo | `ffmpeg`/`ffprobe` | npm-pakketten `ffmpeg-static` + `ffprobe-static` (project-scoped, geen systeeminstallatie) |
| Transcriptie (woordtijden) | Transcript + wpm + spreeksnelheid | `faster-whisper` | venv `.venv-vi/` + `scripts/vi_transcribe.py` |
| Teksten in beeld (OCR) | Tekst/ondertiteling per shot | `rapidocr-onnxruntime` | venv `.venv-vi/` + `scripts/vi_ocr.py` |
| Visuele duiding + AI-conclusies | Shotbeschrijvingen, hooks, structuur, conclusies | `ANTHROPIC_API_KEY` | In `.env.local` zetten (betaalde sleutel) |

Ontbreekt een tool/sleutel, dan wordt die stap eerlijk als **"nog niet beschikbaar"**
gemarkeerd — nooit nepdata. De module toont dit live in het setup-paneel op
`/video-intelligence`.

## Eenmalige opzet (lokaal, macOS arm64)

`ffmpeg-static`/`ffprobe-static` komen mee met `npm install`. Daarnaast:

```bash
# yt-dlp (platform-URL's)
uv tool install yt-dlp

# transcriptie + OCR-venv
uv venv .venv-vi
uv pip install -p .venv-vi/bin/python faster-whisper rapidocr-onnxruntime
```

Het Whisper-model (`base`) wordt bij de eerste transcriptie eenmalig gedownload en
daarna gecachet. `.venv-vi/` staat in `.gitignore`.

## Padoverrides (optioneel)

- `FFMPEG_PATH` / `FFPROBE_PATH` — expliciet pad naar de binaries.
- `YTDLP_PATH` — expliciet pad naar yt-dlp.
- `AI_MODEL` — Claude-model voor de duiding/conclusies.

## Productie (nog te doen — fase infra)

- Verwerking draait nu in-proces op de (lokale) server. Voor schaal: echte queue/worker.
- Objectopslag i.p.v. lokale `.data/`-schijf.
- Op Vercel (Linux) leveren `ffmpeg-static`/`ffprobe-static` automatisch de Linux-binaries;
  `yt-dlp` en de transcriptie-venv vereisen een eigen opzet of een losse worker.

## Opnieuw verwerken

Zodra een tool/sleutel beschikbaar komt: open de analyse → **"Opnieuw verwerken"**.
De pijplijn is herstartbaar en draait de nu-beschikbare stappen alsnog.
