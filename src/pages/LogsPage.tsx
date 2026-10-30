import { Fragment, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ApiError } from "../lib/api";
import { refreshBadges } from "../lib/badges";
import {
  envLabel,
  getLogs,
  getLogsStatus,
  resolveLog,
  type LogEvent,
  type LogRange,
  type LogsResponse,
  type LogsStatus,
  type LogType,
  type StepMark,
} from "../lib/logsApi";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Icon, PathIcon } from "../components/icons";
import { useToast } from "../components/Toast";
import "../styles/logs.css";

type Cat = "all" | LogType;

const CATS: [Cat, string][] = [
  ["all", "All"],
  ["server", "Server"],
  ["deploy", "Deployments"],
  ["backup", "Backups"],
  ["agent", "Agent releases"],
  ["staff", "Staff actions"],
  ["error", "Errors"],
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TZ = "Asia/Kolkata";
const REFRESH_MS = 30_000;

const RESULT: Record<LogEvent["result"], [string, string]> = {
  ok: ["OK", "good"],
  fail: ["Failed", "bad"],
  rolled: ["Rolled back", "warn"],
};
const STEP: Record<StepMark, [string, string]> = {
  ok: ["OK", "good"],
  fail: ["Failed", "bad"],
  skip: ["Skipped", "skip"],
};

/* ---------- time (the API speaks UTC; the page shows IST) ---------- */

const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const istTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const istStamp = (iso: string) => {
  const [, m, d] = istDay(iso).split("-").map(Number);
  return `${d} ${MON[m - 1]}, ${istTime(iso)}`;
};

function dayLabel(day: string, now: Date): string {
  const d = new Date(`${day}T12:00:00`);
  const today = istDay(now.toISOString());
  const yesterday = istDay(new Date(now.getTime() - 86_400_000).toISOString());
  const prefix = day === today ? "Today · " : day === yesterday ? "Yesterday · " : "";
  return `${prefix}${DAYS[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

function ago(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/* ---------- board pieces ---------- */

/** Type icons from the board (multi-element, so drawn here rather than in icons.tsx). */
function TypeIcon({ e }: { e: LogEvent }): ReactElement {
  const kind = e.label === "Rollback" ? "roll" : e.type;
  const svg = (children: ReactElement) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
  switch (kind) {
    case "server":
      return svg(
        <>
          <rect x="3" y="4" width="18" height="7" rx="1.5" />
          <rect x="3" y="13" width="18" height="7" rx="1.5" />
          <path d="M7 7.5h.01M7 16.5h.01" />
        </>,
      );
    case "roll":
      return svg(
        <>
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
        </>,
      );
    case "backup":
      return svg(
        <>
          <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
          <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
          <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
        </>,
      );
    case "agent":
      return svg(
        <>
          <rect x="3" y="4" width="18" height="12" rx="1.5" />
          <path d="M8 20h8M12 16v4" />
        </>,
      );
    case "staff":
      return svg(
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c1-3.5 3.8-5.5 7-5.5s6 2 7 5.5" />
        </>,
      );
    case "error":
      return svg(
        <>
          <path d="M12 3.5L2.5 20h19z" />
          <path d="M12 10v4.5M12 17.5h.01" />
        </>,
      );
    default:
      return <PathIcon d="M12 19V5M6 11l6-6 6 6" size={15} />;
  }
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadCsv(rows: LogEvent[]): string {
  const name = `zinwe-logs-${istDay(new Date().toISOString())}.csv`;
  const lines = [
    ["Time (IST)", "Type", "Env", "What happened", "Who", "Result", "Details"].join(","),
    ...rows.map((e) =>
      [
        `${istDay(e.at)} ${istTime(e.at)}`,
        e.label,
        envLabel(e.env),
        e.what,
        e.who,
        e.result_label || RESULT[e.result][0],
        e.details.map(([k, v]) => `${k}: ${v}`).join("; "),
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/** What to do about a failed job: the board's Retry ran a root job on the server, which the admin can't. */
function fixHint(e: LogEvent): string {
  const env = e.env || "prod";
  if (e.type === "backup") {
    return `Run .\\deploy.ps1 ${env} backup from the owner PC: a fresh backup with its off-site copy. When it passes, this clears by itself.`;
  }
  if (e.type === "deploy") return `Fix the cause, then deploy again (run-zinwe or .\\deploy.ps1 ${env} deploy). A good deploy clears this.`;
  return "Clears when the next run of this job passes, or mark it resolved here.";
}

const pill = (state: "good" | "bad" | "warn" | "", text: string) => (
  <span className={`pill ${state}`}>
    <span className="dot" />
    {text}
  </span>
);

function StatusCards({ status, error }: { status: LogsStatus | null; error: string | null }): ReactElement {
  const now = new Date();
  if (!status) {
    return (
      <section aria-label="Status" className="lg-status">
        <div className="card lg-card">
          <div className="lg-card__row">
            <b>API</b>
            {error ? pill("bad", "Not answering") : pill("", "Checking")}
          </div>
          <span className="lg-card__note">{error ?? "Checking this server…"}</span>
        </div>
      </section>
    );
  }
  const { api, database, server, last_deploy: deploy, last_backup: backup } = status;
  const release = api.release;
  const meters = (
    [
      ["CPU", server.cpu],
      ["Memory", server.memory],
      ["Disk", server.disk],
    ] as const
  ).filter(([, v]) => v !== null) as [string, number][];
  return (
    <section aria-label="Status" className="lg-status">
      <div className="card lg-card">
        <div className="lg-card__row">
          <b>{envLabel(status.env)} API</b>
          {pill("good", "Live")}
        </div>
        <span className="mono lg-card__host">{api.host || "this server"}</span>
        <div className="lg-card__foot">
          <span>Up since {istStamp(api.started_at)}</span>
          <span>checked {istTime(status.checked_at)}</span>
        </div>
      </div>
      <div className="card lg-card">
        <div className="lg-card__row">
          <b>Database</b>
          {database.ok ? pill("good", "Live") : pill("bad", "Down")}
        </div>
        <span className="mono lg-card__host">{database.engine === "postgresql" ? "PostgreSQL" : database.engine === "sqlite" ? "SQLite (local)" : database.engine}</span>
        <div className="lg-card__foot">
          <span>{database.latency_ms !== null ? <><b className="num">{database.latency_ms}</b> ms</> : "no answer"}</span>
          <span>checked {istTime(status.checked_at)}</span>
        </div>
      </div>
      <div className="card lg-card">
        <div className="lg-card__row">
          <b>Last deploy</b>
          {deploy ? pill(deploy.result === "ok" ? "good" : deploy.result === "rolled" ? "warn" : "bad", deploy.result_label || RESULT[deploy.result][0]) : null}
        </div>
        <span className="mono lg-card__host">{release?.stamp ?? (deploy ? deploy.label : "Not a server release")}</span>
        <div className="lg-card__foot">
          <span>{deploy ? `${deploy.label} · ${istStamp(deploy.at)}` : "None logged yet"}</span>
          <span>{deploy ? ago(deploy.at, now) : ""}</span>
        </div>
      </div>
      <div className="card lg-card">
        <div className="lg-card__row">
          <b>Last backup</b>
          {backup ? pill(backup.result === "ok" ? "good" : "bad", backup.result === "ok" ? "OK" : "Failed") : null}
        </div>
        <span className="lg-card__host">{backup ? backup.what : "None logged yet"}</span>
        <div className="lg-card__foot">
          <span>{backup ? istStamp(backup.at) : "Daily at 03:00 IST on the servers"}</span>
          <span>{backup ? ago(backup.at, now) : ""}</span>
        </div>
      </div>
      <div className="card lg-card">
        <div className="lg-card__row">
          <b>Server</b>
          <span className="k">{server.cores ? `${server.cores} CPU${server.cores === 1 ? "" : "s"}` : ""}</span>
        </div>
        {meters.length ? (
          <div className="lg-meters">
            {meters.map(([label, v]) => (
              <Fragment key={label}>
                <span>{label}</span>
                <span className="bar">
                  <span style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
                </span>
                <b className="num">{Math.round(v)}%</b>
              </Fragment>
            ))}
          </div>
        ) : (
          <span className="lg-card__note">This server doesn’t report CPU, memory or disk.</span>
        )}
        <span className="lg-card__note">
          {server.booted_at
            ? `Last restart ${istStamp(server.booted_at)}`
            : server.cpu === null
              ? "CPU and memory show on the Linux servers only."
              : ""}
        </span>
      </div>
    </section>
  );
}

/**
 * Logs (AdminLogs board, FR-37) on the real API: GET /api/admin/logs/ (one timeline: ops events from
 * zinwe-server.sh and the API, staff actions from the audit trail, agent releases, payment reviews) and
 * GET /api/admin/logs/status/ (this environment's health, last deploy / backup, unresolved failures).
 */
export function LogsPage(): ReactElement {
  const toast = useToast();
  const [cat, setCat] = useState<Cat>("all");
  const [range, setRange] = useState<LogRange>("7d");
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [data, setData] = useState<LogsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [status, setStatus] = useState<LogsStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [resolving, setResolving] = useState<number | null>(null);

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = window.setTimeout(() => setNeedle(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    setPending(true);
    getLogs({ range, type: cat, q: needle })
      .then((res) => {
        if (!alive) return;
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : "The logs couldn’t load.");
      })
      .finally(() => {
        if (alive) setPending(false);
      });
    return () => {
      alive = false;
    };
  }, [range, cat, needle, nonce]);

  const loadStatus = useCallback(() => {
    getLogsStatus()
      .then((s) => {
        setStatus(s);
        setStatusError(null);
      })
      .catch((err) => setStatusError(err instanceof ApiError ? err.message : "The API didn’t answer."));
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus, nonce]);

  // Refreshes every 30 s while the page is open.
  useEffect(() => {
    const t = window.setInterval(() => setNonce((n) => n + 1), REFRESH_MS);
    return () => window.clearInterval(t);
  }, []);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const groups = useMemo(() => {
    const out: { day: string; rows: LogEvent[] }[] = [];
    for (const e of rows) {
      const day = istDay(e.at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(e);
      else out.push({ day, rows: [e] });
    }
    return out;
  }, [rows]);

  const filtered = cat !== "all" || range !== "7d" || needle !== "";
  const clearFilters = () => {
    setCat("all");
    setRange("7d");
    setQ("");
    setNeedle("");
  };

  const doResolve = async (e: LogEvent) => {
    if (e.ops_id === null || resolving !== null) return;
    setResolving(e.ops_id);
    try {
      await resolveLog(e.ops_id);
      toast("Marked as resolved. It no longer needs attention.");
      refreshBadges();
      setNonce((n) => n + 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn’t mark it as resolved. Try again.");
    } finally {
      setResolving(null);
    }
  };

  const viewDetails = (e: LogEvent) => {
    const show = () => {
      setOpen((o) => ({ ...o, [e.id]: true }));
      window.setTimeout(() => document.getElementById(`evt-${e.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    };
    if (rows.some((r) => r.id === e.id)) {
      show();
      return;
    }
    // Not in the current view: open the widest one.
    setCat("all");
    setRange("30d");
    setQ("");
    setNeedle("");
    show();
  };

  const plural = (n: number) => `${n} ${n === 1 ? "event" : "events"}`;
  const now = new Date();
  const attention = status?.attention ?? [];
  const first = attention[0];
  const openCount = status?.unresolved ?? attention.length;
  const env = status?.env ?? data?.env ?? "";

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Server, deployments, backups, agent releases and staff actions in one timeline. Written automatically by the deploy and backup scripts, the API and the admin itself; nobody types them."
      >
        <span className="k">Times in IST · refreshes every 30 s</span>
        <button
          type="button"
          className="btn"
          disabled={!rows.length}
          onClick={() => toast(`Exported ${plural(rows.length)} to ${downloadCsv(rows)}`)}
        >
          <Icon name="download" />
          Export CSV
        </button>
      </PageHeader>

      <StatusCards status={status} error={statusError} />

      {first ? (
        <section aria-labelledby="attn-h" className="lg-attn">
          <div className="lg-attn__text">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C0331C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}>
              <path d="M12 3.5L2.5 20h19z" />
              <path d="M12 10v4.5M12 17.5h.01" />
            </svg>
            <div>
              <h2 id="attn-h">
                Needs attention · {openCount === 1 ? "1 failure" : `${openCount} failures`} nobody has handled
              </h2>
              <p>
                {envLabel(first.env)} · {istStamp(first.at)}. {first.what}. {fixHint(first)}
              </p>
            </div>
          </div>
          <div className="lg-attn__acts">
            <button type="button" className="btn dark" disabled={resolving !== null} onClick={() => void doResolve(first)}>
              {resolving === first.ops_id ? "Saving…" : "Mark as resolved"}
            </button>
            <a
              className="btn"
              href={`#evt-${first.id}`}
              onClick={(ev) => {
                ev.preventDefault();
                viewDetails(first);
              }}
            >
              View details
            </a>
          </div>
        </section>
      ) : status ? (
        <div role="status" className="lg-clear">
          <Icon name="check" size={18} strokeWidth={2} />
          Nothing needs attention. Failed deploys and backups show here until they’re fixed.
        </div>
      ) : null}

      <section className="card lg-filters" aria-label="Filters">
        <div role="group" aria-label="Event type" className="lg-chips">
          {CATS.map(([key, label]) => (
            <button key={key} type="button" className={"chip" + (cat === key ? " on" : "")} aria-pressed={cat === key} onClick={() => setCat(key)}>
              {label}
              <span className="num lg-chip-n">{data ? data.counts[key] : "·"}</span>
            </button>
          ))}
        </div>
        <div className="lg-filter-row">
          <span className="lg-env">
            <span className="k" style={{ fontWeight: 600 }}>
              Environment
            </span>
            <span className="pill dark">{env ? envLabel(env) : "…"}</span>
            <span className="k">this server’s own log · dev and prod each keep theirs</span>
          </span>
          <label className="sr" htmlFor="rng">
            Date range
          </label>
          <select id="rng" className="inp lg-range" value={range} onChange={(e) => setRange(e.target.value as LogRange)}>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <div className="lg-q">
            <label className="sr" htmlFor="q">
              Search events
            </label>
            <input id="q" type="search" className="inp" placeholder="Search email, customer, release or commit" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="k num" style={{ whiteSpace: "nowrap" }} role="status">
            {pending && !data ? "Loading…" : plural(data?.total ?? 0)}
          </span>
        </div>
      </section>

      {error && !data ? (
        <ErrorState title="The logs couldn’t load" message={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : !data ? (
        <LoadingState rows={6} label="Loading the logs…" />
      ) : (
        <section className="card" aria-label="Events" aria-busy={pending} style={{ overflow: "hidden" }}>
          {error ? (
            <p role="alert" className="k" style={{ margin: 0, padding: "10px 16px", color: "var(--bad)" }}>
              Couldn’t refresh: {error} Showing the last loaded events.
            </p>
          ) : null}
          {rows.length ? (
            <div className="tbl-wrap">
              <table className="tbl lg-tbl">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 64 }}>Time</th>
                    <th scope="col" style={{ width: 160 }}>Type</th>
                    <th scope="col" style={{ width: 70 }}>Env</th>
                    <th scope="col">What happened</th>
                    <th scope="col" style={{ width: 170 }}>Who</th>
                    <th scope="col" style={{ width: 120 }}>Result</th>
                  </tr>
                </thead>
                {groups.map((g) =>
                  g.rows.map((e, i) => {
                    const isOpen = Boolean(open[e.id]);
                    const res = RESULT[e.result];
                    return (
                      <tbody key={e.id} id={`evt-${e.id}`}>
                        {i === 0 ? (
                          <tr>
                            <th scope="colgroup" colSpan={6} className="grp">
                              <span className="lg-grp">
                                <span>{dayLabel(g.day, now)}</span>
                                <span className="k">{plural(g.rows.length)}</span>
                              </span>
                            </th>
                          </tr>
                        ) : null}
                        <tr className="ev">
                          <td className="mono num lg-time">{istTime(e.at)}</td>
                          <td>
                            <span className="lg-type">
                              <span className="lg-type__ic">
                                <TypeIcon e={e} />
                              </span>
                              {e.label}
                            </span>
                          </td>
                          <td>
                            <span className={"pill " + (e.env === "prod" ? "dark" : "lg-devpill")}>{envLabel(e.env)}</span>
                          </td>
                          <td>
                            <button type="button" className="lg-x" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [e.id]: !isOpen }))}>
                              <span className="t">{e.what}</span>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", transform: isOpen ? "rotate(180deg)" : "none" }}>
                                <path d="M6 9l6 6 6-6" />
                              </svg>
                            </button>
                          </td>
                          <td className={"lg-who" + (e.who === "system" ? " is-system" : "")}>{e.who}</td>
                          <td>
                            <span className={`pill ${res[1]}`}>{e.result_label || res[0]}</span>
                            {e.unresolved ? <span className="sr"> · needs attention</span> : null}
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr>
                            <td colSpan={6} className="lg-detail">
                              <div className="lg-detail__grid">
                                <dl className="lg-kv">
                                  <div>
                                    <dt className="k">When</dt>
                                    <dd>{istStamp(e.at)} IST</dd>
                                  </div>
                                  {e.details.map(([k, v], n) => (
                                    <div key={`${k}-${n}`}>
                                      <dt className="k">{k}</dt>
                                      <dd>{v}</dd>
                                    </div>
                                  ))}
                                </dl>
                                {e.steps.length ? (
                                  <div className="lg-col">
                                    <h4 className="k">Steps</h4>
                                    <ol className="lg-steps">
                                      {e.steps.map(([label, mark, note], n) => (
                                        <li key={`${label}-${n}`}>
                                          <span className="k num">{n + 1}</span>
                                          <span>
                                            <span className={`pill ${STEP[mark][1]}`}>{STEP[mark][0]}</span>
                                          </span>
                                          <span>
                                            {label} <span className="k">{note}</span>
                                          </span>
                                        </li>
                                      ))}
                                    </ol>
                                  </div>
                                ) : null}
                                {e.unresolved && e.ops_id !== null ? (
                                  <div className="lg-col" style={{ gap: 8, alignItems: "flex-start" }}>
                                    <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{fixHint(e)}</span>
                                    <button type="button" className="btn dark" disabled={resolving !== null} onClick={() => void doResolve(e)}>
                                      {resolving === e.ops_id ? "Saving…" : "Mark as resolved"}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    );
                  }),
                )}
              </table>
            </div>
          ) : filtered ? (
            <div className="lg-empty">
              <span>No events match these filters.</span>
              <button type="button" className="btn" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          ) : (
            <EmptyState
              center
              icon="logs"
              title="Nothing logged in the last 7 days"
              body="Staff actions show here as soon as someone acts in the admin. Deployments, rollbacks and backups appear once the servers run the updated zinwe-server script; API starts and server errors are written by the API itself."
            />
          )}
          {data.truncated ? (
            <p className="k" style={{ margin: 0, padding: "10px 16px", borderTop: "1px solid var(--line-soft)" }}>
              Showing the newest {rows.length} of {data.total}. Narrow the range or search to see older ones.
            </p>
          ) : null}
        </section>
      )}
      <p className="k" style={{ margin: 0 }}>
        Sources: zinwe-server deploy, rollback and backup (daily at 03:00 IST, with the encrypted off-site copy on
        Backblaze B2); the API (each start, and unhandled errors, at most one row per route every 10 minutes); the admin
        audit log for staff actions, agent releases and payment reviews. Uptime isn’t measured yet, so it isn’t shown.
      </p>
    </>
  );
}
