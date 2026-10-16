/** Small display helpers for the admin tables. */

export function inr(amount: string | number): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "₹0";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function date(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function relativeDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return date(iso);
}

export function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

const METHOD_LABEL: Record<string, string> = {
  upi: "UPI",
  bank_transfer: "Bank transfer",
  paypal: "PayPal",
  cheque: "Cheque",
  cash: "Cash",
};

export function methodLabel(method: string): string {
  return METHOD_LABEL[method] ?? titleCase(method);
}

/** Pill colour for a payment status. */
export function paymentTone(status: string): string {
  if (status === "verified") return "good";
  if (status === "submitted") return "warn";
  return "bad";
}

/** "1 Nov" (or "1 Nov 2027" when not this year) – for compact periods. */
export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "1 Nov – 1 Dec 2026" */
export function period(from: string | null, until: string | null): string {
  if (!from || !until) return "—";
  return `${shortDate(from)} – ${date(until)}`;
}

/** "12 days left", "1 day left", "Ends today" */
export function daysLeftLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "";
  if (days <= 0) return "Ends today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

export function dateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "1145.78" + INR -> "₹1,145.78"; "144.00" + USD -> "$144.00". */
export function money(amount: string | number, currency: string = "INR"): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return String(amount);
  return currency === "USD"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
