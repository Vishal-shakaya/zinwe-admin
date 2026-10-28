/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-37 Logs). No logs API yet: the Logs page and the menu dot read this
 * typed sample (copied from the AdminLogs board). Replace with `GET /api/admin/logs/` on the API day.
 * (Placeholder shape — the Logs page build fills in the full board dataset.)
 */
export type LogLevel = "info" | "ok" | "warn" | "error";

export interface LogEvent {
  id: string;
  at: string;
  level: LogLevel;
  source: string;
  title: string;
  detail: string;
  resolved?: boolean;
}

export const LOG_EVENTS: LogEvent[] = [
  {
    id: "bk-1028",
    at: "2026-10-28T03:00:00+05:30",
    level: "error",
    source: "backup",
    title: "Off-site backup failed",
    detail: "The local copy is fine (412 MB); the copy to Backblaze B2 timed out after 3 tries.",
  },
];
