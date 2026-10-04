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
