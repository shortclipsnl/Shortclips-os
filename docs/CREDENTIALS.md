# Benodigde credentials

De koppelingen zijn volledig gebouwd. Wat ontbreekt zijn de sleutels. Hieronder
staat per koppeling wat er nodig is, waar je het vandaan haalt, welke rechten
het moet hebben en hoe je controleert of het werkt.

Zet alles in `.env.local` (lokaal) of in de omgevingsvariabelen van je hosting.
**Nooit in Git.** `.env.example` bevat alle namen zonder waarden.

Op **Instellingen → Koppelingen** staat dezelfde informatie in de applicatie
zelf, met per koppeling een knop "Verbinding testen".

---

## Verplicht voor productie

### `SESSION_SECRET`
Ondertekent en beschermt sessies. Zonder deze waarde weigert de applicatie in
productie te starten.

```bash
openssl rand -base64 48
```

### `DATABASE_URL`
De Postgres-verbinding. Bij Supabase: Project → Settings → Database →
Connection string (URI). Zonder deze waarde valt de applicatie terug op PGlite,
wat alleen voor ontwikkelen bedoeld is.

### `CRON_SECRET`
Beschermt `/api/jobs/run` tegen misbruik. Zonder deze waarde is die route dicht.

```bash
openssl rand -hex 32
```

---

## Monday.com

| Variabele | Nodig | Waar |
|---|---|---|
| `MONDAY_API_TOKEN` | ja | monday.com → avatar rechtsboven → **Developers** → **My access tokens** |
| `MONDAY_WEBHOOK_SECRET` | aanbevolen | Wordt getoond bij het aanmaken van een webhook |
| `MONDAY_API_VERSION` | nee | Standaard `2026-07` |

**Benodigde rechten:** `boards:read`, `boards:write`, `users:read`,
`updates:read`, `webhooks:write`.

**Webhook-adres:** `https://<jouw-domein>/api/webhooks/monday`
Monday stuurt bij registratie eerst een `challenge`; de applicatie beantwoordt
die automatisch.

**Testen:** Instellingen → Koppelingen → Monday.com → Verbinding testen. Bij
succes zie je met welk account je verbonden bent.

---

## Frame.io

| Variabele | Nodig | Waar |
|---|---|---|
| `FRAMEIO_TOKEN` | ja | developer.frame.io → app aanmaken → server-to-server OAuth of developer token |
| `FRAMEIO_ACCOUNT_ID` | ja | Zichtbaar in de URL van je Frame.io-omgeving |
| `FRAMEIO_WEBHOOK_SECRET` | aanbevolen | Wordt getoond bij het aanmaken van een webhook |

**Benodigde rechten:** lezen op projects, folders, files en comments. Schrijven
alleen als je statussen wilt terugzetten.

**Webhook-adres:** `https://<jouw-domein>/api/webhooks/frameio`

De applicatie gebruikt de **V4 API** (`https://api.frame.io/v4`).

---

## Google Drive

| Variabele | Nodig | Waar |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ja | console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (type: Web application) |
| `GOOGLE_CLIENT_SECRET` | ja | Zelfde scherm |
| `GOOGLE_REFRESH_TOKEN` | ja | Eenmalig via de OAuth-consent flow |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | aanbevolen | Laatste deel van de URL van de hoofdmap in Drive |

**Benodigde scope:** `https://www.googleapis.com/auth/drive.readonly`
(gebruik `.../auth/drive` alleen als je ook wilt schrijven).

**Refresh-token verkrijgen:** doorloop de consent flow met
`access_type=offline` en `prompt=consent`. Zet de Drive API aan onder
APIs & Services → Library.

Zonder `GOOGLE_DRIVE_ROOT_FOLDER_ID` weet de importwizard niet welke mappen
klanten zijn; die melding krijg je dan ook in de dry run.

---

## Ayrshare (social statistieken)

| Variabele | Nodig | Waar |
|---|---|---|
| `AYRSHARE_API_KEY` | ja | app.ayrshare.com → Dashboard → API Key |

Levert cijfers van Instagram, TikTok, YouTube, Facebook en LinkedIn via één
koppeling, inclusief de OAuth-afhandeling per klant.

Let op wat wél en niet beschikbaar is: weergaven en interacties zijn vrijwel
actueel, bereik en kijktijd lopen één tot drie dagen achter, en TikTok-retentie
en opslagacties zijn niet via de API op te halen. Beloof dat dus niet aan klanten.

---

## AI (optioneel)

| Variabele | Nodig | Waar |
|---|---|---|
| `ANTHROPIC_API_KEY` | nee | console.anthropic.com |
| `AI_MODEL` | nee | Standaard `claude-sonnet-5` |

Alleen nodig voor tekstuele samenvattingen. De rekenkundige analyses — hooks,
doorlooptijden, revisiepatronen, risicosignalen — werken volledig zonder sleutel.

---

## Controleren of alles klopt

1. Start de applicatie opnieuw na het wijzigen van omgevingsvariabelen.
2. Ga naar **Instellingen → Koppelingen**.
3. Elke koppeling toont zijn status en, als er iets ontbreekt, precies welke
   variabele en waar je die haalt.
4. Klik op **Verbinding testen**. De uitkomst wordt opgeslagen en is later terug
   te zien, inclusief de laatste foutmelding.
5. Ga daarna naar **Instellingen → Importeren** voor de eerste dry run.
