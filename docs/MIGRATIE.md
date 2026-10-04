# Overstappen zonder het bedrijf stil te leggen

De invoering gebeurt in vier fasen. In geen enkele fase hoeft het team te
stoppen met werken zoals het nu werkt.

## Fase 1 — Meekijken (nu mogelijk)

ShortClips OS leest bestaande informatie en toont die op één plek. Monday,
Frame.io en Drive blijven leidend; er wordt niets teruggeschreven.

**Stappen**
1. Credentials invullen (zie [CREDENTIALS.md](CREDENTIALS.md)).
2. Instellingen → Koppelingen → verbinding testen per systeem.
3. Instellingen → Importeren → dry run.
4. Voorstellen beoordelen: koppelen, nieuw aanmaken of overslaan.
5. Import uitvoeren.
6. Webhook-adressen registreren bij Monday en Frame.io.

**Wat je erover wint:** één klantpagina, één zoekbalk, één dashboard, zonder dat
er iets verandert aan de manier van werken.

**Risico:** geen. Er wordt alleen gelezen.

## Fase 2 — Werken in ShortClips OS, Monday blijft bestaan

Het team gaat de video pipeline, scripts en opnamedagen in ShortClips OS
bijhouden. Monday blijft draaien voor wat er nog niet is overgezet.

**Wat je regelt**
- Statussen en streeftijden controleren onder Instellingen → Statussen.
- Automatiseringen doorlopen onder Instellingen → Automatiseringen.
- Afspreken welk systeem waarvoor leidend is, zodat er geen dubbele administratie ontstaat.

**Let op sync-lussen.** De mapping bewaart een hash van de laatst
weggeschreven payload, waardoor een echo van je eigen wijziging genegeerd wordt.
Zet tweerichtingssync pas aan als de richting per veld duidelijk is.

## Fase 3 — ShortClips OS neemt workflows over

Klantgoedkeuringen verlopen via het portaal in plaats van via mail en WhatsApp.
Contentplanning, rapportages en finance draaien in ShortClips OS. De
automatiseringen nemen het handwerk over: goedkeuringsverzoeken, publicatietaken,
verlengingssignalen, risicomeldingen.

**Wat je regelt**
- Klantaccounts aanmaken voor de contactpersonen die mogen goedkeuren.
- Eén klant als pilot, daarna uitrollen.

## Fase 4 — Monday uitfaseren waar het kan

Zodra een proces volledig in ShortClips OS draait, kan het bijbehorende
Monday-board uit. Frame.io en Drive mogen blijven zolang dat technisch en
financieel logisch is: ze doen hun werk goed en de koppeling verbergt ze al voor
het team.

**Volgorde die het minste risico geeft**
1. Video pipeline (draait al volledig in ShortClips OS)
2. Scripts en opnamedagen
3. Contentplanning
4. Taken
5. Klantadministratie

## Wat je onderweg in de gaten houdt

| Signaal | Waar |
|---|---|
| Koppeling verbroken of fout | Instellingen → Koppelingen |
| Webhooks komen niet aan | Zelfde pagina, "Ontvangen webhooks" |
| Synchronisatie mislukt | Zelfde pagina, "Recente synchronisaties" |
| Technische fouten | Instellingen → Systeemstatus |
| Wie deed wat | Instellingen → Audit log |
