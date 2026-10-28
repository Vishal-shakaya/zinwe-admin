/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-43) — Support page extras the API does not serve yet.
 *
 * Real (lib/api): tickets, counts, messages, unread, reply (emails the owner), close/reopen, customer plan + PCs.
 * Sample, here:
 *  - `assignee` per ticket ("Assigned to", the Anyone / Mine / Unassigned filter) — kept in this browser.
 *  - internal notes on a ticket ("Internal note" mode) — kept in this browser, never sent.
 *  - the "First reply, median" summary figure.
 *  - `SUPPORT_TEAM`: other staff to assign to (empty until a staff list API exists).
 * Auth/API day: move assignee + notes to `admin/support/<id>/` (fields `assignee`, `notes[]`), the median to
 * `admin/support/` counts, and the team to a staff list; then delete the localStorage parts below.
 *
 * `SAVED_REPLIES` is content (ready-made replies), not sample data; it stays client-side.
 */
import { readLocal, writeLocal } from "../../pages/inbox/format";

export interface StaffOption {
  key: string;
  name: string;
  initials: string;
}

/** Other staff to assign conversations to. Empty: there is no staff list API yet ("You" is always offered). */
export const SUPPORT_TEAM: StaffOption[] = [];

/** "First reply, median" (board value). No API serves it yet. */
export const FIRST_REPLY_MEDIAN = { value: "1 h 40 min", note: "Last 7 days · goal under 4 h" };

export interface LocalNote {
  id: string;
  by: string;
  at: string;
  body: string;
}

const ASSIGN_KEY = "zinwe.admin.support.assignee";
const NOTES_KEY = "zinwe.admin.support.notes";

export function getAssignees(): Record<string, string> {
  return readLocal<Record<string, string>>(ASSIGN_KEY, {});
}

export function setAssignee(ticketId: number, who: string): Record<string, string> {
  const all = getAssignees();
  if (who) all[String(ticketId)] = who;
  else delete all[String(ticketId)];
  writeLocal(ASSIGN_KEY, all);
  return all;
}

export function getNotes(ticketId: number): LocalNote[] {
  return readLocal<Record<string, LocalNote[]>>(NOTES_KEY, {})[String(ticketId)] ?? [];
}

export function addNote(ticketId: number, by: string, body: string): LocalNote[] {
  const all = readLocal<Record<string, LocalNote[]>>(NOTES_KEY, {});
  const list = all[String(ticketId)] ?? [];
  const next = [...list, { id: `n${Date.now()}`, by, at: new Date().toISOString(), body }];
  all[String(ticketId)] = next;
  writeLocal(NOTES_KEY, all);
  return next;
}

/** Ready-made replies (AdminSupport board, word for word). */
export const SAVED_REPLIES: { key: string; label: string; text: string }[] = [
  {
    key: "shot",
    label: "Ask what they see",
    text: "Could you tell us exactly what you see on the screen, or attach a picture of it? The Support button in your dashboard lets you add a file.",
  },
  {
    key: "agent",
    label: "Update the Windows app",
    text: "Please update Zinwe on those PCs: click the Zinwe icon near the clock, then Check for updates. It takes about a minute and the PC stays protected.",
  },
  {
    key: "gst",
    label: "Invoice reissued with GSTIN",
    text: "We have reissued the invoice with your GSTIN. You will find it in Profile → Billing → Invoices.",
  },
  {
    key: "remove",
    label: "Remove a PC",
    text: "Go to Team & devices, open the PC, then Remove this PC. Its seat frees up at once.",
  },
];
