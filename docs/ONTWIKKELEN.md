# Werken aan ShortClips OS

## Opzet

```bash
npm install
cp .env.example .env.local     # invullen mag later
npm run db:migrate
npm run db:seed -- --fresh
npm run dev
```

## Structuur

Elke module volgt hetzelfde patroon:

| Laag | Waar | Verantwoordelijk voor |
|---|---|---|
| Schema | `src/db/schema/` | Tabellen, relaties, indexen |
| Datalaag | `src/server/<domein>.ts` | Queries, altijd met klantscoping |
| Acties | `src/server/actions/<domein>.ts` | Mutaties, altijd met rechtencontrole |
| Pagina's | `src/app/(app)/<domein>/` | Server components voor de weergave |
| Interactie | `<domein>/*.tsx` met `"use client"` | Alleen waar interactie nodig is |

## Regels die overal gelden

1. **Elke query op klantgebonden data gebruikt `scopeToClients()`.** Zonder
   uitzondering. Vergeet je dat, dan lekt data.
2. **Elke mutatie begint met `requirePermission()` en `assertClientAccess()`.**
3. **Geen secrets in de client.** Alles wat `process.env` leest hoort in
   `src/server/` of `src/lib/env.ts`, nooit in een component met `"use client"`.
4. **Foutmeldingen zijn Nederlands en begrijpelijk.** Technische details gaan
   naar `error_logs`, niet naar het scherm.
5. **Externe API's alleen via de adapters** in `src/server/integrations/`.

## Schema wijzigen

```bash
# 1. pas src/db/schema/*.ts aan
npm run db:generate -- --name beschrijvende_naam
# 2. controleer de gegenereerde SQL in drizzle/
npm run db:migrate
```

Migraties nooit achteraf aanpassen als ze al ergens gedraaid hebben; maak een
nieuwe.

### Let op bij gecorreleerde subqueries

Drizzle rendert `${tabel.kolom}` binnen een `sql`-template soms zonder
tabelnaam. In een subquery bindt die kolom dan aan de binnenste tabel, en krijg
je stilzwijgend verkeerde uitkomsten. Schrijf de tabelnaam daarom voluit:

```ts
// goed
sql`(select count(*) from scripts sc where sc.production_day_id = production_days.id)`

// fout — 'id' bindt aan scripts
sql`(select count(*) from scripts sc where sc.production_day_id = ${productionDays.id})`
```

## Tests

```bash
npm test              # alles
npm run test:watch    # tijdens het werken
```

Tests draaien op een eigen database in `.data/test-pglite`, los van de
ontwikkelomgeving. Ze kunnen dus naast `npm run dev` draaien.

Wat er getest wordt:

| Bestand | Onderwerp |
|---|---|
| `tests/auth.test.ts` | Wachtwoordhashing, rollen en rechten |
| `tests/isolation.test.ts` | Klantscheiding tegen een echte database |
| `tests/workflow.test.ts` | Pipeline, automatiseringen, ontdubbeling van meldingen |
| `tests/webhooks.test.ts` | Handtekeningen en idempotentie |
| `tests/import.test.ts` | Naamherkenning bij importeren |
| `tests/format.test.ts` | Opmaak, kalenderraster, statussen |

Bouw je iets dat toegang raakt, breid dan `tests/isolation.test.ts` uit.

## Voor het opleveren

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Huisstijl

Alle kleuren, typografie, afronding en schaduwen staan als design tokens in
`src/app/globals.css`. Pas ze daar aan, niet in componenten. De basiscomponenten
staan in `src/components/ui/index.tsx`.
