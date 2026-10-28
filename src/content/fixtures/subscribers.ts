/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-43) for the Subscribers board. Everything else on /subscribers comes from
 * `GET /api/admin/subscribers/`; these are the few things the board shows that the API does not serve yet.
 * Each one says what replaces it on the API day.
 */
import type { Payment, Subscriber } from "../../lib/api";

/** How far back activity history goes per plan (board: Plan → History). API day: a field on the plan. */
export const PLAN_HISTORY: Record<string, string> = {
  free: "7 days",
  startups: "90 days",
  teams: "180 days",
  businesses: "1 year",
};

/** Where staff look for the money (board step 2). API day: billing settings (`admin/billing-settings/`). */
export const STATEMENT_ACCOUNT = "SKYTECHNO statement (Kotak •••• 4659, UPI skytechnocomp@ybl)";

/**
 * Country. The API has no country on a customer yet, so it is DERIVED: a customer who ever paid in USD is
 * "abroad", everyone else India (sign-up is India-first). API day: `company.country` (ISO code).
 */
export function countryOf(row: Subscriber): { cc: string; name: string; abroad: boolean } {
  const usd = row.payments.some((p: Payment) => (p.currency ?? "INR") === "USD");
  return usd ? { cc: "—", name: "Abroad", abroad: true } : { cc: "IN", name: "India", abroad: false };
}

/**
 * Board features with no endpoint yet; the UI shows them switched off with a "Sample data" tag:
 * - Extend plan (free days, no invoice)                → `POST admin/subscribers/<id>/extend/`
 * - Resend confirmation email                          → `POST admin/subscribers/<id>/resend-confirmation/`
 * - Refund from a payment (amount, reason, credit note) → `POST admin/payments/<id>/refund/`
 * - Step 2 "Found in bank/UPI statement" (date + amount) is checked in the browser only; the API stores the
 *   receipt amount + UTR (`approve/`). API day: send `statement_on` + `statement_amount` with the approval.
 */
export const NOT_YET_IN_API = {
  extendPlan: true,
  resendConfirmation: true,
  refunds: true,
  statementCheckStored: true,
} as const;
