# Resultaten automatisch koppelen — hoe het werkt en wat ervoor nodig is

_Toelichting bij feedbackpunt 3. Gebaseerd op de huidige code van ShortClips OS én een live-test tegen de Metricool API._

> **Update na implementatie.** Likes en reacties worden nu wél automatisch opgehaald via Metricool (getest: `reels/likes` en `reels/comments` leveren data) en staan op de Resultaten-pagina en in het klantportaal. Uit de live-test bleek ook: van de 13 Metricool-merken is **YouTube bij geen enkel merk gekoppeld** (Instagram 11, TikTok 8, Facebook 5), en Metricool v2 heeft **geen endpoint voor cijfers per losse post** — per-short blijft dus afhankelijk van Ayrshare. De rest van dit document is daarop bijgewerkt.

## Kort antwoord

- **Wat nu al automatisch werkt:** resultaten **per klant, per platform** (Instagram, TikTok, Facebook) worden automatisch opgehaald via **Metricool** en 1× per nacht ververst. Deze cijfers staan op de Resultaten-pagina én in het klantportaal — zonder handmatig invoeren.
- **Wat nog niet automatisch werkt:** cijfers **per losse video/short**, **YouTube Shorts**, en **likes + reacties** worden op dit moment niet automatisch opgehaald. Het datamodel is er wél klaar voor; de koppeling die per-post cijfers binnenhaalt is nog niet gebouwd.
- **Om volledig automatisch (per klant én per short, alle 4 platforms) te worden** is één extra koppeling nodig — aanbevolen: **Ayrshare** — plus een synchronisatie-job die per post de cijfers ophaalt en aan de juiste video koppelt.

---

## De 5 vragen beantwoord

### 1. Hoe koppelen we Instagram, TikTok, Facebook en YouTube Shorts?

Er zijn drie mogelijke routes. In de huidige code is route A deels actief, route B voorbereid maar niet gebouwd.

| Route | Platforms | Status in ons dashboard | Per losse video? |
|---|---|---|---|
| **A. Metricool** (`metricool.ts`) | Instagram, TikTok, Facebook (géén YouTube) | **Actief** — token aanwezig, sync + nachtelijke cron draaien | Nee — alleen account-/platformtotalen |
| **B. Ayrshare** | Instagram, TikTok, YouTube, Facebook, LinkedIn | **Voorbereid, niet gebouwd** — alleen beschrijving + lege API-key | Ja (Ayrshare levert per-post analytics) |
| **C. Platform-API's rechtstreeks** (Meta Graph API, TikTok API, YouTube Data API) | Alle, los per platform | Niet aanwezig | Ja, maar per platform eigen app + goedkeuring + login per klant nodig |

Metricool is de pragmatische keuze voor **klantniveau** (en draait al). Voor **YouTube** en voor **per-video** cijfers is Metricool niet genoeg; daarvoor is Ayrshare (route B) de kortste weg, omdat Ayrshare met één API alle vier de platforms én per post dekt.

### 2. Kunnen weergaven, bereik, likes, reacties, deelacties en volgers automatisch worden opgehaald?

Gedeeltelijk, afhankelijk van de metric:

| Statistiek | Automatisch nu (Metricool, per klant) | Nodig voor volledig (per video) |
|---|---|---|
| Weergaven | ✅ ja | Ayrshare per post |
| Bereik | ✅ ja | Ayrshare per post |
| Deelacties (shares) | ✅ ja (Reels) | Ayrshare per post |
| Saves | ✅ ja (Reels) | Ayrshare per post |
| Volgers / volgersgroei | ✅ ja | n.v.t. (accountniveau) |
| Kijktijd (totaal/gemiddeld) | ✅ deels (Reels-kijktijd) | Ayrshare per post |
| **Likes** | ✅ ja (toegevoegd via Metricool reels) | — |
| **Reacties (comments)** | ✅ ja (toegevoegd via Metricool reels) | — |
| Profielbezoeken | ❌ niet via Metricool | Ayrshare / platform-API |
| Uitkijkpercentage / retentiegrafiek | ❌ niet via Metricool | Ayrshare / platform-API (beperkt beschikbaar) |

Likes en reacties zijn nu toegevoegd en worden automatisch opgehaald. Profielbezoeken en uitkijkpercentage levert de Metricool-API niet; die tonen "—" en worden niet geschat.

### 3. Kunnen we resultaten per klant én per individuele short bekijken?

- **Per klant: ja, nu al.** Dit werkt automatisch via Metricool en staat op de Resultaten-pagina (totalen, per platform, per maand, vergelijking met de vorige periode).
- **Per individuele short: nog niet automatisch.** De schermen bestaan al (de video-analysepagina met thumbnail, per-platform cijfers en retentiegrafiek), maar de onderliggende tabel met per-post cijfers wordt op dit moment alleen met demodata gevuld. Zodra er een koppeling is die per gepubliceerde post de cijfers ophaalt (Ayrshare), vullen die pagina's zich automatisch — inclusief koppeling aan de juiste video via de post-link.

### 4. Hoe vaak worden de resultaten bijgewerkt?

- Nu: **1× per nacht** (nachtelijke synchronisatie, rond 03:00). De cijfers van overdag zie je dus de volgende ochtend.
- Dit kan verhoogd worden (bijv. elke paar uur). Let op: de platforms zelf lopen voor sommige cijfers (bereik, kijktijd, uitkijkpercentage) 1 tot 3 dagen achter en kennen snelheidslimieten, dus vaker dan een paar keer per dag levert weinig extra op.
- **Aandachtspunt om te controleren:** de job-route reageert alleen op een POST-aanroep met het geheime cron-token. Controleer in de hostingomgeving (Vercel) of de geplande cron de job daadwerkelijk start; anders ververst er niets automatisch. Dit is een configuratiecheck, geen codewijziging.

### 5. Kunnen de resultaten ook automatisch in het klantportaal?

**Ja — dit gebeurt al.** Het klantportaal toont dezelfde Metricool-cijfers (weergaven, bereik, interacties, volgersgroei, per platform, vergelijking met de vorige periode) automatisch per klant. De per-video weergave in het portaal is voorbereid en vult zich zodra de per-post koppeling (vraag 3) actief is.

---

## Wat is er concreet nodig om "nooit meer handmatig" te bereiken?

Doel: één centraal dashboard, per klant én per short, alle 4 platforms, automatisch, ook in het portaal.

**Aanbevolen: Ayrshare-koppeling bouwen (route B).**

Benodigd:
1. **Ayrshare-account** (betaald, Business-plan voor meerdere profielen) → levert `AYRSHARE_API_KEY` en per klant een profielsleutel.
2. Per klant de social-accounts in Ayrshare koppelen (eenmalige login per platform).
3. **Te bouwen in het dashboard:**
   - een Ayrshare-client (API-aanroepen) — bestaat nog niet;
   - een synchronisatie-job die per gepubliceerde post de analytics ophaalt en wegschrijft in de per-video tabel;
   - het matchen van elke externe post aan de juiste video in het dashboard (via de post-link/ID — het datamodel heeft hier al velden voor).
4. Eventueel: de nachtelijke sync uitbreiden/vaker laten draaien.

**Kleinere tussenstap (sneller, zonder per-video):** de bestaande Metricool-koppeling uitbreiden met **likes, reacties en YouTube** op klantniveau. Dat maakt het klant-overzicht completer zonder een nieuwe koppeling, maar geeft nog geen cijfers per losse short.

**Alternatief (meeste werk, meeste controle):** rechtstreekse platform-API's (Meta Graph API voor Instagram/Facebook, TikTok API, YouTube Data API). Elk vereist een eigen app, goedkeuringsproces en login per klant. Alleen zinvol als Ayrshare onvoldoende blijkt.

---

## Samengevat

| Onderdeel | Werkt nu automatisch? | Koppeling |
|---|---|---|
| Resultaten per klant (IG/TikTok/FB) | ✅ ja | Metricool (actief) |
| Likes & reacties (per klant) | ✅ ja (toegevoegd) | Metricool (actief) |
| In klantportaal tonen (per klant) | ✅ ja | Metricool (actief) |
| YouTube Shorts | ❌ nee (0 merken gekoppeld in Metricool) | Metricool-koppeling in YouTube, of Ayrshare/YouTube API |
| Resultaten per losse short | ❌ nog niet (Metricool heeft geen per-post API) | Ayrshare (bouwen) |
| Per-video in portaal | ❌ nog niet (scherm klaar) | Ayrshare (bouwen) |
| Verversfrequentie | 1×/nacht | (verhoogbaar) |

Je hoeft dus nu al **niet** handmatig in te vullen voor de klant-totalen (dat loopt via Metricool). De stap naar **per-short, alle platforms, automatisch** vraagt om de Ayrshare-koppeling te activeren en de per-post synchronisatie te bouwen. Zeg het als je wilt dat ik dat als volgende stap uitwerk.
