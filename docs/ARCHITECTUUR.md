# Architectuur

## Uitgangspunt

ShortClips OS bouwt geen bestaande software opnieuw. Monday.com, Frame.io en
Google Drive blijven doen waar ze goed in zijn; ShortClips OS legt daar één
interface en één intelligentielaag overheen, met een eigen database die de
relaties tussen die systemen vasthoudt.

De centrale entiteit is de **klant**. Elke klant heeft één ShortClips-id waaraan
alles hangt: een Monday-board, een Frame.io-project, een Drive-map, contracten,
scripts, opnamedagen, video's, publicaties, cijfers en facturen.

## Verdeling van verantwoordelijkheid

| Systeem | Blijft leidend voor |
|---|---|
| Monday.com | Bestaande operationele planning, zolang die nog niet is overgezet |
| Frame.io | Videobestanden, versies, getimede opmerkingen, review |
| Google Drive | Documenten, ruwe beelden, rapportages |
| **ShortClips OS** | Cross-systeem relaties, dashboards, workflowlogica, analytics, AI, automatisering, notificaties, finance, rechten, audit, zoeken |

De architectuur is niet afhankelijk van Monday. Alle externe systemen lopen via
adapters (`src/server/integrations/`) met een eigen interface. Een koppeling
vervangen betekent één bestand vervangen, niet de applicatie herschrijven.

## Stack

- **Next.js 16** (App Router) met React 19 en TypeScript
- **Tailwind CSS 4** met design tokens in `src/app/globals.css`
- **Drizzle ORM** op **PostgreSQL**
- **Vitest** voor tests

### Twee databasedrivers, één schema

Lokaal draait de applicatie op **PGlite**: een volledige Postgres, gecompileerd
naar WebAssembly, die in `.data/pglite` op schijf leeft. Daardoor is er geen
database-installatie of Docker nodig om te beginnen, terwijl het wel echte
Postgres is — dezelfde SQL, dezelfde migraties, dezelfde types.

Zet `DATABASE_URL` en de applicatie schakelt naar gewone Postgres (Supabase,
Neon, of een eigen server). Er verandert niets aan het schema of de queries.

> **Belangrijk:** PGlite ondersteunt één schrijvend proces tegelijk. Dat is
> prima voor ontwikkelen, maar niet voor productie of voor het naast elkaar
> draaien van de webserver en achtergrondtaken. Gebruik daar altijd een echte
> Postgres.

## Lagen

```
src/
  app/                    Routes (App Router)
    (auth)/login          Inloggen
    (app)/                Interne applicatie — vereist een intern account
    (portal)/portal       Klantportaal — vereist een klantaccount
    api/                  Webhooks, zoeken, health, geplande taken
  components/             Designsysteem en layout
  db/
    schema/               60 tabellen, per domein gegroepeerd
    seed/                 Platformconfiguratie + voorbeelddata
    client.ts             Databaseverbinding (dual driver)
  lib/                    Env, opmaak, statussen, hulpfuncties
  server/
    auth/                 Sessies, wachtwoorden, rechten, viewer-context
    actions/              Server actions (alle mutaties)
    integrations/         Adapters per extern systeem
    jobs/                 Achtergrondtaken met logging
    *.ts                  Datalaag per domein
  proxy.ts                Lichte poortwachter vóór elke request
```

## Toegang en klantscheiding

Dit is het belangrijkste onderdeel van het ontwerp.

1. **`proxy.ts`** kijkt alleen of er een sessiecookie is. Deze laag heeft geen
   databasetoegang en neemt bewust geen beslissingen over rechten.
2. **`getViewer()`** (`src/server/auth/context.ts`) laadt per request één keer
   wie er kijkt, welke rechten die heeft en — cruciaal — welke klanten die mag
   zien (`clientScope`).
3. **Elke query** op klantgebonden data gebruikt `scopeToClients(viewer, kolom)`.
   Bij een lege scope levert dat `false` op: geen rijen, geen uitzonderingen.
4. **Elke detailpagina en mutatie** roept `assertClientAccess()` aan. Een id uit
   een andere klantomgeving in de URL plakken levert een foutmelding op, geen data.

Klantaccounts (`primaryRole = "client"`) worden bovendien via `requirePortal()`
uit de interne applicatie geweerd, en interne gebruikers via `requireInternal()`
uit het portaal.

Interne opmerkingen en klantopmerkingen zijn gescheiden op één kolom:
`review_threads.visibility`. De datalaag filtert daarop; het portaal vraagt
uitsluitend `client`-draden op.

Deze afspraken zijn vastgelegd in `tests/isolation.test.ts` en draaien tegen een
echte database.

### Waarom geen Supabase RLS?

Row Level Security is een goede extra laag zodra de applicatie op Supabase
draait, maar het is niet de enige laag die je wilt: RLS werkt alleen als elke
query via een geauthenticeerde databaseverbinding loopt. Achtergrondtaken,
webhooks en importscripts doen dat niet. Daarom zit de afdwinging in de datalaag,
die altijd meedoet. Draai je op Supabase, dan kan RLS daar bovenop als extra slot.

## Webhooks

Een webhook-endpoint doet drie dingen en niet meer: handtekening controleren,
het bericht opslaan, en direct `200` teruggeven. De verwerking gebeurt daarna
apart.

Dubbele bezorging wordt op twee manieren afgevangen: een unieke sleutel op
`(provider, external_event_id)` en een hash van de payload. Frame.io-opmerkingen
worden bovendien gecontroleerd op hun eigen id voordat ze worden aangemaakt.

Sync-lussen met Monday worden voorkomen door de hash van de laatst
weggeschreven payload te bewaren in de mapping. Komt er een webhook binnen met
dezelfde hash, dan is dat ons eigen echo-bericht en gebeurt er niets.

## Automatiseringen

Regels staan in `automation_rules`: een trigger, voorwaarden en acties. De
engine (`src/server/automation.ts`) evalueert ze en voert de acties uit. Elke
uitvoering komt in `automation_runs` met resultaat en eventuele fout. Regels
zijn dus aanpasbaar zonder nieuwe versie, en achteraf is te zien wat het systeem
zelf heeft gedaan.

## AI

De analyses in `src/server/ai.ts` rekenen rechtstreeks op de database: hooks,
doorlooptijden, revisiepatronen. Ze hebben geen taalmodel nodig en leveren
uitsluitend conclusies met bronvermelding — elk inzicht slaat op welke cijfers
het gebaseerd is en op hoeveel datapunten. Is er te weinig data, dan verschijnt
er geen inzicht.

Een taalmodel wordt alleen ingezet om die uitkomsten leesbaar samen te vatten,
nooit om cijfers of conclusies te bedenken. Zonder `ANTHROPIC_API_KEY` werkt
alles behalve die samenvattende tekst.

## Prestaties

Schermen lezen uit de eigen database, nooit rechtstreeks uit externe API's.
Synchronisatie gebeurt op de achtergrond via webhooks en geplande taken. Zware
lijsten zijn begrensd, statistieken worden als dagelijkse snapshots opgeslagen
zodat trends beschikbaar blijven ook als een platform zelf weinig historie
bewaart.
