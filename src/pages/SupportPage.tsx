import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ApiError,
  getSubscriber,
  getSupportTicket,
  getSupportTickets,
  isBlocked,
  replySupportTicket,
  setSupportStatus,
  type Subscriber,
  type SupportStatus,
  type SupportTicketDetail,
  type SupportTicketRow,
} from "../lib/api";
import { refreshBadges } from "../lib/badges";
import { date, dateTime, money, paymentTone, relativeDay } from "../lib/format";
import { pageName } from "../lib/pages";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";

/** The customer behind a conversation (plan, payment), loaded once per ticket; null while loading or if it fails. */
function useCustomer(id: number | null): Subscriber | null | "error" {
  const [row, setRow] = useState<Subscriber | null | "error">(null);
  useEffect(() => {
    if (id === null) return;
    let alive = true;
    getSubscriber(id)
      .then((r) => {
        if (alive) setRow(r);
      })
      .catch(() => {
        if (alive) setRow("error");
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return row;
}

const PAY_WORD: Record<string, string> = { submitted: "Payment waiting", verified: "Paid", rejected: "Payment rejected" };

/** J8-10: plan + payment at a glance, and a way to the customer, so billing questions need no search. */
function CustomerContext({ customer, customerId }: { customer: Subscriber | null | "error"; customerId: number }): ReactElement {
  const link = (
    <Link className="btn btn--ghost btn--sm" to={`/subscribers?open=${customerId}`}>
      Open customer
    </Link>
  );
  if (customer === "error") return <div className="sup-ctx">{link}</div>;
  if (customer === null) return <div className="sup-ctx muted">Loading the customer…</div>;
  const pay = customer.payment ?? customer.payments[0] ?? null;
  const sub = customer.subscription;
  return (
    <div className="sup-ctx">
      {isBlocked(customer) ? <span className="pill pill--bad">Blocked</span> : null}
      <span className="sup-ctx__plan">
        <b>{customer.plan?.name ?? "No plan"}</b>
        {sub?.status === "active" && sub.ends_at ? ` · until ${date(sub.ends_at)}` : ""}
        {sub?.status === "pending_payment" ? " · not active yet" : ""}
        {sub?.status === "expired" ? " · ended" : ""}
      </span>
      {pay ? (
        <span className={`pill pill--${paymentTone(pay.status)}`}>
          {PAY_WORD[pay.status] ?? pay.status} · {money(pay.due_total ?? pay.amount_inr, pay.currency ?? "INR")} ·{" "}
          {pay.plan.name}
        </span>
      ) : (
        <span className="pill pill--muted">No payments</span>
      )}
      {link}
    </div>
  );
}

const FILTERS: { key: SupportStatus | "all"; label: string }[] = [
  { key: "open", label: "Waiting for us" },
  { key: "answered", label: "Answered" },
  { key: "closed", label: "Resolved" },
  { key: "all", label: "All" },
];

const STATUS: Record<SupportStatus, { label: string; tone: string }> = {
  open: { label: "Waiting for us", tone: "warn" },
  answered: { label: "Answered", tone: "good" },
  closed: { label: "Resolved", tone: "muted" },
};

const CATEGORY: Record<SupportTicketRow["category"], string> = {
  question: "Question",
  problem: "Not working",
  billing: "Billing",
  setup: "Setting up PCs",
  idea: "Idea",
};

/**
 * Support inbox: conversations customers start from their dashboard's Support
 * chat. Replies are emailed to the customer and appear in their dashboard.
 * `?ticket=<id>` (the link in the team email) opens one directly.
 */
export function SupportPage(): ReactElement {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<SupportStatus | "all">("open");
  const load = useCallback(() => getSupportTickets(filter === "all" ? undefined : filter), [filter]);
  const { data, error, pending, reload } = useLoad(load);

  const selectedId = Number(params.get("ticket")) || null;
  const select = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("ticket", String(id));
    else next.delete("ticket");
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Support"
        subtitle="Questions and problems customers send from their dashboard. Replies are emailed to them."
        onReload={reload}
        pending={pending}
      />

      {data ? (
        <div className="stats">
          <div className="stat">
            <span className="stat__label">Waiting for us</span>
            <span className={"stat__value" + (data.counts.open > 0 ? " tone-warn" : "")}>{data.counts.open}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Answered</span>
            <span className="stat__value tone-good">{data.counts.answered}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Resolved</span>
            <span className="stat__value">{data.counts.closed}</span>
          </div>
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Filter conversations">
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
            {data && f.key !== "all" && data.counts[f.key] > 0 ? ` (${data.counts[f.key]})` : ""}
          </button>
        ))}
      </div>

      {error ? (
        <p className="alert alert--bad">{error}</p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="sup-layout">
          <div className="card sup-list" aria-label="Conversations">
            {data.rows.length === 0 ? (
              <div className="empty">
                <b>Nothing here</b>
                <span className="muted">
                  {filter === "open" ? "No one is waiting for an answer." : "No conversations in this view."}
                </span>
              </div>
            ) : (
              data.rows.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={"sup-row" + (t.id === selectedId ? " is-active" : "") + (t.unread > 0 ? " is-unread" : "")}
                  onClick={() => select(t.id)}
                >
                  <span className="sup-row__top">
                    <b>{t.subject}</b>
                    {t.unread > 0 ? <span className="sup-dot" aria-label={`${t.unread} unread`}>{t.unread}</span> : null}
                  </span>
                  <span className="sup-row__who">
                    {t.customer.company ? <b>{t.customer.company}</b> : null}
                    <span className="sup-row__person">
                      {t.customer.full_name ? `${t.customer.full_name} · ` : ""}
                      {t.customer.email}
                    </span>
                  </span>
                  <span className="sup-row__meta">
                    <span className={`pill pill--${STATUS[t.status].tone}`}>{STATUS[t.status].label}</span>
                    <span className="muted">{CATEGORY[t.category]}</span>
                    <span className="muted">· {relativeDay(t.updated_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>

          {selectedId ? (
            <TicketPane key={selectedId} id={selectedId} onChanged={reload} onClose={() => select(null)} />
          ) : (
            <div className="card sup-pane sup-pane--empty">
              <span className="muted">Pick a conversation to read and reply.</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function TicketPane({ id, onChanged, onClose }: { id: number; onChanged: () => void; onClose: () => void }): ReactElement {
  const toast = useToast();
  // Opening it marks the customer's messages read: refresh the list's unread dots after each load.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
  const load = useCallback(async () => {
    const detail = await getSupportTicket(id);
    changed.current();
    return detail;
  }, [id]);
  const { data, error, setData } = useLoad(load);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const pane = useRef<HTMLElement>(null);
  const customerId = data?.customer.id ?? null;
  const customer = useCustomer(customerId);

  // On a phone the conversation opens below the list: bring it into view (J8-08).
  const loaded = data !== undefined;
  useEffect(() => {
    if (loaded && window.matchMedia("(max-width: 900px)").matches) {
      pane.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loaded]);

  const send = async (resolve: boolean) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setData(await replySupportTicket(id, text.trim(), resolve));
      setText("");
      toast(resolve ? "Reply sent and marked resolved. The customer was emailed." : "Reply sent. The customer was emailed.");
      onChanged();
      refreshBadges();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't send the reply.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: SupportStatus) => {
    setBusy(true);
    try {
      setData(await setSupportStatus(id, status));
      toast(status === "closed" ? "Marked resolved." : "Reopened: it's waiting for us again.");
      onChanged();
      refreshBadges();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't update it.", "bad");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="card sup-pane"><p className="alert alert--bad">{error}</p></div>;
  if (!data) return <div className="card sup-pane"><p className="muted">Loading…</p></div>;
  const t: SupportTicketDetail = data;

  return (
    <section ref={pane} className="card sup-pane" aria-label={`Conversation: ${t.subject}`}>
      <header className="sup-pane__head">
        <div className="sup-pane__who">
          <button type="button" className="link-btn sup-pane__back" onClick={onClose}>
            ← All conversations
          </button>
          <h2 className="card__title">{t.subject}</h2>
          <p className="muted">
            {t.customer.full_name || t.customer.email} · <a href={`mailto:${t.customer.email}`}>{t.customer.email}</a>
            {t.customer.company ? ` · ${t.customer.company}` : ""}
          </p>
          <p className="muted">
            {CATEGORY[t.category]} · opened {dateTime(t.created_at)}
            {t.page ? ` · from ${pageName(t.page)}` : ""}
          </p>
          <CustomerContext customer={customer} customerId={t.customer.id} />
        </div>
        <div className="sup-pane__actions">
          <span className={`pill pill--${STATUS[t.status].tone}`}>{STATUS[t.status].label}</span>
          {t.status === "closed" ? (
            <button type="button" className="btn btn--ghost" onClick={() => void changeStatus("open")} disabled={busy}>
              Reopen
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={() => void changeStatus("closed")} disabled={busy}>
              Mark resolved
            </button>
          )}
        </div>
      </header>

      <div className="sup-thread" role="log">
        {t.messages.map((m) => (
          <div key={m.id} className={"sup-msg sup-msg--" + (m.sender === "staff" ? "out" : "in")}>
            <span className="sup-msg__body">{m.body}</span>
            <small className="muted">
              {m.sender === "staff" ? "Zinwe team" : m.author_name} · {dateTime(m.created_at)}
            </small>
          </div>
        ))}
      </div>

      <form
        className="sup-reply"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void send(false);
        }}
      >
        <textarea
          rows={4}
          maxLength={4000}
          placeholder={`Reply to ${t.customer.full_name || t.customer.email}… (they'll get it by email)`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="sup-reply__actions">
          <small className="muted sup-reply__hint">“Resolve” moves it to Resolved; the customer can still write again.</small>
          <button type="button" className="btn btn--ghost" onClick={() => void send(true)} disabled={busy || !text.trim()}>
            Send &amp; resolve
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !text.trim()}>
            {busy ? "Sending…" : "Send reply"}
          </button>
        </div>
      </form>
    </section>
  );
}
