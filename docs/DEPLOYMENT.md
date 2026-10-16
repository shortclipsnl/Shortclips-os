# Naar productie

## Voorwaarden

1. Een echte PostgreSQL-database. PGlite is uitsluitend voor lokaal werken:
   het ondersteunt één schrijvend proces en overleeft geen serverless omgeving.
2. `SESSION_SECRET` en `CRON_SECRET` gegenereerd.
3. HTTPS. De sessiecookie krijgt in productie automatisch de `Secure`-vlag.

## Optie 1 — Vercel + Supabase (aanbevolen)

### Database

1. Maak een Supabase-project.
2. Kopieer de connection string: Project → Settings → Database → **URI**.
3. Zet die als `DATABASE_URL`.

Migraties uitvoeren tegen productie:

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

Platformconfiguratie plaatsen (rollen, rechten, statussen, automatiseringen) —
**zonder** voorbeelddata:

```bash
DATABASE_URL="postgresql://..." npm run db:seed -- --config-only
```

Maak daarna het eerste eigenaarsaccount aan. De seed doet dat niet in
config-only-modus, juist om te voorkomen dat er een bekend wachtwoord in
productie belandt.

### Applicatie

1. Koppel de repository aan Vercel.
2. Zet de omgevingsvariabelen uit [CREDENTIALS.md](CREDENTIALS.md).
3. Deploy.

### Geplande taken

Voeg `vercel.json` toe:

```json
{
  "crons": [
    { "path": "/api/jobs/run?job=signals.daily", "schedule": "0 7 * * *" },
    { "path": "/api/jobs/run?job=signals.hourly", "schedule": "0 * * * *" },
    { "path": "/api/jobs/run?job=frameio.pull_comments", "schedule": "*/15 * * * *" },
    { "path": "/api/jobs/run?job=maintenance.prune_sessions", "schedule": "0 3 * * 0" }
  ]
}
```

Vercel Cron stuurt automatisch een `Authorization`-header met `CRON_SECRET`.
Gebruik je een andere scheduler, stuur dan zelf `Authorization: Bearer <CRON_SECRET>`.

## Optie 2 — Eigen server of container

```bash
npm ci
npm run build
DATABASE_URL="postgresql://..." npm run db:migrate
NODE_ENV=production npm start
```

Zet een reverse proxy met TLS ervoor (Caddy, nginx, Traefik). De applicatie
luistert standaard op poort 3000.

## Na de deploy controleren

| Controle | Hoe |
|---|---|
| Applicatie leeft | `GET /api/health` geeft `{"status":"ok"}` |
| Database | Zelfde response toont driver en reactietijd |
| Inloggen | Login met het eigenaarsaccount |
| Rechten | Log in als editor: geen finance in het menu |
| Klantscheiding | Log in als klant, probeer een andere klant-URL |
| Koppelingen | Instellingen → Koppelingen → Verbinding testen |
| Webhooks | Registreer de adressen, controleer de lijst "Ontvangen webhooks" |
| Taken | Instellingen → Koppelingen → een taak handmatig starten |

## Beveiliging in productie

- `SESSION_SECRET` gezet (anders start de applicatie niet)
- `CRON_SECRET` gezet (anders is `/api/jobs/run` dicht)
- Webhook-secrets gezet, zodat handtekeningen echt gecontroleerd worden.
  Zonder secret registreert de applicatie de handtekening als "niet
  gecontroleerd" — dat is zichtbaar op de integratiepagina en is bewust geen
  stilzwijgend akkoord.
- Beveiligingsheaders staan aan in `next.config.ts`
- Wachtwoorden met scrypt (OWASP-parameters), sessietokens alleen als hash in
  de database
- Audit logging op gevoelige acties, inclusief geweigerde pogingen

## Back-up

Bij Supabase staan automatische back-ups aan. Draai je zelf Postgres, richt dan
`pg_dump` in. De belangrijkste onvervangbare data zijn `social_metrics` en
`daily_metrics`: platforms bewaren die historie zelf niet.

Dagelijkse dump zelf draaien (naast Supabase, aan te raden):

```bash
pg_dump "$DATABASE_URL" --no-owner --format=custom \
  --file "shortclips-$(date +%F).dump"
# bewaar minstens 14 dagen aan dumps buiten de server
```

## Herstel (restore) — test dit vóór je Monday opzegt

Zet een back-up altijd eerst terug in een **gescheiden** database, nooit over
productie heen:

```bash
# 1) maak een lege hersteldatabase (Supabase: nieuw project of een branch)
# 2) zet de dump terug
pg_restore --no-owner --clean --if-exists \
  --dbname "$RESTORE_DATABASE_URL" shortclips-YYYY-MM-DD.dump
# 3) draai de app tegen RESTORE_DATABASE_URL en controleer:
#    - inloggen werkt
#    - klanten/video's/opnames tellen kloppen met productie
#    - Beheer → Systeemstatus toont de database als bereikbaar
```

Criterium 1 (exitcriteria) is pas behaald als een restore in een aparte omgeving
aantoonbaar is uitgevoerd.

## Synchronisatie controleren (dagelijks/na deploy)

- **Beheer → Koppelingen**: per koppeling status, **laatste succesvolle sync** en
  een **"Verouderd"-waarschuwing** als data > 24 u oud is. Een groen icoon alleen
  is onvoldoende — let op de versheid.
- **Beheer → Monday-migratie**: de 8 exitcriteria met status + bewijs, en de
  Monday-sync-schakelaar.
- **Beheer → Audit log / Systeemstatus**: recente `sync_jobs` (nieuw/bij/mislukt)
  en databaselatentie.
- Handmatig een sync forceren: `POST /api/jobs/run?job=<naam>` met
  `Authorization: Bearer $CRON_SECRET` (bv. `sync.nightly`, `calendar.sync`,
  `frameio.pull_comments`, `metricool.sync`, `drive.sync_all`).

## Veelvoorkomende storingen

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| Koppeling "Verouderd" terwijl verbonden | cron draait niet of token verlopen | controleer `CRON_SECRET`, draai de job handmatig, vernieuw de OAuth-refresh-token |
| "Nog niet ingesteld" | secret ontbreekt | vul de genoemde env-var in en herstart; klik "Verbinding testen" |
| Webhook komt niet binnen | webhook-secret leeg (fail-closed → 401) of URL niet geregistreerd | zet het secret, registreer de webhook-URL bij de externe dienst |
| Geen enkele sync draait | `CRON_SECRET` leeg → `/api/jobs/run` dicht | zet `CRON_SECRET` in de omgeving |
| Agenda/Drive dood | `GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN` leeg | OAuth-consent (offline, prompt=consent) opnieuw doorlopen |
| App start niet in productie | `SESSION_SECRET` leeg | genereer en zet `SESSION_SECRET` |

## Overdraagbaarheid (criterium 8)

Een tweede ontwikkelaar kan met deze map (`docs/`) zelfstandig: deployen
(dit bestand), de database en architectuur begrijpen (`ARCHITECTUUR.md`),
secrets vinden en zetten (`CREDENTIALS.md`), de Monday-migratie volgen
(`MIGRATIE.md`) en lokaal ontwikkelen (`ONTWIKKELEN.md`). Houd deze bestanden
bij elke structurele wijziging actueel.
