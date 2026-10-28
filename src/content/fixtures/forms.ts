/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-43) — Forms page extras the API does not serve yet.
 *
 * Real (lib/api): submissions, kinds + counts, search, status new/handled (+ who/when), internal note.
 * The board has three statuses (New · Contacted · Done); the API has two (new · handled). Both Contacted and
 * Done are saved as `handled`; which of the two it is lives here, in this browser only.
 * Auth/API day: add `contacted` to `z_forms` FormSubmission.status (or a `stage` field) and delete this file.
 */
import { readLocal, writeLocal } from "../../pages/inbox/format";

export type BoardStatus = "new" | "contacted" | "done";

const KEY = "zinwe.admin.forms.contacted";

export function contactedIds(): number[] {
  return readLocal<number[]>(KEY, []);
}

export function setContacted(id: number, on: boolean): number[] {
  const set = new Set(contactedIds());
  if (on) set.add(id);
  else set.delete(id);
  const next = [...set];
  writeLocal(KEY, next);
  return next;
}
