import { Fragment, useEffect, useMemo, useState, type ReactElement } from "react";
import { getMe } from "../lib/api";
import { useAdminEnv } from "../lib/env";
import {
  LOG_ATTENTION,
  LOG_EVENTS,
  LOG_SERVER,
  LOG_SOURCES,
  LOG_STATUS,
  LOGS_NOW,
  retriedEvent,
  retryOffsiteCopy,
  type LogEvent,
  type LogType,
  type StepMark,
} from "../content/fixtures/logs";
import { PageHeader } from "../components/PageHeader";
import { SampleTag } from "../components/States";
import { Icon, PathIcon } from "../components/icons";
import { useToast } from "../components/Toast";
import "../styles/logs.css";

type Cat = "all" | LogType;
type Range = "24h" | "7d" | "30d";

const CATS: [Cat, string][] = [
  ["all", "All"],
  ["server", "Server"],
  ["deploy", "Deployments"],
  ["backup", "Backups"],
  ["agent", "Agent releases"],
  ["staff", "Staff actions"],
  ["error", "Errors"],
];
const HOURS: Record<Range, number> = { "24h": 24, "7d": 168, "30d": 720 };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

const ts = (at: string) => new Date(`${at}:00`).getTime();

function inCat(e: LogEvent, c: Cat): boolean {
  if (c === "all") return true;
  if (c === "error") return e.type === "error" || e.result === "fail";
  return e.type === c;
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const today = LOGS_NOW.slice(0, 10);
  const y = new Date(`${today}T12:00:00`);
  y.setDate(y.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  const prefix = day === today ? "Today · " : day === yesterday ? "Yesterday · " : "";
  return `${prefix}${DAYS[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadCsv(rows: LogEvent[]): string {
  const name = `zinwe-logs-${LOGS_NOW.slice(0, 10)}.csv`;
  const lines = [
    ["Time (IST)", "Type", "Env", "What happened", "Who", "Result", "Details"].join(","),
    ...rows.map((e) =>
      [
        e.at.replace("T", " "),
        e.label,
        e.env,
        e.what,
        e.who,
        e.resultLabel ?? RESULT[e.result][0],
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

/**
 * Logs (AdminLogs board, FR-37). No API yet: everything on this page comes from the sample module
 * src/content/fixtures/logs.ts (status cards, events, the off-site retry).
 */
export function LogsPage(): ReactElement {
  const toast = useToast();
  const env = useAdminEnv();
  const [cat, setCat] = useState<Cat>("all");
  const [range, setRange] = useState<Range>("7d");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ prom2: true });
  const [retry, setRetry] = useState<"idle" | "running" | "done">("idle");
  const [me, setMe] = useState("you");

  useEffect(() => {
    let alive = true;
    getMe()
      .then((m) => {
        if (alive) setMe(m.email);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const events = useMemo(() => {
    const list = LOG_EVENTS.map((e) =>
      e.id === LOG_ATTENTION.eventId && retry === "done"
        ? {
            ...e,
            retryable: false,
            unresolved: false,
            details: e.details.map(([k, v]): [string, string] =>
              k === "Off-site copy" ? [k, `Failed at 03:04 · retried ${LOGS_NOW.slice(11)} by ${me} · B2 ✓`] : [k, v],
            ),
          }
        : e,
    );
    if (retry === "done") list.push(retriedEvent(me));
    return list.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [retry, me]);

  const needle = q.trim().toLowerCase();
  const base = useMemo(() => {
    const now = ts(LOGS_NOW);
    return events.filter((e) => {
      if ((now - ts(e.at)) / 3_600_000 > HOURS[range]) return false;
      if (!needle) return true;
      const hay = [e.what, e.who, e.label, e.env, ...e.details.map((d) => d.join(" ")), ...(e.commits ?? []).map((c) => `${c[0]} ${c[1].join(" ")}`)]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [events, range, needle]);
  const rows = base.filter((e) => inCat(e, cat));

  const groups = useMemo(() => {
    const out: { day: string; rows: LogEvent[] }[] = [];
    for (const e of rows) {
      const day = e.at.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(e);
      else out.push({ day, rows: [e] });
    }
    return out;
  }, [rows]);

  const doRetry = async () => {
    if (retry !== "idle") return;
    setRetry("running");
    toast("Retrying the off-site copy of the 03:00 backup to B2…");
    await retryOffsiteCopy();
    setRetry("done");
    toast("Off-site copy done. B2 ✓ · 412 MB in 41 s.");
  };

  const viewDetails = () => {
    setCat("all");
    setRange("7d");
    setQ("");
    setOpen((o) => ({ ...o, [LOG_ATTENTION.eventId]: true }));
    window.setTimeout(() => document.getElementById(`evt-${LOG_ATTENTION.eventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const retrying = retry === "running";
  const plural = (n: number) => `${n} ${n === 1 ? "event" : "events"}`;

  return (
    <>
      <PageHeader
        title="Logs"
        badge={<SampleTag />}
        subtitle="Server, deployments, backups, agent releases and staff actions in one timeline. Written automatically by the deploy, backup and monitoring scripts; nobody types them."
      >
        <span className="k">Times in IST · refreshes every 30 s</span>
        <button type="button" className="btn" onClick={() => toast(`Exported ${plural(rows.length)} to ${downloadCsv(rows)}`)}>
          <Icon name="download" />
          Export CSV
        </button>
      </PageHeader>

      <section aria-label="Status" className="lg-status">
        {LOG_STATUS.map((s) => (
          <div key={s.name} className="card lg-card">
            <div className="lg-card__row">
              <b>{s.name}</b>
              <span className={`pill ${s.state === "live" ? "good" : s.state === "down" ? "bad" : "warn"}`}>
                <span className="dot" />
                {s.state === "live" ? "Live" : s.state === "down" ? "Down" : "Restarting"}
              </span>
            </div>
            <span className="mono lg-card__host">{s.host}</span>
            <div className="lg-card__foot">
              <span>
                <b className="num">{s.uptime}</b> · 30 days
              </span>
              <span>{s.checked}</span>
            </div>
          </div>
        ))}
        <div className="card lg-card">
          <div className="lg-card__row">
            <b>Server</b>
            <span className="k">{LOG_SERVER.note}</span>
          </div>
          <div className="lg-meters">
            {(
              [
                ["CPU", LOG_SERVER.cpu],
                ["Memory", LOG_SERVER.memory],
                ["Disk", LOG_SERVER.disk],
              ] as const
            ).map(([label, v]) => (
              <Fragment key={label}>
                <span>{label}</span>
                <span className="bar">
                  <span style={{ width: `${v}%` }} />
                </span>
                <b className="num">{v}%</b>
              </Fragment>
            ))}
          </div>
          <span className="lg-card__note">{LOG_SERVER.lastRestart}</span>
        </div>
      </section>

      {retry !== "done" ? (
        <section aria-labelledby="attn-h" className="lg-attn">
          <div className="lg-attn__text">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A3260F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}>
              <path d="M12 3.5L2.5 20h19z" />
              <path d="M12 10v4.5M12 17.5h.01" />
            </svg>
            <div>
              <h2 id="attn-h">{LOG_ATTENTION.title}</h2>
              <p>{LOG_ATTENTION.body}</p>
            </div>
          </div>
          <div className="lg-attn__acts">
            <button type="button" className="btn dark" disabled={retrying} onClick={() => void doRetry()}>
              {retrying ? "Retrying…" : "Retry"}
            </button>
            <a className="btn" href={`#evt-${LOG_ATTENTION.eventId}`} onClick={(e) => { e.preventDefault(); viewDetails(); }}>
              View details
            </a>
          </div>
        </section>
      ) : (
        <div role="status" className="lg-clear">
          <Icon name="check" size={18} strokeWidth={2} />
          {LOG_ATTENTION.clear}
        </div>
      )}

      <section className="card lg-filters" aria-label="Filters">
        <div role="group" aria-label="Event type" className="lg-chips">
          {CATS.map(([key, label]) => (
            <button key={key} type="button" className={"chip" + (cat === key ? " on" : "")} aria-pressed={cat === key} onClick={() => setCat(key)}>
              {label}
              <span className="num lg-chip-n">{base.filter((e) => inCat(e, key)).length}</span>
            </button>
          ))}
        </div>
        <div className="lg-filter-row">
          <span className="lg-env">
            <span className="k" style={{ fontWeight: 600 }}>
              Environment
            </span>
            <span className="pill dark">{env === "dev" ? "Dev" : "Prod"}</span>
            <span className="k">set in the admin menu · Dev ships share the server, so they show here marked Dev</span>
          </span>
          <label className="sr" htmlFor="rng">
            Date range
          </label>
          <select id="rng" className="inp lg-range" value={range} onChange={(e) => setRange(e.target.value as Range)}>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <div className="lg-q">
            <label className="sr" htmlFor="q">
              Search events
            </label>
            <input id="q" type="search" className="inp" placeholder="Search tag, email, customer or commit" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="k num" style={{ whiteSpace: "nowrap" }} role="status">
            {plural(rows.length)}
          </span>
        </div>
      </section>

      <section className="card" aria-label="Events" style={{ overflow: "hidden" }}>
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
                            <span>{dayLabel(g.day)}</span>
                            <span className="k">{plural(g.rows.length)}</span>
                          </span>
                        </th>
                      </tr>
                    ) : null}
                    <tr className="ev">
                      <td className="mono num lg-time">{e.at.slice(11, 16)}</td>
                      <td>
                        <span className="lg-type">
                          <span className="lg-type__ic">
                            <TypeIcon e={e} />
                          </span>
                          {e.label}
                        </span>
                      </td>
                      <td>
                        <span className={"pill " + (e.env === "Prod" ? "dark" : "lg-devpill")}>{e.env}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="lg-x"
                          aria-expanded={isOpen}
                          onClick={() => setOpen((o) => ({ ...o, [e.id]: !isOpen }))}
                        >
                          <span className="t">{e.what}</span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5E6167" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", transform: isOpen ? "rotate(180deg)" : "none" }}>
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </button>
                      </td>
                      <td className={"lg-who" + (e.who === "system" ? " is-system" : "")}>{e.who}</td>
                      <td>
                        <span className={`pill ${res[1]}`}>{e.resultLabel ?? res[0]}</span>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={6} className="lg-detail">
                          <div className="lg-detail__grid">
                            <dl className="lg-kv">
                              {e.details.map(([k, v]) => (
                                <div key={k}>
                                  <dt className="k">{k}</dt>
                                  <dd>{v}</dd>
                                </div>
                              ))}
                            </dl>
                            {e.steps ? (
                              <div className="lg-col">
                                <h4 className="k">Steps</h4>
                                <ol className="lg-steps">
                                  {e.steps.map(([label, mark, note], n) => (
                                    <li key={label}>
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
                            {e.commits ? (
                              <div className="lg-col" style={{ gap: 8 }}>
                                <h4 className="k">Commits</h4>
                                {e.commits.map(([repo, lines]) => (
                                  <div key={repo} className="lg-commit">
                                    <span style={{ fontSize: 13 }}>
                                      <b className="mono">{repo}</b>{" "}
                                      <span className="k">
                                        · {lines.length} {lines.length === 1 ? "commit" : "commits"}
                                      </span>
                                    </span>
                                    {lines.map((l) => (
                                      <span key={l} className="mono lg-commit__line">
                                        {l}
                                      </span>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {e.retryable && retry !== "done" ? (
                              <div className="lg-col" style={{ gap: 8, alignItems: "flex-start" }}>
                                <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
                                  Runs only the off-site copy again. The local backup is not touched.
                                </span>
                                <button type="button" className="btn dark" disabled={retrying} onClick={() => void doRetry()}>
                                  {retrying ? "Retrying…" : "Retry off-site copy"}
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
          {rows.length === 0 ? (
            <div className="lg-empty">
              <span>No events match these filters.</span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setCat("all");
                  setRange("7d");
                  setQ("");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </div>
      </section>
      <p className="k" style={{ margin: 0 }}>
        {LOG_SOURCES}
      </p>
    </>
  );
}
