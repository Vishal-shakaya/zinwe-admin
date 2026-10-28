import { useEffect, useId, useState, type ReactElement } from "react";
import {
  approvePayment,
  deleteSubscriber,
  downloadInvoicePdf,
  getCustomerEmails,
  getSubscriber,
  isBlocked,
  rejectPayment,
  setRemark,
  unblockSubscriber,
  type Payment,
  type PlanSummary,
  type SentEmail,
  type Subscriber,
} from "../../lib/api";
import { refreshBadges } from "../../lib/badges";
import { dateTime, methodLabel, money, period, titleCase } from "../../lib/format";
import { useToast } from "../../components/Toast";
import { Icon } from "../../components/icons";
import { SampleTag } from "../../components/States";
import { PLAN_HISTORY, countryOf } from "../../content/fixtures/subscribers";
import { Drawer } from "./Drawer";
import { BlockConfirm, PlanConfirm } from "./CustomerConfirm";
import { PasswordReset } from "./PasswordReset";
import { EMPTY_CHECK, PendingPayment, type ReceiptCheck } from "./PaymentReview";
import { ago, chipOf, companyName, cur, dLong, dShort, initials, pcsUsed, pendingPayments } from "./model";

export type DrawerTab = "overview" | "payments" | "remarks" | "emails" | "actions";

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

const industry = (s: string) => titleCase(s.replace(/_/g, " ")).replace(/^It\b/, "IT");

/**
 * The board's customer panel: header (initials, company, status, one line), tabs, and per tab everything about
 * one customer with every action the old customer window had (approve / reject, plan, block, password, note,
 * emails, delete).
 */
export function CustomerDrawer({
  row,
  plans,
  initialTab,
  emailsVersion,
  onClose,
  onUpdated,
  onDeleted,
  onEmail,
}: {
  row: Subscriber;
  plans: PlanSummary[];
  initialTab?: DrawerTab;
  emailsVersion: number;
  onClose: () => void;
  onUpdated: (row: Subscriber) => void;
  onDeleted: (id: number) => void;
  /** Open the composer; a template id starts it from that template. */
  onEmail: (template?: string) => void;
}): ReactElement {
  const toast = useToast();
  const headId = useId();
  const pend = pendingPayments(row);
  const [tab, setTab] = useState<DrawerTab>(initialTab ?? (pend.length ? "payments" : "overview"));
  const [checks, setChecks] = useState<Record<number, ReceiptCheck>>({});
  const [localEmails, setLocalEmails] = useState(0);
  const emails = useCustomerEmails(row.id, emailsVersion + localEmails);
  const chip = chipOf(row);
  const co = companyName(row);
  const used = pcsUsed(row);
  const country = countryOf(row);

  const approve = (p: Payment) => async (amount: string, reference: string) => {
    await approvePayment(p.id, reference, amount);
    const fresh = await getSubscriber(row.id);
    onUpdated(fresh);
    setChecks((c) => ({ ...c, [p.id]: EMPTY_CHECK }));
    setLocalEmails((n) => n + 1);
    refreshBadges();
    const inv = fresh.payments.find((x) => x.id === p.id)?.invoice_number;
    const until = fresh.subscription?.ends_at ? ` until ${dLong(fresh.subscription.ends_at)}` : "";
    toast(`Approved. ${co} is on ${fresh.plan?.name ?? p.plan.name}${until}.${inv ? ` Invoice ${inv} emailed.` : " The owner was emailed."}`);
  };

  const reject = (p: Payment) => async (reason: string) => {
    await rejectPayment(p.id, reason);
    onUpdated(await getSubscriber(row.id));
    setLocalEmails((n) => n + 1);
    refreshBadges();
    toast(`Payment rejected. ${row.full_name || row.email} was emailed the reason.`);
  };

  const tabs: { key: DrawerTab; label: string; badge?: string; warn?: boolean }[] = [
    { key: "overview", label: "Overview" },
    { key: "payments", label: "Payments", badge: pend.length ? `${pend.length} to check` : undefined, warn: true },
    { key: "remarks", label: "Remarks", badge: row.remark ? "1" : undefined },
    { key: "emails", label: "Emails", badge: emails ? (emails.length ? String(emails.length) : undefined) : row.emails.total ? String(row.emails.total) : undefined },
    { key: "actions", label: "Actions" },
  ];

  const line = [
    row.plan ? row.plan.name : "No plan",
    row.plan ? `${used.used} of ${used.limit} PCs` : `${used.used} PCs`,
    [row.company?.city, country.name].filter(Boolean).join(", "),
  ].join(" · ");

  const head = (
    <>
      <div className="sb-dh">
        <span className="sb-dh__tile" aria-hidden="true">
          {initials(co)}
        </span>
        <div className="sb-dh__text">
          <div className="sb-dh__row">
            <h2 id={headId}>{co}</h2>
            <span className={`pill ${chip.tone}`}>
              <span className="dot" />
              {chip.label}
            </span>
          </div>
          <span className="k sb-dh__line">{line}</span>
        </div>
        <button type="button" className="btn sm sb-dh__close" aria-label="Close customer details" onClick={onClose}>
          <Icon name="close" strokeWidth={2} />
        </button>
      </div>
      <div role="tablist" aria-label="Customer sections" className="sb-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={"tab" + (tab === t.key ? " on" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.badge ? <span className={"pill num " + (t.key === "payments" ? "warn" : "sb-pill-n")}>{t.badge}</span> : null}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <Drawer labelledBy={headId} onClose={onClose} head={head}>
      {isBlocked(row) ? (
        <p className="sb-blocked" role="status">
          <b>Blocked.</b>{" "}
          {row.blocked
            ? `${dateTime(row.blocked.at)}${row.blocked.by ? ` by ${row.blocked.by}` : ""}: ${row.blocked.reason}${row.blocked.emailed ? " (the customer was emailed)" : " (not emailed)"}`
            : "They can’t sign in."}
        </p>
      ) : null}

      {tab === "overview" ? <Overview row={row} onTab={setTab} onEmail={() => onEmail()} /> : null}

      {tab === "payments" ? (
        <div className="sb-col">
          {pend.map((p) => (
            <PendingPayment
              key={p.id}
              payment={p}
              row={row}
              check={checks[p.id] ?? EMPTY_CHECK}
              onCheck={(c) => setChecks((all) => ({ ...all, [p.id]: c }))}
              onApprove={approve(p)}
              onReject={reject(p)}
              onAskRest={() => onEmail("payment_details_needed")}
            />
          ))}
          <History row={row} />
        </div>
      ) : null}

      {tab === "remarks" ? <Remarks row={row} onUpdated={onUpdated} /> : null}

      {tab === "emails" ? (
        <div className="sb-col">
          <div className="sb-sechead">
            <span className="k">Every email Zinwe sent them, newest first. Codes are hidden.</span>
            <button type="button" className="btn sm dark" onClick={() => onEmail()}>
              <Icon name="mail" />
              Send email
            </button>
          </div>
          <SentEmails emails={emails} />
        </div>
      ) : null}

      {tab === "actions" ? (
        <Actions
          row={row}
          plans={plans}
          onUpdated={onUpdated}
          onDeleted={(id) => {
            onDeleted(id);
            onClose();
          }}
        />
      ) : null}
    </Drawer>
  );
}

// --- Overview -------------------------------------------------------------------------------

function Kv({ k, v, cls }: { k: string; v: string; cls?: string }): ReactElement {
  return (
    <div className="sb-kv">
      <dt className="k">{k}</dt>
      <dd className={cls}>{v}</dd>
    </div>
  );
}

function Overview({ row, onTab, onEmail }: { row: Subscriber; onTab: (t: DrawerTab) => void; onEmail: () => void }): ReactElement {
  const c = row.company;
  const sub = row.subscription;
  const used = pcsUsed(row);
  const country = countryOf(row);
  const members = row.team.members;
  const withPcs = members.filter((m) => m.devices > 0);
  const accepted = withPcs.filter((m) => m.consent?.at).length;
  const waiting = withPcs.length - accepted;
  const paid = sub && Number(sub.amount_inr) > 0;
  const planKv: { k: string; v: string }[] = row.plan
    ? [
        { k: "Plan", v: row.plan.name },
        { k: "PC limit", v: `${row.plan.max_devices} PCs` },
        { k: "History", v: PLAN_HISTORY[row.plan.code] ?? "—" },
        { k: sub?.is_trial ? "Trial ends" : "Paid until", v: sub?.ends_at ? dLong(sub.ends_at) : "No end date" },
        { k: "Price", v: paid ? `${money(sub.amount_inr, country.abroad ? "USD" : "INR")} before tax` : "Free" },
      ]
    : [];

  return (
    <div className="sb-col">
      <div className="sb-grid2">
        <section className="sb-sec" aria-label="Company">
          <h3 className="k sb-h">Company</h3>
          <dl className="sb-dl">
            <Kv k="Name" v={c?.name || "Not registered yet"} cls="sb-strong" />
            {c ? <Kv k="Industry" v={industry(c.industry)} /> : null}
            {c ? <Kv k="Team size" v={`${c.team_size} people`} /> : null}
            <Kv k="Location" v={[c?.city, c?.state, country.name].filter(Boolean).join(", ") || "—"} />
            <Kv k="Joined" v={dLong(row.date_joined)} />
          </dl>
        </section>
        <section className="sb-sec" aria-label="Owner">
          <h3 className="k sb-h">Owner</h3>
          <b>{row.full_name || "Unnamed"}</b>
          <a href={`mailto:${row.email}`} className="sb-mail">
            {row.email}
          </a>
          <span className="k">{row.email_verified ? "Email confirmed" : "Email not confirmed yet"}</span>
          <div>
            <button type="button" className="btn sm" onClick={onEmail}>
              <Icon name="mail" />
              Send email
            </button>
          </div>
        </section>
      </div>

      <section className="sb-sec" aria-label="Plan">
        <div className="sb-sechead">
          <h3 className="k sb-h">Plan</h3>
          <button type="button" className="btn sm" onClick={() => onTab("actions")}>
            Extend or change
          </button>
        </div>
        {row.plan ? (
          <div className="sb-plankv">
            {planKv.map((x) => (
              <div key={x.k}>
                <span className="k">{x.k}</span>
                <b className="num">{x.v}</b>
              </div>
            ))}
          </div>
        ) : (
          <span className="sb-mute">No plan chosen yet.</span>
        )}
        {row.billing.cycles_paid > 0 ? (
          <span className="k">
            {row.billing.cycles_paid} cycle{row.billing.cycles_paid === 1 ? "" : "s"} paid ·{" "}
            {money(row.billing.total_paid_inr, "INR")} in total
          </span>
        ) : null}
      </section>

      <section className="sb-sec" aria-label="PCs">
        <div className="sb-sechead">
          <h3 className="k sb-h">
            PCs · {used.used}
            {used.limit ? ` of ${used.limit}` : ""} used
          </h3>
          <span className="k">
            {members.length} member{members.length === 1 ? "" : "s"}
          </span>
        </div>
        {members.length === 0 ? (
          <span className="sb-mute">
            No PCs connected yet. The owner adds people in Team &amp; devices; each gets a Member ID for their PC.
          </span>
        ) : (
          <div className="sb-pcs">
            {members.map((m) => (
              <div key={m.id} className={"sb-pcs__row" + (m.is_active ? "" : " is-off")}>
                <span className="mono sb-pcs__code">{m.member_code}</span>
                <span className="sb-pcs__who">
                  {m.name}
                  <a href={`mailto:${m.email}`} className="k">
                    {m.email}
                  </a>
                </span>
                <span className="num">
                  {m.devices} PC{m.devices === 1 ? "" : "s"}
                </span>
                <span>
                  {!m.is_active ? (
                    <span className="pill muted">Removed</span>
                  ) : m.devices === 0 ? (
                    <span className="k">No PC yet</span>
                  ) : m.consent?.at ? (
                    <span className="k">Consent {dShort(m.consent.at)}</span>
                  ) : (
                    <span className="pill warn">No consent yet</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="sb-grid2">
        <section className="sb-sec" aria-label="Monitoring consent">
          <h3 className="k sb-h">Monitoring consent from employees</h3>
          <div className="sb-consent">
            <div>
              <b className="num">{accepted}</b>
              <span className="k">Accepted</span>
            </div>
            <div>
              <b className="num">{waiting}</b>
              <span className="k">Waiting</span>
            </div>
            <div>
              <b className="num">{members.length - withPcs.length}</b>
              <span className="k">No PC yet</span>
            </div>
          </div>
        </section>
        <section className="sb-sec" aria-label="Sign-up">
          <h3 className="k sb-h">Sign-up</h3>
          <dl className="sb-dl">
            <Kv k="Signed up" v={dLong(row.date_joined)} />
            <Kv k="Terms" v={row.terms?.accepted_at ? `Accepted ${dLong(row.terms.accepted_at)} · v${row.terms.version}` : "Not recorded"} />
            <Kv k="Last seen" v={ago(row.last_login)} />
          </dl>
        </section>
      </div>
    </div>
  );
}

// --- Payments history -------------------------------------------------------------------------

const ST: Record<string, { label: string; tone: string }> = {
  verified: { label: "Approved", tone: "good" },
  rejected: { label: "Rejected", tone: "bad" },
};

function History({ row }: { row: Subscriber }): ReactElement {
  const toast = useToast();
  const list = row.payments.filter((p) => p.status !== "submitted");
  const paidTotal = Number(row.billing.total_paid_inr);
  const openInvoice = async (p: Payment) => {
    if (!p.invoice_number) return;
    try {
      await downloadInvoicePdf(p.id, p.invoice_number);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn’t open the invoice.", "bad");
    }
  };
  return (
    <section aria-label="Payment history" className="sb-col sb-col--tight">
      <div className="sb-sechead">
        <h3 className="sb-h2">History</h3>
        <span className="k num">{paidTotal > 0 ? `Paid so far ${money(paidTotal, "INR")}` : ""}</span>
      </div>
      {list.length === 0 ? (
        <p className="sb-nohist">No payments yet.</p>
      ) : (
        <ul className="sb-hist">
          {list.map((p) => (
            <li key={p.id}>
              <span className="sb-hist__l">
                <b>
                  {p.plan.name}
                  {p.cycle ? ` · cycle ${p.cycle}` : ""}{" "}
                  <span className="k num" style={{ fontWeight: 400 }}>
                    · paid {dLong(p.paid_on)}
                  </span>
                </b>
                <span className="k">
                  {methodLabel(p.method)}
                  {p.staff_reference || p.reference ? (
                    <>
                      {" · "}
                      <span className="mono">{p.staff_reference || p.reference}</span>
                    </>
                  ) : null}
                  {p.covers_from ? ` · ${period(p.covers_from, p.covers_until)}` : ""}
                </span>
                {p.rejection_reason ? <span className="sb-hist__reason">Reason sent: {p.rejection_reason}</span> : null}
                {p.staff_amount && Math.abs(Number(p.staff_amount) - Number(p.due_total ?? p.amount_inr)) > 0.005 ? (
                  <span className="sb-hist__due">Receipt showed {money(p.staff_amount, cur(p))}</span>
                ) : null}
                {p.duplicate_of ? (
                  <span className="sb-hist__due">
                    Same {p.duplicate_of.match === "receipt" ? "receipt" : "UTR"} as #{p.duplicate_of.id}
                  </span>
                ) : null}
                {p.reviewed_at ? (
                  <span className="k">
                    {p.status === "verified" ? "Approved" : "Rejected"} {dLong(p.reviewed_at)}
                    {p.reviewed_by ? ` · ${p.reviewed_by}` : ""}
                  </span>
                ) : null}
              </span>
              <span className="sb-hist__r">
                <span className="sb-hist__amt">
                  <b className="num">{money(p.due_total ?? p.amount_inr, cur(p))}</b>
                  <span className={`pill ${ST[p.status]?.tone ?? "muted"}`}>{ST[p.status]?.label ?? p.status}</span>
                </span>
                {p.invoice_number ? (
                  <button
                    type="button"
                    className="mono sb-inv"
                    aria-label={`Open invoice ${p.invoice_number}`}
                    onClick={() => void openInvoice(p)}
                  >
                    {p.invoice_number}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <span className="k sb-sample-line">
        Refunds from a payment come with the refunds API. <SampleTag what="Not in the API yet" />
      </span>
    </section>
  );
}

// --- Remarks --------------------------------------------------------------------------------

/**
 * The team's internal note on a customer (the API keeps one per customer). Never shown to the customer; set apart
 * from the customer-facing payment reason (j3).
 */
function Remarks({ row, onUpdated }: { row: Subscriber; onUpdated: (row: Subscriber) => void }): ReactElement {
  const toast = useToast();
  const saved = row.remark?.text ?? "";
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  const has = Boolean(row.remark);
  const dirty = text.trim() !== saved.trim();

  const save = async (value: string) => {
    setBusy(true);
    try {
      const fresh = await setRemark(row.id, value);
      onUpdated(fresh);
      setText(fresh.remark?.text ?? "");
      toast(value.trim() ? `Remark saved on ${companyName(row)}.` : "Remark removed.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn’t save the remark.", "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sb-col sb-col--remarks">
      <div className="sb-col sb-col--tight">
        <label className="sb-fl" htmlFor={`rmk-${row.id}`}>
          <span>
            {has ? "Edit the remark" : "Add a remark"}{" "}
            <span className="k" style={{ fontWeight: 400 }}>
              Only Zinwe staff see remarks.
            </span>
          </span>
        </label>
        <textarea
          id={`rmk-${row.id}`}
          className="sb-txt"
          maxLength={2000}
          placeholder="e.g. Called on 28 Oct, wants a demo for 20 PCs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && dirty) void save(text);
          }}
        />
        <div className="sb-row-end">
          <span className="k">Ctrl+Enter to save · {text.length}/2000</span>
          {dirty && has ? (
            <button type="button" className="btn" disabled={busy} onClick={() => setText(saved)}>
              Undo
            </button>
          ) : null}
          <button type="button" className="btn dark" disabled={busy || !dirty || (!has && !text.trim())} onClick={() => void save(text)}>
            {busy ? "Saving…" : has ? "Save remark" : "Add remark"}
          </button>
        </div>
      </div>
      {!row.remark ? (
        <p className="sb-mute">No remarks yet.</p>
      ) : (
        <ol className="sb-remarks">
          <li className="sb-sec">
            <div className="sb-sechead">
              <b>{row.remark.updated_by ?? "Zinwe staff"}</b>
              <span className="k">{dateTime(row.remark.updated_at)}</span>
            </div>
            <span className="sb-remark-text">{row.remark.text}</span>
            <div>
              <button type="button" className="sb-lnk" disabled={busy} onClick={() => void save("")}>
                Remove
              </button>
            </div>
          </li>
        </ol>
      )}
    </div>
  );
}

function SentEmails({ emails }: { emails: SentEmail[] | null }): ReactElement {
  if (emails === null) {
    return (
      <div className="sb-col sb-col--tight" role="status" aria-label="Loading emails">
        <span className="shimmer" style={{ height: 40 }} />
        <span className="shimmer" style={{ height: 40 }} />
      </div>
    );
  }
  if (!emails.length) return <p className="sb-nohist">No emails sent to this customer yet.</p>;
  return (
    <ul className="sb-mails">
      {emails.map((m) => (
        <li key={m.id}>
          <details>
            <summary>
              <span className="sb-mails__subject">{m.subject || EMAIL_KIND[m.template] || m.template}</span>
              <span className={"pill " + (m.automatic ? "muted" : "info")}>
                {m.automatic ? (EMAIL_KIND[m.template] ?? "Automatic") : "From the team"}
              </span>
              <span className="k">{dateTime(m.sent_at ?? m.created_at)}</span>
              {m.status !== "sent" ? <span className="pill bad">Not sent</span> : null}
            </summary>
            <pre className="sb-mails__body">{m.body}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}

// --- Actions --------------------------------------------------------------------------------

function Actions({
  row,
  plans,
  onUpdated,
  onDeleted,
}: {
  row: Subscriber;
  plans: PlanSummary[];
  onUpdated: (row: Subscriber) => void;
  onDeleted: (id: number) => void;
}): ReactElement {
  const toast = useToast();
  const [newPlan, setNewPlan] = useState(row.plan?.code ?? "");
  const [mailPlan, setMailPlan] = useState(true);
  const [askPlan, setAskPlan] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [delText, setDelText] = useState("");
  const [extDays, setExtDays] = useState("14");
  const co = companyName(row);
  const blocked = isBlocked(row);
  const pend = pendingPayments(row);
  const target = plans.find((p) => p.code === newPlan) ?? null;
  const used = row.team.devices;
  const approved = row.payments.filter((p) => p.status === "verified");
  const invoices = approved.map((p) => p.invoice_number).filter((n): n is string => Boolean(n));
  // An older backend doesn't send invoice numbers: approved payments always have an invoice, so treat them as such.
  const hasTaxRecords = invoices.length > 0 || (approved.length > 0 && approved.every((p) => p.invoice_number === undefined));
  const delOk = delText.trim() === co && pend.length === 0 && !hasTaxRecords;
  const free = !row.subscription || Number(row.subscription.amount_inr) <= 0;

  const unblock = async () => {
    setBusy(true);
    try {
      onUpdated(await unblockSubscriber(row.id));
      toast(`${row.email} can sign in again.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn’t do that.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await deleteSubscriber(row.id);
      toast(`${co} deleted.`);
      onDeleted(row.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn’t delete the customer.", "bad");
      setBusy(false);
    }
  };

  return (
    <div className="sb-col sb-col--actions">
      <section className="sb-sec" aria-labelledby="a-signin">
        <h3 id="a-signin" className="sb-h2">
          Sign-in help
        </h3>
        <PasswordReset row={row} onUpdated={onUpdated} />
        <div className="sb-arow sb-arow--rule">
          <span className="sb-arow__text">
            {row.email_verified
              ? "Email confirmed. Resend only if they changed their address or lost the first email."
              : "Email not confirmed yet. The link in the confirmation email works for 24 hours."}
          </span>
          <button type="button" className="btn" disabled title="Comes with the API (auth day)">
            Resend confirmation email
          </button>
        </div>
      </section>

      <section className="sb-sec" aria-labelledby="a-ext">
        <div className="sb-sechead">
          <h3 id="a-ext" className="sb-h2">
            Extend plan
          </h3>
          <SampleTag what="Not in the API yet" />
        </div>
        {free ? (
          <span className="sb-mute">Free forever has no end date. Change the plan first if you want to give paid days.</span>
        ) : (
          <div className="sb-col sb-col--tight">
            <span className="sb-mute">
              Adds free days to {row.plan?.name}. No invoice is made. Now paid until{" "}
              <b className="sb-ink">{dLong(row.subscription?.ends_at)}</b>.
            </span>
            <div className="sb-ext">
              <label className="sb-fl" style={{ width: 110 }}>
                Days
                <input
                  className="inp num"
                  type="number"
                  min={1}
                  max={365}
                  value={extDays}
                  onChange={(e) => setExtDays(e.target.value)}
                  disabled
                />
              </label>
              <div className="seg" role="group" aria-label="Quick days">
                {[7, 14, 30].map((n) => (
                  <button key={n} type="button" className={String(n) === extDays ? "on" : ""} aria-pressed={String(n) === extDays} disabled>
                    {n} days
                  </button>
                ))}
              </div>
            </div>
            <div className="sb-row-end">
              <span className="k">Until the extend endpoint exists, use Change plan or ask a developer.</span>
              <button type="button" className="btn dark" disabled>
                Extend
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="sb-sec" aria-labelledby="a-plan">
        <h3 id="a-plan" className="sb-h2">
          Change plan
        </h3>
        <span className="sb-mute">Takes effect now. The next payment uses the new plan’s price.</span>
        <div className="sb-ext">
          <label className="sb-fl" style={{ flex: "1 1 220px" }}>
            New plan
            <select
              className="inp"
              value={newPlan}
              disabled={plans.length === 0}
              onChange={(e) => setNewPlan(e.target.value)}
            >
              {!row.plan ? <option value="">No plan</option> : null}
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} · {p.max_devices} PCs{PLAN_HISTORY[p.code] ? ` · ${PLAN_HISTORY[p.code]}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn dark" disabled={!target || newPlan === row.plan?.code} onClick={() => setAskPlan(true)}>
            Change plan…
          </button>
        </div>
        <label className="sb-check">
          <input type="checkbox" checked={mailPlan} onChange={() => setMailPlan((v) => !v)} /> Email the owner about the
          change
        </label>
        {target && newPlan !== row.plan?.code && target.max_devices < used ? (
          <span className="sb-warnbox">
            {used} PCs are connected but {target.name} allows {target.max_devices}. They keep working, but the owner
            can’t add new ones until they’re under the limit.
          </span>
        ) : null}
      </section>

      <section className="sb-sec" aria-labelledby="a-block">
        <h3 id="a-block" className="sb-h2">
          {blocked ? "Blocked" : "Block account"}
        </h3>
        <div className="sb-arow">
          <span className="sb-arow__text">
            {blocked
              ? "They can’t sign in. Unblocking lets them sign in again; nothing else changes."
              : row.is_active
                ? "Signs them out everywhere and stops sign-in. Their PCs and data stay as they are."
                : "The sign-up was never finished, so there is nothing to block."}
          </span>
          {blocked ? (
            <button type="button" className="btn dark" disabled={busy} onClick={() => void unblock()}>
              Unblock
            </button>
          ) : row.is_active ? (
            <button type="button" className="btn" onClick={() => setBlocking(true)}>
              Block…
            </button>
          ) : null}
        </div>
      </section>

      <section className="sb-sec sb-sec--danger" aria-labelledby="a-del">
        <h3 id="a-del" className="sb-h2 sb-h2--bad">
          Delete customer
        </h3>
        <span className="sb-mute">
          Removes the company, its {used} PCs, their alerts and activity history, and signs everyone out. It can’t be
          undone.{" "}
          {hasTaxRecords
            ? `Tax invoices ${invoices.join(", ") || "on the approved payments"} are kept for 8 years, as GST law needs, so this account can’t be deleted: block it instead.`
            : "There are no invoices to keep."}
        </span>
        {pend.length ? (
          <span className="sb-warnbox">A payment is still waiting for you to check. Approve or reject it first.</span>
        ) : null}
        {!hasTaxRecords ? (
          <>
            <label className="sb-fl">
              <span>
                Type <span className="mono sb-ink">{co}</span> to confirm
              </span>
              <input className="inp" autoComplete="off" value={delText} onChange={(e) => setDelText(e.target.value)} />
            </label>
            <div className="sb-arow">
              <span className="k">Blocking is usually enough: it stops sign-in and keeps the history.</span>
              <button type="button" className="btn danger-fill" disabled={!delOk || busy} onClick={() => void doDelete()}>
                Delete customer
              </button>
            </div>
          </>
        ) : null}
      </section>

      {askPlan && target ? (
        <PlanConfirm
          plan={target}
          row={row}
          plans={plans}
          email={mailPlan}
          onUpdated={onUpdated}
          onClose={() => setAskPlan(false)}
        />
      ) : null}
      {blocking ? <BlockConfirm row={row} onUpdated={onUpdated} onClose={() => setBlocking(false)} /> : null}
    </div>
  );
}
