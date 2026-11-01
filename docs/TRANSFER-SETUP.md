# Shortclips Transfer — opslag instellen (Cloudflare R2)

De Transfer-module (de eigen WeTransfer-vervanger) is **volledig af in de code**:
slepen, multipart-upload rechtstreeks browser → opslag, hervatten, publieke
download zonder account, verloop- en bewaartermijnen, automatische opruiming.
Het enige wat nog moet gebeuren om hem écht te laten werken is **de opslag
koppelen**: een Cloudflare R2-bucket + sleutels + één CORS-policy.

Grote bestanden gaan rechtstreeks tussen de browser en R2 (presigned URL's); onze
server zit nooit in het datapad. Daarom is de CORS-policy op de bucket verplicht —
zonder die policy mislukt elke upload met een netwerk-/CORS-fout, óók met geldige
sleutels.

---

## 1. R2 aanzetten en een bucket maken

1. Ga naar het Cloudflare-dashboard → **R2**. Zet R2 aan (eenmalig een
   betaalmethode koppelen; opslag is goedkoop, ~$0,015/GB/maand, geen egress-kosten).
2. **Create bucket** → naam `shortclips-transfer` (of een eigen naam; die moet
   dan ook in `R2_BUCKET`). Locatie: automatic/EU.

## 2. API-token (de sleutels) maken

1. R2 → **Manage R2 API Tokens** → **Create API token**.
2. Permissions: **Object Read & Write**, beperkt tot de bucket `shortclips-transfer`.
3. Na aanmaken krijg je drie waarden te zien (eenmalig!):
   - **Account ID** → `R2_ACCOUNT_ID`
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`

## 3. CORS-policy op de bucket zetten (verplicht)

Bucket → **Settings** → **CORS policy** → **Edit/Add** en plak dit JSON. Vul bij
`AllowedOrigins` de domeinen in waar de Transfer-pagina draait (de browser PUT't
van daaruit naar R2) — dus de **app-URL**, niet het download-domein:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://JOUW-APP-DOMEIN.vercel.app",
      "https://os.shortclips.nl"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

Opmerkingen:
- `ExposeHeaders` mag leeg: de server voltooit de multipart-upload zelf en haalt
  de ETags serverzijdig op, dus de browser hoeft de `ETag`-header niet te lezen.
- Zet alléén de domeinen erin die je echt gebruikt. Vervang
  `JOUW-APP-DOMEIN.vercel.app` / `os.shortclips.nl` door je eigen app-domein(en).
- Het publieke downloaddomein (`TRANSFER_PUBLIC_URL`, bv.
  `transfer.shortclips.nl`) hoeft **niet** in de CORS-lijst: downloaden loopt via
  een server-redirect, niet via een browser-fetch met CORS.

## 4. De omgevingsvariabelen invullen

Lokaal in `.env.local`, productie in **Vercel → Project → Settings → Environment
Variables** (zie ook `.env.example`):

```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=shortclips-transfer
# optioneel, zet pas als het domein gekoppeld is:
TRANSFER_PUBLIC_URL=https://transfer.shortclips.nl
```

Herstart lokaal `next dev`; op Vercel een nieuwe deploy (env-wijzigingen vereisen
een redeploy).

## 5. Controleren

Open **Transfer** als eigenaar. Bovenaan verschijnt een statusbalk:

- 🟢 **"Opslag verbonden — bucket shortclips-transfer"** → sleutels en bucket
  kloppen. Doe nu een testupload van een klein bestand en open de downloadlink.
- 🟠 **melding met reden** → de serverzijdige test (`r2HealthCheck`, een
  `HeadBucket`) faalde:
  - *Bucket niet gevonden* → bucketnaam/`R2_BUCKET` klopt niet.
  - *Sleutels afgekeurd (403)* → `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` fout of
    het token heeft geen rechten op de bucket.

Als de statusbalk groen is maar **de upload zelf** in de browser faalt (netwerk-/
CORS-fout in de console), dan is stap 3 (CORS) niet of verkeerd gezet — dat is de
enige stap die de serverzijdige test niet kan controleren.

---

## Hoe het werkt (kort)

- **Upload**: `createTransfer` maakt per bestand een R2 multipart-upload; de
  browser vraagt per deel een presigned PUT-URL (`signUploadPart`) en uploadt
  rechtstreeks naar R2 (3 delen parallel, 3× retry). `completeFile` voltooit
  serverzijdig.
- **Download**: `/d/<code>` toont de bestanden; `/api/d/<code>/<fileId>`
  valideert en redirect naar een korte presigned GET-URL met de juiste
  bestandsnaam.
- **Opruimen**: dagelijkse cron `transfers.cleanup` (03:30) zet verlopen
  transfers op `expired` en verwijdert bestanden na de bewaartermijn uit R2.
  Termijnen: downloadlink 30 dagen, bewaren 45 dagen (`service.ts`).
- **Degradatie**: zonder R2-sleutels is `r2Configured()` false; de UI blijft
  werken en meldt netjes dat de opslag nog niet is ingesteld.
