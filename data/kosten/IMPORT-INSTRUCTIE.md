# Kostenmonitor — maandelijkse import

De pagina **Kostenmonitor** (`/kosten`, alleen zichtbaar voor de eigenaar) leest
zijn gegevens uit de database. De data komt binnen op twee manieren:

## 1. Eerste keer / bij elke deploy — automatisch uit de repo

Het bestand [`kosten_data.json`](./kosten_data.json) in deze map wordt bij elke
deploy ingelezen door `npm run kosten:seed` (onderdeel van `vercel-build`).
Dat script vult **alleen maanden die nog niet in de database staan**, zodat latere
correcties via het import-endpoint nooit worden overschreven.

Handmatig lokaal draaien:

```bash
npm run kosten:seed            # alleen nieuwe maanden (veilig)
npm run kosten:seed -- --fresh # álle maanden opnieuw (per maand wissen + invoeren)
```

## 2. Elke maand — via het beveiligde import-endpoint

De geplande taak die op de 1e van de maand DigiBoox uitleest, stuurt hetzelfde
JSON-formaat (velden `bijgewerkt`, `lev`, `subs`, `m`, `omzet`) naar:

```
POST https://shortclips-os.vercel.app/api/kosten/import
Authorization: Bearer <KOSTEN_IMPORT_TOKEN>
Content-Type: application/json

<de export-JSON>
```

- Alleen de **maanden die in de payload zitten** worden vervangen (per maand eerst
  verwijderen, dan opnieuw invoegen). De rest blijft staan.
- Het endpoint is dicht zonder het juiste token: zet in Vercel de
  omgevingsvariabele **`KOSTEN_IMPORT_TOKEN`** (een lang, willekeurig geheim) en
  geef diezelfde waarde mee als `Bearer`-token.

Voorbeeld met `curl`:

```bash
curl -X POST https://shortclips-os.vercel.app/api/kosten/import \
  -H "Authorization: Bearer $KOSTEN_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  --data @kosten_data.json
```

Antwoord bij succes: `{ "ok": true, "months": [...], "regels": N, "omzetMonths": N, "skipped": [] }`.

## Controle

- Totale bedrijfskosten zonder btw per maand moeten gelijk zijn aan het tabblad
  "Per maand" in `kostenmonitor_export.xlsx`. Ter controle: **augustus 2026 =
  € 23.791**, **september 2026 = € 19.610**, **omzet september 2026 = € 18.635**.
- `oud_maandafsluitingen/` is uitsluitend archief en wordt **niet** geïmporteerd.
