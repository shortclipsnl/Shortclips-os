# ShortClips OS — Backup & Herstel

Dit document hoort bij elke backup (het zit in de code-bundle) en beschrijft hoe
je het volledige portaal terugzet als er iets misgaat.

## Hoe de backups werken

**Dagelijks automatisch** (GitHub Actions, `.github/workflows/backup.yml`):
elke nacht om 02:00 UTC draait een backup op de servers van GitHub — volledig los
van het live-portaal. De backup bevat:
- `code/shortclips-os.bundle` — de volledige git-repo met historie (alle code,
  functies, automatiseringen, design én het databaseschema in `drizzle/`).
- `database/data/*.json` — elke databasetabel met alle rijen.
- `database/manifest.json` — tabellen + rij-aantallen + exporttijd.
- `RESTORE-HANDLEIDING.md` + `BACKUP-INFO.txt`.

Het geheel wordt **versleuteld** (AES-256, met `BACKUP_PASSPHRASE`) en als
`shortclips-backup-<datum>.tar.gz.gpg` in **Google Drive** gezet. Backups ouder
dan `BACKUP_RETENTION_DAYS` (standaard 30) worden opgeruimd.

**API-sleutels zitten NIET in de backup** (met opzet). Die staan in Vercel en
hoor je apart in een wachtwoordmanager te bewaren. Zie `config/ENV-VARS.md` /
`docs/ENV-VARS.md` voor de volledige lijst.

## Een backup uitpakken

```bash
# 1) Ontsleutelen (vraagt de passphrase uit je wachtwoordmanager):
gpg --batch --yes --passphrase "<BACKUP_PASSPHRASE>" \
  -d -o shortclips-backup.tar.gz shortclips-backup-<datum>.tar.gz.gpg
# 2) Uitpakken:
tar -xzf shortclips-backup.tar.gz   # levert map ./backup/
```

## Snel herstel (database + Vercel bestaan nog, alleen code stuk)
```bash
git clone backup/code/shortclips-os.bundle shortclips-os
cd shortclips-os && git remote set-url origin <github-url>
git push origin HEAD:main      # Vercel bouwt en deployt automatisch
```

## Volledig herstel vanaf nul

1. **Code:**
   ```bash
   git clone backup/code/shortclips-os.bundle shortclips-os
   cd shortclips-os && git remote add origin <nieuwe-github-url> && git push -u origin main
   npm install
   ```
2. **Database (nieuw Supabase-project):** noteer de twee connection strings
   (Transaction pooler 6543 → `DATABASE_URL`, Session pooler 5432 →
   `MIGRATE_DATABASE_URL`). Schema opbouwen:
   ```bash
   DATABASE_DRIVER=postgres MIGRATE_DATABASE_URL="postgres://...5432/postgres" npm run db:migrate
   ```
3. **Data terugzetten** (getest, zet FK-checks tijdelijk uit):
   ```bash
   DATABASE_DRIVER=postgres DATABASE_URL="postgres://...6543/postgres" \
     npm run restore:data -- backup/database/data
   ```
   Controleer daarna de rij-aantallen tegen `backup/database/manifest.json`.
4. **Omgevingsvariabelen** uit `docs/ENV-VARS.md` terug in Vercel (Production +
   Preview). Zonder DB-URL's faalt de build; zonder de rest blijven koppelingen
   slapend maar start de app.
5. **Koppelingen** opnieuw verbinden (Google Drive+Agenda, Monday, Frame.io,
   Metricool, Ayrshare, Anthropic, Resend) door hun sleutels te zetten. De
   koppelings-configuratie zelf staat al in de teruggezette data.
6. **Deploy + controle:** push naar `main`, wacht op de Vercel-build, open
   `/api/health` (verwacht `200 ok`) en log in om klanten/editing/scripting/
   planning te controleren. Cron-jobs lopen daarna vanzelf.

## Herstel getest
De combinatie migraties + `restore:data` is end-to-end getest: schema opnieuw
opgebouwd, alle tabellen/rijen teruggezet met 0 afwijkingen, relaties en binaire
kennisbankdata intact. Doe deze test af en toe opnieuw met een recente backup in
een wegwerp-PGlite:
```bash
DATABASE_DRIVER=pglite PGLITE_DATA_DIR=/tmp/hersteltest npm run db:migrate
DATABASE_DRIVER=pglite PGLITE_DATA_DIR=/tmp/hersteltest npm run restore:data -- backup/database/data
```

## Let op — vertrouwelijk
Een uitgepakte backup bevat klant-PII, inloggegevens, leads en financiën. Bewaar
'm versleuteld, deel 'm niet, en zet een uitgepakte kopie na gebruik weg.
