# Agenten-API (OpenClaw, Claude, Skripte)

Die App lässt sich vollständig maschinell bedienen. Zwei Zugänge, ein Auth-Mechanismus:

1. **JSON-API `/api/v1/…`** — zum Lesen (Saison, Spiele, Tabellen) und für Ergebnisse. Antworten sind JSON.
2. **Bestehende Admin-Endpunkte `/api/admin/…`** — alles Übrige (Paarungen, K.o.-Runden, Saisons, Teilnehmer, …). Form-encoded POSTs; Erfolg/Fehler steht im `Location`-Header der Redirect-Antwort (`?ok=…` / `?error=…`).

## Authentifizierung

Tokens stehen in der Server-`.env` als kommagetrennte `name:token`-Paare:

```bash
API_TOKENS=openclaw:LANGESGEHEIMNIS1,claude:LANGESGEHEIMNIS2   # openssl rand -hex 24
```

Jeder Request trägt den Token als Bearer-Header:

```bash
curl -H "Authorization: Bearer LANGESGEHEIMNIS1" https://vm.tennisclub-muckensturm.de/api/v1/season
```

Ein gültiger Token agiert mit **Admin-Rechten**; im Audit-Log erscheint `api+<name>@service.local`. Ohne `API_TOKENS` in der `.env` ist die API deaktiviert. Requests mit `Authorization`-Header werden ausschließlich über den Token autorisiert (kein Cookie-Fallback).

> Setup auf dem VPS: `API_TOKENS=…` an die bestehende `/root/tcm-vereinsmeister/.env` **anhängen** (Datei nie überschreiben), dann `docker compose up -d`.

## JSON-Endpunkte

### `GET /api/v1/season`
Aktive Saison (oder `?jahr=2025`) mit allen Konkurrenzen und der Saisonliste.

```json
{ "season": { "id": 1, "jahr": 2026, "name": "Vereinsmeisterschaft 2026", "status": "aktiv" },
  "competitions": [ { "id": 1, "slug": "herren", "name": "Herren Einzel", "art": "einzel", "modus": "gruppe" } ],
  "seasons": [ … ] }
```

### `GET /api/v1/matches`
Alle Paarungen der Saison (ohne Freilose/Platzhalter) mit Ergebnis und Status.
Filter: `?competition=<slug>`, `?status=open|pending|confirmed|rejected`, `?jahr=…`.

```bash
curl -H "Authorization: Bearer $TOKEN" "…/api/v1/matches?competition=herren&status=open"
```

Jedes Match: `matchId`, `wettbewerb`, `gruppe`/`runde`, `nr`, `sideA`/`sideB` (Namenslisten), `status`, `satz1/satz2/mtb`, `sieger`, `result`.

### `GET /api/v1/competition/<id>`
Eine Konkurrenz im Detail: `players` (Teilnehmer mit Gruppe/gesetzt), `gruppen` (Tabellen je Gruppe), `quali` (Gruppenphase fertig? Top 2), `runden`, `lastRoundWinners` (Kandidaten für die nächste Auslosung), `matches`.

### `POST /api/v1/results` — Ergebnis eintragen
Maßgebliche Eintragung (wie im Admin-Interface): **sofort bestätigt**, ersetzt ein vorhandenes Ergebnis, KO-Bracket wird synchronisiert, Audit-Log-Eintrag. Sätze immer **aus Sicht von Seite A**.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "match_id": 12, "satz1": "6:3", "satz2": "4:6", "mtb": "10:7" }' …/api/v1/results
```

Sonderfälle: kampflos `{ "match_id": 12, "typ": "wo", "sieger": "B" }`; Aufgabe `{ "match_id": 12, "typ": "aufgabe", "sieger": "A", "satz1": "6:2" }` (erfasste Sätze optional).
Antworten: `200` mit gespeichertem Ergebnis, `404` unbekanntes Match, `422` ungültiger Spielstand (Fehlertext in `error`).

### `DELETE /api/v1/results` — Ergebnis löschen
```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "match_id": 12 }' …/api/v1/results
```

## Alles Übrige: Admin-Form-Endpunkte

Gleicher Bearer-Header, Body `application/x-www-form-urlencoded`. Antwort ist ein Redirect (`302`); **Erfolg/Fehler im `Location`-Header** prüfen (`?ok=…` bzw. `?error=…`), z. B. mit `curl -i` (ohne `-L`).

```bash
# Beispiel: vor Ort geloste K.o.-Runde eintragen (2 Paarungen)
curl -i -X POST -H "Authorization: Bearer $TOKEN" "…/api/admin/match" \
  --data-urlencode "action=ko_round_create" \
  --data-urlencode "competition_id=1" \
  --data-urlencode "runde=Halbfinale" \
  --data-urlencode "side_a=Max Muster" --data-urlencode "side_b=Erika Beispiel" \
  --data-urlencode "side_a=Hans Test"  --data-urlencode "side_b=Lisa Probe"
```

| Endpoint | `action` | Wichtige Felder |
| --- | --- | --- |
| `POST /api/admin/enter` | `save` (Default) / `delete` | `match_id`, `ergebnis_typ` (`gespielt`/`wo`/`aufgabe`), `satz1`, `satz2`, `mtb`, `sieger` (`A`/`B`) — wie `/api/v1/results`, nur als Form |
| `POST /api/admin/result` | `confirm` / `delete` / `resolve` | `result_id`; bei `resolve` zusätzlich `satz1`, `satz2`, `mtb` (Spieler-Eintragungen bestätigen/klären) |
| `POST /api/admin/match` | `match_create` / `match_update` / `match_delete` | `competition_id` bzw. `match_id`, `nr`, `gruppe` oder `runde`, `side_a`, `side_b`, `monat`, `termin` |
| | `match_generate` | `competition_id`, `monat` — Jeder-gegen-Jeden je Gruppe |
| | `ko_generate` | `competition_id` — komplettes KO-Bracket mit Auto-Vorrücken |
| | `ko_round_create` | `competition_id`, `runde`, `monat?`, mehrfach `side_a`/`side_b` — geloste Runde ohne Auto-Vorrücken |
| `POST /api/admin/competition` | `comp_create` / `comp_update` / `comp_move` / `comp_delete` | `season_id` bzw. `competition_id`, `name`, `art` (`einzel`/`doppel`), `modus` (`gruppe`/`ko`), `dir` |
| | `player_add` / `player_remove` / `meldungen_uebernehmen` | `competition_id`, `player_name`, `gruppe`, `gesetzt=on` |
| `POST /api/admin/season` | `create` / `activate` / `archive` / `meldung` | `jahr`, `name`, `aktiv=on` bzw. `season_id` |
| `POST /api/admin/player` | `create` / `rename` / `phone` / `geschlecht` | `name`, `new_name`, `telefon`, `geschlecht` |
| `POST /api/admin/reminders` | – | `match_id` — Erinnerungs-Mail an die Beteiligten |
| `POST /api/admin/ladder` | `add` / `remove` / `move` / `penalty` / `resolve` | Forderungsliste: `liste`, `player_name`, `rank`, `dir`, `challenge_id`, `outcome` |
| `GET /api/admin/export` | – | Alle Ergebnisse als CSV |

## Typischer Agenten-Ablauf „Ergebnis anlegen"

1. `GET /api/v1/season` → Konkurrenz-Slug nachschlagen.
2. `GET /api/v1/matches?competition=herren&status=open` → `matchId` der Paarung finden (über `sideA`/`sideB`-Namen).
3. `POST /api/v1/results` mit `match_id` und Sätzen aus Sicht von Seite A.
