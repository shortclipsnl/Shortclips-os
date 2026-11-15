# Editor Meetings

Elke actieve editor heeft één keer per maand een persoonlijk gesprek met de
verantwoordelijke content creator (Milou of Jiska), bij voorkeur in de eerste
week van de maand. Dit onderdeel plant, bereidt voor, legt vast en bewaakt die
gesprekken.

## Waar staat wat

| Laag | Bestand |
|---|---|
| Regels zonder database (maanden, status, herinneringen, thema's) | `src/lib/editor-meetings.ts` |
| Tabellen | `src/db/schema/editor-meetings.ts`, migratie `drizzle/0125_editor_meetings.sql` |
| Datalaag, toegang en automatisering | `src/server/editor-meetings.ts` |
| Server-acties | `src/server/actions/editor-meetings.ts` |
| Pagina's | `src/app/(app)/editor-meetings/` |
| Tests (de tien opleversituaties) | `tests/editor-meetings.test.ts` |

## Hoe het werkt

- **Eén meeting per editor per maand.** De unieke sleutel `(editor_id, period)`
  maakt een dubbele meeting onmogelijk. Verplaatsen werkt dezelfde rij bij; het
  editorportaal, het portaal van de content creator, het centrale overzicht,
  "Agenda deze week" op Vandaag en de agenda-feed van de editor lezen die rij.
- **Verantwoordelijke.** Vastgelegd in `editor_meeting_owners`. Zonder rij doet
  het portaal een voorstel op basis van de klanten waar de editor voor werkt.
  Een nieuwe editor (actief account met de rol editor) doet vanzelf mee.
- **Verslag.** Concept is alleen zichtbaar voor de content creator en het
  management. Na publiceren ziet de editor het verslag en krijgt hij een melding.
  Interne notities blijven altijd intern.
- **Actiepunten.** Bij publiceren wordt elk actiepunt een taak in `tasks`. De
  status van het actiepunt ís de status van die taak, dus afronden op de
  takenpagina, in het editorportaal of in het verslag werkt overal door.
- **Maandelijkse plantaak.** De job `editor_meetings.sync` (dagelijks, zie
  `vercel.json`) maakt zeven dagen voor het maandeinde per content creator één
  taak "Plan de editor meetings voor <maand>". De taak werkt zichzelf bij, rondt
  zichzelf af als alles is ingepland en stuurt op vaste momenten een herinnering.
  Vaste sleutels per maand en per persoon voorkomen dubbele taken en meldingen.

## Toegang

| Wie | Wat |
|---|---|
| Editor | Eigen meetings, gepubliceerde verslagen en eigen actiepunten |
| Milou, Jiska | Plannen en verslagen voor hun eigen editors; van andere editors alleen de planning |
| Management (eigenaar, admin) | Alles |

De lijst met content creators staat in `EDITOR_MEETING_OWNER_EMAILS`
(`src/lib/editor-meetings.ts`).

## Nog niet gekoppeld

Google Agenda is in het portaal alleen-lezen gekoppeld. Een meeting komt daarom
niet automatisch in de agenda "Team Shortclips". Wel staat bij elke meeting een
knop "Zet in Google Agenda" en verschijnt de meeting in de persoonlijke
agenda-feed van de editor.
