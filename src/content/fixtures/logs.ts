/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-37 Logs). No logs API yet: the Logs page and the menu dot read this
 * typed sample, copied word for word from the AdminLogs board (one admin dataset, 28 Oct 2026 14:36 IST).
 * The sample keeps its own clock (`LOGS_NOW`) so "Today", "Yesterday" and the date ranges match the board.
 *
 * API day: replace with `GET /api/admin/logs/?range=&type=&q=` (+ `/status/`, and
 * `POST /api/admin/logs/backups/<id>/retry-offsite/`) and delete this file.
 */

export type LogType = "server" | "deploy" | "backup" | "agent" | "staff" | "error";
export type LogResult = "ok" | "fail" | "rolled";
export type StepMark = "ok" | "fail" | "skip";

export interface LogEvent {
  id: string;
  /** Local IST time, "YYYY-MM-DDTHH:MM". */
  at: string;
  type: LogType;
  /** "Ship", "Promote", "Rollback", "Backup", … */
  label: string;
  env: "Prod" | "Dev";
  what: string;
  /** Staff email, or "system". */
  who: string;
  result: LogResult;
  /** Custom result label ("Down 4 min"). */
  resultLabel?: string;
  details: [string, string][];
  steps?: [string, StepMark, string][];
  commits?: [string, string[]][];
  /** The off-site copy of this backup can be retried from the page. */
  retryable?: boolean;
  /** A failure nobody has fixed yet: feeds "Needs attention" and the menu dot. */
  unresolved?: boolean;
}

export interface StatusCard {
  name: string;
  host: string;
  state: "live" | "restarting" | "down";
  uptime: string;
  checked: string;
}

export const LOGS_NOW = "2026-10-28T14:36";

const T = "925/925 passed";

export const LOG_STATUS: StatusCard[] = [
  { name: "Prod API", host: "api.zinwe.io", state: "live", uptime: "99.99%", checked: "checked 20 s ago" },
  { name: "Website", host: "zinwe.io", state: "live", uptime: "99.99%", checked: "checked 20 s ago" },
  { name: "Admin", host: "admin.zinwe.io", state: "live", uptime: "99.99%", checked: "checked 20 s ago" },
  { name: "Dev", host: "dev.zinwe.io · after ship 14:33", state: "restarting", uptime: "99.62%", checked: "checked 10 s ago" },
];

export const LOG_SERVER = {
  note: "1 VPS · dev + prod",
  cpu: 23,
  memory: 61,
  disk: 48,
  lastRestart: "Last restart 25 Oct, 02:10 (host maintenance)",
};

export const LOG_ATTENTION = {
  title: "Needs attention · 1 failure in the last 24 hours",
  body: "Prod nightly backup, 28 Oct 03:00. The local copy is fine (412 MB), but the off-site copy to Backblaze B2 failed after 3 tries.",
  eventId: "bkp28",
  clear: "Nothing needs attention. The 28 Oct backup now has its off-site copy on B2.",
};

export const LOG_SOURCES =
  "Sources: ship.sh, promote.sh and rollback.sh for deployments; backup.sh at 03:00 IST, kept 14 days, encrypted copy on Backblaze B2; the uptime monitor for Prod API, Website, Admin and Dev; the admin audit log for staff actions.";

export const LOG_EVENTS: LogEvent[] = [
  { id: "ship1", at: "2026-10-28T14:33", type: "deploy", label: "Ship", env: "Dev", what: "Shipped to dev · backend, admin", who: "vishal@zinwe.io", result: "ok",
    details: [["Tests", T + " · 2 min 48 s"], ["Dev restart", "Started 14:34 · health check pending"], ["Source", "ship.sh"]],
    commits: [["backend", ["f3a9d21  Log backup size in MB", "0c7be45  B2 upload: longer timeout, 3 tries"]], ["admin", ["3be81f4  Logs: environment filter", "90c2d7a  Logs: export as CSV"]]] },
  { id: "pay1", at: "2026-10-28T12:05", type: "staff", label: "Staff action", env: "Prod", what: "Approved payment · Harbor Lane Clinics · ₹2,123 (Teams, 1 month)", who: "priya@zinwe.io", result: "ok",
    details: [["Customer", "Harbor Lane Clinics"], ["Payment", "UPI · ₹2,123 incl. GST"], ["Invoice", "ZW/2026-27/0131"], ["Source", "Admin audit log"]] },
  { id: "note1", at: "2026-10-28T11:40", type: "staff", label: "Staff action", env: "Prod", what: "Published release note · Windows agent 1.2.1", who: "vishal@zinwe.io", result: "ok",
    details: [["Title", "Tray fixes and clearer second-PC messages"], ["Shown in", "Dashboard bell and the tray app"], ["Source", "Admin audit log"]] },
  { id: "agent1", at: "2026-10-28T11:32", type: "agent", label: "Agent release", env: "Prod", what: "Released Windows agent 1.2.1 · Optional", who: "vishal@zinwe.io", result: "ok",
    details: [["Update", "Optional · the person agrees in the tray app"], ["Installer", "ZinweSetup-1.2.1.msi · 38.4 MB · signed"], ["Updated so far", "12 of 214 PCs"], ["Source", "release.sh"]],
    commits: [["agent", ["c41e0a9  Tray opens above the taskbar on every monitor", "5aa7d10  Second PC: clear message instead of a silent block"]]] },
  { id: "prom2", at: "2026-10-28T10:19", type: "deploy", label: "Promote", env: "Prod", what: "Promoted to prod · prod-20261028-1019 · passed on retry", who: "vishal@zinwe.io", result: "ok",
    details: [["Tag", "prod-20261028-1019"], ["Retry of", "The 10:12 attempt, stopped at off-site copy"], ["Tests", T], ["Downtime", "None · API restart 9 s"], ["Source", "promote.sh"]],
    steps: [["Tests", "ok", T], ["Pre-deploy backup", "ok", "411 MB"], ["Off-site copy to B2", "ok", "attempt 2 · 38 s"], ["Database migrations", "ok", "2 applied"], ["Restart prod API", "ok", "9 s"], ["Health check", "ok", "API, website, admin"]],
    commits: [["backend", ["e52c9a0  Fix heartbeat connection pool leak", "b19d4f2  LinkedIn sign-in: handle 502 from LinkedIn"]], ["website", ["4c70e1a  Download page: agent 1.2.1"]], ["admin", ["d2a8e66  Payment links: copy button"]]] },
  { id: "prom1", at: "2026-10-28T10:12", type: "deploy", label: "Promote", env: "Prod", what: "Promote stopped at off-site backup · prod not changed", who: "vishal@zinwe.io", result: "fail",
    details: [["Tag", "prod-20261028-1012 (not used)"], ["Prod stayed on", "prod-20261026-1530"], ["Next", "Retried at 10:19 and passed"], ["Source", "promote.sh"]],
    steps: [["Tests", "ok", T], ["Pre-deploy backup", "ok", "411 MB"], ["Off-site copy to B2", "fail", "timed out after 120 s"], ["Database migrations", "skip", ""], ["Restart prod API", "skip", ""], ["Health check", "skip", ""]] },
  { id: "err1", at: "2026-10-28T09:02", type: "error", label: "Error", env: "Prod", what: "API errors · 41 × 500 on POST /api/agent/heartbeat in 5 min", who: "system", result: "fail",
    details: [["Cause", "Database connection pool full (20 of 20)"], ["Cleared", "09:06 · pool reset by the API watchdog"], ["Affected", "3 customers · PCs showed offline up to 4 min"], ["Fix", "e52c9a0, in prod since 10:19"], ["Source", "Uptime monitor"]] },
  { id: "bkp28", at: "2026-10-28T03:00", type: "backup", label: "Backup", env: "Prod", what: "Nightly backup · 412 MB · off-site copy failed", who: "system", result: "fail", retryable: true, unresolved: true,
    details: [["Local copy", "OK · 412 MB · encrypted"], ["Off-site copy", "B2 upload failed after 3 tries (timeout)"], ["Kept", "14 days · oldest is 15 Oct"], ["Next backup", "29 Oct, 03:00 IST"], ["Source", "backup.sh (daily, 03:00 IST)"]] },

  { id: "roll1", at: "2026-10-27T22:44", type: "deploy", label: "Rollback", env: "Prod", what: "Rolled back prod to prod-20261026-1530", who: "vishal@zinwe.io", result: "ok",
    details: [["From", "prod-20261027-2231"], ["To", "prod-20261026-1530"], ["Reason", "Sign in with LinkedIn returned 502"], ["Downtime", "11 s during restart"], ["Source", "rollback.sh"]] },
  { id: "prom0", at: "2026-10-27T22:31", type: "deploy", label: "Promote", env: "Prod", what: "Promoted to prod · prod-20261027-2231", who: "vishal@zinwe.io", result: "rolled",
    details: [["Tag", "prod-20261027-2231"], ["Tests", T], ["Rolled back", "22:44 · see the rollback above"], ["Source", "promote.sh"]],
    steps: [["Tests", "ok", T], ["Pre-deploy backup", "ok", "409 MB"], ["Off-site copy to B2", "ok", "44 s"], ["Database migrations", "ok", "1 applied"], ["Restart prod API", "ok", "10 s"], ["Health check", "ok", "API, website, admin"]],
    commits: [["backend", ["6f1e2d3  Sign in with LinkedIn"]], ["website", ["8a9b0c1  LinkedIn button on the sign-in page"]]] },
  { id: "link1", at: "2026-10-27T18:05", type: "staff", label: "Staff action", env: "Prod", what: "Sent payment link · Northwind Tutors · ₹1,146 (Startups)", who: "priya@zinwe.io", result: "ok",
    details: [["Customer", "Northwind Tutors"], ["Link expires", "3 Nov 2026"], ["Source", "Admin audit log"]] },
  { id: "ship0", at: "2026-10-27T15:10", type: "deploy", label: "Ship", env: "Dev", what: "Shipped to dev · backend, website", who: "vishal@zinwe.io", result: "ok",
    details: [["Tests", T + " · 2 min 51 s"], ["Dev restart", "14 s"], ["Source", "ship.sh"]],
    commits: [["backend", ["6f1e2d3  Sign in with LinkedIn"]], ["website", ["8a9b0c1  LinkedIn button on the sign-in page"]]] },
  { id: "agent2", at: "2026-10-27T16:20", type: "agent", label: "Agent release", env: "Dev", what: "Published Windows agent 1.3.0 to Dev · Required once promoted", who: "vishal@zinwe.io", result: "ok",
    details: [["Update", "Required · 4 test PCs on Dev"], ["Installer", "ZinweSetup-1.3.0.msi · 39.1 MB · signed"], ["Installed so far", "3 of 4 test PCs · no errors"], ["Next", "Promote to Prod from Releases"], ["Source", "release.sh"]] },
  { id: "ann1", at: "2026-10-27T11:20", type: "staff", label: "Staff action", env: "Prod", what: "Published announcement · Agent 1.2.1 arrives this week", who: "priya@zinwe.io", result: "ok",
    details: [["Shown to", "All owners, in the dashboard bell"], ["Ends", "31 Oct"], ["Source", "Admin audit log"]] },
  { id: "bkp27", at: "2026-10-27T03:00", type: "backup", label: "Backup", env: "Prod", what: "Nightly backup · 409 MB · Off-site copy: B2 ✓", who: "system", result: "ok",
    details: [["Local copy", "OK · 409 MB · encrypted"], ["Off-site copy", "B2 ✓ · 52 s"], ["Kept", "14 days"], ["Source", "backup.sh (daily, 03:00 IST)"]] },

  { id: "prom-1", at: "2026-10-26T15:30", type: "deploy", label: "Promote", env: "Prod", what: "Promoted to prod · prod-20261026-1530", who: "vishal@zinwe.io", result: "ok",
    details: [["Tag", "prod-20261026-1530"], ["Tests", T], ["Downtime", "None · API restart 9 s"], ["Source", "promote.sh"]],
    commits: [["backend", ["2d4e6f8  Alerts: group repeats by person"]], ["admin", ["71ab3c0  Release notes editor"]]] },
  { id: "del1", at: "2026-10-26T13:12", type: "staff", label: "Staff action", env: "Prod", what: "Deleted customer · Test Co Pvt Ltd (owner asked)", who: "vishal@zinwe.io", result: "ok",
    details: [["Removed", "Company, 2 PCs, 6 days of activity"], ["Backups", "Drops out of backups within 14 days"], ["Source", "Admin audit log"]] },
  { id: "rem1", at: "2026-10-26T11:48", type: "staff", label: "Staff action", env: "Prod", what: "Added remark · Harbor Lane Clinics", who: "priya@zinwe.io", result: "ok",
    details: [["Remark", "Wants a call about the Teams plan on Friday"], ["Source", "Admin audit log"]] },
  { id: "blog1", at: "2026-10-26T10:05", type: "staff", label: "Staff action", env: "Prod", what: "Published blog post · How to set USB rules", who: "priya@zinwe.io", result: "ok",
    details: [["URL", "zinwe.io/blog/usb-rules"], ["Source", "Admin audit log"]] },
  { id: "bkp26", at: "2026-10-26T03:00", type: "backup", label: "Backup", env: "Prod", what: "Nightly backup · 407 MB · Off-site copy: B2 ✓", who: "system", result: "ok",
    details: [["Local copy", "OK · 407 MB · encrypted"], ["Off-site copy", "B2 ✓ · 49 s"], ["Kept", "14 days"], ["Source", "backup.sh (daily, 03:00 IST)"]] },

  { id: "bkp25", at: "2026-10-25T03:00", type: "backup", label: "Backup", env: "Prod", what: "Nightly backup · 406 MB · Off-site copy: B2 ✓", who: "system", result: "ok",
    details: [["Local copy", "OK · 406 MB · encrypted"], ["Off-site copy", "B2 ✓ · 50 s"], ["Kept", "14 days"], ["Source", "backup.sh (daily, 03:00 IST)"]] },
  { id: "down1", at: "2026-10-25T02:14", type: "server", label: "Server", env: "Prod", what: "Prod API down (VPS maintenance) · back after 4 min", who: "system", result: "fail", resultLabel: "Down 4 min",
    details: [["Down", "02:10 – 02:14 IST"], ["Also down", "Website, Admin and Dev (same VPS)"], ["Cause", "Host restarted the VPS for planned maintenance"], ["Alert", "Sent to staff after 2 failed checks"], ["Source", "Uptime monitor"]] },

  { id: "agent0", at: "2026-10-23T16:00", type: "agent", label: "Agent release", env: "Prod", what: "Released Windows agent 1.2.0 · Required", who: "vishal@zinwe.io", result: "ok",
    details: [["Update", "Required · installs on next sign-in"], ["Installer", "ZinweSetup-1.2.0.msi · 38.1 MB · signed"], ["Updated", "214 of 214 PCs"], ["Source", "release.sh"]] },
  { id: "ann0", at: "2026-10-22T17:30", type: "staff", label: "Staff action", env: "Prod", what: "Published announcement · Short maintenance on 25 Oct, 02:00", who: "priya@zinwe.io", result: "ok",
    details: [["Shown to", "All owners, in the dashboard bell"], ["Source", "Admin audit log"]] },
];

/** The event the page adds after a successful off-site retry (board copy). */
export function retriedEvent(by: string): LogEvent {
  return {
    id: "retry28", at: LOGS_NOW, type: "backup", label: "Backup", env: "Prod",
    what: "Off-site copy retried · 28 Oct 03:00 backup · B2 ✓", who: by, result: "ok",
    details: [["Off-site copy", "B2 ✓ · 412 MB in 41 s · encrypted"], ["Started from", "Retry on this page"], ["Source", "backup.sh --offsite-only"]],
  };
}

/** Sample stand-in for the retry endpoint. */
export async function retryOffsiteCopy(): Promise<void> {
  await new Promise((r) => window.setTimeout(r, 2200));
}
