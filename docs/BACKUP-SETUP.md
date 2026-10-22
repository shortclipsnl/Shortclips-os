# Eenmalige setup — dagelijkse backup aanzetten

De backup draait via GitHub Actions (`.github/workflows/backup.yml`) en zet elke
nacht een versleutelde kopie in Google Drive. Om dat te laten werken moet je
eenmalig een paar dingen instellen. Ik kan je hier stap voor stap doorheen helpen.

## 1. GitHub-secrets (4 stuks)
Ga naar: **GitHub → repo `Shortclips-os` → Settings → Secrets and variables →
Actions → New repository secret**. Maak deze aan:

| Secret | Waarde | Waar vandaan |
|---|---|---|
| `SUPABASE_URL` | de Supabase project-URL | Vercel env, of Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | de service-role sleutel | idem (dit is een geheim) |
| `BACKUP_PASSPHRASE` | een zelfbedacht sterk wachtwoord | **zelf genereren** (bijv. `openssl rand -base64 32`) en in je wachtwoordmanager zetten — hiermee wordt de backup versleuteld; zonder dit kun je niet herstellen |
| `RCLONE_CONF_BASE64` | de rclone-config (base64) | zie stap 2 |

> Ik vul deze secrets bewust **niet** zelf in: sleutels horen door jou te worden
> ingevoerd, niet door mij. Ik help wel met uitleg.

## 2. Google Drive koppelen (rclone)
Op je eigen Mac, eenmalig:
```bash
brew install rclone          # of: curl https://rclone.org/install.sh | sudo bash
rclone config
# → n (new remote) → naam: drive → storage: drive (Google Drive)
# → laat client_id/secret leeg (Enter) → scope: 1 (volledige toegang)
# → autoriseer in de browser met je Google-account → y
rclone config file            # toont het pad van rclone.conf
base64 -i "$(rclone config file | tail -1)" | pbcopy   # kopieert de base64 naar klembord
```
Plak dat in de GitHub-secret `RCLONE_CONF_BASE64`. De map in Drive heet standaard
`ShortClips-Backups` (wordt vanzelf aangemaakt).

## 3. De workflow toevoegen
Het bestand `.github/workflows/backup.yml` staat klaar, maar de huidige
GitHub-token mag geen workflows pushen. Kies één:
- **A (aanrader):** voeg het bestand toe via **GitHub → Add file → Create new
  file**, naam `.github/workflows/backup.yml`, en plak de inhoud. (Ik stuur je het
  bestand.)
- **B:** geef de token de extra scope `workflow` (GitHub → Settings → Developer
  settings → Tokens), dan push ik het zelf.

## 4. Instellingen (optioneel)
Onder **Settings → Secrets and variables → Actions → Variables**:
- `BACKUP_DRIVE_FOLDER` — mapnaam in Drive (standaard `ShortClips-Backups`)
- `BACKUP_RETENTION_DAYS` — hoeveel dagen bewaren (standaard `30`)

## 5. Testen
Ga naar **Actions → Dagelijkse backup → Run workflow**. Na afloop staat er een
`shortclips-backup-<datum>.tar.gz.gpg` in je Drive-map. Ik kan de run voor je
volgen en controleren of alles goed ging.

Herstellen: zie `docs/BACKUP-RESTORE.md`.
