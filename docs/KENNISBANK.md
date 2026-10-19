# Shortclips Kennisbank

Interne kennisbank (vervanger van de Skool Classroom) onder **Team → Shortclips Kennisbank** (`/kennisbank`).

## Rechten

- **Lezen:** iedere interne gebruiker (medewerkers en freelancers). Klantaccounts (portaal) hebben geen toegang.
- **Beheren:** uitsluitend de eigenaar (`primary_role = owner`). Afgedwongen in:
  - `src/server/actions/kennisbank.ts` (elke schrijfactie begint met `requireOwner()`),
  - `src/app/api/kennisbank/assets/**` (uploaden alleen met `isOwner`).
  Nieuwe gebruikers krijgen dus nooit automatisch beheerrechten.
- **Afgeschermde cursus** (zoals "privé" in Skool): alleen eigenaar + gekozen rollen. Bestanden in zo'n cursus zijn ook via de bestands-URL afgeschermd.
- **Concept**: lessen/cursussen die niet gepubliceerd zijn, ziet alleen de eigenaar.

## Datamodel (`src/db/schema/kennisbank.ts`)

| Tabel | Inhoud |
|---|---|
| `kb_courses` | cursus: titel, beschrijving, cursusafbeelding, volgorde, afscherming, bronverwijzing |
| `kb_chapters` | hoofdstuk binnen een cursus |
| `kb_lessons` | les: inhoud als ProseMirror-JSON (verliesvrij, zelfde formaat als Skool), platte tekst voor zoeken/AI, video, bijlagen, bronverwijzing |
| `kb_lesson_revisions` | elke vorige versie van een les (bij elke opslag) |
| `kb_progress` | persoonlijke voortgang per medewerker |
| `kb_assets` + `kb_asset_parts` | eigen bestandsopslag in de database, in delen van 3 MB (uploads en downloads blijven binnen de serverless limieten; downloads worden gestreamd met Range-ondersteuning) |
| `kb_import_runs` | logboek van de Skool-import |

Verwijderen is altijd een soft delete (`deleted_at`), dus herstelbaar.

## Import uit Skool

- Bundel: `data/kennisbank-import/` (volledige Skool-export + alle afbeeldingen, bijlagen en video's als bestanden). Daardoor is de import onafhankelijk van Skool.
- `npm run kb:import` (draait ook automatisch in `vercel-build`). Idempotent: alleen als er nog geen geslaagde import is en de kennisbank leeg is. Alles in één transactie.
- Tekst en opmaak worden letterlijk overgenomen. Alleen technische verwijzingen worden omgezet: afbeeldingen naar eigen opslag, interne Skool-links naar de bijbehorende les.
- Status en openstaande punten: `/kennisbank/migratie` (alleen eigenaar).

## Zoeken en AI

- De centrale zoekfunctie (`src/server/search.ts`) doorzoekt lestitels én lestekst.
- `kennisbankContextForAi()` in `src/server/kennisbank.ts` geeft relevante SOP-passages met bronverwijzing terug, voor de interne AI. Alleen lezen: verandert nooit inhoud.
