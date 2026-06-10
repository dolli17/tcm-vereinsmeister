// Audit-Log: protokolliert Eingriffe (Admin-Aktionen, Ergebnis-Entscheidungen),
// damit strittige Ergebnisse und Verwaltungsänderungen nachvollziehbar bleiben.
import { getDb } from './db';

export type AuditEntry = {
  id: number;
  user_id: number | null;
  user_label: string | null;
  action: string;
  detail: string | null;
  created_at: string;
};

export function logAction(
  user: { id: number; email: string } | null | undefined,
  action: string,
  detail?: string | null,
): void {
  getDb()
    .prepare('INSERT INTO audit_log (user_id, user_label, action, detail) VALUES (?, ?, ?, ?)')
    .run(user?.id ?? null, user?.email ?? null, action, detail ?? null);
}

export function listAuditLog(limit = 50): AuditEntry[] {
  return getDb()
    .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(limit) as AuditEntry[];
}
