// Sieger-Ermittlung je Konkurrenz: KO → Finalsieger, Gruppen → Gruppensieger.
// Grundlage für das Saison-Archiv ("Hall of Fame") und den Abschluss-Wizard.
import {
  getCompetitions,
  getEnrichedMatches,
  getGruppen,
  getRunden,
  isPlayed,
  type Competition,
} from './tournament';
import { computeStandings } from './standings';

export type CompetitionHonour = {
  competition: Competition;
  // KO: genau ein Eintrag (Finalsieger). Gruppen: ein Eintrag je Gruppe.
  winners: { label: string; name: string }[];
  open: number; // noch offene (spielbare) Partien — 0 = Konkurrenz fertig
};

export function getSeasonHonours(seasonId: number): CompetitionHonour[] {
  const out: CompetitionHonour[] = [];
  for (const comp of getCompetitions(seasonId)) {
    const matches = getEnrichedMatches(comp.id);
    const playable = matches.filter((m) => m.sideA && m.sideB && m.sideA !== 'BYE' && m.sideB !== 'BYE');
    const open = playable.filter((m) => !isPlayed(m) && !/^Sieger\s/i.test(m.sideA ?? '') && !/^Sieger\s/i.test(m.sideB ?? '')).length;

    const winners: { label: string; name: string }[] = [];
    // K.o.-Runden vorhanden (reine KO-Konkurrenz oder KO-Phase nach der
    // Gruppenphase) → der Finalsieger ist Vereinsmeister, nicht die Gruppensieger.
    const runden = getRunden(comp.id);
    if (runden.length > 0) {
      const finalRound = runden[runden.length - 1];
      const finals = matches.filter((m) => m.runde === finalRound);
      if (finals.length === 1 && isPlayed(finals[0])) {
        const f = finals[0];
        const name = f.sieger === 'A' ? f.sideA : f.sideB;
        if (name) winners.push({ label: 'Vereinsmeister', name });
      }
    } else if (comp.modus !== 'ko') {
      for (const g of getGruppen(comp.id)) {
        const rows = computeStandings(comp.id, g);
        const first = rows[0];
        if (first && first.gespielt > 0) winners.push({ label: `Gruppe ${g}`, name: first.name });
      }
    }
    out.push({ competition: comp, winners, open });
  }
  return out;
}
