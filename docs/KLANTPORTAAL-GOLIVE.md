# Klantportaal — go-live checklist

Het klantenportaal draait op dezelfde codebase als het interne platform (route-
groep `(portal)`, pad `/portal`). Klantaccounts zijn gewone `users` met rol
`client` + een `client_id`; de datalaag schopt daar hard op, zodat klant A nooit
data van klant B ziet.

## 1. Omgevingsvariabelen (Vercel → Project → Settings → Environment Variables)

| Variabele | Waarom | Nodig vóór |
|---|---|---|
| `APP_URL` | Basis-URL voor de uitnodigings- en herstel-links in e-mails. **Zonder dit wijzen de links naar `http://localhost:3000`.** Zet op het echte portaaldomein, bijv. `https://portaal.shortclips.nl` (of het app-domein). | uitnodigen per e-mail / links delen |
| `RESEND_API_KEY` | Zodat uitnodigingen en wachtwoord-herstel-mails automatisch verstuurd worden (provider: Resend). | e-mailuitnodigingen |
| `MAIL_FROM` | Afzender van die mails, bijv. `ShortClips <portaal@shortclips.nl>`. Het afzenderdomein moet in Resend geverifieerd zijn. | e-mailuitnodigingen |
| `SESSION_SECRET` | Ondertekening van sessies (min. 32 tekens: `openssl rand -base64 48`). | productie (login) |
| `DATABASE_URL` | Runtime-verbinding (Supabase **transaction pooler**, poort 6543). | productie |
| `MIGRATE_DATABASE_URL` | Migraties in de build (Supabase **session pooler**, poort 5432). | productie |

Zonder `RESEND_API_KEY` + `MAIL_FROM` blijft e-mail netjes slapend: bij het
uitnodigen krijg je dan een **kopieerbare beveiligde link** of je kiest **Direct
wachtwoord** (tijdelijk wachtwoord dat je één keer ziet en zelf doorgeeft). De
link gebruikt wél `APP_URL`, dus zet die sowieso goed.

## 2. Domein / subdomein

- Gekozen: `portaal.shortclips.nl` als eigen subdomein.
- In Vercel: Project → Settings → Domains → subdomein toevoegen, DNS-CNAME naar
  Vercel zetten. SSL/HTTPS regelt Vercel automatisch.
- Klanten die inloggen komen binnen op `/portal`; interne gebruikers op
  `/dashboard`. De login (`/login`) stuurt automatisch door op basis van de rol.

## 3. Een klant toegang geven (vanuit het interne platform)

1. **Beheer → Klantportalen**.
2. Bij de klant op **Portaaltoegang beheren**.
3. E-mailadres (en eventueel naam) invullen, dan:
   - **Uitnodigen per e-mail** → de klant stelt zelf een wachtwoord in via een
     beveiligde link (7 dagen geldig), of
   - **Direct wachtwoord** → je krijgt een tijdelijk wachtwoord dat je één keer
     ziet en zelf doorgeeft.
4. Meerdere gebruikers per klant kan; per account kun je **resetten**,
   **opnieuw uitnodigen** en **(de)activeren**.

De klant kan zelf zijn wachtwoord wijzigen via **Mijn account** in het portaal.

## 4. Rechten

- **Janno (owner):** volledig overzicht en beheer.
- **Milou & Jiska (projectcoördinator):** operationeel beheer van hun eigen
  klanten (uitnodigen, resetten, (de)activeren, opvolgen). Rolgebaseerd — geen
  e-mailuitzonderingen.
- Toegang volgt automatisch de samenwerkingsstatus: een klant op `churned` of
  `paused` wordt automatisch geblokkeerd; weer `active` → weer toegang.

## 5. Beveiliging — vóór uitnodigen controleren

- Wachtwoorden: scrypt-hash, nooit leesbaar opgeslagen.
- Sessies: gehashte tokens, 7 dagen glijdend / 30 dagen hard, account-lockout na
  te veel mislukte pogingen.
- Isolatie: test expliciet dat een klant via URL/id geen data van een andere
  klant kan opvragen (alle klantqueries lopen via `scopeToClients` /
  `assertClientAccess`).

## 6. Back-up

- Code: git bundle. Database: JSON-export via de service key, herstel via
  migraties + `restore:data`. Dagelijks via GitHub Actions (zie
  `docs/BACKUP-SETUP.md`).
