import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ApiError,
  getSupportTicket,
  getSupportTickets,
  replySupportTicket,
  setSupportStatus,
  type SupportStatus,
  type SupportTicketDetail,
  type SupportTicketRow,
} from "../lib/api";
import { dateTime, relativeDay } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";

const FILTERS: { key: SupportStatus | "all"; label: string }[] = [
  { key: "open", label: "Waiting for us" },
  { key: "answered", label: "Answered" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const STATUS: Record<SupportStatus, { label: string; tone: string }> = {
  open: { label: "Waiting for us", tone: "warn" },
  answered: { label: "Answered", tone: "good" },
  closed: { label: "Closed", tone: "muted" },
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
            <span className="stat__label">Closed</span>
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
                    {t.customer.company || t.customer.full_name || t.customer.email}
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

  const send = async (close: boolean) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setData(await replySupportTicket(id, text.trim(), close));
      setText("");
      toast(close ? "Reply sent and conversation closed." : "Reply sent. The customer was emailed.");
      onChanged();
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
      onChanged();
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
    <section className="card sup-pane" aria-label={`Conversation: ${t.subject}`}>
      <header className="sup-pane__head">
        <div>
          <h2 className="card__title">{t.subject}</h2>
          <p className="muted">
            {t.customer.full_name || t.customer.email} · <a href={`mailto:${t.customer.email}`}>{t.customer.email}</a>
            {t.customer.company ? ` · ${t.customer.company}` : ""}
          </p>
          <p className="muted">
            {CATEGORY[t.category]} · opened {dateTime(t.created_at)}
            {t.page ? ` · from ${t.page}` : ""}
          </p>
        </div>
        <div className="sup-pane__actions">
          <span className={`pill pill--${STATUS[t.status].tone}`}>{STATUS[t.status].label}</span>
          {t.status === "closed" ? (
            <button type="button" className="btn btn--ghost" onClick={() => void changeStatus("open")} disabled={busy}>
              Reopen
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={() => void changeStatus("closed")} disabled={busy}>
              Close
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose} aria-label="Close this conversation view">
            ✕
          </button>
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
          <button type="button" className="btn btn--ghost" onClick={() => void send(true)} disabled={busy || !text.trim()}>
            Send & close
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !text.trim()}>
            {busy ? "Sending…" : "Send reply"}
          </button>
        </div>
      </form>
    </section>
  );
}
