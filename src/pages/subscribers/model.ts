/** Pure helpers for the Subscribers board: status chip, filters, sorting, amounts, times. */
import { isBlocked, type Payment, type Subscriber } from "../../lib/api";
import { countryOf } from "../../content/fixtures/subscribers";

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

/** The board's status chip. Order matters: the first match wins. */
export function chipOf(r: Subscriber): { label: string; tone: Tone } {
  if (isBlocked(r)) return { label: "Blocked", tone: "bad" };
  if (!r.is_active) return { label: "Sign-up not finished", tone: "muted" };
  if (r.payment?.status === "submitted") return { label: "Payment to check", tone: "warn" };
  const sub = r.subscription;
  if (!sub) return { label: "No plan yet", tone: "muted" };
  if (sub.is_trial) {
    if (sub.status !== "active") return { label: "Trial ended", tone: "info" };
    const d = sub.days_left ?? 0;
    return { label: `Trial · ${d} day${d === 1 ? "" : "s"} left`, tone: "info" };
  }
  if (sub.status === "expired") return { label: "Expired", tone: "bad" };
  if (sub.status === "cancelled") return { label: "Cancelled", tone: "muted" };
  if (sub.status === "pending_payment") return { label: "Waiting for payment", tone: "warn" };
  if (Number(sub.amount_inr) <= 0) return { label: "Free", tone: "muted" };
  return { label: "Active", tone: "good" };
}

/** On a paid plan with a current payment. */
export function isPaying(r: Subscriber): boolean {
  const sub = r.subscription;
  return Boolean(sub && sub.status === "active" && !sub.is_trial && Number(sub.amount_inr) > 0) && !isBlocked(r);
}

/** A paid plan that ends within a week, or already lapsed: time to remind or renew. */
export function renewalDue(r: Subscriber): boolean {
  const sub = r.subscription;
  if (!sub || Number(sub.amount_inr) <= 0 || sub.is_trial) return false;
  if (sub.status === "expired") return true;
  return sub.status === "active" && sub.days_left !== null && sub.days_left <= 7;
}

export function pendingPayments(r: Subscriber): Payment[] {
  return r.payments.filter((p) => p.status === "submitted");
}

/**
 * Filter chips. `waiting` keeps its old URL name (?status=waiting, Dashboard + staff email links) but shows as
 * the board's "Payment to check".
 */
export const FILTERS = [
  { key: "all", label: "All", test: (r: Subscriber) => !isBlocked(r) },
  { key: "paying", label: "Paying", test: (r: Subscriber) => isPaying(r) },
  { key: "free", label: "Free", test: (r: Subscriber) => !isPaying(r) && !isBlocked(r) },
  { key: "waiting", label: "Payment to check", test: (r: Subscriber) => pendingPayments(r).length > 0 },
  {
    key: "trial",
    label: "Trial ending",
    test: (r: Subscriber) =>
      Boolean(r.subscription?.is_trial && r.subscription.status === "active" && (r.subscription.days_left ?? 99) <= 7),
  },
  { key: "renewal", label: "Renewal due", test: (r: Subscriber) => renewalDue(r) },
  { key: "rejected", label: "Rejected", test: (r: Subscriber) => r.payment?.status === "rejected" },
  { key: "blocked", label: "Blocked", test: (r: Subscriber) => isBlocked(r) },
] as const;
export type FilterKey = (typeof FILTERS)[number]["key"];

export type SortKey = "seen" | "joined" | "until" | "pcs" | "name";
export type CountryKey = "all" | "in" | "abroad";

const time = (iso: string | null | undefined, fallback: number) => (iso ? new Date(iso).getTime() : fallback);

export function companyName(r: Subscriber): string {
  return r.company?.name || r.full_name || r.email;
}

export function pcsUsed(r: Subscriber): { used: number; limit: number; full: boolean; pct: number } {
  const used = r.team.devices;
  const limit = r.plan?.max_devices ?? 0;
  const full = limit > 0 && used >= limit;
  return { used, limit, full, pct: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0 };
}

export const SORTS: Record<SortKey, (a: Subscriber, b: Subscriber) => number> = {
  seen: (a, b) => time(b.last_login, 0) - time(a.last_login, 0),
  joined: (a, b) => time(b.date_joined, 0) - time(a.date_joined, 0),
  until: (a, b) => time(a.subscription?.ends_at, Infinity) - time(b.subscription?.ends_at, Infinity),
  pcs: (a, b) => pcsUsed(b).pct - pcsUsed(a).pct,
  name: (a, b) => companyName(a).localeCompare(companyName(b)),
};

export function matchesCountry(r: Subscriber, c: CountryKey): boolean {
  if (c === "all") return true;
  const abroad = countryOf(r).abroad;
  return c === "abroad" ? abroad : !abroad;
}

export function matchesQuery(r: Subscriber, q: string): boolean {
  if (!q) return true;
  const hay = [r.company?.name ?? "", r.full_name, r.email, r.company?.city ?? "", r.company?.state ?? ""]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** "₹ 1,145.78" / "1145.78" / "971" -> 1145.78; NaN when it isn't a number. */
export function parseAmount(text: string): number {
  const cleaned = text.replace(/[₹$,\s]/g, "");
  return cleaned && /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

/** Spaces out, upper case: how references are compared. */
export function normRef(text: string): string {
  return text.replace(/\s+/g, "").toUpperCase();
}

/** The amount the customer had to pay for this payment (with tax). */
export function dueOf(p: Payment): number {
  return Number(p.due_total ?? p.expected_inr);
}

export function cur(p: Payment): string {
  return p.currency ?? "INR";
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "28 Oct 2026" (the board's date). */
export function dLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

/** "28 Oct" */
export function dShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

/** "28 Oct, 12:41" */
export function dSent(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MON[d.getMonth()]}, ${hh}:${mm}`;
}

/** "4 min ago", "3 h ago", "2 days ago", "Never". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "YYYY-MM-DD" in local time. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function firstName(r: Subscriber): string {
  return (r.full_name || r.email).replace(/^Dr\.\s*/, "").split(/[\s@]/)[0];
}
