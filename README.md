# Vereinsmeisterschaft · TC Muckensturm

Web-App für die Vereinsmeisterschaft: Live-Tabellen, Spielplan und **Self-Service-
Ergebniseintragung** mit Spieler-Accounts und Gegner-Bestätigung.

## Architektur

- **Astro (SSR, Node-Adapter)** — eine Node-Anwendung, serverseitig gerendert.
- **SQLite** (`better-sqlite3`) — vollständiges Mehrjahres-Modell in der DB:
  Saisons, Konkurrenzen, Teilnehmer und Paarungen (`src/lib/tournament.ts`,
  Tabellen `seasons`/`competitions`/`competition_players`/`matches`); Ergebnisse
  hängen per `match_id` an den Paarungen. Die JSON-Dateien unter `src/data/`
  dienen nur noch dem einmaligen Seed/der Migration der Saison 2026.
- **Login mit E-Mail + Passwort** (scrypt-Hash) + Cookie-Session (`src/lib/auth.ts`, `src/middleware.ts`).
- **Resend** für E-Mails (`src/lib/mail.ts`); ohne API-Key landen Mails im Log (Dev).

### Ablauf der Ergebniseintragung
1. Spieler:in registriert sich (`/registrieren`) mit Passwort, beansprucht den eigenen Namen → Admin gibt frei.
2. Eintragen unter `/meine-spiele` (auch kampflos/Aufgabe) → Ergebnis ist `pending`, Gegner bekommt eine Hinweis-E-Mail.
3. Gegner loggt sich ein und bestätigt/lehnt unter `/meine-spiele` ab → `confirmed` fließt in die Tabelle, bei Ablehnung wird der Admin (`/admin`) informiert. In KO-Konkurrenzen rückt der Sieger automatisch in die nächste Runde vor.

### Weitere Funktionen
- **Terminvereinbarung**: Vorschlag → Bestätigung durch den Gegner, ICS-Download, WhatsApp-/Anruf-Links.
- **Saison-Anmeldung** (`/anmeldung`): Meldefenster pro Saison, Admin übernimmt Meldungen als Teilnehmer.
- **Generatoren**: Jeder-gegen-Jeden (Gruppen) und komplettes KO-Bracket mit Setzliste/Freilosen.
- **Archiv & Rangliste**: `/archiv` (Vereinsmeister vergangener Saisons), `/rangliste` (ewige ELO-Wertung).
- **Admin**: Dashboard mit Audit-Protokoll, CSV-Export; Erinnerungs-Mails gezielt per Klick je überfälligem Spiel (der tägliche Cron prüft nur noch die Forderungs-Fristen).

## Entwicklung

```sh
npm install
npm run dev        # http://localhost:4321
```

Ohne `.env` läuft alles lokal: SQLite unter `./data/vm.sqlite` (seedet sich selbst),
Mails werden in die Konsole geloggt. Für Admin-Rechte beim lokalen Test:
`ADMIN_EMAILS=deine@mail npm run dev` — danach unter `/registrieren` mit dieser
E-Mail ein Passwort setzen (Admin-Namensanspruch ist sofort freigegeben).

| Command | Aktion |
| --- | --- |
| `npm run dev` | Dev-Server |
| `npm run build` | Produktions-Build nach `dist/` |
| `npm start` | Gebaute App starten (`node dist/server/entry.mjs`) |
| `npx astro check` | Typprüfung |

## Deployment

Docker auf dem Hostinger VPS — siehe [DEPLOY.md](./DEPLOY.md).

> Hinweis: Der Umbau auf Accounts läuft auf dem Branch `feature/accounts`. Der
> `main`-Branch ist weiterhin die alte statische Seite (IONOS) und bleibt produktiv,
> bis der Cutover erfolgt.
