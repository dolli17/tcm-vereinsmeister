// Selbst-Seeding beim ersten Start:
//  1) globaler Spielerstamm + bereits gespielte Ergebnisse (aus den JSON-Fixtures),
//  2) einmalige Migration ins Mehrjahres-Modell (Saison 2026 + Konkurrenzen +
//     Paarungen), inkl. Backfill von results.match_id.
// Jeder Schritt ist idempotent (läuft nur, wenn die jeweilige Tabelle leer ist).
import type Database from 'better-sqlite3';
import spielerData from '../data/spieler.json';
import einzelData from '../data/einzel.json';
import damenEinzelData from '../data/damen-einzel.json';
import doppelData from '../data/doppel.json';
import damenDoppelData from '../data/damen-doppel.json';
import mixedDoppelData from '../data/mixed-doppel.json';
import telefonnummern from '../data/telefonnummern.json';

const PHONE_BOOK = telefonnummern as Record<string, string>;

type SeedSpieler = { name: string; gruppe: number; gesetzt: boolean; telefon?: string };
type EinzelM = { nr: number; gruppe: number; monat: string; spielerA: string; spielerB: string; termin: string | null; satz1: string | null; satz2: string | null; mtb: string | null; sieger: string | null };
type DoppelM = { runde: string; nr: number; doppelA: string | null; doppelB: string | null; termin: string | null; satz1: string | null; satz2: string | null; mtb: string | null; sieger: string | null };
type MixedM = { nr: number; teamA: string | null; teamB: string | null; termin?: string | null; satz1?: string | null; satz2?: string | null; mtb?: string | null; sieger?: string | null };

const EINZEL_SPIELER = spielerData.einzel as SeedSpieler[];
const DAMEN_EINZEL_SPIELER = spielerData.damenEinzel as SeedSpieler[];
const RAW_EINZEL = einzelData.matches as EinzelM[];
const RAW_DAMEN_EINZEL = damenEinzelData.matches as EinzelM[];
const RAW_DOPPEL = doppelData.matches as DoppelM[];
const RAW_DAMEN_DOPPEL = damenDoppelData.matches as DoppelM[];
const RAW_MIXED: { runde: string; nr: number; teamA: string | null; teamB: string | null; termin: string | null; satz1: string | null; satz2: string | null; mtb: string | null; sieger: string | null }[] =
  mixedDoppelData.runden.flatMap((r) =>
    (r.matches as MixedM[]).map((m) => ({
      runde: r.name,
      nr: m.nr,
      teamA: m.teamA ?? null,
      teamB: m.teamB ?? null,
      termin: m.termin ?? null,
      satz1: m.satz1 ?? null,
      satz2: m.satz2 ?? null,
      mtb: m.mtb ?? null,
      sieger: m.sieger ?? null,
    })),
  );

function teamPlayers(team: string | null): string[] {
  if (!team || team === 'BYE') return [];
  return team.split('/').map((p) => p.trim());
}
const isPlaceholder = (name: string) => /^Sieger\s/i.test(name);
const isPlayed = (m: { sieger: string | null }) => m.sieger === 'A' || m.sieger === 'B';

export function runSeed(db: Database.Database): void {
  seedPlayers(db);
  seedConfirmedResults(db);
  migrateToSeasons(db);
  backfillBracketRefs(db);
  backfillGeschlecht(db);
  ensureAdmins(db);
}

// Geschlecht aus den Einzel-Stammdaten ableiten (herren→m, damen→w). Idempotent;
// alle übrigen Spieler pflegt der Admin bzw. die Registrierung.
function backfillGeschlecht(db: Database.Database): void {
  db.exec(`
    UPDATE players SET geschlecht = 'm' WHERE geschlecht IS NULL AND konkurrenz = 'herren';
    UPDATE players SET geschlecht = 'w' WHERE geschlecht IS NULL AND konkurrenz = 'damen';
  `);
}

// Verknüpft "Sieger Match N"-Platzhalter (Altdaten) mit dem Quellmatch derselben
// Konkurrenz (source_match_a/b), damit die KO-Automatik auch für sie greift.
// Idempotent: behandelt nur Zeilen ohne gesetzte Referenz.
function backfillBracketRefs(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT id, competition_id, side_a, side_b, source_match_a, source_match_b FROM matches
       WHERE (side_a LIKE 'Sieger %' AND source_match_a IS NULL)
          OR (side_b LIKE 'Sieger %' AND source_match_b IS NULL)`,
    )
    .all() as { id: number; competition_id: number; side_a: string | null; side_b: string | null; source_match_a: number | null; source_match_b: number | null }[];

  // 'Sieger Match N' → frühestes Match Nr. N der Konkurrenz; 'Sieger <Runde> N'
  // (z. B. 'Sieger Viertelfinale 2') → Match Nr. N der genannten Runde.
  const byNr = db.prepare('SELECT id FROM matches WHERE competition_id = ? AND nr = ? AND id != ? ORDER BY id LIMIT 1');
  const byRunde = db.prepare('SELECT id FROM matches WHERE competition_id = ? AND runde = ? AND nr = ? AND id != ? LIMIT 1');
  const upd = db.prepare('UPDATE matches SET source_match_a = ?, source_match_b = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const m of rows) {
      const resolve = (side: string | null, existing: number | null): number | null => {
        if (existing != null || !side) return existing;
        const matchRef = side.match(/^Sieger Match (\d+)$/i);
        if (matchRef) {
          const src = byNr.get(m.competition_id, parseInt(matchRef[1], 10), m.id) as { id: number } | undefined;
          return src?.id ?? null;
        }
        const rundeRef = side.match(/^Sieger (.+?) (\d+)$/i);
        if (rundeRef) {
          const src = byRunde.get(m.competition_id, rundeRef[1], parseInt(rundeRef[2], 10), m.id) as { id: number } | undefined;
          return src?.id ?? null;
        }
        return null;
      };
      upd.run(resolve(m.side_a, m.source_match_a), resolve(m.side_b, m.source_match_b), m.id);
    }

    // Entschiedene Quellmatches vorrücken: Platzhalter-Seiten werden aufgelöst,
    // wenn das Quellmatch ein Freilos ist ODER bereits ein bestätigtes Ergebnis
    // hat (Altdaten, die vor der KO-Automatik bestätigt wurden). Läuft bei jedem
    // Start und iterativ über die Runden (Sieger einer aufgelösten Runde können
    // weitere Platzhalter auflösen).
    const placeholderStmt = db.prepare(
      `SELECT id, side_a, side_b, source_match_a, source_match_b FROM matches
       WHERE (side_a LIKE 'Sieger %' AND source_match_a IS NOT NULL)
          OR (side_b LIKE 'Sieger %' AND source_match_b IS NOT NULL)`,
    );
    const srcStmt = db.prepare('SELECT side_a, side_b FROM matches WHERE id = ?');
    const confirmedStmt = db.prepare("SELECT sieger FROM results WHERE match_id = ? AND status = 'confirmed' LIMIT 1");
    const setSide = (col: 'side_a' | 'side_b') => db.prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`);
    const setA = setSide('side_a');
    const setB = setSide('side_b');
    const real = (x: string | null) => !!x && x !== 'BYE' && !isPlaceholder(x);

    // Sieger des Quellmatches: bestätigtes Ergebnis > Freilos; sonst offen.
    const winnerOf = (srcId: number): string | null => {
      const src = srcStmt.get(srcId) as { side_a: string | null; side_b: string | null } | undefined;
      if (!src) return null;
      const res = confirmedStmt.get(srcId) as { sieger: 'A' | 'B' } | undefined;
      if (res) {
        const w = res.sieger === 'A' ? src.side_a : src.side_b;
        return real(w) ? w : null;
      }
      if (src.side_b === 'BYE' && real(src.side_a)) return src.side_a;
      if (src.side_a === 'BYE' && real(src.side_b)) return src.side_b;
      return null;
    };

    for (let pass = 0; pass < 10; pass++) {
      let changed = 0;
      const placeholderRows = placeholderStmt.all() as { id: number; side_a: string | null; side_b: string | null; source_match_a: number | null; source_match_b: number | null }[];
      for (const m of placeholderRows) {
        // Hat die Folgepartie selbst schon ein bestätigtes Ergebnis, nicht anfassen.
        if (confirmedStmt.get(m.id)) continue;
        if (m.side_a?.startsWith('Sieger') && m.source_match_a != null) {
          const w = winnerOf(m.source_match_a);
          if (w) { setA.run(w, m.id); changed++; }
        }
        if (m.side_b?.startsWith('Sieger') && m.source_match_b != null) {
          const w = winnerOf(m.source_match_b);
          if (w) { setB.run(w, m.id); changed++; }
        }
      }
      if (changed === 0) break;
    }
  });
  tx();
}

function seedPlayers(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO players (name, konkurrenz, gruppe, gesetzt, telefon)
     VALUES (@name, @konkurrenz, @gruppe, @gesetzt, @telefon)`,
  );
  const tx = db.transaction(() => {
    for (const s of EINZEL_SPIELER) {
      insert.run({ name: s.name, konkurrenz: 'herren', gruppe: s.gruppe, gesetzt: s.gesetzt ? 1 : 0, telefon: s.telefon ?? PHONE_BOOK[s.name] ?? null });
    }
    for (const s of DAMEN_EINZEL_SPIELER) {
      insert.run({ name: s.name, konkurrenz: 'damen', gruppe: s.gruppe, gesetzt: s.gesetzt ? 1 : 0, telefon: s.telefon ?? PHONE_BOOK[s.name] ?? null });
    }
    const teamNames = new Set<string>();
    for (const m of [...RAW_DOPPEL, ...RAW_DAMEN_DOPPEL]) {
      for (const p of [...teamPlayers(m.doppelA), ...teamPlayers(m.doppelB)]) teamNames.add(p);
    }
    for (const m of RAW_MIXED) {
      for (const p of [...teamPlayers(m.teamA), ...teamPlayers(m.teamB)]) teamNames.add(p);
    }
    for (const name of teamNames) {
      if (isPlaceholder(name)) continue;
      insert.run({ name, konkurrenz: null, gruppe: null, gesetzt: 0, telefon: PHONE_BOOK[name] ?? null });
    }
  });
  tx();
}

function seedConfirmedResults(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM results').get() as { n: number }).n;
  if (count > 0) return;
  // Nur zusammen mit der Saison-Migration: existieren bereits Saisons, läuft der
  // match_id-Backfill (migrateToSeasons) nicht mehr — die Zeilen blieben mit
  // match_id=NULL unsichtbar und der Duplikat-Schutz (Partial-Index) griffe nicht.
  const seasons = (db.prepare('SELECT COUNT(*) AS n FROM seasons').get() as { n: number }).n;
  if (seasons > 0) return;

  const insert = db.prepare(
    `INSERT INTO results (wettbewerb, gruppe, runde, match_nr, satz1, satz2, mtb, sieger, status, decided_at)
     VALUES (@wettbewerb, @gruppe, @runde, @match_nr, @satz1, @satz2, @mtb, @sieger, 'confirmed', datetime('now'))`,
  );
  const tx = db.transaction(() => {
    const seedEinzel = (matches: EinzelM[], wettbewerb: 'herren' | 'damen') => {
      for (const m of matches) {
        if (!isPlayed(m)) continue;
        insert.run({ wettbewerb, gruppe: m.gruppe, runde: null, match_nr: m.nr, satz1: m.satz1, satz2: m.satz2, mtb: m.mtb, sieger: m.sieger });
      }
    };
    const seedDoppel = (matches: DoppelM[], wettbewerb: 'doppel' | 'damen-doppel') => {
      for (const m of matches) {
        if (!isPlayed(m)) continue;
        insert.run({ wettbewerb, gruppe: null, runde: m.runde, match_nr: m.nr, satz1: m.satz1, satz2: m.satz2, mtb: m.mtb, sieger: m.sieger });
      }
    };
    seedEinzel(RAW_EINZEL, 'herren');
    seedEinzel(RAW_DAMEN_EINZEL, 'damen');
    seedDoppel(RAW_DOPPEL, 'doppel');
    seedDoppel(RAW_DAMEN_DOPPEL, 'damen-doppel');
    for (const m of RAW_MIXED) {
      if (!isPlayed(m)) continue;
      insert.run({ wettbewerb: 'mixed', gruppe: null, runde: m.runde, match_nr: m.nr, satz1: m.satz1, satz2: m.satz2, mtb: m.mtb, sieger: m.sieger });
    }
  });
  tx();
}

// ── Einmalige Migration ins Mehrjahres-Modell (Saison 2026) ──────────────────
type CompSpec = { slug: string; name: string; art: 'einzel' | 'doppel'; modus: 'gruppe' | 'ko'; sort: number };
const COMPS_2026: CompSpec[] = [
  { slug: 'herren', name: 'Herren Einzel', art: 'einzel', modus: 'gruppe', sort: 0 },
  { slug: 'damen', name: 'Damen Einzel', art: 'einzel', modus: 'gruppe', sort: 1 },
  { slug: 'doppel', name: 'Herren Doppel', art: 'doppel', modus: 'ko', sort: 2 },
  { slug: 'damen-doppel', name: 'Damen Doppel', art: 'doppel', modus: 'ko', sort: 3 },
  { slug: 'mixed', name: 'Mixed Doppel', art: 'doppel', modus: 'ko', sort: 4 },
];

function migrateToSeasons(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM seasons').get() as { n: number }).n;
  if (count > 0) return;

  const insSeason = db.prepare("INSERT INTO seasons (jahr, name, status) VALUES (?, ?, 'aktiv')");
  const insComp = db.prepare(
    "INSERT INTO competitions (season_id, slug, name, art, modus, sort) VALUES (@season_id, @slug, @name, @art, @modus, @sort)",
  );
  const insCompPlayer = db.prepare(
    'INSERT OR IGNORE INTO competition_players (competition_id, player_name, gruppe, gesetzt) VALUES (?, ?, ?, ?)',
  );
  const insMatch = db.prepare(
    'INSERT INTO matches (competition_id, gruppe, runde, monat, nr, side_a, side_b, termin) VALUES (@competition_id, @gruppe, @runde, @monat, @nr, @side_a, @side_b, @termin)',
  );
  // Verknüpft bereits vorhandene Legacy-Ergebnisse mit der neuen matches-Zeile.
  const linkResults = db.prepare(
    `UPDATE results SET match_id = ?
     WHERE wettbewerb = ? AND IFNULL(gruppe,-1) = IFNULL(?, -1)
       AND IFNULL(runde,'') = IFNULL(?, '') AND match_nr = ? AND match_id IS NULL`,
  );

  const tx = db.transaction(() => {
    const seasonId = insSeason.run(2026, 'Vereinsmeisterschaft 2026').lastInsertRowid as number;
    const compId: Record<string, number> = {};
    for (const c of COMPS_2026) {
      compId[c.slug] = insComp.run({ season_id: seasonId, ...c }).lastInsertRowid as number;
    }

    // Teilnehmer (Einzel: aus spieler.json mit Gruppe/Setzung)
    for (const s of EINZEL_SPIELER) insCompPlayer.run(compId.herren, s.name, s.gruppe, s.gesetzt ? 1 : 0);
    for (const s of DAMEN_EINZEL_SPIELER) insCompPlayer.run(compId.damen, s.name, s.gruppe, s.gesetzt ? 1 : 0);

    // Paarungen + Teilnehmer (Doppel/Mixed: aus den Team-Namen abgeleitet)
    const addEinzel = (rows: EinzelM[], slug: string) => {
      for (const m of rows) {
        const id = insMatch.run({ competition_id: compId[slug], gruppe: m.gruppe, runde: null, monat: m.monat, nr: m.nr, side_a: m.spielerA, side_b: m.spielerB, termin: m.termin }).lastInsertRowid as number;
        linkResults.run(id, slug, m.gruppe, null, m.nr);
      }
    };
    const addTeam = (rows: { runde: string; nr: number; a: string | null; b: string | null; termin: string | null }[], slug: string) => {
      const seen = new Set<string>();
      for (const m of rows) {
        // 1. Runde ist im Mai fällig (Anzeige/Überfälligkeit); spätere Runden ohne Frist.
        const monat = m.runde === '1. Runde' ? 'Mai' : null;
        const id = insMatch.run({ competition_id: compId[slug], gruppe: null, runde: m.runde, monat, nr: m.nr, side_a: m.a, side_b: m.b, termin: m.termin }).lastInsertRowid as number;
        linkResults.run(id, slug, null, m.runde, m.nr);
        for (const p of [...teamPlayers(m.a), ...teamPlayers(m.b)]) {
          if (isPlaceholder(p) || seen.has(p)) continue;
          seen.add(p);
          insCompPlayer.run(compId[slug], p, null, 0);
        }
      }
    };

    addEinzel(RAW_EINZEL, 'herren');
    addEinzel(RAW_DAMEN_EINZEL, 'damen');
    addTeam(RAW_DOPPEL.map((m) => ({ runde: m.runde, nr: m.nr, a: m.doppelA, b: m.doppelB, termin: m.termin })), 'doppel');
    addTeam(RAW_DAMEN_DOPPEL.map((m) => ({ runde: m.runde, nr: m.nr, a: m.doppelA, b: m.doppelB, termin: m.termin })), 'damen-doppel');
    addTeam(RAW_MIXED.map((m) => ({ runde: m.runde, nr: m.nr, a: m.teamA, b: m.teamB, termin: m.termin })), 'mixed');
  });
  tx();
}

function ensureAdmins(db: Database.Database): void {
  const emails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return;

  const upsert = db.prepare(
    `INSERT INTO users (email, role, claim_status) VALUES (?, 'admin', 'approved')
     ON CONFLICT(email) DO UPDATE SET role = 'admin', claim_status = 'approved'`,
  );
  const tx = db.transaction(() => {
    for (const email of emails) upsert.run(email);
  });
  tx();
}
