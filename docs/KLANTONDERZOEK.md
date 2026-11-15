# Klantonderzoek

Automatisch onderzoeksdossier per klant, op de interne klantpagina (tabblad
**Klantonderzoek**). Uitsluitend voor het interne team: editors, freelance
videografen en het klantportaal hebben geen toegang.

## Wat het doet

1. **Start.** Bij een nieuwe klant (aangemaakt in de laatste 14 dagen, zonder
   onderzoek) start de nulmeting vanzelf, hoe de klant ook is aangemaakt
   (handmatig, vanuit een lead of via import). Voor bestaande klanten start het
   team het onderzoek met de knop op het tabblad.
2. **Vijf fases**, elk in een eigen aanroep (max. 5 minuten per fase):
   `intern` (eigen klantgegevens, geen AI) → `bedrijf` (webonderzoek: bedrijf,
   doelgroep, software, reviews) → `social` (webonderzoek: kanalen, content,
   concurrenten) → `dossier` (modules 1 t/m 8) → `strategie` (kansen en eerste
   strategieadvies).
3. **Controle.** Het dossier staat op "Wacht op controle". De verantwoordelijke
   van de klant krijgt één melding (zonder verantwoordelijke: de eigenaar).
4. **Goedkeuring.** Pas dan gaat er iets door naar de rest van het portaal:
   - klantkennis (`client_knowledge`, bron `klantonderzoek`): dezelfde bron als
     de klantbriefing uit de kickoff, gelezen door de Script Engine, captions,
     editorbriefings en Content Research;
   - concurrenten (`content_competitors`), alleen namen die er nog niet staan.
5. **Hercontrole.** 90 dagen na goedkeuring start automatisch een nieuwe ronde.
   Die komt naast de nulmeting te staan en toont wat er veranderd is.

## Betrouwbaarheid

- Elke bevinding heeft een soort (feit, berekening, aanname, AI aanbeveling),
  een bron, een betrouwbaarheid en de onderzoeksdatum.
- Een feit zonder bron krijgt nooit betrouwbaarheid "hoog".
- Software zonder aantoonbaar bewijs blijft "onbekend, nog bevestigen".
- Volgersaantallen worden alleen overgenomen als exact getal. Afrondingen
  ("12K") zijn geen meting.
- Views, bereik en engagement komen alleen uit gekoppelde accounts (Metricool)
  of handmatige invoer met vermelding van de herkomst.
- Aannames gaan niet door naar de klantkennis.
- Het dossier wordt na afronding niet meer overschreven. Correcties en
  aanvullingen van het team staan ernaast (`corrections`, `additions`).

## Grenzen van platformen

Het webonderzoek gebruikt de zoek- en ophaalfunctie van de Claude API en leest
alleen openbare pagina's. Er wordt nergens ingelogd en er wordt niets
gescrapet achter een afscherming. Wat een platform niet openbaar toont, staat
als "niet openbaar" in het dossier.

## Techniek

| Onderdeel | Waar |
|---|---|
| Tabel | `client_research_runs` (migratie `0126_klantonderzoek`) |
| Regels en types | `src/lib/client-research.ts` |
| Onderzoek | `src/server/client-research/` (`collect`, `prompts`, `run`, `approve`, `view`) |
| Cron | `client_research.advance`, elke 5 minuten tussen 05:00 en 19:59 UTC |
| Acties | `src/server/actions/client-research.ts` |
| Pagina | `src/app/(app)/clients/[slug]/research-tab.tsx` |
| Tests | `tests/klantonderzoek.test.ts` |

Rechten: bekijken = intern team; starten = `content_research:write` of
`clients:write`; goedkeuren, corrigeren en aanvullen = `knowledge:write`.

Vereist `ANTHROPIC_API_KEY`. Zonder sleutel blijft het tabblad werken, maar
start er geen onderzoek.
