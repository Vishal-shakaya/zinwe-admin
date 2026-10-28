import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ApiError,
  getMe,
  getSubscriber,
  getSubscribers,
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
import { date, money } from "../lib/format";
import { pageName } from "../lib/pages";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";
import { ErrorState, LoadingState, SampleTag } from "../components/States";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import {
  addNote,
  FIRST_REPLY_MEDIAN,
  getAssignees,
  getNotes,
  SAVED_REPLIES,
  setAssignee as saveAssignee,
  SUPPORT_TEAM,
  type LocalNote,
} from "../content/fixtures/support";
import { age, dayTime, daysAgo, firstName } from "./inbox/format";
import "../styles/support.css";

const STATUS: Record<SupportStatus, { label: string; cls: string }> = {
  open: { label: "Waiting for us", cls: "zsp-st--open" },
  answered: { label: "Waiting for customer", cls: "zsp-st--answered" },
  closed: { label: "Closed", cls: "zsp-st--closed" },
};

const FILTERS: { key: SupportStatus; label: string }[] = [
  { key: "open", label: "Waiting for us" },
  { key: "answered", label: "Waiting for customer" },
  { key: "closed", label: "Closed" },
];

const CATEGORY: Record<SupportTicketRow["category"], string> = {
  question: "Question",
  problem: "Not working",
  billing: "Billing",
  setup: "Setting up PCs",
  idea: "Idea",
};

const ME = "me";

type Who = "all" | "mine" | "none";

function companyOf(t: SupportTicketRow): string {
  return t.customer.company || t.customer.full_name || t.customer.email;
}

/** The customer behind a conversation (plan, PCs, payment), loaded once per ticket. */
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

/**
 * Support inbox (AdminSupport board): conversations customers start from their dashboard's Support chat.
 * Replies are emailed to the customer and appear in their chat. `?ticket=<id>` (the team email link) opens one.
 */
export function SupportPage(): ReactElement {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<SupportStatus>("open");
  const [q, setQ] = useState("");
  const [who, setWho] = useState<Who>("all");
  const [assignees, setAssignees] = useState<Record<string, string>>(getAssignees);
  // Every conversation once (search, counts and "closed this week" work on the whole list).
  const load = useCallback(() => getSupportTickets(), []);
  const { data, error, pending, reload } = useLoad(load);
  const [me, setMe] = useState<{ name: string; initials: string }>({ name: "You", initials: "ME" });
  const [plans, setPlans] = useState<Record<number, string>>({});

  useEffect(() => {
    let alive = true;
    getMe()
      .then((m) => {
        if (!alive) return;
        const name = m.full_name || m.email.replace(/@.*/, "");
        const parts = name.split(/\s+/);
        setMe({ name: parts[0], initials: (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? "")).toUpperCase() });
      })
      .catch(() => {});
    // Plans decide "Priority" (Businesses first). If this fails the list still works, unsorted by plan.
    getSubscribers()
      .then((rows) => {
        if (alive) setPlans(Object.fromEntries(rows.map((r) => [r.id, r.plan?.name ?? ""])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const selectedId = Number(params.get("ticket")) || null;
  const select = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("ticket", String(id));
    else next.delete("ticket");
    setParams(next, { replace: true });
  };

  const all = useMemo(() => data?.rows ?? [], [data]);
  const isPriority = (t: SupportTicketRow) => plans[t.customer.id] === "Businesses" && t.status !== "closed";
  const query = q.trim().toLowerCase();
  const rows = all
    .filter((t) => t.status === filter)
    .filter(
      (t) =>
        !query ||
        [t.customer.company, t.customer.full_name, t.customer.email, t.subject, t.last_message?.body ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query),
    )
    .filter((t) => {
      const a = assignees[String(t.id)] ?? "";
      return who === "all" || (who === "none" ? !a : a === ME);
    })
    .sort((a, b) => {
      if (filter === "open") {
        const p = Number(isPriority(b)) - Number(isPriority(a));
        return p || new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  const open = all.filter((t) => t.status === "open");
  const oldest = [...open].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  const closedWeek = all.filter((t) => t.status === "closed" && daysAgo(t.updated_at) < 7);
  const closedFirst = closedWeek.filter((t) => t.message_count <= 2).length;
  const counts = data?.counts ?? { open: 0, answered: 0, closed: 0 };

  let emptyTitle = "Nobody is waiting for an answer.";
  let emptySub = "New messages from the dashboard Support chat land here. The team also gets an email.";
  if (query) {
    emptyTitle = `No conversations match “${q.trim()}”.`;
    emptySub = "Try a company name, a person or a word from the message.";
  } else if (who !== "all") {
    emptyTitle = "Nothing here for this filter.";
    emptySub = "Switch to Anyone to see every conversation.";
  } else if (filter === "answered") {
    emptyTitle = "No one owes us a reply.";
    emptySub = "Conversations you answered wait here until the customer writes back.";
  } else if (filter === "closed") {
    emptyTitle = "No closed conversations yet.";
    emptySub = "";
  }

  const assign = (id: number, value: string) => setAssignees({ ...saveAssignee(id, value) });
  const teamName = (key: string) => (key === ME ? me.name : (SUPPORT_TEAM.find((s) => s.key === key)?.name ?? key));
  const teamIni = (key: string) => (key === ME ? me.initials : (SUPPORT_TEAM.find((s) => s.key === key)?.initials ?? "?"));

  return (
    <>
      <PageHeader
        title="Support"
        subtitle="Conversations customers start from the Support chat in their dashboard. Your reply is emailed to them and shows in their chat."
      >
        <span className="k">Times in IST · Businesses plan conversations come first</span>
      </PageHeader>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <>
          <section className="zsp-sum" aria-label="Summary">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card zsp-sum__card">
                <span className="shimmer" style={{ height: 12, width: "50%" }} />
                <span className="shimmer" style={{ height: 26, width: "30%", marginTop: 6 }} />
              </div>
            ))}
          </section>
          <LoadingState rows={6} label="Loading conversations…" />
        </>
      ) : (
        <>
          <section className="zsp-sum" aria-label="Summary">
            <div className="card zsp-sum__card">
              <span className="k zsp-sum__k">Waiting for us</span>
              <b className="num zsp-sum__v">{counts.open}</b>
              <span className="k">{oldest ? `Oldest: ${age(oldest.created_at)} · ${companyOf(oldest)}` : "Nobody waiting"}</span>
            </div>
            <div className="card zsp-sum__card">
              <span className="k zsp-sum__k">Waiting for customer</span>
              <b className="num zsp-sum__v">{counts.answered}</b>
              <span className="k">Reopen on their next message</span>
            </div>
            <div className="card zsp-sum__card">
              <span className="k zsp-sum__k">
                First reply, median <SampleTag />
              </span>
              <b className="num zsp-sum__v">{FIRST_REPLY_MEDIAN.value}</b>
              <span className="k">{FIRST_REPLY_MEDIAN.note}</span>
            </div>
            <div className="card zsp-sum__card">
              <span className="k zsp-sum__k">Closed this week</span>
              <b className="num zsp-sum__v">{closedWeek.length}</b>
              <span className="k">{closedFirst} on the first reply</span>
            </div>
          </section>

          <div className="zsp-layout">
            <section className="card zsp-list" aria-label="Conversations">
              <div className="zsp-list__tools">
                <div role="group" aria-label="Status" className="zsp-chips">
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className={"chip" + (filter === f.key ? " on" : "")}
                      aria-pressed={filter === f.key}
                      onClick={() => setFilter(f.key)}
                    >
                      {f.label}
                      <span className="num zsp-chip-n">{counts[f.key]}</span>
                    </button>
                  ))}
                </div>
                <div className="zsp-search">
                  <div className="zsp-search__q">
                    <label className="sr" htmlFor="sq">
                      Search conversations
                    </label>
                    <input
                      id="sq"
                      type="search"
                      className="inp"
                      placeholder="Search company, person or words"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>
                  <label className="sr" htmlFor="who">
                    Show conversations assigned to
                  </label>
                  <select id="who" className="inp zsp-who" value={who} onChange={(e) => setWho(e.target.value as Who)}>
                    <option value="all">Anyone</option>
                    <option value="mine">Mine</option>
                    <option value="none">Unassigned</option>
                  </select>
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="zsp-empty">
                  <span className="zsp-empty__icon" aria-hidden="true">
                    <Icon name="check" size={20} />
                  </span>
                  <b>{emptyTitle}</b>
                  {emptySub ? <span className="k zsp-empty__sub">{emptySub}</span> : null}
                  {query || who !== "all" ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setQ("");
                        setWho("all");
                      }}
                    >
                      Clear search and filters
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div role="list" className="zsp-rows">
                {rows.map((t) => {
                  const on = t.id === selectedId;
                  const a = assignees[String(t.id)] ?? "";
                  const unread = t.unread > 0;
                  return (
                    <div role="listitem" key={t.id}>
                      <button
                        type="button"
                        className={"zsp-tk" + (on ? " on" : "")}
                        aria-current={on ? "true" : undefined}
                        onClick={() => select(t.id)}
                      >
                        <span className="zsp-tk__top">
                          <span className="zsp-tk__co">
                            {unread ? (
                              <>
                                <span className="dot zsp-tk__unread" aria-hidden="true" />
                                <span className="sr">Unread.</span>
                              </>
                            ) : null}
                            <b className="clip zsp-tk__company">{companyOf(t)}</b>
                            {isPriority(t) ? <span className="pill zsp-tk__prio">Priority</span> : null}
                          </span>
                          <span className="k num zsp-tk__age">{age(t.created_at)}</span>
                        </span>
                        <span className={"clip zsp-tk__subj" + (unread ? " is-unread" : "")}>{t.subject}</span>
                        <span className="clip zsp-tk__first">{t.last_message?.body ?? ""}</span>
                        <span className="zsp-tk__foot">
                          <span className="k clip">Sent from {t.page ? pageName(t.page) : "Dashboard"}</span>
                          <span className={"zsp-av" + (a ? (a === ME ? " zsp-av--me" : " zsp-av--team") : " zsp-av--none")} aria-hidden="true">
                            {a ? teamIni(a) : ""}
                          </span>
                          <span className="sr">{a ? `Assigned to ${teamName(a)}.` : "Not assigned."}</span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {selectedId ? (
              <TicketPane
                key={selectedId}
                id={selectedId}
                me={me.name}
                assignee={assignees[String(selectedId)] ?? ""}
                onAssign={(v) => assign(selectedId, v)}
                teamName={teamName}
                onChanged={reload}
                onClose={() => select(null)}
              />
            ) : (
              <section className="card zsp-pick">
                <b>Pick a conversation</b>
                <span className="k">Read the whole thread, see the customer's plan and PCs, and reply.</span>
              </section>
            )}
          </div>
          {pending ? <span className="sr" role="status">Refreshing…</span> : null}
        </>
      )}
    </>
  );
}

const PAY_WORD: Record<string, string> = { submitted: "Waiting for a check", verified: "Paid", rejected: "Rejected" };

/** Plan, PCs and the latest payment, so billing questions need no search (J8-10). */
function contextCells(c: Subscriber): { k: string; v: string; note: string; warn?: boolean }[] {
  const sub = c.subscription;
  const planNote =
    sub?.status === "active"
      ? sub.ends_at
        ? `${sub.renewable ? "Paid" : "Active"} · until ${date(sub.ends_at)}`
        : "Active"
      : sub?.status === "pending_payment"
        ? "Not active yet"
        : sub?.status === "expired"
          ? "Ended"
          : "No plan yet";
  const max = c.plan?.max_devices ?? 0;
  const pcs = c.team.devices;
  const free = Math.max(0, max - pcs);
  const pay = c.payment ?? c.payments[0] ?? null;
  return [
    { k: "Plan", v: c.plan?.name ?? "No plan", note: isBlocked(c) ? "Account blocked" : planNote, warn: isBlocked(c) },
    {
      k: "PCs",
      v: max ? `${pcs} of ${max}` : String(pcs),
      note: max && pcs >= max ? "Plan is full" : max ? `${free} free slot${free === 1 ? "" : "s"}` : "",
      warn: Boolean(max && pcs >= max),
    },
    pay
      ? {
          k: "Latest payment",
          v: money(pay.due_total ?? pay.amount_inr, pay.currency ?? "INR"),
          note: `${PAY_WORD[pay.status] ?? pay.status} · ${pay.plan.name}`,
          warn: pay.status !== "verified",
        }
      : { k: "Latest payment", v: "None", note: "No payments yet" },
    { k: "Team", v: String(c.team.members.length), note: c.team.members.length === 1 ? "person added" : "people added" },
  ];
}

type ThreadItem =
  | { kind: "msg"; id: string; at: string; staff: boolean; who: string; body: string }
  | { kind: "note"; id: string; at: string; who: string; body: string };

function TicketPane({
  id,
  me,
  assignee,
  onAssign,
  teamName,
  onChanged,
  onClose,
}: {
  id: number;
  me: string;
  assignee: string;
  onAssign: (v: string) => void;
  teamName: (key: string) => string;
  onChanged: () => void;
  onClose: () => void;
}): ReactElement {
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
  const { data, error, setData, reload } = useLoad(load);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<LocalNote[]>(() => getNotes(id));
  const pane = useRef<HTMLElement>(null);
  const customer = useCustomer(data?.customer.id ?? null);

  // On a phone the conversation opens below the list: bring it into view (J8-08).
  const loaded = data !== undefined;
  useEffect(() => {
    if (loaded && window.matchMedia("(max-width: 900px)").matches) {
      pane.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loaded]);

  if (error)
    return (
      <section className="card zsp-pane">
        <ErrorState message={error} onRetry={reload} title="This conversation couldn’t load" />
      </section>
    );
  if (!data)
    return (
      <section className="card zsp-pane">
        <LoadingState bare rows={6} label="Loading the conversation…" />
      </section>
    );
  const t: SupportTicketDetail = data;
  const first = firstName(t.customer.full_name, t.customer.email);
  const isReply = mode === "reply";
  const noDraft = !draft.trim();

  const send = async (close: boolean) => {
    if (noDraft || busy) return;
    setBusy(true);
    try {
      setData(await replySupportTicket(id, draft.trim(), close));
      setDraft("");
      if (!assignee) onAssign(ME);
      toast(close ? `Reply sent and closed. ${first} was emailed.` : `Reply sent. ${first} was emailed and sees it in their Support chat.`);
      onChanged();
      refreshBadges();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn’t send the reply.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: SupportStatus) => {
    setBusy(true);
    try {
      setData(await setSupportStatus(id, status));
      toast(status === "closed" ? `Closed. If ${first} writes again, it reopens.` : "Reopened. It’s waiting for us again.");
      onChanged();
      refreshBadges();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn’t update it.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const items: ThreadItem[] = [
    ...t.messages.map(
      (m): ThreadItem => ({
        kind: "msg",
        id: `m${m.id}`,
        at: m.created_at,
        staff: m.sender === "staff",
        who: m.sender === "staff" ? m.author_name || "Zinwe team" : m.author_name || t.customer.full_name || t.customer.email,
        body: m.body,
      }),
    ),
    ...notes.map((n): ThreadItem => ({ kind: "note", id: n.id, at: n.at, who: n.by, body: n.body })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <section ref={pane} className="card zsp-pane" aria-label={`Conversation: ${t.subject}`}>
      <header className="zsp-head">
        <div className="zsp-head__row">
          <div className="zsp-head__who">
            <button type="button" className="lnk zsp-back" onClick={onClose}>
              <Icon name="chevronLeft" size={14} /> All conversations
            </button>
            <div className="zsp-head__meta">
              <span className={"zsp-stp " + STATUS[t.status].cls}>
                <span className="dot" />
                {STATUS[t.status].label}
              </span>
              <span className="k">
                {CATEGORY[t.category]} · <span className="mono">#{t.id}</span>
              </span>
            </div>
            <h2 className="zsp-head__subj">{t.subject}</h2>
            <span className="zsp-head__person">
              <b>{t.customer.company || t.customer.full_name || t.customer.email}</b>
              {t.customer.full_name ? ` · ${t.customer.full_name}` : ""} ·{" "}
              <a href={`mailto:${t.customer.email}`}>{t.customer.email}</a>
            </span>
            <span className="k">
              Opened {dayTime(t.created_at)} · sent from {t.page ? pageName(t.page) : "Dashboard"}
            </span>
          </div>
          <div className="zsp-head__acts">
            <div className="zsp-asg">
              <label className="k zsp-asg__k" htmlFor="asg">
                Assigned to <SampleTag what="This browser" />
              </label>
              <select
                id="asg"
                className="inp"
                value={assignee}
                onChange={(e) => {
                  onAssign(e.target.value);
                  toast(e.target.value ? `Assigned to ${teamName(e.target.value)}.` : "Unassigned.");
                }}
              >
                <option value="">Nobody yet</option>
                <option value={ME}>{me} (you)</option>
                {SUPPORT_TEAM.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            {t.status === "closed" ? (
              <button type="button" className="btn" disabled={busy} onClick={() => void changeStatus("open")}>
                Reopen
              </button>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => void changeStatus("closed")}>
                <Icon name="check" strokeWidth={2} />
                Close
              </button>
            )}
          </div>
        </div>

        <div className="zsp-ctx">
          <div className="zsp-ctx__top">
            <h3 className="k zsp-ctx__h">Customer</h3>
            <Link className="lnk" to={`/subscribers?open=${t.customer.id}`}>
              Open in Subscribers
            </Link>
          </div>
          {customer === null ? (
            <div className="zsp-ctx__loading">
              <span className="shimmer" style={{ height: 54 }} />
            </div>
          ) : customer === "error" ? (
            <p className="k" style={{ margin: 0 }}>
              The customer’s plan couldn’t load. Open them in Subscribers.
            </p>
          ) : (
            <dl className="zsp-ctx__grid">
              {contextCells(customer).map((c) => (
                <div key={c.k} className="zsp-ctx__cell">
                  <dt className="k">{c.k}</dt>
                  <dd className="zsp-ctx__v">{c.v}</dd>
                  {c.note ? <dd className={"k zsp-ctx__note" + (c.warn ? " is-warn" : "")}>{c.note}</dd> : null}
                </div>
              ))}
            </dl>
          )}
        </div>
      </header>

      <div role="log" aria-label="Messages" className="zsp-log">
        {items.map((m) => {
          const right = m.kind === "note" || m.staff;
          return (
            <div key={m.id} className={"zsp-msg" + (right ? " zsp-msg--right" : "")}>
              <div className={"zsp-bub " + (m.kind === "note" ? "zsp-bub--note" : m.staff ? "zsp-bub--staff" : "zsp-bub--cust")}>
                {m.kind === "note" ? (
                  <span className="zsp-bub__note">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="5" y="11" width="14" height="9" rx="1.5" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                    </svg>
                    Internal note · not sent to the customer
                  </span>
                ) : null}
                <p className="zsp-bub__body">{m.body}</p>
              </div>
              <span className={"k zsp-msg__meta"}>
                {m.kind === "note" ? `${m.who} · internal` : m.staff ? `${/zinwe team/i.test(m.who) ? "Zinwe team" : `${m.who}, Zinwe team`} · emailed` : m.who} · {dayTime(m.at)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="zsp-compose">
        <div className="zsp-compose__top">
          <div className="seg" role="group" aria-label="Write a">
            <button type="button" className={isReply ? "on" : ""} aria-pressed={isReply} onClick={() => setMode("reply")}>
              Reply
            </button>
            <button type="button" className={!isReply ? "on" : ""} aria-pressed={!isReply} onClick={() => setMode("note")}>
              Internal note
            </button>
          </div>
          {isReply ? (
            <div className="zsp-saved">
              <label className="k zsp-asg__k" htmlFor="saved">
                Saved replies
              </label>
              <select
                id="saved"
                className="inp"
                value=""
                onChange={(e) => {
                  const txt = SAVED_REPLIES.find((s) => s.key === e.target.value)?.text;
                  if (!txt) return;
                  setDraft((d) => (d.trim() ? `${d.trim()}\n\n${txt}` : `Hi ${first},\n\n${txt}`));
                }}
              >
                <option value="">Insert a saved reply</option>
                {SAVED_REPLIES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <label className="sr" htmlFor="msg">
          {isReply ? `Reply to ${first}` : "Internal note"}
        </label>
        <textarea
          id="msg"
          className={"ta" + (isReply ? "" : " ta--note")}
          maxLength={4000}
          placeholder={
            isReply ? `Write to ${first}. They get it by email and in their Support chat.` : "Write a note for the team. The customer never sees it."
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="zsp-compose__foot">
          <span className="zsp-compose__hint">
            {isReply ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="1.5" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
            )}
            {isReply ? `Reply emails the customer at ${t.customer.email}.` : "Not sent. Only the Zinwe team sees notes."}
            {isReply ? null : <SampleTag what="Saved in this browser" />}
          </span>
          <div className="zsp-compose__btns">
            {isReply ? (
              <>
                <button type="button" className="btn" disabled={noDraft || busy} onClick={() => void send(true)}>
                  Send and close
                </button>
                <button type="button" className="btn dark" disabled={noDraft || busy} onClick={() => void send(false)}>
                  {busy ? "Sending…" : "Send reply"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn dark"
                disabled={noDraft}
                onClick={() => {
                  setNotes(addNote(id, me, draft.trim()));
                  setDraft("");
                  toast("Note added. Only the Zinwe team sees it.");
                }}
              >
                Add note
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
