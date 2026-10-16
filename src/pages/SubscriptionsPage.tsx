import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { downloadInvoicePdf, getSubscriptions, setPaymentLink, type AdminSubscription } from "../lib/api";
import { date, money } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";

type RegionFilter = "all" | "IN" | "INTL";
type StatusFilter = "all" | "pending_payment" | "active" | "renewal_due" | "expired";

const STATUS_PILL: Record<AdminSubscription["status"], [string, string]> = {
  pending_payment: ["pill--warn", "Waiting for payment"],
  active: ["pill--good", "Active"],
  expired: ["pill--bad", "Expired"],
  cancelled: ["pill--muted", "Cancelled"],
};

const PAYMENT_PILL: Record<string, [string, string]> = {
  submitted: ["pill--warn", "To check"],
  verified: ["pill--good", "Confirmed"],
  rejected: ["pill--bad", "Rejected"],
};

function renewalDue(s: AdminSubscription): boolean {
  return s.status === "active" && s.days_left !== null && s.days_left <= 7 && !s.is_trial;
}

/**
 * Subscriptions: the billing view of every customer — country (India = INR monthly + GST, elsewhere =
 * USD yearly, export), what they owe next with tax, their latest payment, invoices (PDF), and the
 * Skydo payment link for customers outside India. Payments are confirmed in Subscribers.
 */
export function SubscriptionsPage(): ReactElement {
  const load = useCallback(() => getSubscriptions(), []);
  const { data, error, pending, reload } = useLoad(load);
  const toast = useToast();
  const [region, setRegion] = useState<RegionFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [linkFor, setLinkFor] = useState<AdminSubscription | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((s) => {
      if (region !== "all" && s.region !== region) return false;
      if (status === "renewal_due" ? !renewalDue(s) : status !== "all" && s.status !== status) return false;
      if (!q) return true;
      return [s.owner.email, s.owner.name, s.company?.name ?? "", s.company?.country ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [data, region, status, query]);

  const counts = useMemo(() => {
    const all = data ?? [];
    return {
      india: all.filter((s) => s.region === "IN").length,
      abroad: all.filter((s) => s.region === "INTL").length,
      due: all.filter(renewalDue).length,
      waiting: all.filter((s) => s.status === "pending_payment").length,
    };
  }, [data]);

  const pdf = async (paymentId: number, number: string) => {
    try {
      await downloadInvoicePdf(paymentId, number);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't download.", "bad");
    }
  };

  return (
    <>
      <PageHeader
        title="Subscriptions"
        subtitle="Who pays what, in which currency, with tax. India: INR monthly + GST. Outside India: USD yearly (export, no GST)."
        onReload={reload}
        pending={pending}
      />

      <div className="stats">
        <div className="stat">
          <span className="stat__label">India (INR, monthly + GST)</span>
          <span className="stat__value">{counts.india}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Outside India (USD, yearly)</span>
          <span className="stat__value">{counts.abroad}</span>
        </div>
        <div className={counts.waiting ? "stat stat--hot" : "stat"}>
          <span className="stat__label">Waiting for payment</span>
          <span className="stat__value">{counts.waiting}</span>
        </div>
        <div className={counts.due ? "stat stat--hot" : "stat"}>
          <span className="stat__label">Renewal due (7 days)</span>
          <span className="stat__value">{counts.due}</span>
        </div>
      </div>

      <div className="card subs-filters">
        <input
          className="subs-search"
          type="search"
          placeholder="Search name, email, company or country"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search subscriptions"
        />
        <select className="plan-select" value={region} onChange={(e) => setRegion(e.target.value as RegionFilter)} aria-label="Region">
          <option value="all">All countries</option>
          <option value="IN">India</option>
          <option value="INTL">Outside India</option>
        </select>
        <select className="plan-select" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status">
          <option value="all">Any status</option>
          <option value="pending_payment">Waiting for payment</option>
          <option value="active">Active</option>
          <option value="renewal_due">Renewal due</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {error ? (
        <p className="alert alert--bad">{error}</p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card empty">
          <b>No subscriptions here</b>
          <span className="muted">Change the filters, or wait for the first customer to pick a plan.</span>
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Plan</th>
                  <th>Next payment</th>
                  <th>Status</th>
                  <th>Latest payment</th>
                  <th>Invoices</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const [pillClass, pillText] = STATUS_PILL[s.status];
                  const due = s.amount_due;
                  const pay = s.latest_payment;
                  return (
                    <tr key={s.id}>
                      <td>
                        <b>{s.company?.name ?? s.owner.email}</b>
                        <div className="muted">{s.owner.email}</div>
                        <div className="muted">
                          {s.company?.country || "—"}
                          {s.company?.state ? `, ${s.company.state}` : ""}
                          {s.company?.gstin ? ` · GSTIN ${s.company.gstin}` : ""}
                        </div>
                      </td>
                      <td className="nowrap">
                        <b>{s.plan.name}</b>
                        <div className="muted">
                          {s.currency} · {s.billing_cycle === "yearly" ? "Yearly" : "Monthly"}
                          {s.is_trial ? " · trial" : ""}
                        </div>
                      </td>
                      <td className="nowrap">
                        {due ? (
                          <>
                            <b>{money(due.total, due.currency)}</b>
                            <div className="muted">
                              {money(due.amount, due.currency)}
                              {due.taxes.length
                                ? ` + ${due.taxes.map((t) => `${t.label} ${money(t.amount, due.currency)}`).join(" + ")}`
                                : due.export
                                  ? " · export, no GST"
                                  : " · no GST"}
                            </div>
                          </>
                        ) : (
                          <span className="muted">Free</span>
                        )}
                      </td>
                      <td>
                        <span className={`pill ${pillClass}`}>{pillText}</span>
                        {s.status === "active" && s.ends_at ? (
                          <div className="muted nowrap">
                            until {date(s.ends_at)}
                            {s.days_left !== null ? ` (${s.days_left}d)` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {pay ? (
                          <>
                            <span className={`pill ${PAYMENT_PILL[pay.status]?.[0] ?? "pill--muted"}`}>
                              {PAYMENT_PILL[pay.status]?.[1] ?? pay.status}
                            </span>
                            <div className="muted nowrap">
                              {money(pay.amount, pay.currency)} · {pay.method}
                            </div>
                            {pay.status === "submitted" ? (
                              <Link className="link-btn" to={`/subscribers?status=waiting`}>
                                Check it in Subscribers →
                              </Link>
                            ) : null}
                          </>
                        ) : (
                          <span className="muted">None yet</span>
                        )}
                      </td>
                      <td>
                        {s.invoices.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <ul className="subs-invoices">
                            {s.invoices.map((inv) => (
                              <li key={inv.number}>
                                <button type="button" className="link-btn" onClick={() => void pdf(inv.payment_id, inv.number)}>
                                  {inv.number}
                                </button>{" "}
                                <span className="muted">{money(inv.total, inv.currency)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>
                        {s.region === "INTL" && due ? (
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLinkFor(s)}>
                            {s.payment_link ? "Payment link ✓" : "Add payment link"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
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
    </>
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
        <div className="actions">
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : link.trim() ? "Save link" : "Remove link"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <ol className="subs-steps">
        <li>
          In Skydo, open <b>InstaLinks → Create Payment Link</b>.
        </li>
        <li>
          Amount: <b>{due ? money(due.total, due.currency) : "—"}</b> ({subscription.plan.name}, one year). Customer:{" "}
          {subscription.company?.name ?? subscription.owner.email}, {subscription.owner.email}.
        </li>
        <li>Allow card and ACH. Decide whether the customer pays the Skydo fee (5% card, 2% ACH, min $9).</li>
        <li>Copy the link and paste it below. The customer sees a "Pay" button on their payment page straight away.</li>
        <li>When Skydo shows the payment as received, confirm it in Subscribers: the plan starts and the invoice is issued.</li>
      </ol>
      <label className="field">
        <span>Payment link (https://…)</span>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
      </label>
      {error ? <p className="alert alert--bad">{error}</p> : null}
    </Modal>
  );
}
