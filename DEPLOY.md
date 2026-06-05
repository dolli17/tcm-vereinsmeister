# Deployment (Hostinger VPS, Docker)

Die App ist eine Astro-SSR-Anwendung (Node) mit SQLite-Datenbank. In der **Testphase**
läuft sie als Docker-Container und ist über `http://<VPS-IP>:<APP_PORT>` erreichbar.
Die alte statische Seite auf IONOS bleibt davon unberührt und produktiv, bis zum Cutover.

## Erststart auf dem VPS

```bash
# 1. Repo + Branch holen
git clone <repo-url> vm && cd vm
git checkout feature/accounts

# 2. Konfiguration anlegen
cp .env.example .env
nano .env        # SITE_URL=http://<VPS-IP>:8080, ADMIN_EMAILS, ggf. RESEND_API_KEY

# 3. Bauen & starten
docker compose up -d --build

# 4. Logs prüfen (im Dev-/Sandbox-Modus stehen Magic-Links/Mails hier drin)
docker compose logs -f app
```

Aufrufen: `http://<VPS-IP>:8080`.

## Updates ausrollen

```bash
git pull
docker compose up -d --build
```

Die SQLite-Datenbank liegt im Docker-Volume `vm-data` (Pfad im Container:
`/data/vm.sqlite`) und übersteht Rebuilds/Neustarts. Beim allerersten Start seedet
sie sich selbst aus den JSON-Fixtures (Spieler + bereits eingetragene Ergebnisse als
`confirmed`).

## Wichtige .env-Variablen

| Variable | Bedeutung |
| --- | --- |
| `SITE_URL` | Basis-URL für die Links in E-Mails. Testphase `http://<IP>:8080`, Cutover `https://<domain>`. |
| `APP_PORT` | Nach außen gemappter Port (Standard 8080). |
| `RESEND_API_KEY` | Resend-Key für echten Mailversand. Leer = Mails landen nur im Log (Test). |
| `MAIL_FROM` | Absender. Bis Domain verifiziert: `onboarding@resend.dev`. |
| `ADMIN_EMAILS` | Kommagetrennt; diese Accounts erhalten beim Start die Admin-Rolle. |
| `COOKIE_SECURE` | `false` über HTTP (Test), `true` über HTTPS (Cutover). |

## Backup

```bash
docker run --rm -v vm-data:/data -v "$PWD":/backup busybox \
  cp /data/vm.sqlite /backup/vm-backup-$(date +%F).sqlite
```

## Cutover (später)

1. Reverse-Proxy (nginx/Traefik) mit TLS (Let's Encrypt) vor den Container setzen.
2. `.env`: `SITE_URL=https://vm.tennisclub-muckensturm.de`, `COOKIE_SECURE=true`.
3. Domain `vm.tennisclub-muckensturm.de` auf den VPS zeigen lassen.
4. Branch `feature/accounts` nach `main` mergen.
5. Alte IONOS-Deploy-Pipeline (`.github/workflows/deploy.yml`) deaktivieren.
