/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-43) — Dashboard blocks the API does not serve yet. Everything else on the
 * Dashboard (Needs you now, tiles, sign-ups, revenue, recent activity) is real API data.
 *
 *  - AGENT_VERSIONS_BY_DAY: PCs online per day by Windows agent version, last 14 days (AdminDashboard board).
 *    Needs a daily heartbeat roll-up per version (e.g. `GET /api/admin/agents/versions/?days=14`).
 *  - The System card's Website status, last deploy and last backup come from the Logs sample
 *    (src/content/fixtures/logs.ts, FR-37); the API and Admin "Live" pills are real (this page loaded).
 *
 * API day: add the endpoints above and delete this file.
 */

/** 15–28 Oct 2026: [1.2.1, 1.2.0, older] PCs online that day. */
export const AGENT_VERSIONS_BY_DAY: { day: string; counts: [number, number, number] }[] = [
  { day: "2026-10-15", counts: [0, 0, 188] },
  { day: "2026-10-16", counts: [0, 0, 190] },
  { day: "2026-10-17", counts: [0, 0, 189] },
  { day: "2026-10-18", counts: [0, 0, 193] },
  { day: "2026-10-19", counts: [0, 0, 194] },
  { day: "2026-10-20", counts: [0, 0, 196] },
  { day: "2026-10-21", counts: [0, 0, 197] },
  { day: "2026-10-22", counts: [0, 52, 146] },
  { day: "2026-10-23", counts: [0, 151, 48] },
  { day: "2026-10-24", counts: [0, 188, 13] },
  { day: "2026-10-25", counts: [0, 204, 3] },
  { day: "2026-10-26", counts: [0, 206, 0] },
  { day: "2026-10-27", counts: [0, 207, 0] },
  { day: "2026-10-28", counts: [12, 190, 0] },
];

export const AGENT_VERSION_LABELS: [string, string, string] = ["1.2.1", "1.2.0", "Older"];

export const AGENT_VERSIONS_NOTE = "1.2.0 became required on 23 Oct. 1.2.1 is optional, out today at 11:32.";

export const WEBSITE_LIVE = true;
