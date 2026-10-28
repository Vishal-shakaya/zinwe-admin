/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-43) — Feedback page extras the API does not serve yet.
 *
 * Real (lib/api `getFeedback`): ratings, comments, page, customer, member + PC, dates. Replies are really sent
 * (`sendCustomerEmail`, logged on the customer's Emails tab).
 * Sample, kept in this browser only:
 *  - read / unread per rating (ratings older than `READ_BEFORE_DAYS` on first visit count as read),
 *  - tags (Bug / Idea / Praise / Pricing),
 *  - the "Replied <date> by <who>" line after a reply from this screen.
 * Auth/API day: `PATCH admin/feedback/<id>/` with `read`, `tags[]`, and `replied_at/by` from the email log;
 * then delete the localStorage parts below.
 */
import { readLocal, writeLocal } from "../../pages/inbox/format";

export type FeedbackTag = "bug" | "idea" | "praise" | "pricing";

export const TAG_LABEL: Record<FeedbackTag, string> = { bug: "Bug", idea: "Idea", praise: "Praise", pricing: "Pricing" };

export interface FeedbackLocal {
  /** Rating ids marked read. */
  read: number[];
  /** Rating ids marked unread again after the baseline. */
  unread: number[];
  tags: Record<string, FeedbackTag[]>;
  replied: Record<string, string>;
  /** ISO time: ratings before this count as read until someone marks them unread. */
  baseline: string;
}

const KEY = "zinwe.admin.feedback.local";
const READ_BEFORE_DAYS = 7;

export function loadFeedbackLocal(): FeedbackLocal {
  const fresh: FeedbackLocal = {
    read: [],
    unread: [],
    tags: {},
    replied: {},
    baseline: new Date(Date.now() - READ_BEFORE_DAYS * 86_400_000).toISOString(),
  };
  const stored = readLocal<Partial<FeedbackLocal> | null>(KEY, null);
  if (!stored) {
    writeLocal(KEY, fresh);
    return fresh;
  }
  return { ...fresh, ...stored };
}

export function saveFeedbackLocal(next: FeedbackLocal): FeedbackLocal {
  writeLocal(KEY, next);
  return next;
}

export function isUnread(local: FeedbackLocal, id: number, createdAt: string): boolean {
  if (local.read.includes(id)) return false;
  if (local.unread.includes(id)) return true;
  return new Date(createdAt).getTime() >= new Date(local.baseline).getTime();
}
