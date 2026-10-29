/**
 * Logs client (FR-37): /api/admin/logs/*. One timeline of this environment: deploys, rollbacks, backups (with the
 * off-site copy), API starts and server errors (written by zinwe-server.sh / the API itself), merged with staff
 * actions from the admin audit trail, agent releases and payment reviews. Dev and prod each keep their own.
 */
import { request } from "./api";

export type LogType = "server" | "deploy" | "backup" | "agent" | "staff" | "error";
export type LogResult = "ok" | "fail" | "rolled";
export type StepMark = "ok" | "fail" | "skip";
export type LogRange = "24h" | "7d" | "30d";

export interface LogEvent {
  /** "ops-12", "evt-345", "rel-3", "pay-9": unique across the sources. */
  id: string;
  /** ISO time (UTC); the page shows it in IST. */
  at: string;
  type: LogType;
  /** "Ship", "Promote", "Rollback", "Backup", "Staff action", … */
  label: string;
  /** "prod", "dev" or "local". */
  env: string;
  what: string;
  /** Staff email, or "system". */
  who: string;
  result: LogResult;
  /** Custom result text ("Down 4 min"); empty = the plain label. */
  result_label: string;
  details: [string, string][];
  steps: [string, StepMark, string][];
  /** A failure nobody has handled: "Needs attention" and the menu dot. */
  unresolved: boolean;
  source: "ops" | "audit" | "release" | "payment";
  /** The ops row's id (resolve it with resolveLog); null for the other sources. */
  ops_id: number | null;
}

export interface LogsResponse {
  env: string;
  range: LogRange;
  type: "all" | LogType;
  q: string;
  now: string;
  /** Per type, for the chips: over the range and search, not the type. */
  counts: Record<"all" | LogType, number>;
  total: number;
  /** More rows matched than were sent (the newest are sent). */
  truncated: boolean;
  rows: LogEvent[];
}

export interface LogsStatus {
  env: string;
  checked_at: string;
  api: {
    ok: boolean;
    host: string;
    version: string;
    started_at: string;
    /** The RELEASE file of a server release (stamp, backend, frontend, admin, deployed_at, …); null locally. */
    release: Record<string, string> | null;
    pid: number;
  };
  database: { ok: boolean; engine: string; latency_ms: number | null };
  /** Percentages; null where the OS doesn't report them (Windows, a locked-down host). */
  server: {
    cpu: number | null;
    memory: number | null;
    disk: number | null;
    disk_free_gb: number | null;
    booted_at: string | null;
    cores: number | null;
  };
  /** Not measured yet: always null, the page hides it. */
  uptime_30d: number | null;
  last_deploy: LogEvent | null;
  last_backup: LogEvent | null;
  unresolved: number;
  /** The newest unresolved failures (up to 5). */
  attention: LogEvent[];
}

export interface LogsQuery {
  range?: LogRange;
  type?: "all" | LogType;
  q?: string;
  limit?: number;
}

export function getLogs(query: LogsQuery = {}): Promise<LogsResponse> {
  const p = new URLSearchParams();
  if (query.range) p.set("range", query.range);
  if (query.type && query.type !== "all") p.set("type", query.type);
  if (query.q?.trim()) p.set("q", query.q.trim());
  if (query.limit) p.set("limit", String(query.limit));
  const qs = p.toString();
  return request<LogsResponse>(`/api/admin/logs/${qs ? `?${qs}` : ""}`);
}

export const getLogsStatus = () => request<LogsStatus>("/api/admin/logs/status/");

/** Mark a failed job as handled: it leaves "Needs attention" and the menu dot. */
export const resolveLog = (opsId: number) =>
  request<LogEvent>(`/api/admin/logs/ops/${opsId}/resolve/`, { method: "POST" });

/** "prod" -> "Prod". */
export const envLabel = (env: string) => (env ? env.charAt(0).toUpperCase() + env.slice(1) : "—");
