# ShortClips OS

Eén platform voor de complete videoworkflow van ShortClips: klanten, strategie,
scripts, opnamedagen, edit, goedkeuring, planning, publicatie, resultaten,
finance en team — bij elkaar, op één plek.

Monday.com, Frame.io en Google Drive blijven eronder bestaan als infrastructuur.
ShortClips OS is de centrale interface en de intelligentielaag daarboven.

---

## Snel starten

Je hebt alleen Node 18 of hoger nodig. **Geen database-installatie, geen Docker.**

```bash
cd ~/shortclips-os && npm install && npm run db:migrate && npm run db:seed -- --fresh && npm run dev
```

Open daarna <http://localhost:3000>.

### Inloggegevens van de voorbeelddata

| Rol | E-mailadres | Wachtwoord | Ziet |
|---|---|---|---|
| Eigenaar | `jarno@shortclips.nl` | `shortclips2026` | alles, inclusief finance |
| Projectcoördinator | `milou@shortclips.nl` | `shortclips2026` | alle klanten, geen finance |
| Editor | `daan@shortclips.nl` | `shortclips2026` | alleen eigen video's |
| Finance | `finance@shortclips.nl` | `shortclips2026` | omzet en facturen, geen interne feedback |
| Klantportaal | `marieke@frieslandlease.nl` | `shortclips2026` | uitsluitend de eigen omgeving |

Log in als editor of als klant en probeer via de URL bij een andere klant te
komen. Dat wordt geweigerd — dat is de kern van het rechtenmodel.

---

## Commando's

| Commando | Wat het doet |
|---|---|
| `npm run dev` | Ontwikkelserver |
| `npm run build` | Productiebuild |
| `npm start` | Productieserver |
| `npm run db:generate` | Nieuwe migratie genereren uit het schema |
| `npm run db:migrate` | Migraties uitvoeren |
| `npm run db:seed` | Voorbeelddata plaatsen (`-- --fresh` wist eerst, `-- --config-only` alleen configuratie) |
| `npm run db:reset` | Database volledig opnieuw opbouwen |
| `npm run db:studio` | Drizzle Studio openen |
| `npm run typecheck` | TypeScript controleren |
| `npm run lint` | ESLint |
| `npm test` | Testsuite |

---

## Wat werkt er nu

**Volledig werkend, met echte database en echte mutaties:**

- Inloggen met sessies (scrypt, httpOnly-cookie), uitloggen, sessieoverzicht
- Rollen en rechten (8 rollen, 47 rechten), server-afgedwongen klantscheiding
- Hoofddashboard dat de operationele vragen in één scherm beantwoordt
- Klantpagina met 15 tabbladen: overzicht, video's, scripts, opnames, planning,
  resultaten, rapportages, klantkennis, documenten, taken, contacten, contract
  en facturatie, AI-inzichten, koppelingen, activiteitentijdlijn
- Video pipeline in lijst- en kanbanweergave, met detailpagina, statuswissels,
  editortoewijzing, versies en gescheiden interne/klantfeedback
- Scriptmodule met automatische versiegeschiedenis
- Opnamedagen met checklist en risicosignalering
- Contentkalender (maandraster en lijst) met filters
- Taken, team en capaciteit, finance, resultaten, AI-inzichten
- Universele zoekfunctie over elf domeinen (⌘K)
- Klantportaal: goedkeuren, aanpassing vragen, scripts beoordelen
- Notificaties met ontdubbeling
- Automation engine met regels in de database en volledige uitvoeringslogging
- Integratielaag met adapters voor Monday, Frame.io en Google Drive
- Webhook-infrastructuur: eerst opslaan, dan verwerken, idempotent
- Achtergrondtaken met logging per run
- Importwizard met dry run, naamherkenning en reconciliation
- Beheer: gebruikers, rollen, automatiseringen, statussen, audit log, systeemstatus

**Wel volledig gebouwd, maar nog niet geactiveerd:** de koppelingen met
Monday.com, Frame.io, Google Drive en Ayrshare. De code is compleet — wat
ontbreekt zijn de API-credentials. Zie [docs/CREDENTIALS.md](docs/CREDENTIALS.md)
en de pagina Instellingen → Koppelingen, waar per koppeling staat wat er nodig
is en waar je het vandaan haalt.

---

## Documentatie

- [docs/ARCHITECTUUR.md](docs/ARCHITECTUUR.md) — hoe het systeem in elkaar zit en waarom
- [docs/CREDENTIALS.md](docs/CREDENTIALS.md) — welke sleutels nodig zijn en waar ze vandaan komen
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — naar productie brengen
- [docs/ONTWIKKELEN.md](docs/ONTWIKKELEN.md) — werken aan de code
- [docs/MIGRATIE.md](docs/MIGRATIE.md) — overstappen zonder het bedrijf stil te leggen
