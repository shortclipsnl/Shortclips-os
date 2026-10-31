# Shortclips AI Editor

Ruwe camerabeelden erin, een complete advertentie in de **Shortclips Ads Style**
eruit. Voor de eigen advertenties van Shortclips (niet klantgebonden).

Pagina's: `/ai-editor` (projecten), `/ai-editor/<id>` (monteren, preview,
feedback, export), `/ai-editor/stijl` (Stijlbeheer).

Rechten: `ai_editor:read` (bekijken), `ai_editor:run` (monteren),
`ai_editor:style` (Stijlbeheer). Eigenaar en beheerder hebben alles;
projectcoördinator en content creator krijgen standaard `read` + `run`.

## Hoe het werkt

```
Browser ── upload / Drive-link ──▶ opslag (Supabase of .data/)        ai_editor_jobs (wachtrij)
   │                                                                          │
   └── "Genereer advertentievideo" ──▶ job "generate" ─────────────▶ verwerk-server (npm run ai-editor:worker)
                                                                              │
   1. Bronnen ophalen (originelen, niets vooraf gecomprimeerd)                 │
   2. Analyse per bestand: ffprobe, log-detectie, kleur, luidheid             │
   3. Transcriptie met woordtijden (faster-whisper, per spraakdeel)           │
   4. Montageplan: takes kiezen, versprekingen/pauzes eruit, volgorde,        │
      zooms, b-roll, ondertitels, kaarten (+ optioneel Claude)                │
   5. Kleur: log → Rec.709 (LUT of generiek), daarna per bron gelijk-          │
      getrokken naar de profielwaarden (gesloten lus: meten, bijstellen)      │
   6. Render (ffmpeg): segmenten → concat → compositie → loudnorm             │
   7. Kwaliteitscontrole: technisch (blokkeert) en creatief (advies)          │
                                                                              ▼
   Preview (halve resolutie) ◀── opslag ◀──────────────────────────────── resultaat
```

- **Het montageplan is de bron van waarheid** (`ad_edit_projects.plan`). Feedback
  past het plan aan; de render hergebruikt elk segment waarvan de invoer niet
  veranderd is (hash-cache in de werkmap). Ondertitels hangen aan woordtijden en
  kloppen daardoor na elke wijziging automatisch.
- **Er wordt geen tekst verzonnen.** Ondertitels zijn de gesproken woorden (met de
  spelling uit het script als dat er is). Kaartteksten van Claude worden
  gecontroleerd tegen wat er gezegd is; anders vallen ze af (staat in de uitleg).
- **Takes**: met script per zin de beste take (dekking, opvulwoorden, herstarts,
  continuïteit). Scoren twee inhoudelijk verschillende takes vrijwel gelijk, dan
  kiest het team. Zonder script worden valse starts en dubbele takes herkend en
  wint de laatste volledige poging.
- **Definitieve export** komt uit de originele bestanden in volle kwaliteit:
  H.264 High, 25 fps, CRF 16 (max 16 Mbit/s), AAC 320 kbps, -16,5 LUFS / -1 dBTP,
  faststart. Formaten 9:16 (1080×1920), 4:5 en 1:1.
- Zonder `ANTHROPIC_API_KEY` werkt alles met de vaste logica (CTA-kaart, b-roll op
  opsommingen, feedback via vaste patronen). Met sleutel kiest Claude extra kaarten
  en b-rollmomenten en vertaalt het vrije feedback.

## Verwerk-server inrichten

De online hub (Vercel) zet alleen jobs klaar. Het zware werk draait op een
altijd-aan machine, dezelfde opzet als de Video Intelligence-worker
(`docs/VIDEO-INTELLIGENCE-WORKER.md`). Eén machine kan beide workers draaien.

```bash
cd shortclips-os && npm install            # ffmpeg-static/ffprobe-static komen mee
uv venv .venv-vi                            # als die er nog niet is
uv pip install -p .venv-vi/bin/python faster-whisper pillow numpy
.venv-vi/bin/python -c "import faster_whisper, PIL; print('OK')"
```

Omgeving (zelfde waarden als productie):

```bash
DATABASE_URL=…                 # Supabase transaction pooler
SUPABASE_URL=…  SUPABASE_SERVICE_ROLE_KEY=…
SUPABASE_AI_EDITOR_BUCKET=ai-editor          # wordt automatisch aangemaakt (privé)
GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GOOGLE_REFRESH_TOKEN=…   # voor Drive-bronnen
ANTHROPIC_API_KEY=…            # optioneel, voor de AI-laag
AI_EDITOR_WHISPER_MODEL=medium # tiny/base/small/medium/large-v3
AI_EDITOR_WORK_DIR=/pad/met/ruimte           # rendercache + gedownloade originelen
```

Starten: `npm run ai-editor:worker` (of `-- --once`). Als service: kopieer de
launchd/systemd-voorbeelden uit de VI-worker-documentatie en vervang
`vi:worker` door `ai-editor:worker`.

Het Whisper-model wordt bij de eerste run gedownload (medium ~1,5 GB).

## Grote camerabestanden

Uploaden via de browser gaat naar Supabase Storage en is daar beperkt tot de
bestandslimiet van het plan (Free: 50 MB per bestand; `AI_EDITOR_MAX_UPLOAD_MB`).
Ruwe camerabestanden zijn vaak groter. Daarvoor is de **Google Drive-link**: zet de
opnamedag in een Drive-map, plak de link, en de verwerk-server downloadt de
originelen zelf (gestreamd, geen limiet). Op Supabase Pro kan de limiet omhoog.

## Stijlbeheer

- Het profiel heeft versies; opslaan maakt een nieuwe actieve versie, elke oude
  versie is terug te zetten. Een project onthoudt met welke versie het gemaakt is.
- **Referentievideo's**: upload of "Gebruik deze video als stijlreferentie" na een
  export. De worker meet ritme, pauzes, tempo, kleur, luidheid en muziekniveau en
  stelt alleen afwijkende waarden voor. Overnemen gebeurt per waarde, na akkoord.
- **Muziek**: de nieuwste actieve track wordt onder de stem gezet (ducking,
  ~14 dB onder de stem). Zonder track geen muziekbed.
- **LUT's**: technische conversie per log-profiel (S-Log3, V-Log, C-Log, …).
  Zonder LUT gebruikt de editor een generieke curve en meldt dat in de QC.
- Niet automatisch te meten (handmatig vastgelegd): typografie van de kaarten en
  de muziekkeuze. Zie `STYLE_PROVENANCE` in `style-profile.ts`.

## Kosten

Per project staat in het portaal wat de video kostte: AI-tokens (tarief via
`AI_EDITOR_CENTS_PER_MTOK_IN/OUT`, standaard een schatting), rendertijd
(`AI_EDITOR_RENDER_CENTS_PER_HOUR`, standaard € 0 op een eigen machine) en opslag
(`AI_EDITOR_STORAGE_CENTS_PER_GB_MONTH`). Transcriptie draait lokaal (geen
kosten per minuut) en wordt hergebruikt als dezelfde bron opnieuw voorkomt.

## Bestanden

| Pad | Wat |
|---|---|
| `src/server/ai-editor/style-profile.ts` | Profielschema + gemeten startwaarden |
| `src/server/ai-editor/takes.ts` | Take-herkenning, scriptuitlijning, knippen, zooms |
| `src/server/ai-editor/planner.ts` | Montageplan, b-roll, CTA, AI-laag met tekstcontrole |
| `src/server/ai-editor/plan.ts` | Plan-types, tijdlijn, ondertitelblokken |
| `src/server/ai-editor/grade.ts` | Kleurconversie en shot-matching |
| `src/server/ai-editor/render.ts` | ffmpeg-render met segmentcache |
| `src/server/ai-editor/qc.ts` | Kwaliteitscontrole |
| `src/server/ai-editor/feedback.ts` | Feedback → bewerkingen |
| `src/server/ai-editor/pipeline.ts` | Jobs: generate, revise, export, referentie |
| `scripts/ai_editor_transcribe.py` | Transcriptie per spraakdeel |
| `scripts/ai_editor_overlays.py` | Ondertitels en UI-kaarten als PNG (Poppins/Inter) |
| `scripts/ai-editor-worker.ts` | De worker |
| `tests/ai-editor.test.ts` | Unittests |
