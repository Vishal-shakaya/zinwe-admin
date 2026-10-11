import { Fragment, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import {
  approvePayment,
  blockSubscriber,
  changePlan,
  deleteSubscriber,
  getCustomerEmails,
  getPlans,
  getSubscriber,
  getSubscribers,
  rejectPayment,
  sendCustomerEmail,
  setPassword,
  setRemark,
  unblockSubscriber,
  type Payment,
  type PlanSummary,
  type SentEmail,
  type Subscriber,
} from "../lib/api";
import { date, dateTime, daysLeftLabel, inr, methodLabel, paymentTone, period, titleCase } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { PaymentProof } from "../components/PaymentProof";
import { RichTextEditor, type RichTextValue } from "../components/RichTextEditor";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Popover } from "../components/Popover";
import { useToast } from "../components/Toast";
import { EMAIL_TEMPLATES, TEMPLATE_GROUPS, contextFor } from "../content/emailTemplates";

const COLUMNS = 8;

/** Filters on the customer's latest payment. Approved customers need no action, so they're just in All. */
const FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "waiting", label: "Waiting for approval", test: (r: Subscriber) => r.payment?.status === "submitted" },
  { key: "renewal", label: "Renewal due", test: (r: Subscriber) => renewalDue(r) },
  { key: "rejected", label: "Rejected", test: (r: Subscriber) => r.payment?.status === "rejected" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

/** A paid plan that ends within a week, or already lapsed: time to remind or renew. */
function renewalDue(r: Subscriber): boolean {
  const sub = r.subscription;
  if (!sub || Number(sub.amount_inr) <= 0 || sub.is_trial) return false;
  if (sub.status === "expired") return true;
  return sub.status === "active" && sub.days_left !== null && sub.days_left <= 7;
}

/** Status-column line: "12 days left · until 1 Nov", warn when a week or less. */
function DaysLeft({ sub }: { sub: NonNullable<Subscriber["subscription"]> }): ReactElement | null {
  if (sub.status === "expired" && sub.ends_at) return <small className="days days--bad">Ended {date(sub.ends_at)}</small>;
  if (sub.status !== "active") return null;
  if (!sub.ends_at) return <small className="muted block">No end date</small>;
  const soon = sub.days_left !== null && sub.days_left <= 7;
  return (
    <small className={"days" + (soon ? " days--warn" : "")}>
      <b>{daysLeftLabel(sub.days_left)}</b> · until {date(sub.ends_at)}
    </small>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Pending payment",
  active: "Active",
  expired: "Expired",
  cancelled: "Cancelled",
};

/**
 * Every customer in one table. Paid plans activate here: a customer's reported payment shows as
 * "Waiting"; Review opens the customer's details with the payment, its proof, and Approve / Reject.
 */
export function SubscribersPage(): ReactElement {
  const loadSubs = useCallback(() => getSubscribers(), []);
  const loadPlans = useCallback(() => getPlans(), []);
  const subs = useLoad(loadSubs);
  const plans = useLoad(loadPlans);
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState<number | null>(null);
  const [emailFor, setEmailFor] = useState<number | null>(null);
  const [emailsVersion, setEmailsVersion] = useState(0); // bump to reload the modal's sent-email list

  const filter: FilterKey = FILTERS.some((f) => f.key === params.get("status"))
    ? (params.get("status") as FilterKey)
    : "all";
  const setFilter = (key: FilterKey) => setParams(key === "all" ? {} : { status: key }, { replace: true });

  const rows = subs.data ?? [];
  const onUpdated = (row: Subscriber) => subs.setData(rows.map((r) => (r.id === row.id ? row : r)));
  const onDeleted = (id: number) => subs.setData(rows.filter((r) => r.id !== id));

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.test).length])) as Record<FilterKey, number>,
    [rows],
  );

  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)!.test;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => test(r) && (!q || [r.full_name, r.email, r.company?.name ?? ""].some((v) => v.toLowerCase().includes(q))),
    );
  }, [rows, filter, query]);

  const openRow = rows.find((r) => r.id === openId) ?? null;
  const emailRow = rows.find((r) => r.id === emailFor) ?? null;

  return (
    <>
      <PageHeader
        title="Subscribers"
        subtitle="Customers, their plans and payments. A paid plan turns on only when you approve its payment."
        onReload={subs.reload}
        pending={subs.pending}
      >
        <input
          type="search"
          className="search"
          placeholder="Search name, email or company"
          aria-label="Search subscribers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </PageHeader>

      <div className="tabs" role="tablist" aria-label="Filter by payment">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={"tab" + (filter === f.key ? " is-active" : "")}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {subs.data ? (
              <span className={"tab__count" + (f.key === "waiting" && counts.waiting > 0 ? " tab__count--hot" : "")}>
                {counts[f.key]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {subs.error ? (
        <p className="alert alert--bad">{subs.error}</p>
      ) : !subs.data ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card empty">
          <b>No customers yet</b>
          <span className="muted">People who sign up on the website show up here.</span>
        </div>
      ) : (
        <div className="card table-card">
          <table className="sheet sheet--subs">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Remark</th>
                <th>Mail</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <SubscriberRow
                  key={row.id}
                  row={row}
                  plans={plans.data ?? []}
                  onOpen={() => setOpenId(row.id)}
                  onEmail={() => setEmailFor(row.id)}
                  onUpdated={onUpdated}
                  onDeleted={onDeleted}
                />
              ))}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS} className="sheet__empty">
                    {filter === "waiting" && !query ? "No payments are waiting for approval." : "No customer matches this filter."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {openRow ? (
        <SubscriberModal
          row={openRow}
          plans={plans.data ?? []}
          onClose={() => setOpenId(null)}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
          onEmail={() => setEmailFor(openRow.id)}
          emailsVersion={emailsVersion}
        />
      ) : null}
      {emailRow ? (
        <EmailComposer
          row={emailRow}
          onClose={() => setEmailFor(null)}
          onSent={() => setEmailsVersion((v) => v + 1)}
        />
      ) : null}
    </>
  );
}

// --- One table row -------------------------------------------------------------

type Confirm = { kind: "plan"; plan: PlanSummary } | { kind: "delete" } | null;

function SubscriberRow({
  row,
  plans,
  onOpen,
  onEmail,
  onUpdated,
  onDeleted,
}: {
  row: Subscriber;
  plans: PlanSummary[];
  onOpen: () => void;
  onEmail: () => void;
  onUpdated: (row: Subscriber) => void;
  onDeleted: (id: number) => void;
}): ReactElement {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const run = async (fn: () => Promise<Subscriber>, done: string) => {
    setBusy(true);
    try {
      onUpdated(await fn());
      toast(done);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't do that.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const onAction = (value: string) => {
    if (value === "active" && !row.is_active) void run(() => unblockSubscriber(row.id), `${row.email} can sign in again.`);
    if (value === "blocked" && row.is_active) void run(() => blockSubscriber(row.id), `${row.email} is blocked and signed out.`);
    if (value === "delete") setConfirm({ kind: "delete" });
  };

  const sub = row.subscription;
  const pay = row.payment;
  const waiting = pay?.status === "submitted";

  return (
    <tr className={(row.is_active ? "" : "is-blocked") + (waiting ? " is-waiting" : "")}>
      <td>
        <button type="button" className="name-btn" onClick={onOpen}>
          {row.full_name || "Unnamed"}
        </button>
        {row.company ? <small className="muted block">{row.company.name}</small> : null}
        <small className="muted block">Joined {date(row.date_joined)}</small>
      </td>
      <td>
        <span className="cell-email">{emailWithBreak(row.email)}</span>
        {!row.email_verified ? <small className="muted block">Email not verified</small> : null}
      </td>
      <td>
        <select
          className="plan-select"
          aria-label={`Plan for ${row.email}`}
          value={row.plan?.code ?? ""}
          disabled={busy || plans.length === 0}
          onChange={(e) => {
            const plan = plans.find((p) => p.code === e.target.value);
            if (plan) setConfirm({ kind: "plan", plan });
          }}
        >
          {!row.plan ? <option value="">No plan</option> : null}
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
        {row.plan ? <small className="muted block">{row.plan.max_devices} PCs</small> : null}
      </td>
      <td>
        {!row.is_active ? (
          <>
            <span className="pill pill--bad">Blocked</span>
            <small className="muted block">Can't sign in</small>
          </>
        ) : sub ? (
          <>
            <span className={"pill pill--" + statusTone(sub.status)}>{STATUS_LABEL[sub.status] ?? sub.status}</span>
            <DaysLeft sub={sub} />
          </>
        ) : (
          <span className="muted">No plan yet</span>
        )}
      </td>
      <td>
        {pay ? (
          <div className="pay-cell">
            <span className={"pill pill--" + paymentTone(pay.status)}>
              {waiting
                ? `${pay.is_renewal ? "Renewal" : "Waiting"} · cycle ${pay.cycle ?? 1}`
                : pay.status === "verified"
                  ? pay.is_renewal
                    ? "Renewed"
                    : "Approved"
                  : "Rejected"}
            </span>
            <small className="muted block">
              {inr(pay.amount_inr)} · {methodLabel(pay.method)}
            </small>
          </div>
        ) : (
          <span className="muted block">No payments</span>
        )}
        {row.billing.cycles_paid > 0 ? (
          <small className="cycles">
            {row.billing.cycles_paid} cycle{row.billing.cycles_paid === 1 ? "" : "s"} paid · {inr(row.billing.total_paid_inr)}
          </small>
        ) : null}
        {waiting ? (
          <button type="button" className="btn btn--primary btn--sm review-btn" onClick={onOpen}>
            Review payment
          </button>
        ) : (
          <button type="button" className="link-btn block" onClick={onOpen}>
            View details
          </button>
        )}
      </td>
      <td className="remark-cell">
        <RemarkCell row={row} onUpdated={onUpdated} />
      </td>
      <td>
        <button type="button" className="icon-btn" onClick={onEmail} title={`Send an email to ${row.email}`}>
          <MailIcon />
          <span>Send mail</span>
        </button>
        <small className="muted block mail-meta">
          {row.emails.sent > 0
            ? `${row.emails.sent} sent · last ${date(row.emails.last_sent_at)}`
            : "None sent yet"}
        </small>
      </td>
      <td>
        <select
          className={"status-select action-select" + (row.is_active ? "" : " is-bad")}
          aria-label={`Action for ${row.email}`}
          value={row.is_active ? "active" : "blocked"}
          disabled={busy}
          onChange={(e) => onAction(e.target.value)}
        >
          <option value="active">Active</option>
          <option value="blocked">Block</option>
          <option value="delete">Delete…</option>
        </select>

        <ConfirmFor confirm={confirm} row={row} onUpdated={onUpdated} onDeleted={onDeleted} onClose={() => setConfirm(null)} />
      </td>
    </tr>
  );
}

function MailIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </svg>
  );
}

function NoteIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

function KeyIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3M14 9l2 2" />
    </svg>
  );
}

/** Remark: the note itself is the button; editing happens in a small popover next to it. */
function RemarkCell({ row, onUpdated }: { row: Subscriber; onUpdated: (row: Subscriber) => void }): ReactElement {
  const toast = useToast();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const saved = row.remark?.text ?? "";

  const open = (el: HTMLElement) => {
    setText(saved);
    setAnchor(el);
  };

  const save = async (value: string) => {
    setBusy(true);
    try {
      onUpdated(await setRemark(row.id, value));
      toast(value.trim() ? "Remark saved." : "Remark removed.");
      setAnchor(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the remark.", "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {row.remark ? (
        <button
          type="button"
          className="remark-chip"
          title="Edit remark"
          aria-label={`Edit remark: ${row.remark.text}`}
          onClick={(e) => open(e.currentTarget)}
        >
          <span className="remark-chip__text">{row.remark.text}</span>
        </button>
      ) : (
        <button type="button" className="add-btn" onClick={(e) => open(e.currentTarget)}>
          <NoteIcon />
          Add remark
        </button>
      )}

      {anchor ? (
        <Popover anchor={anchor} title="Remark" onClose={() => setAnchor(null)}>
          <textarea
            className="pop__textarea"
            rows={4}
            maxLength={2000}
            placeholder="e.g. Called on 11 Oct, wants a demo for 20 PCs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim() !== saved) void save(text);
            }}
            autoFocus
          />
          <div className="pop__meta">
            <span>Only your team sees this</span>
            <span>{text.length}/2000</span>
          </div>
          {row.remark ? (
            <p className="pop__hint">
              Last edited {dateTime(row.remark.updated_at)}
              {row.remark.updated_by ? ` by ${row.remark.updated_by}` : ""}
            </p>
          ) : null}
          <div className="pop__actions">
            {row.remark ? (
              <button type="button" className="link-btn link-btn--danger" disabled={busy} onClick={() => void save("")}>
                Remove
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setAnchor(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || text.trim() === saved}
              title="Ctrl + Enter"
              onClick={() => void save(text)}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

/** A random 14-character password with upper, lower, digit and symbol (no look-alike characters). */
function generatePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%*?-"];
  const all = sets.join("");
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const chars = [...sets.map(pick), ...Array.from({ length: 10 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// --- Customer modal: everything about one customer, with every action ---------------------

type ModalTab = "overview" | "payments" | "team" | "emails";

function SubscriberModal({
  row,
  plans,
  onClose,
  onUpdated,
  onDeleted,
  onEmail,
  emailsVersion,
}: {
  row: Subscriber;
  plans: PlanSummary[];
  onClose: () => void;
  onUpdated: (row: Subscriber) => void;
  onDeleted: (id: number) => void;
  onEmail: () => void;
  emailsVersion: number;
}): ReactElement {
  const toast = useToast();
  const [tab, setTab] = useState<ModalTab>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [resetting, setResetting] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const emails = useCustomerEmails(row.id, emailsVersion);

  const sub = row.subscription;
  const pay = row.payment;
  const waiting = pay?.status === "submitted" ? pay : null;

  const review = async (approve: boolean) => {
    if (!waiting) return;
    setBusy(true);
    setError(null);
    try {
      if (approve) await approvePayment(waiting.id);
      else await rejectPayment(waiting.id, reason.trim());
      const fresh = await getSubscriber(row.id);
      onUpdated(fresh);
      setRejecting(false);
      setReason("");
      setDone(
        approve
          ? `Approved. ${fresh.plan?.name ?? "The plan"} ${waiting.is_renewal ? "now runs" : "is active"}${fresh.subscription?.ends_at ? ` until ${date(fresh.subscription.ends_at)}` : ""}, and the customer was emailed.`
          : "Payment rejected. The customer sees your reason and can send a new payment.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't do that.");
    } finally {
      setBusy(false);
    }
  };

  const toggleBlock = async () => {
    setBusy(true);
    try {
      onUpdated(await (row.is_active ? blockSubscriber(row.id) : unblockSubscriber(row.id)));
      toast(row.is_active ? `${row.email} is blocked and signed out.` : `${row.email} can sign in again.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't do that.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const footer = waiting ? (
    rejecting ? (
      <form
        className="modal-reject"
        onSubmit={(e) => {
          e.preventDefault();
          void review(false);
        }}
      >
        <input
          type="text"
          placeholder="Reason the customer will see, e.g. No payment found for this UTR"
          aria-label="Reason for rejecting"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setRejecting(false)}>
          Back
        </button>
        <button type="submit" className="btn btn--danger" disabled={busy || !reason.trim()}>
          {busy ? "Rejecting…" : "Reject payment"}
        </button>
      </form>
    ) : (
      <>
        <span className="modal__hint">Check the amount and reference against your bank or PayPal first.</span>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void review(true)}>
          {busy
            ? "Approving…"
            : waiting.is_renewal && waiting.would_cover
              ? `Approve & extend to ${date(waiting.would_cover.until)}`
              : `Approve & activate ${waiting.plan.name}`}
        </button>
      </>
    )
  ) : (
    <button type="button" className="btn btn--ghost" onClick={onClose}>
      Close
    </button>
  );

  const tabs: { key: ModalTab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "payments", label: "Payments", count: row.payments.length },
    { key: "team", label: "Team", count: row.team.members.length },
    { key: "emails", label: "Emails", count: emails?.length },
  ];

  return (
    <Modal
      title={row.full_name || row.email}
      subtitle={
        <>
          {row.email}
          {row.company ? ` · ${row.company.name}` : ""}
          {!row.is_active ? (
            <span className="pill pill--bad">Blocked</span>
          ) : sub ? (
            <span className={"pill pill--" + statusTone(sub.status)}>{STATUS_LABEL[sub.status] ?? sub.status}</span>
          ) : null}
        </>
      }
      onClose={onClose}
      footer={footer}
    >
      <div className="cust-actions" role="toolbar" aria-label="Customer actions">
        <button type="button" className="icon-btn" onClick={onEmail}>
          <MailIcon />
          Send email
        </button>
        <button
          type="button"
          className={"icon-btn" + (resetting ? " is-on" : "")}
          aria-expanded={resetting}
          onClick={() => {
            setTab("overview");
            setResetting((v) => !v);
          }}
        >
          <KeyIcon />
          Reset password
        </button>
        <label className="cust-actions__plan">
          <span>Plan</span>
          <select
            className="plan-select"
            aria-label={`Change plan for ${row.email}`}
            value={row.plan?.code ?? ""}
            disabled={busy || plans.length === 0}
            onChange={(e) => {
              const plan = plans.find((p) => p.code === e.target.value);
              if (plan) setConfirm({ kind: "plan", plan });
            }}
          >
            {!row.plan ? <option value="">No plan</option> : null}
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span className="cust-actions__spacer" />
        <button type="button" className={"icon-btn" + (row.is_active ? "" : " is-good")} disabled={busy} onClick={() => void toggleBlock()}>
          {row.is_active ? <BlockIcon /> : <CheckIcon />}
          {row.is_active ? "Block" : "Unblock"}
        </button>
        <button type="button" className="icon-btn icon-btn--danger" onClick={() => setConfirm({ kind: "delete" })}>
          <TrashIcon />
          Delete
        </button>
      </div>

      {done ? (
        <p className="alert alert--good" role="status">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className="alert alert--bad" role="alert">
          {error}
        </p>
      ) : null}

      <div className="tabs tabs--modal" role="tablist" aria-label="Customer details">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={"tab" + (tab === t.key ? " is-active" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count !== undefined ? <span className="tab__count">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          {resetting ? <PasswordReset row={row} onUpdated={onUpdated} onDone={() => setResetting(false)} /> : null}
          <PlanSummary row={row} />
          {waiting ? (
            <section className="msec msec--hot" aria-label="Payment waiting for approval">
              <h3 className="msec__title">
                {waiting.is_renewal ? "Renewal payment waiting for approval" : "Payment waiting for approval"}
                <span className="pill pill--info">
                  {waiting.cycle && waiting.cycle > 1 ? `Cycle ${waiting.cycle} · renewal` : "Cycle 1 · first payment"}
                </span>
              </h3>
              <div className="review">
                <PaymentFacts payment={waiting} customerName={row.full_name} />
                <div className="review__proof">
                  <PaymentProof paymentId={waiting.id} hasProof={waiting.has_proof} />
                </div>
              </div>
            </section>
          ) : null}
          <AccountDetails row={row} />
          <RemarkEditor row={row} onUpdated={onUpdated} />
        </>
      ) : null}

      {tab === "payments" ? (
        row.payments.length ? (
          <div className="table-scroll">
            <PaymentHistory payments={row.payments} />
          </div>
        ) : (
          <p className="muted msec__empty">No payments yet.</p>
        )
      ) : null}

      {tab === "team" ? <TeamList row={row} /> : null}

      {tab === "emails" ? <SentEmails emails={emails} /> : null}

      <ConfirmFor
        confirm={confirm}
        row={row}
        onUpdated={onUpdated}
        onDeleted={(id) => {
          onDeleted(id);
          onClose();
        }}
        onClose={() => setConfirm(null)}
      />
    </Modal>
  );
}

/** Who the customer is: account and company facts in one compact grid. */
function AccountDetails({ row }: { row: Subscriber }): ReactElement {
  const c = row.company;
  return (
    <section className="msec" aria-label="Account">
      <h3 className="msec__title">Account</h3>
      <dl className="facts facts--account">
        <Fact
          label="Email"
          value={
            <>
              {emailWithBreak(row.email)}
              <small className={"block " + (row.email_verified ? "tone-good" : "tone-warn")}>
                {row.email_verified ? "Verified" : "Not verified"}
              </small>
            </>
          }
        />
        <Fact label="Joined" value={date(row.date_joined)} />
        <Fact label="Last sign-in" value={row.last_login ? dateTime(row.last_login) : "Never"} />
        <Fact
          label="Team"
          value={`${row.team.members.length} member${row.team.members.length === 1 ? "" : "s"} · ${row.team.devices} PC${row.team.devices === 1 ? "" : "s"}`}
        />
        {c ? (
          <>
            <Fact label="Company" value={c.name} />
            <Fact label="Industry" value={titleCase(c.industry.replace(/_/g, " ")).replace(/^It\b/, "IT")} />
            <Fact label="Team size" value={`${c.team_size} people`} />
            <Fact label="Location" value={[c.city, c.state].filter(Boolean).join(", ") || "—"} />
          </>
        ) : (
          <Fact label="Company" value="Not registered yet" />
        )}
      </dl>
    </section>
  );
}

/** The members the owner added on their dashboard: who, their email, PCs, status. */
function TeamList({ row }: { row: Subscriber }): ReactElement {
  const members = row.team.members;
  if (!members.length) {
    return (
      <p className="muted msec__empty">
        No team members yet. The customer adds them from Team in their dashboard; each gets a code for their PC.
      </p>
    );
  }
  return (
    <ul className="team-list">
      {members.map((m) => (
        <li key={m.id} className={m.is_active ? "" : "is-off"}>
          <span className="team-list__avatar" aria-hidden="true">
            {(m.name || m.email).trim().charAt(0).toUpperCase()}
          </span>
          <span className="team-list__who">
            <b>{m.name}</b>
            <a href={`mailto:${m.email}`}>{m.email}</a>
          </span>
          <span className="team-list__meta">
            <span className="mono">{m.member_code}</span>
            <small>
              {m.devices} PC{m.devices === 1 ? "" : "s"} · added {date(m.created_at)}
            </small>
          </span>
          <span className={"pill " + (m.is_active ? "pill--good" : "pill--muted")}>{m.is_active ? "Active" : "Removed"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Set a new password (never readable: stored hashed). Generate + Copy, then save. */
function PasswordReset({
  row,
  onUpdated,
  onDone,
}: {
  row: Subscriber;
  onUpdated: (row: Subscriber) => void;
  onDone: () => void;
}): ReactElement {
  const toast = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy; select the password and copy it.", "bad");
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      onUpdated(await setPassword(row.id, value));
      toast(`New password saved; ${row.email} was signed out everywhere.`);
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't set the password.", "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="msec pw-reset" aria-label="Reset password">
      <h3 className="msec__title">
        Reset password <span className="msec__aside">Passwords are stored encrypted and can't be shown</span>
      </h3>
      <div className="pw-reset__row">
        <input
          className="pop__input mono"
          type="text"
          autoComplete="new-password"
          spellCheck={false}
          placeholder="New password, at least 8 characters"
          aria-label={`New password for ${row.email}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.length >= 8) void save();
          }}
          autoFocus
        />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setValue(generatePassword())}>
          Generate
        </button>
        {value ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
        <button type="button" className="btn btn--primary btn--sm" disabled={busy || value.length < 8} onClick={() => void save()}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </div>
      <p className="pop__hint">They're signed out of every device. Share the new password privately.</p>
    </section>
  );
}

/** Plan-change and delete confirmations, shared by the table row and the customer modal. */
function ConfirmFor({
  confirm,
  row,
  onUpdated,
  onDeleted,
  onClose,
}: {
  confirm: Confirm;
  row: Subscriber;
  onUpdated: (row: Subscriber) => void;
  onDeleted: (id: number) => void;
  onClose: () => void;
}): ReactElement | null {
  const toast = useToast();
  if (confirm?.kind === "plan") {
    return (
      <ConfirmDialog
        title={`Switch to ${confirm.plan.name}?`}
        confirmLabel={`Switch to ${confirm.plan.name}`}
        onClose={onClose}
        onConfirm={async () => {
          onUpdated(await changePlan(row.id, confirm.plan.code));
          toast(`${row.email} is now on ${confirm.plan.name}.`);
        }}
      >
        <p>
          <b>{row.full_name || row.email}</b> moves from <b>{row.plan?.name ?? "no plan"}</b> to{" "}
          <b>{confirm.plan.name}</b> ({confirm.plan.max_devices} PCs) right away.
        </p>
        {Number(confirm.plan.price_inr_monthly) > 0 ? (
          <p className="confirm__note">
            This grants {confirm.plan.name} for one month <b>without a payment</b>. To charge for it, let the customer
            choose it and approve their payment instead.
          </p>
        ) : null}
      </ConfirmDialog>
    );
  }
  if (confirm?.kind === "delete") {
    return (
      <ConfirmDialog
        title="Delete this account?"
        confirmLabel="Delete account"
        danger
        confirmText={row.email}
        onClose={onClose}
        onConfirm={async () => {
          await deleteSubscriber(row.id);
          onDeleted(row.id);
          toast(`${row.email} was deleted.`);
        }}
      >
        <p>
          This permanently removes <b>{row.email}</b> with their company, subscriptions, payment records, devices and
          feedback. It can't be undone.
        </p>
        <p className="confirm__note">Blocking is usually enough: it stops sign-in and keeps the history.</p>
      </ConfirmDialog>
    );
  }
  return null;
}

function BlockIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function CheckIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function TrashIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

function Fact({ label, value }: { label: string; value: ReactElement | string }): ReactElement {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** One line for the plan (name, size, price, status) and one for its period and what's been paid. */
function PlanSummary({ row }: { row: Subscriber }): ReactElement {
  const sub = row.subscription;
  if (!row.plan || !sub) {
    return (
      <section className="plan-sum" aria-label="Plan">
        <span className="muted">No plan chosen yet.</span>
      </section>
    );
  }
  const price = Number(sub.amount_inr) > 0 ? `${inr(sub.amount_inr)} / month` : "Free";
  const meta: string[] = [];
  if (sub.status === "active") {
    meta.push(
      sub.ends_at
        ? `${daysLeftLabel(sub.days_left)} · paid until ${date(sub.ends_at)}`
        : `Since ${date(sub.starts_at)} · no end date`,
    );
  } else if (sub.status === "expired" && sub.ends_at) {
    meta.push(`Ended ${date(sub.ends_at)}`);
  }
  if (row.billing.cycles_paid > 0) {
    meta.push(
      `${row.billing.cycles_paid} cycle${row.billing.cycles_paid === 1 ? "" : "s"} paid · ${inr(row.billing.total_paid_inr)} in total`,
    );
  }
  return (
    <section className="plan-sum" aria-label="Plan">
      <div className="plan-sum__main">
        <b className="plan-sum__name">{row.plan.name}</b>
        <span className="muted">
          {row.plan.max_devices} PCs · {price}
        </span>
        <span className={"pill pill--" + statusTone(sub.status)}>{STATUS_LABEL[sub.status] ?? sub.status}</span>
      </div>
      {meta.length ? <p className="plan-sum__meta">{meta.join("  ·  ")}</p> : null}
    </section>
  );
}

/** The payment being reviewed. Each fact appears once; the payer only when it isn't the customer. */
function PaymentFacts({ payment, customerName }: { payment: Payment; customerName: string }): ReactElement {
  const mismatch = Number(payment.amount_inr) !== Number(payment.expected_inr);
  const otherPayer =
    payment.payer_name && payment.payer_name.trim().toLowerCase() !== customerName.trim().toLowerCase();
  return (
    <dl className="facts">
      <Fact
        label="Amount"
        value={
          <span className={mismatch ? "is-warn" : ""}>
            {inr(payment.amount_inr)}
            {mismatch ? <small className="block">Plan price is {inr(payment.expected_inr)}</small> : null}
          </span>
        }
      />
      <Fact
        label={`${methodLabel(payment.method)} reference`}
        value={<span className="mono">{payment.reference}</span>}
      />
      <Fact
        label="Paid on"
        value={
          <>
            {date(payment.paid_on)}
            <small className="block muted">reported {dateTime(payment.submitted_at)}</small>
          </>
        }
      />
      {payment.would_cover ? (
        <Fact
          label={payment.is_renewal ? "Extends plan" : "Activates plan"}
          value={
            <span className="period">
              {date(payment.would_cover.from)} → {date(payment.would_cover.until)}
            </span>
          }
        />
      ) : null}
      {otherPayer ? <Fact label="Paid by" value={payment.payer_name} /> : null}
    </dl>
  );
}

function PaymentHistory({ payments }: { payments: Payment[] }): ReactElement {
  const manyPlans = new Set(payments.map((p) => p.plan.code)).size > 1;
  return (
    <table className="sheet sheet--mini">
      <thead>
        <tr>
          <th>Cycle</th>
          <th>Type</th>
          {manyPlans ? <th>Plan</th> : null}
          <th>Amount</th>
          <th>Method · reference</th>
          <th>Paid on</th>
          <th>Period</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id}>
            <td>{p.cycle ? <b>#{p.cycle}</b> : <span className="muted">—</span>}</td>
            <td>
              <span className={"tag" + (p.is_renewal ? " tag--renew" : "")}>{p.is_renewal ? "Renewal" : "New"}</span>
            </td>
            {manyPlans ? <td>{p.plan.name}</td> : null}
            <td>{inr(p.amount_inr)}</td>
            <td>
              {methodLabel(p.method)} · <span className="mono">{p.reference}</span>
            </td>
            <td>{date(p.paid_on)}</td>
            <td className="nowrap">
              {p.covers_from ? (
                period(p.covers_from, p.covers_until)
              ) : p.would_cover ? (
                <span className="muted">{period(p.would_cover.from, p.would_cover.until)} if approved</span>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
            <td>
              <span className={"pill pill--" + paymentTone(p.status)}>
                {p.status === "submitted" ? "Waiting" : p.status === "verified" ? "Approved" : titleCase(p.status)}
              </span>
              {p.rejection_reason ? <small className="muted block">{p.rejection_reason}</small> : null}
              {p.reviewed_at ? (
                <small className="muted block">
                  {date(p.reviewed_at)}
                  {p.reviewed_by ? ` · ${p.reviewed_by}` : ""}
                </small>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function statusTone(status: string): string {
  if (status === "active") return "good";
  if (status === "pending_payment") return "warn";
  return "muted";
}

// --- Remark, sent emails, composer ---------------------------------------------------

/** The team's internal note on a customer. Saved explicitly; never shown to the customer. */
function RemarkEditor({ row, onUpdated }: { row: Subscriber; onUpdated: (row: Subscriber) => void }): ReactElement {
  const saved = row.remark?.text ?? "";
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setText(saved);
  }, [saved]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await setRemark(row.id, text));
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the remark.");
    } finally {
      setBusy(false);
    }
  };

  const dirty = text.trim() !== saved;
  return (
    <section className="msec" aria-label="Remark">
      <h3 className="msec__title">
        Remark
        <span className="msec__aside">
          {justSaved
            ? "Saved"
            : row.remark
              ? `Edited ${dateTime(row.remark.updated_at)}${row.remark.updated_by ? ` by ${row.remark.updated_by}` : ""}`
              : "Only your team sees this"}
        </span>
      </h3>
      <textarea
        className="remark-input"
        rows={1}
        maxLength={2000}
        placeholder="e.g. Called on 11 Oct, wants a demo for 20 PCs"
        aria-label={`Remark about ${row.email}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {dirty || busy ? (
        <div className="remark-bar">
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setText(saved)}>
            Undo
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save remark"}
          </button>
        </div>
      ) : null}
      {error ? <p className="row-error">{error}</p> : null}
    </section>
  );
}

/** Emails to this customer the team should see (custom + automatic), newest first; reloads on `version`. */
function useCustomerEmails(customerId: number, version: number): SentEmail[] | null {
  const [emails, setEmails] = useState<SentEmail[] | null>(null);
  useEffect(() => {
    let alive = true;
    getCustomerEmails(customerId)
      .then((list) => {
        if (alive) setEmails(list);
      })
      .catch(() => {
        if (alive) setEmails([]);
      });
    return () => {
      alive = false;
    };
  }, [customerId, version]);
  return emails;
}

/** Click an email to read it. */
function SentEmails({ emails }: { emails: SentEmail[] | null }): ReactElement {
  if (emails === null) return <p className="muted msec__empty">Loading…</p>;
  if (!emails.length) return <p className="muted msec__empty">No emails sent to this customer yet.</p>;
  return (
    <ul className="mail-list">
      {emails.map((m) => (
        <li key={m.id}>
          <details>
            <summary>
              <span className="mail-list__subject">{m.subject}</span>
              {m.automatic ? (
                <span className="tag" title="Sent automatically by Zinwe">
                  Automatic
                </span>
              ) : null}
              <span className="muted">{dateTime(m.sent_at ?? m.created_at)}</span>
              {m.status !== "sent" ? <span className="pill pill--bad">Not sent</span> : null}
            </summary>
            <pre className="mail-list__body">{m.body}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}

/** Write and send a custom email (subject + rich text) to one customer, in the branded Zinwe layout. */
function EmailComposer({
  row,
  onClose,
  onSent,
}: {
  row: Subscriber;
  onClose: () => void;
  onSent: () => void;
}): ReactElement {
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState<RichTextValue>({ html: "", text: "" });
  // The editor is uncontrolled: a template loads by remounting it with new starting content.
  const [editor, setEditor] = useState<{ key: number; html: string }>({ key: 0, html: "" });
  // What the last template put in, so we only ask before replacing the operator's own edits.
  const [applied, setApplied] = useState<{ subject: string; text: string }>({ subject: "", text: "" });
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const firstName = (row.full_name || "").split(" ")[0];
  const ready = subject.trim().length > 0 && body.text.length > 0;
  const edited = subject !== applied.subject || body.text !== applied.text;
  const suggested = useMemo(() => EMAIL_TEMPLATES.filter((t) => t.suggest?.(row)), [row]);
  const current = EMAIL_TEMPLATES.find((t) => t.id === templateId) ?? null;

  const apply = (id: string) => {
    setPending(null);
    setTemplateId(id);
    const tpl = EMAIL_TEMPLATES.find((t) => t.id === id);
    const filled = tpl ? tpl.build(contextFor(row)) : { subject: "", html: "" };
    setSubject(filled.subject);
    setBody({ html: "", text: "" }); // a blank template loads nothing, so clear it here
    setEditor((e) => ({ key: e.key + 1, html: filled.html }));
    // body/applied.text are set by the editor's first onChange after it remounts
    setApplied({ subject: filled.subject, text: "" });
  };

  const choose = (id: string) => {
    if (id === templateId) return;
    if (edited && (subject.trim() || body.text)) setPending(id);
    else apply(id);
  };

  const onBody = (value: RichTextValue) => {
    setBody(value);
    // The first change after a (re)mount is the template itself loading: that's the baseline.
    setApplied((a) => (a.text === "" && editor.html ? { ...a, text: value.text } : a));
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCustomerEmail(row.id, subject.trim(), body.html);
      setSent(true);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The email couldn't be sent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Send email"
      subtitle={<>To {row.full_name ? `${row.full_name} <${row.email}>` : row.email}</>}
      onClose={onClose}
      footer={
        sent ? (
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <span className="modal__hint">Sent from the Zinwe team with your logo and signature.</span>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={busy || !ready} onClick={() => void send()}>
              {busy ? "Sending…" : "Send email"}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <p className="alert alert--good" role="status">
          Email sent to {row.email}. It's listed under “Emails sent” on this customer.
        </p>
      ) : (
        <div className="composer">
          <div className="composer__field">
            <label htmlFor="mail-template">Template</label>
            <select
              id="mail-template"
              className="composer__select"
              value={pending ?? templateId}
              onChange={(e) => choose(e.target.value)}
            >
              <option value="">Blank email</option>
              {suggested.length ? (
                <optgroup label="Suggested for this customer">
                  {suggested.map((t) => (
                    <option key={`s-${t.id}`} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {TEMPLATE_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {EMAIL_TEMPLATES.filter((t) => t.group === group && !suggested.includes(t)).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {pending ? (
              <div className="composer__replace" role="alert">
                <span>Replace your message with “{EMAIL_TEMPLATES.find((t) => t.id === pending)?.label ?? "Blank email"}”?</span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPending(null)}>
                  Keep mine
                </button>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => apply(pending)}>
                  Replace
                </button>
              </div>
            ) : (
              <small className="composer__when">
                {current ? current.when : "Start from scratch, or pick a template: it fills in this customer's details."}
              </small>
            )}
          </div>

          <label className="composer__field">
            Subject
            <input
              type="text"
              maxLength={200}
              placeholder="e.g. Your Zinwe plan is ready"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <div className="composer__field">
            <span>Message</span>
            <RichTextEditor
              key={editor.key}
              label="Message"
              placeholder={firstName ? `Hi ${firstName},` : "Hi,"}
              initialHtml={editor.html}
              onChange={onBody}
            />
            {current && /\[[^\]]+\]/.test(body.text) ? (
              <small className="composer__todo">Replace the [bracketed] parts before sending.</small>
            ) : null}
          </div>
          {error ? (
            <p className="alert alert--bad" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/** Let a long email wrap at natural points (before "@", after "."), never mid-word. */
function emailWithBreak(email: string): ReactElement {
  const parts = email.split(/(?=@)|(?<=\.)/);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}
