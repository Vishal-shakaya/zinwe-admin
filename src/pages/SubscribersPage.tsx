import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import {
  approvePayment,
  getCustomerEmails,
  getPlans,
  getSubscriber,
  getSubscribers,
  isBlocked,
  rejectPayment,
  sendCustomerEmail,
  setRemark,
  unblockSubscriber,
  type Payment,
  type PlanSummary,
  type SentEmail,
  type Subscriber,
} from "../lib/api";
import { refreshBadges } from "../lib/badges";
import { date, dateTime, daysLeftLabel, inr, methodLabel, money, paymentTone, period, titleCase } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { RichTextEditor, type RichTextValue } from "../components/RichTextEditor";
import { Popover } from "../components/Popover";
import { useToast } from "../components/Toast";
import { EMAIL_TEMPLATES, TEMPLATE_GROUPS, contextFor } from "../content/emailTemplates";
import { CustomerConfirm, type Confirm } from "./subscribers/CustomerConfirm";
import { PasswordReset } from "./subscribers/PasswordReset";
import {
  ApproveConfirm,
  EMPTY_CHECK,
  PaymentReview,
  RejectForm,
  checkReady,
  type ReceiptCheck,
} from "./subscribers/PaymentReview";
import { BlockIcon, CheckIcon, ChevronIcon, KeyIcon, LockIcon, MailIcon, NoteIcon, TrashIcon } from "./subscribers/icons";

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

/** The payment to show for a customer: the current plan's latest, else the last one they ever sent. */
function lastPayment(row: Subscriber): { payment: Payment; current: boolean } | null {
  if (row.payment) return { payment: row.payment, current: true };
  return row.payments[0] ? { payment: row.payments[0], current: false } : null;
}

/**
 * Every customer in one table. Paid plans activate here: a customer's reported payment shows as
 * "Waiting"; Review opens the customer's details with the payment, its receipt, and Approve / Reject.
 * `?review=<payment id>` (the link in the staff email) and `?open=<customer id>` open a customer directly.
 */
export function SubscribersPage(): ReactElement {
  const loadSubs = useCallback(() => getSubscribers(), []);
  const loadPlans = useCallback(() => getPlans(), []);
  const subs = useLoad(loadSubs);
  const plans = useLoad(loadPlans);
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState<number | null>(null);
  const [emailFor, setEmailFor] = useState<number | null>(null);
  const [emailsVersion, setEmailsVersion] = useState(0); // bump to reload the modal's sent-email list

  const filter: FilterKey = FILTERS.some((f) => f.key === params.get("status"))
    ? (params.get("status") as FilterKey)
    : "all";
  const setFilter = (key: FilterKey) => setParams(key === "all" ? {} : { status: key }, { replace: true });

  const rows = useMemo(() => subs.data ?? [], [subs.data]);
  const onUpdated = (row: Subscriber) => subs.setData(rows.map((r) => (r.id === row.id ? row : r)));
  const onDeleted = (id: number) => subs.setData(rows.filter((r) => r.id !== id));

  // Deep links: ?review=<payment id> from the "payment to check" email, ?open=<customer id> from Support /
  // Feedback, ?compose=<customer id> (Feedback's "Email them").
  const review = params.get("review");
  const open = params.get("open");
  const compose = params.get("compose");
  useEffect(() => {
    if ((!review && !open && !compose) || !subs.data) return;
    const paymentId = Number(review);
    const found = review
      ? subs.data.find((r) => r.payments.some((p) => p.id === paymentId))
      : subs.data.find((r) => r.id === Number(open ?? compose));
    if (found && compose) setEmailFor(found.id);
    else if (found) setOpenId(found.id);
    else {
      toast(
        review
          ? `Payment #${review} isn't here any more (the customer may have been deleted).`
          : "That customer isn't here any more.",
        "bad",
      );
    }
    const next = new URLSearchParams(params);
    next.delete("review");
    next.delete("open");
    next.delete("compose");
    setParams(next, { replace: true });
  }, [review, open, compose, subs.data, params, setParams, toast]);

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
                <tr className="sheet__empty-row">
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
          key={openRow.id}
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

// --- One table row (a card on phones) ----------------------------------------------------

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
  const [confirm, setConfirm] = useState<Confirm>(null);
  const sub = row.subscription;
  const last = lastPayment(row);
  const pay = last?.payment ?? null;
  const waiting = last?.current === true && pay?.status === "submitted";
  const blocked = isBlocked(row);

  return (
    <tr className={(blocked ? "is-blocked" : "") + (waiting ? " is-waiting" : "")}>
      <td className="cell-name">
        <button type="button" className="name-btn" onClick={onOpen}>
          {row.full_name || "Unnamed"}
        </button>
        {row.company ? <small className="muted block">{row.company.name}</small> : null}
        <small className="muted block">Joined {date(row.date_joined)}</small>
      </td>
      <td className="cell-mail" data-label="Email">
        <span className="cell-email">{emailWithBreak(row.email)}</span>
        {!row.email_verified ? <small className="muted block">Email not verified</small> : null}
      </td>
      <td data-label="Plan">
        <select
          className="plan-select"
          aria-label={`Plan for ${row.email}`}
          value={row.plan?.code ?? ""}
          disabled={plans.length === 0}
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
      <td data-label="Status">
        {blocked ? (
          <>
            <span className="pill pill--bad">Blocked</span>
            <small className="muted block">Can't sign in</small>
          </>
        ) : !row.is_active ? (
          <>
            <span className="pill pill--muted">Sign-up not finished</span>
            <small className="muted block">Email code not entered</small>
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
      <td className="cell-pay" data-label="Payment">
        {pay ? (
          <div className="pay-cell">
            {!last?.current ? <small className="muted block">Last payment · {pay.plan.name}</small> : null}
            <span className={"pill pill--" + paymentTone(pay.status)}>
              {waiting
                ? `${pay.is_renewal ? "Renewal" : "Waiting"} · cycle ${pay.cycle ?? 1}`
                : pay.status === "submitted"
                  ? "Not reviewed"
                  : pay.status === "verified"
                    ? pay.is_renewal
                      ? "Renewed"
                      : "Approved"
                    : "Rejected"}
            </span>
            <small className="muted block">
              {money(pay.due_total ?? pay.amount_inr, pay.currency ?? "INR")} · {methodLabel(pay.method)}
              {!waiting ? ` · ${date(pay.reviewed_at ?? pay.submitted_at)}` : ""}
            </small>
          </div>
        ) : (
          <span className="muted block">No payments yet</span>
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
      <td className="remark-cell" data-label="Internal note">
        <RemarkCell row={row} onUpdated={onUpdated} />
      </td>
      <td data-label="Mail">
        <button type="button" className="icon-btn" onClick={onEmail} title={`Send an email to ${row.email}`}>
          <MailIcon />
          <span>Send mail</span>
        </button>
        <small className="muted block mail-meta">
          {row.emails.sent > 0
            ? `${row.emails.sent} sent by staff · last ${date(row.emails.last_sent_at)}`
            : "None sent by staff yet"}
        </small>
        {row.emails.total ? (
          <small className="muted block mail-meta">
            {row.emails.total} email{row.emails.total === 1 ? "" : "s"} in all
          </small>
        ) : null}
      </td>
      <td data-label="Action">
        <ActionsMenu row={row} onOpen={onOpen} onEmail={onEmail} onConfirm={setConfirm} onUpdated={onUpdated} />
        <CustomerConfirm
          confirm={confirm}
          row={row}
          plans={plans}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
          onClose={() => setConfirm(null)}
          onBlockInstead={() => setConfirm({ kind: "block" })}
        />
      </td>
    </tr>
  );
}

/**
 * J8-04: a menu button instead of a <select> (which changed — and blocked a customer — on arrow keys).
 * Nothing happens until a menu item is clicked, and Block / Delete still ask first.
 */
function ActionsMenu({
  row,
  onOpen,
  onEmail,
  onConfirm,
  onUpdated,
}: {
  row: Subscriber;
  onOpen: () => void;
  onEmail: () => void;
  onConfirm: (c: Confirm) => void;
  onUpdated: (row: Subscriber) => void;
}): ReactElement {
  const toast = useToast();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const blocked = isBlocked(row);
  const pick = (fn: () => void) => () => {
    setAnchor(null);
    fn();
  };
  const unblock = async () => {
    try {
      onUpdated(await unblockSubscriber(row.id));
      toast(`${row.email} can sign in again.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't do that.", "bad");
    }
  };
  return (
    <>
      <button
        type="button"
        className={"btn btn--ghost btn--sm actions-btn" + (blocked ? " is-bad" : "")}
        aria-haspopup="true"
        aria-expanded={anchor !== null}
        aria-label={`Actions for ${row.email}`}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {blocked ? "Blocked" : "Actions"} <ChevronIcon />
      </button>
      {anchor ? (
        <Popover anchor={anchor} title={`Actions for ${row.email}`} width={220} onClose={() => setAnchor(null)}>
          <div className="menu">
            <button type="button" className="menu__item" onClick={pick(onOpen)}>
              Open details
            </button>
            <button type="button" className="menu__item" onClick={pick(onEmail)}>
              Send email
            </button>
            {blocked ? (
              <button type="button" className="menu__item" onClick={pick(() => void unblock())}>
                Unblock
              </button>
            ) : row.is_active ? (
              <button type="button" className="menu__item" onClick={pick(() => onConfirm({ kind: "block" }))}>
                Block…
              </button>
            ) : null}
            <button type="button" className="menu__item menu__item--danger" onClick={pick(() => onConfirm({ kind: "delete" }))}>
              Delete…
            </button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

/** Unsaved remark text per customer, kept when the popover closes (J8-17), until saved or discarded. */
const remarkDrafts = new Map<number, string>();

/** Internal note: the note itself is the button; editing happens in a small popover next to it. */
function RemarkCell({ row, onUpdated }: { row: Subscriber; onUpdated: (row: Subscriber) => void }): ReactElement {
  const toast = useToast();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setDraftVersion] = useState(0);
  const saved = row.remark?.text ?? "";
  const draft = remarkDrafts.get(row.id);

  const open = (el: HTMLElement) => {
    setText(remarkDrafts.get(row.id) ?? saved);
    setAnchor(el);
  };

  const close = () => {
    if (text.trim() !== saved.trim()) remarkDrafts.set(row.id, text);
    else remarkDrafts.delete(row.id);
    setDraftVersion((v) => v + 1);
    setAnchor(null);
  };

  const save = async (value: string) => {
    setBusy(true);
    try {
      onUpdated(await setRemark(row.id, value));
      remarkDrafts.delete(row.id);
      toast(value.trim() ? "Note saved." : "Note removed.");
      setAnchor(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the note.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    remarkDrafts.delete(row.id);
    setText(saved);
    setDraftVersion((v) => v + 1);
  };

  return (
    <>
      {row.remark ? (
        <button
          type="button"
          className="remark-chip"
          title="Edit internal note"
          aria-label={`Edit internal note: ${row.remark.text}`}
          onClick={(e) => open(e.currentTarget)}
        >
          <span className="remark-chip__text">{row.remark.text}</span>
        </button>
      ) : (
        <button type="button" className="add-btn" onClick={(e) => open(e.currentTarget)}>
          <NoteIcon />
          Add note
        </button>
      )}
      {draft !== undefined && !anchor ? <small className="remark-draft">Unsaved draft</small> : null}

      {anchor ? (
        <Popover anchor={anchor} title="Internal note" onClose={close}>
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
            <span>
              <LockIcon /> Only your team sees this · Ctrl+Enter to save
            </span>
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
            {text.trim() !== saved.trim() ? (
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={discard}>
                Discard changes
              </button>
            ) : (
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={close}>
                Close
              </button>
            )}
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || text.trim() === saved}
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
  const [check, setCheck] = useState<ReceiptCheck>(EMPTY_CHECK);
  const [approving, setApproving] = useState(false);
  const [localEmails, setLocalEmails] = useState(0); // emails this window caused (approve / reject), to refresh the tab
  const emails = useCustomerEmails(row.id, emailsVersion + localEmails);

  const sub = row.subscription;
  const pay = row.payment;
  const waiting = pay?.status === "submitted" ? pay : null;
  const blocked = isBlocked(row);
  const ready = checkReady(check);

  const approve = async () => {
    if (!waiting) return;
    await approvePayment(waiting.id, check.reference.trim(), check.amount.replace(/[₹$,\s]/g, ""));
    const fresh = await getSubscriber(row.id);
    onUpdated(fresh);
    setCheck(EMPTY_CHECK);
    setLocalEmails((n) => n + 1);
    refreshBadges();
    setDone(
      `Approved. ${fresh.plan?.name ?? "The plan"} ${waiting.is_renewal ? "now runs" : "is active"}${fresh.subscription?.ends_at ? ` until ${date(fresh.subscription.ends_at)}` : ""}, and the customer was emailed.`,
    );
  };

  const reject = async () => {
    if (!waiting) return;
    setBusy(true);
    setError(null);
    try {
      await rejectPayment(waiting.id, reason.trim());
      onUpdated(await getSubscriber(row.id));
      setRejecting(false);
      setReason("");
      setLocalEmails((n) => n + 1);
      refreshBadges();
      setDone("Payment rejected. The customer sees your reason and can send a new payment.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't do that.");
    } finally {
      setBusy(false);
    }
  };

  const unblock = async () => {
    setBusy(true);
    try {
      onUpdated(await unblockSubscriber(row.id));
      toast(`${row.email} can sign in again.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't do that.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const footer = waiting ? (
    rejecting ? (
      <RejectForm
        reason={reason}
        busy={busy}
        onReason={setReason}
        onBack={() => setRejecting(false)}
        onSubmit={() => void reject()}
      />
    ) : (
      <>
        <span className="modal__hint">
          {ready
            ? "Matches your bank statement, UPI app or Skydo? Then approve."
            : "Check the receipt against your bank statement, UPI app or Skydo, then type its amount and UTR above."}
        </span>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !ready}
          title={ready ? undefined : "Type the amount and UTR from the receipt first"}
          onClick={() => setApproving(true)}
        >
          {waiting.is_renewal && waiting.would_cover
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
    { key: "emails", label: "Emails", count: emails?.length ?? row.emails.total },
  ];

  return (
    <Modal
      title={row.full_name || row.email}
      subtitle={
        <>
          {row.email}
          {row.company ? ` · ${row.company.name}` : ""}
          {blocked ? (
            <span className="pill pill--bad">Blocked</span>
          ) : !row.is_active ? (
            <span className="pill pill--muted">Sign-up not finished</span>
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
        {blocked ? (
          <button type="button" className="icon-btn is-good" disabled={busy} onClick={() => void unblock()}>
            <CheckIcon />
            Unblock
          </button>
        ) : row.is_active ? (
          <button type="button" className="icon-btn" disabled={busy} onClick={() => setConfirm({ kind: "block" })}>
            <BlockIcon />
            Block…
          </button>
        ) : null}
        <button type="button" className="icon-btn icon-btn--danger" onClick={() => setConfirm({ kind: "delete" })}>
          <TrashIcon />
          Delete…
        </button>
      </div>

      {blocked ? (
        <p className="alert alert--bad" role="status">
          <b>Blocked</b>
          {row.blocked ? (
            <>
              {" "}
              {dateTime(row.blocked.at)}
              {row.blocked.by ? ` by ${row.blocked.by}` : ""}: {row.blocked.reason}
              {row.blocked.emailed ? " (the customer was emailed)" : " (not emailed)"}
            </>
          ) : (
            " — they can't sign in."
          )}
        </p>
      ) : null}
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
          {waiting ? <PaymentReview payment={waiting} row={row} check={check} onCheck={setCheck} /> : null}
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

      {approving && waiting ? (
        <ApproveConfirm
          payment={waiting}
          row={row}
          check={check}
          onConfirm={approve}
          onClose={() => setApproving(false)}
        />
      ) : null}

      <CustomerConfirm
        confirm={confirm}
        row={row}
        plans={plans}
        onUpdated={onUpdated}
        onDeleted={(id) => {
          onDeleted(id);
          onClose();
        }}
        onClose={() => setConfirm(null)}
        onBlockInstead={() => setConfirm({ kind: "block" })}
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
        <Fact
          label="Terms accepted"
          value={
            row.terms?.accepted_at ? (
              <>
                {dateTime(row.terms.accepted_at)}
                <small className="block muted">Version {row.terms.version}</small>
              </>
            ) : (
              <span className="tone-warn">Not recorded (signed up before the terms checkbox)</span>
            )
          }
        />
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
        No team members yet. The customer adds them in Team &amp; devices on their dashboard; each gets a Member ID for
        their PC.
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
            {m.devices > 0 ? (
              <small className={m.consent?.at ? "tone-good" : "tone-warn"}>
                {m.consent?.at ? `Consent given ${date(m.consent.at)}` : "Consent not given yet"}
              </small>
            ) : null}
          </span>
          <span className={"pill " + (m.is_active ? "pill--good" : "pill--muted")}>{m.is_active ? "Active" : "Removed"}</span>
        </li>
      ))}
    </ul>
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
            <td>
              {money(p.due_total ?? p.amount_inr, p.currency ?? "INR")}
              {p.staff_amount && Math.abs(Number(p.staff_amount) - Number(p.due_total ?? p.amount_inr)) > 0.005 ? (
                <small className="block tone-warn">receipt {money(p.staff_amount, p.currency ?? "INR")}</small>
              ) : null}
            </td>
            <td>
              {methodLabel(p.method)}
              {p.staff_reference || p.reference ? (
                <>
                  {" · "}
                  <span className="mono">{p.staff_reference || p.reference}</span>
                </>
              ) : null}
              {p.duplicate_of ? (
                <small className="block tone-warn">
                  Same {p.duplicate_of.match === "receipt" ? "receipt" : "reference"} as #{p.duplicate_of.id}
                </small>
              ) : null}
              {p.terms_accepted_at ? (
                <small className="block muted">Payment terms accepted {date(p.terms_accepted_at)}</small>
              ) : null}
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
              {p.invoice_number ? <small className="muted block">Invoice {p.invoice_number}</small> : null}
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

// --- Internal note, sent emails, composer ---------------------------------------------------

/**
 * The team's internal note on a customer. Saved explicitly; never shown to the customer. Set apart from
 * the customer-facing payment reason (j3: a reason typed here by mistake would never reach the customer).
 */
function RemarkEditor({ row, onUpdated }: { row: Subscriber; onUpdated: (row: Subscriber) => void }): ReactElement {
  const saved = row.remark?.text ?? "";
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const savedRef = useRef(saved);

  useEffect(() => {
    if (savedRef.current !== saved) {
      savedRef.current = saved;
      setText(saved);
    }
  }, [saved]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await setRemark(row.id, text));
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the note.");
    } finally {
      setBusy(false);
    }
  };

  const dirty = text.trim() !== saved;
  return (
    <section className="msec note-box" aria-labelledby={`note-${row.id}`}>
      <h3 className="msec__title" id={`note-${row.id}`}>
        <LockIcon /> Internal note <span className="note-box__who">(the customer doesn't see this)</span>
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
        aria-label={`Internal note about ${row.email} (the customer doesn't see this)`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && dirty) void save();
        }}
      />
      {dirty || busy ? (
        <div className="remark-bar">
          <span className="muted">Ctrl+Enter to save</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setText(saved)}>
            Undo
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save note"}
          </button>
        </div>
      ) : null}
      {error ? <p className="row-error">{error}</p> : null}
    </section>
  );
}

/** Every email Zinwe sent this customer (automatic and the team's), newest first; reloads on `version`. */
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

/** Plain names for the automatic emails, so staff know what the customer already got. */
const EMAIL_KIND: Record<string, string> = {
  otp_signup: "Sign-up code",
  otp_login: "Sign-in code",
  otp_password_reset: "Password reset code",
  welcome: "Welcome",
  payment_received: "Receipt received",
  payment_rejected: "Payment not accepted",
  subscription_active: "Plan active",
  renewal_reminder: "Renewal reminder",
  plan_expired: "Plan ended",
  quote_sent: "Quote",
  support_reply: "Support reply",
  feedback_request: "Feedback request",
  account_suspended: "Account paused",
  plan_changed_by_staff: "Plan changed",
  newsletter_confirm: "Newsletter",
  newsletter_issue: "Newsletter",
};

/** Click an email to read it. */
function SentEmails({ emails }: { emails: SentEmail[] | null }): ReactElement {
  if (emails === null) return <p className="muted msec__empty">Loading…</p>;
  if (!emails.length) return <p className="muted msec__empty">No emails sent to this customer yet.</p>;
  return (
    <>
      <p className="muted msec__empty">Every email Zinwe sent them, newest first. Codes are hidden.</p>
      <ul className="mail-list">
        {emails.map((m) => (
          <li key={m.id}>
            <details>
              <summary>
                <span className="mail-list__subject">{m.subject || EMAIL_KIND[m.template] || m.template}</span>
                {m.automatic ? (
                  <span className="tag" title="Sent automatically by Zinwe">
                    {EMAIL_KIND[m.template] ?? "Automatic"}
                  </span>
                ) : (
                  <span className="tag tag--renew">From the team</span>
                )}
                <span className="muted">{dateTime(m.sent_at ?? m.created_at)}</span>
                {m.status !== "sent" ? <span className="pill pill--bad">Not sent</span> : null}
              </summary>
              <pre className="mail-list__body">{m.body}</pre>
            </details>
          </li>
        ))}
      </ul>
    </>
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
          Email sent to {row.email}. It's listed under Emails on this customer.
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
