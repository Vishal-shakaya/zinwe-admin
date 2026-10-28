import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { downloadInvoicePdf, getBillingSettings, getSubscriptions, setPaymentLink, type AdminSubscription } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ErrorState, LoadingState } from "../components/States";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import "../styles/subscriptions.css";

type Tab = "all" | "active" | "check" | "expiring" | "expired" | "online" | "manual";
type Cur = "all" | "INR" | "USD";
type Sort = "paid" | "until" | "amount" | "name";
type RowState = "check" | "active" | "expired" | "waiting" | "rejected" | "cancelled";

const TABS: [Tab, string][] = [
  ["all", "All"],
  ["active", "Active"],
  ["check", "Being checked"],
  ["expiring", "Expiring in 7 days"],
  ["expired", "Expired"],
  ["online", "Online (Razorpay)"],
  ["manual", "Manual (UPI, bank, Skydo)"],
];

/** One table row: a subscription and its latest payment (the board shows payments and what they cover). */
interface Row {
  sub: AdminSubscription;
  co: string;
  where: string;
  plan: string;
  cycle: string;
  cur: "INR" | "USD";
  /** Before tax, tax, total — split from what was paid (or what is due when nothing is paid yet). */
  base: number;
  gst: number;
  total: number;
  /** "IN" with GST charged, "IN-off" no GST yet, "export" abroad. */
  tax: "IN" | "IN-off" | "export";
  method: string;
  online: boolean;
  paid: string | null;
  until: string | null;
  st: RowState;
}

const DAY = 86_400_000;

function money(n: number, cur: string): string {
  const whole = Math.abs(n % 1) < 0.001;
  const opts = { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 };
  return cur === "USD" ? "$" + n.toLocaleString("en-US", opts) : "₹" + n.toLocaleString("en-IN", opts);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dayLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.ceil((t - Date.now()) / DAY);
}

/** Tax rate (0.18) from the subscription's next-payment quote; 0 abroad or when GST isn't charged. */
function taxRate(s: AdminSubscription): number {
  const taxes = s.amount_due?.taxes ?? [];
  return taxes.reduce((a, t) => a + (Number(t.rate) || 0), 0) / 100;
}

function toRow(s: AdminSubscription): Row {
  const pay = s.latest_payment;
  const cur = s.currency;
  const rate = taxRate(s);
  const total = pay ? Number(pay.amount) : Number(s.amount_due?.total ?? 0);
  const base = rate ? round2(total / (1 + rate)) : total;
  const place = [s.company?.state, s.company?.country].filter(Boolean).join(", ");
  let st: RowState;
  if (pay?.status === "submitted") st = "check";
  else if (s.status === "active") st = "active";
  else if (s.status === "expired") st = "expired";
  else if (s.status === "cancelled") st = "cancelled";
  else st = pay?.status === "rejected" ? "rejected" : "waiting";
  const online = Boolean(pay && /razorpay/i.test(pay.method));
  return {
    sub: s,
    co: s.company?.name || s.owner.name || s.owner.email,
    where: place || s.owner.email,
    plan: s.plan.name,
    cycle: s.billing_cycle === "yearly" ? "Yearly" : "Monthly",
    cur,
    base,
    gst: round2(total - base),
    total,
    tax: s.region === "INTL" || s.amount_due?.export ? "export" : rate ? "IN" : "IN-off",
    method: pay ? (online ? "Razorpay" : pay.method) : "—",
    online,
    paid: pay?.submitted_at ?? null,
    until: s.ends_at,
    st,
  };
}

function isExpiring(r: Row): boolean {
  const left = daysLeft(r.until);
  return r.st === "active" && !r.sub.is_trial && left !== null && left >= 0 && left <= 7;
}

function inTab(r: Row, t: Tab): boolean {
  switch (t) {
    case "all":
      return true;
    case "active":
      return r.st === "active";
    case "check":
      return r.st === "check";
    case "expiring":
      return isExpiring(r);
    case "expired":
      return r.st === "expired";
    case "online":
      return r.online;
    case "manual":
      return !r.online && r.method !== "—";
  }
}

const SORT: Record<Sort, (a: Row, b: Row) => number> = {
  paid: (a, b) => (b.paid ?? "").localeCompare(a.paid ?? ""),
  until: (a, b) => (a.until ?? "9999").localeCompare(b.until ?? "9999"),
  // ₹ and $ never convert; dollars sort as if ×84 only to interleave them sensibly.
  amount: (a, b) => (b.cur === "INR" ? b.total : b.total * 84) - (a.cur === "INR" ? a.total : a.total * 84),
  name: (a, b) => a.co.localeCompare(b.co),
};

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Subscriptions (AdminSubscriptions board): every paid subscription with its latest payment and the period it
 * covers. ₹ and $ are kept apart and never converted. Invoices download as PDF; customers abroad get a Skydo
 * payment link pasted here. Payments are approved in Subscribers.
 */
export function SubscriptionsPage(): ReactElement {
  const load = useCallback(() => getSubscriptions(), []);
  const { data, error, pending, reload } = useLoad(load);
  const loadSettings = useCallback(() => getBillingSettings(), []);
  const settings = useLoad(loadSettings);
  const gstOn = settings.data?.gst_charged;
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [cur, setCur] = useState<Cur>("all");
  const [sort, setSort] = useState<Sort>("paid");
  const [linkFor, setLinkFor] = useState<AdminSubscription | null>(null);
  const [asOf] = useState(() => new Date());

  const all = useMemo(
    () => (data ?? []).filter((s) => s.amount_due !== null || s.latest_payment !== null).map(toRow),
    [data],
  );

  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (cur !== "all" && r.cur !== cur) return false;
      if (!needle) return true;
      const hay = [r.co, r.where, r.sub.owner.email, ...r.sub.invoices.map((i) => i.number)].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [all, q, cur]);

  const rows = useMemo(() => base.filter((r) => inTab(r, tab)).sort(SORT[sort]), [base, tab, sort]);

  const glance = useMemo(() => {
    const subs = data ?? [];
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const year = now.toISOString().slice(0, 4);
    const rateOf = new Map(subs.map((s) => [s.id, taxRate(s)]));
    const inv = subs.flatMap((s) => s.invoices.map((i) => ({ ...i, rate: rateOf.get(s.id) ?? 0 })));
    const inrMonth = inv.filter((i) => i.currency === "INR" && i.issued_at.slice(0, 7) === month);
    const usdYear = inv.filter((i) => i.currency === "USD" && i.issued_at.slice(0, 4) === year);
    const inrTotal = inrMonth.reduce((a, i) => a + Number(i.total), 0);
    const inrGst = inrMonth.reduce((a, i) => a + (i.rate ? Number(i.total) - Number(i.total) / (1 + i.rate) : 0), 0);
    const checks = all.filter((r) => r.st === "check");
    const checkInr = checks.filter((r) => r.cur === "INR").reduce((a, r) => a + r.total, 0);
    const checkUsd = checks.filter((r) => r.cur === "USD").reduce((a, r) => a + r.total, 0);
    const exp = all.filter(isExpiring);
    const paying = subs.filter((s) => s.status === "active" && !s.is_trial && s.amount_due !== null).length;
    const free = subs.filter((s) => s.amount_due === null && s.status === "active").length;
    return {
      monthName: now.toLocaleDateString("en-GB", { month: "long" }),
      year,
      inr: money(round2(inrTotal), "INR"),
      inrSub: `${plural(inrMonth.length, "payment")} · GST ${money(round2(inrGst), "INR")}`,
      usd: money(round2(usdYear.reduce((a, i) => a + Number(i.total), 0)), "USD"),
      usdSub: `${plural(usdYear.length, "payment")} · no GST`,
      check: String(checks.length),
      checkSub:
        [checkInr ? money(round2(checkInr), "INR") : "", checkUsd ? money(round2(checkUsd), "USD") : ""].filter(Boolean).join(" + ") ||
        "₹0",
      exp: String(exp.length),
      expSub: exp.length ? exp.map((r) => r.co).slice(0, 3).join(", ") + (exp.length > 3 ? " and more" : "") : "Nobody this week",
      paying,
      free,
    };
  }, [data, all]);

  const totals = useMemo(() => {
    // Money not in the bank yet (being checked, not paid) stays out of "Received" unless that tab is open.
    const counted = tab === "check" ? rows : rows.filter((r) => r.st !== "check" && r.st !== "waiting" && r.st !== "rejected" && r.paid);
    const sum = (xs: Row[], k: "base" | "gst" | "total") => round2(xs.reduce((a, r) => a + r[k], 0));
    const inr = counted.filter((r) => r.cur === "INR");
    const usd = counted.filter((r) => r.cur === "USD");
    return {
      label: tab === "check" ? "Waiting for approval" : "Received",
      note: tab === "check" ? "Not money in the bank yet" : rows.length !== counted.length ? "Payments being checked are left out" : "All shown rows",
      inrN: plural(inr.length, "payment"),
      inrAmt: money(sum(inr, "base"), "INR"),
      inrGst: money(sum(inr, "gst"), "INR"),
      inrTot: money(sum(inr, "total"), "INR"),
      usdN: plural(usd.length, "payment"),
      usdAmt: money(sum(usd, "base"), "USD"),
      usdTot: money(sum(usd, "total"), "USD"),
    };
  }, [rows, tab]);

  const pdf = async (paymentId: number, number: string) => {
    try {
      toast(`Opening invoice ${number} (PDF)…`);
      await downloadInvoicePdf(paymentId, number);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't download.", "bad");
    }
  };

  const exportCsv = () => {
    const head = ["Company", "Place", "Email", "Plan", "Cycle", "Currency", "Amount", "GST", "Total", "Method", "Paid on", "Covers until", "Status", "Invoices"];
    const lines = rows.map((r) =>
      [
        r.co,
        r.where,
        r.sub.owner.email,
        r.plan,
        r.cycle,
        r.cur,
        r.base.toFixed(2),
        r.tax === "IN" ? r.gst.toFixed(2) : "",
        r.total.toFixed(2),
        r.method,
        r.paid ? r.paid.slice(0, 10) : "",
        r.until ? r.until.slice(0, 10) : "",
        r.st,
        r.sub.invoices.map((i) => i.number).join(" "),
      ]
        .map(csvCell)
        .join(","),
    );
    const name = `zinwe-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    const url = URL.createObjectURL(new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(`Exported ${plural(rows.length, "payment")} to ${name} (₹ and $ in separate columns)`);
  };

  const subtitle =
    gstOn === false
      ? "Every payment and the period it covers. India pays in rupees, monthly or yearly (a year is 12 × the monthly price); GST isn’t charged yet (no seller GSTIN set). Customers abroad pay in dollars with no GST."
      : "Every payment and the period it covers. India pays in rupees with 18% GST on top, monthly or yearly (a year is 12 × the monthly price); customers abroad pay in dollars with no GST.";

  return (
    <>
      <PageHeader title="Subscriptions" subtitle={subtitle}>
        {data ? (
          <span className="k num">
            {glance.paying} paying · {glance.free} free · recent payments shown
          </span>
        ) : null}
        <span className="k">
          As of{" "}
          {asOf
            .toLocaleString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Kolkata",
            })
            .replace(",", "")}{" "}
          IST
        </span>
        <button type="button" className="btn" onClick={exportCsv} disabled={!data}>
          <Icon name="download" />
          Export CSV
        </button>
      </PageHeader>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState rows={6} />
      ) : (
        <>
          <section aria-label="At a glance" className="ss-glance">
            <div className="card ss-kpi">
              <span className="k">Received in {glance.monthName} · India</span>
              <b className="num">{glance.inr}</b>
              <span className="k num">{glance.inrSub}</span>
            </div>
            <div className="card ss-kpi">
              <span className="k">Received in {glance.year} · abroad</span>
              <b className="num">{glance.usd}</b>
              <span className="k num">{glance.usdSub}</span>
            </div>
            <button type="button" className="card ss-kpi ss-kpi--hot" onClick={() => setTab("check")}>
              <span className="k">Being checked</span>
              <b className="num">{glance.check}</b>
              <span className="k num">{glance.checkSub} waiting · open to check</span>
            </button>
            <button type="button" className="card ss-kpi" onClick={() => setTab("expiring")}>
              <span className="k">Expiring in 7 days</span>
              <b className="num">{glance.exp}</b>
              <span className="k">{glance.expSub}</span>
            </button>
          </section>

          <section className="card ss-card" aria-label="Payments">
            <div className="ss-tabs">
              <div role="tablist" aria-label="Show">
                {TABS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    className={"tab" + (tab === key ? " on" : "")}
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                  >
                    {label}
                    <span className={"pill num" + (key === "check" ? " is-check" : "")}>{base.filter((r) => inTab(r, key)).length}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="ss-tools">
              <div className="ss-search">
                <label className="sr" htmlFor="ss-q">
                  Search payments
                </label>
                <Icon name="search" />
                <input
                  id="ss-q"
                  type="search"
                  className="inp"
                  placeholder="Search company, invoice number or reference"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <label className="sr" htmlFor="ss-cur">
                Currency
              </label>
              <select id="ss-cur" className="inp" value={cur} onChange={(e) => setCur(e.target.value as Cur)}>
                <option value="all">₹ and $</option>
                <option value="INR">India · ₹ only</option>
                <option value="USD">Abroad · $ only</option>
              </select>
              <label className="sr" htmlFor="ss-sort">
                Sort by
              </label>
              <select id="ss-sort" className="inp" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="paid">Paid on, newest</option>
                <option value="until">Covers until, soonest</option>
                <option value="amount">Amount, highest</option>
                <option value="name">Company A–Z</option>
              </select>
              <span className="k num" style={{ whiteSpace: "nowrap" }}>
                {plural(rows.length, "payment")}
              </span>
            </div>
            <div className="ss-scroll">
              <table className="ss-tbl">
                <caption className="sr">Payments and the period each one covers</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ minWidth: 150 }}>
                      Company
                    </th>
                    <th scope="col">Plan</th>
                    <th scope="col">Cycle</th>
                    <th scope="col" className="r">
                      Amount
                    </th>
                    <th scope="col" className="r">
                      GST
                    </th>
                    <th scope="col" className="r">
                      Total
                    </th>
                    <th scope="col">Method</th>
                    <th scope="col">Paid on</th>
                    <th scope="col">Covers until</th>
                    <th scope="col">Invoice</th>
                    <th scope="col">
                      <span className="sr">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <PaymentRow key={r.sub.id} r={r} onPdf={pdf} onLink={() => setLinkFor(r.sub)} />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" rowSpan={2} style={{ fontWeight: 700, verticalAlign: "top" }}>
                      {totals.label}
                      <span className="k" style={{ display: "block", fontWeight: 400 }}>
                        {totals.note}
                      </span>
                    </th>
                    <td colSpan={2} className="k">
                      India · ₹ · {totals.inrN}
                    </td>
                    <td className="r num" style={{ fontWeight: 600 }}>
                      {totals.inrAmt}
                    </td>
                    <td className="r num" style={{ fontWeight: 600 }}>
                      {totals.inrGst}
                    </td>
                    <td className="r num" style={{ fontWeight: 700 }}>
                      {totals.inrTot}
                    </td>
                    <td colSpan={5} />
                  </tr>
                  <tr>
                    <td colSpan={2} className="k">
                      Abroad · $ · {totals.usdN}
                    </td>
                    <td className="r num" style={{ fontWeight: 600 }}>
                      {totals.usdAmt}
                    </td>
                    <td className="r k">No GST</td>
                    <td className="r num" style={{ fontWeight: 700 }}>
                      {totals.usdTot}
                    </td>
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              </table>
            </div>
            {rows.length === 0 ? (
              all.length === 0 ? (
                <div className="ss-empty">
                  <b style={{ color: "var(--ink)" }}>No payments yet</b>
                  <span>Paid plans show here as soon as a customer pays or uploads a receipt.</span>
                </div>
              ) : (
                <div className="ss-empty">
                  <span>No payments match.</span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setQ("");
                      setCur("all");
                      setTab("all");
                    }}
                  >
                    Clear search and filters
                  </button>
                </div>
              )
            ) : null}
          </section>
          <p className="k ss-foot">
            Online payments through Razorpay start plans by themselves. Manual payments (UPI, bank transfer, Skydo) start when
            staff approve them in Subscribers. Totals keep ₹ and $ apart and never convert.
          </p>
        </>
      )}

      {linkFor ? (
        <PaymentLinkModal
          subscription={linkFor}
          onClose={() => setLinkFor(null)}
          onSaved={() => {
            setLinkFor(null);
            toast("Payment link saved. The customer sees a Pay button on their payment page.");
            reload();
          }}
        />
      ) : null}
      {pending && data ? <span className="sr" role="status">Refreshing…</span> : null}
    </>
  );
}

function PaymentRow({
  r,
  onPdf,
  onLink,
}: {
  r: Row;
  onPdf: (paymentId: number, number: string) => void;
  onLink: () => void;
}): ReactElement {
  const left = daysLeft(r.until);
  const expiring = isExpiring(r);
  let tag = "";
  let tagCls = "";
  if (r.st === "check") {
    tag = "If approved";
    tagCls = "warn";
  } else if (r.st === "expired") {
    tag = left !== null && left < 0 ? `Expired ${plural(-left, "day")} ago` : "Expired";
    tagCls = "bad";
  } else if (r.st === "waiting") {
    tag = "Not paid yet";
    tagCls = "warn";
  } else if (r.st === "rejected") {
    tag = "Payment rejected";
    tagCls = "bad";
  } else if (expiring && left !== null) {
    tag = left === 0 ? "Ends today" : left === 1 ? "Ends tomorrow" : `Ends in ${left} days`;
    tagCls = "warn";
  }
  const abroad = r.sub.region === "INTL";
  const canRemind = !abroad && (expiring || r.st === "expired");
  const pay = r.sub.latest_payment;
  return (
    <tr>
      <th scope="row" style={{ fontWeight: 400 }}>
        <Link className="ss-co" to={`/subscribers?open=${r.sub.owner.id}`}>
          {r.co}
        </Link>
        <span className="k" style={{ display: "block" }}>
          {r.where}
        </span>
      </th>
      <td style={{ fontWeight: 600 }}>
        {r.plan}
        {r.sub.is_trial ? <span className="k" style={{ display: "block", fontWeight: 400 }}>Trial</span> : null}
      </td>
      <td>{r.cycle}</td>
      {pay ? (
        <>
          <td className="r num">{money(r.base, r.cur)}</td>
          <td className="r num" style={r.tax === "IN" ? { whiteSpace: "nowrap" } : { color: "var(--mute)", whiteSpace: "nowrap" }}>
            {r.tax === "IN" ? money(r.gst, "INR") : r.tax === "export" ? "None" : "Not charged"}
          </td>
          <td className="r num" style={{ fontWeight: 600 }}>
            {money(r.total, r.cur)}
          </td>
        </>
      ) : (
        <td colSpan={3} className="r k" title={`Next payment: ${money(r.total, r.cur)}`}>
          No payment on file
        </td>
      )}
      <td className="ss-method">
        {r.method === "—" ? (
          <span className="k">—</span>
        ) : (
          <span className={"pill" + (r.online ? " is-online" : "")}>{r.method}</span>
        )}
      </td>
      <td className="num" style={{ whiteSpace: "nowrap" }}>
        {dayLabel(r.paid)}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <span className="num">{dayLabel(r.until)}</span>
        {tag ? <span className={`pill ${tagCls} ss-tag`}>{tag}</span> : null}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {r.sub.invoices.length ? (
          <span className="ss-inv">
            {r.sub.invoices.map((inv) => (
              <button
                key={inv.number}
                type="button"
                className="ss-lnk mono"
                aria-label={`Open invoice ${inv.number}`}
                onClick={() => onPdf(inv.payment_id, inv.number)}
              >
                {inv.number}
              </button>
            ))}
          </span>
        ) : (
          <span className="k">After approval</span>
        )}
      </td>
      <td className="ss-actions">
        {r.st === "check" && pay ? (
          <Link className="btn sm dark" to={`/subscribers?review=${pay.id}`} aria-label={`Check payment from ${r.co}`}>
            Check
          </Link>
        ) : null}
        {canRemind ? (
          <Link className="btn sm" to={`/subscribers?compose=${r.sub.owner.id}`}>
            Send reminder
          </Link>
        ) : null}
        {abroad && r.sub.amount_due ? (
          <button type="button" className="btn sm" onClick={onLink}>
            {r.sub.payment_link ? "Skydo link saved" : "Send Skydo link"}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

/** Make a Skydo payment link for exactly the amount due, paste it here: the customer gets a Pay button. */
function PaymentLinkModal({
  subscription,
  onClose,
  onSaved,
}: {
  subscription: AdminSubscription;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const [link, setLink] = useState(subscription.payment_link);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const due = subscription.amount_due;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setPaymentLink(subscription.id, link.trim());
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Payment link for ${subscription.company?.name ?? subscription.owner.email}`}
      subtitle="For customers outside India. Skydo has no API, so make the link in Skydo and paste it here."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn dark" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : link.trim() ? "Save link" : "Remove link"}
          </button>
        </>
      }
    >
      <ol className="ss-steps">
        <li>
          In Skydo, open <b>InstaLinks → Create Payment Link</b>.
        </li>
        <li>
          Amount: <b>{due ? money(Number(due.total), due.currency) : "—"}</b> ({subscription.plan.name},{" "}
          {subscription.billing_cycle === "yearly" ? "one year" : "one month"}). Customer:{" "}
          {subscription.company?.name ?? subscription.owner.email}, {subscription.owner.email}.
        </li>
        <li>Allow card and ACH. Decide whether the customer pays the Skydo fee (5% card, 2% ACH, min $9).</li>
        <li>Copy the link and paste it below. The customer sees a “Pay” button on their payment page straight away.</li>
        <li>When Skydo shows the payment as received, confirm it in Subscribers: the plan starts and the invoice is issued.</li>
      </ol>
      <label className="ss-field">
        Payment link (https://…)
        <input className="inp" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
      </label>
      {error ? (
        <p className="err-box" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
