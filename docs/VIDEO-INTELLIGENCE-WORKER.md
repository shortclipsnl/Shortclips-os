# Video Intelligence — verwerk-server (worker)

De online hub (Vercel) kan het zware videowerk van Video Intelligence **niet**
draaien: serverless heeft geen Python-omgeving, geen systeeminstallaties en een
tijdslimiet per aanvraag. Daarom werkt de online hub zo:

- **AI-duiding** (Anthropic-sleutel) en **ffmpeg-metrics** (via een npm-pakket)
  draaien overal, ook online.
- **Transcriptie (Whisper), OCR (teksten in beeld) en video ophalen via URL
  (yt-dlp)** vereisen programma's op de machine. Die zet de online hub **niet**
  zelf; een nieuwe analyse blijft daar op status **"queued"** staan.

Een **worker** op een eigen, altijd-aan machine — met de tools én verbonden met
dezelfde database + opslag — pakt die `queued`-jobs op en draait de volledige
pijplijn. Zo krijgt het hele team volledige VI via de online hub.

```
Online hub (Vercel)                 Verwerk-server (jouw machine)
 ─ voegt video toe  ──enqueue──▶  video_analyses.status = "queued"
                                         │  (worker pollt de DB)
                                         ▼
                                   npm run vi:worker
                                   ─ claimt de job (atomisch)
                                   ─ draait runPipeline:
                                       download (yt-dlp/opslag) · probe · shots ·
                                       editing · OCR · transcriptie · AI-duiding
                                   ─ schrijft resultaat terug in dezelfde DB
 ◀───────────── de hub toont het resultaat ─────────────────────────
```

## 1. Machine

Een altijd-aan computer met internettoegang naar je Supabase-database en -opslag:
een **Mac mini** die je al hebt, of een kleine **Linux-VPS** (bijv. 2 vCPU / 4 GB).
Geen GPU nodig (faster-whisper draait prima op CPU voor korte video's).

## 2. Code + tools installeren

```bash
# 1. De code op de machine (zelfde repo).
git clone <repo> shortclips-os && cd shortclips-os
npm install                       # installeert ook ffmpeg-static/ffprobe-static

# 2. uv (Python-pakketbeheer).
curl -LsSf https://astral.sh/uv/install.sh | sh     # zet uv in ~/.local/bin

# 3. yt-dlp (video ophalen via platform-URL).
uv tool install yt-dlp            # komt in ~/.local/bin/yt-dlp

# 4. De transcriptie-/OCR-venv aanmaken en vullen.
uv venv .venv-vi
uv pip install -p .venv-vi/bin/python faster-whisper rapidocr-onnxruntime
```

Controle dat alles er is:

```bash
.venv-vi/bin/python -c "import faster_whisper, rapidocr_onnxruntime; print('OK')"
~/.local/bin/yt-dlp --version
ls node_modules/ffmpeg-static/ffmpeg          # ffmpeg via npm
```

> ffmpeg kan ook de systeemversie zijn (`brew install ffmpeg` / `apt install ffmpeg`);
> zet dan `FFMPEG_PATH`/`FFPROBE_PATH` in de env. De npm-pakketten volstaan meestal.

## 3. Omgevingsvariabelen

Zet dezelfde productiewaarden als op Vercel (de worker praat met dezelfde DB + opslag):

```bash
export DATABASE_URL="postgres://…@…pooler.supabase.com:6543/postgres"  # transaction pooler
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="…"
export SUPABASE_VI_BUCKET="…"           # dezelfde bucket als de hub
export ANTHROPIC_API_KEY="…"            # voor de AI-duiding/-conclusies
# Optioneel, alleen als de binaries elders staan:
# export FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
# export FFPROBE_PATH=/opt/homebrew/bin/ffprobe
# export YTDLP_PATH=$HOME/.local/bin/yt-dlp
# Afstelling (standaardwaarden):
# export VI_WORKER_INTERVAL_MS=5000      # hoe vaak de wachtrij gepolld wordt
# export VI_WORKER_STALE_MIN=30          # vastgelopen job (crash) na X min opnieuw oppakken
```

> Zet geen `DATABASE_URL` → dan draait de worker op de lokale PGlite (alleen voor ontwikkeling).

## 4. Draaien

```bash
npm run vi:worker            # blijft draaien, pollt de wachtrij
npm run vi:worker -- --once  # verwerkt wat klaarstaat en stopt (handig voor een test/cron)
```

### Als service (auto-herstart)

**macOS (launchd)** — `~/Library/LaunchAgents/nl.shortclips.vi-worker.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>nl.shortclips.vi-worker</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-lc</string>
    <string>cd /Users/USER/shortclips-os && npm run vi:worker</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>DATABASE_URL</key><string>…</string>
    <key>SUPABASE_URL</key><string>…</string>
    <key>SUPABASE_SERVICE_ROLE_KEY</key><string>…</string>
    <key>SUPABASE_VI_BUCKET</key><string>…</string>
    <key>ANTHROPIC_API_KEY</key><string>…</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/vi-worker.log</string>
  <key>StandardErrorPath</key><string>/tmp/vi-worker.err</string>
</dict></plist>
```
`launchctl load ~/Library/LaunchAgents/nl.shortclips.vi-worker.plist`

**Linux (systemd)** — `/etc/systemd/system/vi-worker.service`:

```ini
[Unit]
Description=ShortClips Video Intelligence worker
After=network-online.target

[Service]
WorkingDirectory=/home/USER/shortclips-os
EnvironmentFile=/home/USER/shortclips-os/.env.worker
ExecStart=/usr/bin/npm run vi:worker
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
`sudo systemctl enable --now vi-worker`

(Alternatief: `pm2 start npm --name vi-worker -- run vi:worker` + `pm2 save`.)

## 5. Verifiëren

1. Start de worker; de log toont `Gestart. Database: postgres (DATABASE_URL)`.
2. Voeg in de online hub een video toe (upload of platform-URL). Hij staat even op
   **In wachtrij**.
3. Binnen een polling-interval pakt de worker 'm op (log: `Job … opgepakt`), de
   status gaat naar **Verwerken** en daarna **Klaar**.
4. Op de analyse-detailpagina staan onder "Analyse-onderdelen" nu **geen** stappen
   meer als "Nog niet beschikbaar" — transcriptie en OCR zijn **Klaar**.

## Technisch

- De worker is `scripts/vi-worker.ts`; hij hergebruikt de bestaande pijplijn
  `runPipeline(analysisId)` (`src/server/video-intelligence/pipeline.ts`) en de
  tool-detectie (`tools.ts`). Niets aan de analyse-logica is gedupliceerd.
- De hub draait het zware werk alleen inline als de tools aanwezig zijn
  (`canRunHeavyPipeline()`); op Vercel blijft de job dus `queued`.
- Jobs worden atomisch geclaimd (`FOR UPDATE SKIP LOCKED`), dus je mag gerust
  meerdere workers draaien voor meer doorvoer.
- `NODE_OPTIONS=--conditions=react-server` in het npm-script laat de server-only
  modules buiten Next draaien.
