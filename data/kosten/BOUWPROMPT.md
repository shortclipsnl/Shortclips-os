# Bouwprompt: Kostenmonitor in Shortclips OS

Plak deze prompt in een Claude Code-sessie die in de repository van Shortclips OS werkt (shortclips-os.vercel.app). Zet de bestanden uit dit pakket in de repo, bijvoorbeeld in `data/kosten/`.

---

Bouw in Shortclips OS een pagina **Kosten** die functioneel exact gelijk is aan de bestaande Kostenmonitor. Het origineel staat in `data/kosten/kostenmonitor_origineel.html`: een losse HTML-pagina met alle berekeningen in de `<script>`-tag. Neem de logica daaruit één op één over, en pas de vormgeving aan op de huisstijl van Shortclips OS. Verzin geen cijfers. Toon alleen wat in de data staat.

## Data

Hoofdbron is `kosten_data.json`, met deze velden:

- `bijgewerkt`: datum van de uitlezing (JJJJ-MM-DD).
- `lev`: lijst van leveranciersnamen. Een regel verwijst ernaar met een index.
- `subs`: lijst van subcategorieën in de vorm `[naam, groep, soort]`.
  - Groep is `personeel`, `editors`, `freelancers`, `marketing`, `vast`, `operationeel`, `controle`, `prive` of `belasting`.
  - Soort is `vast`, `variabel`, `eenmalig`, `controle` of `geen`.
- `m`: per maand (`JJJJ-MM`) een lijst regels in de vorm `[leverancierIndex, subIndex, bedragMetBtw, bedragZonderBtw, aantalBetalingen]`.
- `omzet`: per maand de gefactureerde omzet zonder btw.

Dezelfde regels staan plat in `kosten_regels.csv` (puntkomma als scheidingsteken) en in `kostenmonitor_export.xlsx`. Gebruik die bestanden alleen om te controleren.

Sla de data op in de database die Shortclips OS al gebruikt. Gebruik twee tabellen:

- **kosten_regels**: maand, leverancier, subcategorie, groep, soort, met_btw, zonder_btw, aantal, bijgewerkt.
- **kosten_omzet**: maand, omzet.

Schrijf een seedscript dat `kosten_data.json` inleest. Het script moet idempotent zijn: per maand eerst verwijderen, dan opnieuw invoegen.

Maak daarnaast een beveiligd import-endpoint, bijvoorbeeld `POST /api/kosten/import`.

- Het endpoint neemt hetzelfde JSON-formaat aan en vervangt alleen de maanden die erin zitten.
- Beveilig het met een geheime token uit een omgevingsvariabele. Zet die token nooit in de code.

## Regels uit het origineel die exact moeten blijven

1. **Bedrijfskosten** zijn alleen de groepen personeel, editors, freelancers, marketing, vast en operationeel.
   - `controle` telt apart als "Nog te beoordelen".
   - `prive` en `belasting` vallen onder "Geen kosten".
2. **Btw-schakelaar**: met btw gebruikt `bedragMetBtw`, zonder btw gebruikt `bedragZonderBtw`. Standaard staat hij op zonder btw.
3. **Afgesloten maanden**: alleen maanden vóór de maand van `bijgewerkt` zijn kiesbaar. De lopende maand is onvolledig en wordt niet getoond.
4. **KPI's** voor de gekozen maand:
   - kosten, met de procentuele verandering ten opzichte van de vorige maand en dezelfde maand vorig jaar
   - het gemiddelde over de laatste 12 maanden
   - de bedragen vast, variabel en eenmalig (soort)
   - nog te beoordelen, plus het bedrag aan geen kosten
5. **Onder de streep**: per maand en voor het jaar tot en met de gekozen maand.
   - Bereken: omzet min kosten (altijd zonder btw), min de verwachte belasting.
   - De belasting volgt uit `ibCalc()` met tarieven 2026 over de verwachte jaarwinst.
   - Verwachte jaarwinst = de afgesloten maanden van het jaar, plus de resterende maanden maal het gemiddelde van de laatste 3 maanden.
   - Neem `IB26` en `ibCalc` letterlijk over.
6. **Categorieën**:
   - Per groep en subcategorie toon je het bedrag, het verschil met de vorige maand en een balk.
   - Op de balk staat een streepje voor het 12-maandsgemiddelde.
   - De categorieën zijn uitklapbaar naar leveranciers, met het aantal betalingen.
7. **Grootste leveranciers**: top 12, te kiezen voor deze maand of dit jaar tot en met de gekozen maand. Toon ook het percentage van de kosten.
8. **Heatmap**: de laatste 12 maanden per subcategorie, in 5 kleurniveaus ten opzichte van het maximum per rij. Voeg een totaalrij en een gemiddeldekolom toe.
9. **Vaste lasten**:
   - Neem leveranciers met soort `vast` die in minstens 3 van de laatste 6 maanden voorkomen.
   - Toon per maand een stip.
   - Toon "niet gezien" in rood als de leverancier vorige maand wel voorkwam en deze maand niet.
10. **Geen kosten**: de privé- en belastingregels van de maand.
11. **Alle leveranciers**: met zoeken en een filter op categorie. Toon het label "nieuw" bij een leverancier die in geen eerdere maand voorkomt, en de kolom "vorige maand".

## Maandelijkse update

De gegevens worden nu elke 1e van de maand uitgelezen uit Knab DigiBoox, door een geplande Claude-taak. Die schrijft het JSON-formaat hierboven nog naar de oude Kostenmonitor.

Lever een korte instructie op met de exacte URL van het import-endpoint en hoe de token wordt meegegeven. Dan kan de geplande taak worden omgezet om naar Shortclips OS te schrijven.

## Controle voor oplevering

- Totale bedrijfskosten zonder btw moeten per maand gelijk zijn aan het tabblad "Per maand" in de Excel, op de euro.
  - Ter controle: augustus 2026 is € 23.791, september 2026 is € 19.610.
- Omzet september 2026 is € 18.635.
- Nergens staan fictieve bedragen of testdata.
- De pagina is alleen zichtbaar voor Jarno (rol eigenaar), niet voor het team.

## Oude maandafsluitingen

De map `oud_maandafsluitingen/` bevat een eerdere versie met maandafsluitingen van april tot en met augustus 2026. Die zijn gebaseerd op de Knab-afschriften plus Revolut-maandtotalen. Importeer die niet in dezelfde tabellen. Bewaar ze als archief; ze zijn alleen ter vergelijking.
