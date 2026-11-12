# Klant-app (PWA) en pushmeldingen

Het klantportaal is installeerbaar als app op iPhone en Android, zonder App Store.
Het is dezelfde code als het portaal: geen tweede systeem, geen dubbele invoer.

## Wat er is

- **Installeerbaar**: `src/app/manifest.ts` (naam, icoon, start op `/portal`),
  iconen in `public/icons/`, service worker `public/sw.js`.
- **Installatiepagina**: `/portal/app` herkent iPhone of Android en toont de juiste
  stappen. Op Android is er een installatieknop. Nieuwe klanten komen er na het
  instellen van hun wachtwoord op een telefoon automatisch op uit.
- **Mobiele navigatie**: vijf tabs Home · Video's · Scripts · Planning · Resultaten,
  met tellers voor openstaande video's en scripts. Planning wisselt tussen Opnames en
  Publicaties, Resultaten tussen Cijfers en Maandanalyses. Meldingen, Zo werken wij,
  Samenwerking, Contact, Mijn account en de installatiehandleiding staan onder het
  menu rechtsboven (`PortalMenuButton`, via een portal naar `<body>`).
- **Mobiel startscherm**: begroeting plus vier tegels (video's voor feedback, scripts
  om goed te keuren, volgende opname, volgende publicatie) en de weergaven van de
  laatste 30 dagen, zonder scrollen. Desktop is ongewijzigd.
- **Passkeys (Face ID, Touch ID, vingerafdruk)**: `src/server/auth/passkeys.ts`.
  Koppelen via Mijn account > Snel inloggen, inloggen via de knop op het inlogscherm.
  Alleen de publieke sleutel staat in `passkeys`; uitdagingen zijn eenmalig
  (`webauthn_challenges`). Een passkey vervangt wachtwoord en inlogcode. Wordt
  ingetrokken bij deactiveren of een gepauzeerde/beëindigde klant. Het domein is
  APP_URL; op een Vercel-preview en localhost het eigen domein (passkeys zijn per
  domein, dus een op de preview gekoppelde passkey werkt niet in productie).
- **Downloads in de app**: `src/lib/save-file.ts`. In de iPhone-app opent een PDF-link
  een scherm zonder terugknop en een nieuw venster deelt de inlog niet; daarom halen
  downloadknoppen het bestand op met de sessie en tonen het deelmenu (Bewaar in
  Bestanden). Gebruik `PortalDownloadButton` voor nieuwe downloads.
- **Altijd actueel**: de service worker cachet niets. Komt een klant na een kwartier
  terug in de app, dan laadt die opnieuw (niet als er ongeslagen tekst in een veld
  staat). Een nieuwe versie van het portaal is zo vanzelf binnen.
- **Meldingencentrum**: `/portal/meldingen` en het belletje rechtsboven.
- **Pushmeldingen**: elke klantmelding uit de bestaande meldingenmotor kan ook als
  push. Regels (`src/lib/push-rules.ts`): stille uren 21:00-08:00, maximaal 2
  automatische pushes per klantgebruiker per dag, gebundeld per soort. Handmatige
  meldingen tellen niet mee voor de daglimiet.
- **Voorkeuren**: de klant zet per soort melding push en e-mail aan of uit
  (Mijn account).
- **Handmatig versturen**: Klanten > Portalen > "App en meldingen" bij een klant.
  Daar zie je ook hoeveel apparaten meldingen hebben en de laatste afleveringen
  (statuscode van de pushdienst).
- **Inlogcode per e-mail**: per klant aan te zetten op dezelfde plek. Op een nieuw
  apparaat vraagt de login dan een code van 6 cijfers; daarna wordt het apparaat
  90 dagen onthouden.
- **Sessies**: klantaccounts 30 dagen glijdend / 90 dagen hard. Team ongewijzigd
  (7 / 30).

## Eenmalig instellen

1. Genereer een VAPID-sleutelpaar: `npx web-push generate-vapid-keys`
2. Zet in Vercel (Production en Preview):
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, eventueel `VAPID_SUBJECT`
   (standaard `mailto:info@shortclips.nl`). Wissel deze sleutels daarna niet meer:
   bestaande abonnementen werken alleen met hetzelfde paar.
3. Zorg dat `APP_URL` op het vaste portaaldomein staat (bijv.
   `https://portaal.shortclips.nl`) vóór klanten de app installeren. Een ander
   domein betekent opnieuw installeren.
4. Deploy en draai de migratie `0113_klant_app_passkeys` (zie DEPLOYMENT.md).

Zonder VAPID-sleutels blijft push slapend; meldingen verschijnen dan in het
portaal en per e-mail. Zonder `RESEND_API_KEY` werkt de inlogcode niet: zet die
pas aan bij een klant als e-mail werkt.

## Beveiliging

- Manifest en service worker bevatten geen data en zijn daarom publiek
  (`src/proxy.ts`). Alle pagina's blijven server-side gecontroleerd
  (`requirePortal`, `scopeToClients`).
- Push-abonnementen horen bij één klantgebruiker en worden ingetrokken bij
  uitloggen op dat apparaat, deactiveren en een gepauzeerde of beëindigde klant.
- Pushteksten zijn zichtbaar op het vergrendelscherm: geen scriptinhoud of cijfers.
- De service worker opent alleen paden die met `/portal` beginnen en bewaart geen
  klantdata (geen offline cache).

## Testen op een telefoon

iPhone: open het portaal in Safari, Deel > Zet op beginscherm, open de app, log in,
Mijn account > Meldingen aanzetten. Er volgt direct een testmelding.
Android: open in Chrome, tik op de banner "Hoe?" en dan "Installeer".
Push werkt alleen via HTTPS, dus test op een Vercel-preview of productie, niet op
`localhost` via je telefoon.
