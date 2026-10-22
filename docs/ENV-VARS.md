# Omgevingsvariabelen (ENV) — ShortClips OS

> **Alleen de NAMEN staan hier, bewust GEEN waarden.** De echte waarden (secrets,
> API-sleutels, tokens) staan in Vercel (Project → Settings → Environment
> Variables) en horen daar te blijven. Bewaar een kopie van de waarden **alleen**
> in een wachtwoordmanager/kluis, nooit in platte tekst in deze backup of in git.
>
> Bron: `src/lib/env.ts` (de app valideert deze bij het opstarten).

## Verplicht voor een werkende productie

| Variabele | Waarvoor | Geheim? | Waar te halen |
|---|---|---|---|
| `DATABASE_DRIVER` | Zet op `postgres` in productie (`pglite` lokaal) | nee | handmatig |
| `DATABASE_URL` | Runtime-DB — **Supabase Transaction pooler, poort 6543** | **ja** | Supabase → Project Settings → Database → Connection string (Transaction) |
| `MIGRATE_DATABASE_URL` | Migraties tijdens build — **Supabase Session pooler, poort 5432** | **ja** | Supabase → Connection string (Session) |
| `SESSION_SECRET` | Ondertekent sessies (min. 32 tekens) | **ja** | zelf genereren (`openssl rand -base64 48`) |
| `APP_URL` | Publieke URL, bijv. `https://shortclips-os.vercel.app` | nee | handmatig |
| `CRON_SECRET` | Beveiligt `/api/jobs/run` (cron) | **ja** | zelf genereren |
| `SUPABASE_URL` | Project-URL (ook voor Video Intelligence-opslag) | nee | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role sleutel (volledige DB-toegang) | **ja** | Supabase → Settings → API |

## Koppelingen (optioneel — zonder blijft die integratie slapend)

| Variabele | Koppeling | Geheim? |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | Google Drive **en** Google Agenda (OAuth) | **ja** |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Drive-hoofdmap | nee |
| `GOOGLE_CALENDAR_IDS` | Komma-lijst van te syncen agenda's (leeg = alle) | nee |
| `MONDAY_API_TOKEN` / `MONDAY_WEBHOOK_SECRET` / `MONDAY_API_VERSION` | Monday.com | **ja** (token/secret) |
| `FRAMEIO_TOKEN` of `FRAMEIO_CLIENT_ID`+`FRAMEIO_CLIENT_SECRET`+`FRAMEIO_REFRESH_TOKEN` / `FRAMEIO_ACCOUNT_ID` / `FRAMEIO_WEBHOOK_SECRET` / `FRAMEIO_IMS_URL` | Frame.io (V4 via Adobe IMS) | **ja** |
| `AYRSHARE_API_KEY` | Social publiceren (Ayrshare) | **ja** |
| `METRICOOL_USER_TOKEN` | Social statistieken (Metricool) | **ja** |
| `ANTHROPIC_API_KEY` / `AI_MODEL` | AI Tools + Video Intelligence | **ja** (key) |
| `YOUTUBE_API_KEY` | Kanaalcijfers in bedrijfsonderzoek | **ja** |
| `SUPABASE_VI_BUCKET` | Storage-bucket voor Video Intelligence (default `video-intelligence`) | nee |
| `KOSTEN_IMPORT_TOKEN` | Beveiligt `/api/kosten/import` (DigiBoox-import) | **ja** |
| `LEADS_WEBHOOK_SECRET` | Beveiligt lead-intake webhook (Meta/Framer) | **ja** |
| `RESEND_API_KEY` / `MAIL_FROM` | E-mail (klantnotificaties via Resend) | **ja** (key) |

## Terugzetten na herstel
Zet al deze variabelen opnieuw in Vercel (scope **Production**, en meestal ook
**Preview**). Zet `DATABASE_URL` en `MIGRATE_DATABASE_URL` **bij het project zelf**,
niet op de gedeelde/team-tab. Zie `./BACKUP-RESTORE.md` stap 3.
