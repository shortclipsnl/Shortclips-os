# Onze visie

Eén centrale bron voor missie, visie, positionering, de vijf kernprincipes, de vertaling per functie, de klantbeloftes, de kwaliteitsvragen en de meetpunten.

## Waar het staat

| Onderdeel | Bestand |
|---|---|
| Inhoud en types (het voorstel) | `src/lib/visie/data.ts` |
| Lezen en opslaan (`app_settings`, sleutel `team.visie`) | `src/server/visie.ts` |
| Acties (opslaan, vaststellen, terug naar voorstel) | `src/server/actions/visie.ts` |
| Pagina en beheer | `src/app/(app)/visie` (tabblad binnen de Kennisbank) |

Geen eigen tabel en geen migratie: zelfde opzet als Mijn verantwoordelijkheden.

## Status: voorstel of definitief

- **Voorstel** (standaard): alleen de eigenaar ziet de visie en alles wat eruit leest.
- **Definitief**: na "Vaststellen voor het team" in Beheer ziet het hele team het.
- Tekst tussen `[[...]]` is nog te bevestigen: geel voor de eigenaar, gewone tekst voor het team.

Gebruik in pagina's altijd `getVisieVoor(viewer)`; die geeft `null` als de kijker de visie nog niet mag zien. Voor documenten zonder kijker (editorbriefing) is er `getVastgesteldeVisie()`.

## Wie leest eruit

| Plek | Wat |
|---|---|
| Kennisbank › Onze visie | De volledige pagina, opent op de functie van wie inlogt |
| Vandaag | Principe van de week (wisselt op maandag) met een echt resultaat uit Resultaten |
| Mijn verantwoordelijkheden | Waarom mijn functie bestaat, principe en "Verder dan de taak" per onderdeel, KPI's gesplitst |
| Scripting | Drie inhoudelijke vragen bovenaan de bestaande kwaliteitscheck |
| Editorbriefing | Blok "Voordat je oplevert" |
| Draaiboek | "Op locatie ben jij Shortclips: drie dingen extra" |
| Teammeetings | Klant van de week, automatisch uit Resultaten |
| Kennisbank › Over Shortclips | Verwijzing boven lessen 0.3, 0.4, 1.4, 1.5, 1.7, 2.1, 2.2 en 2.3 |

Nieuwe plekken lezen uit dezelfde bron. Zet geen losse kopie van een principe in een pagina.
