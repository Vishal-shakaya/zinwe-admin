import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, getFeedback, getMe, sendCustomerEmail, type FeedbackRow } from "../lib/api";
import { pageName } from "../lib/pages";
import { useLoad } from "../lib/useLoad";
import { SAMPLES_ON } from "../lib/samples";
import { PageHeader } from "../components/PageHeader";
import { ErrorState, LoadingState, SampleTag } from "../components/States";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import {
  isUnread,
  loadFeedbackLocal,
  saveFeedbackLocal,
  TAG_LABEL,
  type FeedbackLocal,
  type FeedbackTag,
} from "../content/fixtures/feedback";
import { dayOnly, daysAgo, downloadCsv, firstName, isoToday, timeOnly } from "./inbox/format";
import "../styles/feedback.css";

type Source = "all" | "dashboard" | "app" | "email";
type Band = "all" | "p" | "m" | "d";

const SOURCES: [Source, string][] = [
  ["all", "All sources"],
  ["dashboard", "Dashboard"],
  ["app", "Windows app"],
  ["email", "Feedback email link"],
];

const BANDS: [Band, string, (n: number) => boolean][] = [
  ["all", "All scores", () => true],
  ["p", "Promoters 9–10", (n) => n >= 9],
  ["m", "Passives 7–8", (n) => n >= 7 && n <= 8],
  ["d", "Detractors 1–6", (n) => n <= 6],
];

const TAGS: FeedbackTag[] = ["bug", "idea", "praise", "pricing"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Where a rating came from: a member's Zinwe window, our check-in email link, or the owner's dashboard. */
function sourceOf(r: FeedbackRow): Exclude<Source, "all"> {
  if (r.source === "member") return "app";
  if (/^email|check-in|^mail:/i.test(r.page)) return "email";
  return "dashboard";
}

function fromLine(r: FeedbackRow): string {
  if (r.source === "member") {
    return `Windows app${r.member?.name ? ` · ${r.member.name}` : ""}${r.member?.hostname ? ` on ${r.member.hostname}` : ""}`;
  }
  if (sourceOf(r) === "email") return "Feedback email link";
  return r.page ? pageName(r.page) : "Dashboard";
}

function tone(n: number): { cls: string; word: string } {
  if (n >= 9) return { cls: "fb-score--p", word: "promoter" };
  if (n >= 7) return { cls: "fb-score--m", word: "passive" };
  return { cls: "fb-score--d", word: "detractor" };
}

function signed(v: number): string {
  return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v);
}

/** Monday 00:00 (local) of the week holding `d`. */
function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain text -> the simple HTML the email API takes (paragraphs + line breaks). */
function toHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Feedback (AdminFeedback board): ratings 1–10 from the dashboard, the Windows app (members) and our email link.
 * NPS, the weekly trend, filters and Export CSV are computed from the real rows; read/unread, tags and the
 * "Replied" line are kept in this browser until the API has them (content/fixtures/feedback.ts).
 */
export function FeedbackPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const load = useCallback(() => getFeedback(), []);
  const { data, error, reload } = useLoad(load);
  const [src, setSrc] = useState<Source>("all");
  const [band, setBand] = useState<Band>("all");
  const [period, setPeriod] = useState("30");
  const [tagF, setTagF] = useState<FeedbackTag | "all" | "none">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [local, setLocal] = useState<FeedbackLocal>(loadFeedbackLocal);
  const [me, setMe] = useState("Zinwe");

  useEffect(() => {
    let alive = true;
    getMe()
      .then((m) => {
        if (alive) setMe(firstName(m.full_name, m.email));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const update = (fn: (l: FeedbackLocal) => FeedbackLocal) => setLocal((l) => saveFeedbackLocal(fn(structuredClone(l))));

  const all = useMemo(() => data?.rows ?? [], [data]);
  const days = Number(period);
  const inPeriod = all.filter((r) => daysAgo(r.created_at) < days);
  const inSrc = inPeriod.filter((r) => src === "all" || sourceOf(r) === src);
  const bandTest = BANDS.find((b) => b[0] === band)![2];
  const tagsOf = (r: FeedbackRow) => local.tags[String(r.id)] ?? [];
  const unread = (r: FeedbackRow) => isUnread(local, r.id, r.created_at);
  const rows = inSrc.filter(
    (r) =>
      bandTest(r.rating) &&
      (tagF === "all" || (tagF === "none" ? tagsOf(r).length === 0 : tagsOf(r).includes(tagF))) &&
      (!unreadOnly || unread(r)),
  );

  const n = inSrc.length;
  const p = inSrc.filter((r) => r.rating >= 9).length;
  const d = inSrc.filter((r) => r.rating <= 6).length;
  const m = n - p - d;
  const pct = (k: number) => `${n ? Math.round((k / n) * 100) : 0}%`;
  const nps = n ? Math.round(((p - d) / n) * 100) : 0;
  const avg = n ? (inSrc.reduce((a, r) => a + r.rating, 0) / n).toFixed(1) : "—";
  const unreadAll = all.filter(unread).length;

  // NPS per week (Monday start), last 8 weeks, all sources.
  const weeks = useMemo(() => {
    const thisWeek = weekStart(new Date());
    return Array.from({ length: 8 }, (_, i) => {
      const start = new Date(thisWeek);
      start.setDate(start.getDate() - (7 - i) * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const these = all.filter((r) => {
        const t = new Date(r.created_at).getTime();
        return t >= start.getTime() && t < end.getTime();
      });
      const wp = these.filter((r) => r.rating >= 9).length;
      const wd = these.filter((r) => r.rating <= 6).length;
      return {
        wk: `${start.getDate()} ${MONTHS[start.getMonth()]}`,
        n: these.length,
        v: these.length ? Math.round(((wp - wd) / these.length) * 100) : 0,
      };
    });
  }, [all]);

  const clearFilters = () => {
    setSrc("all");
    setBand("all");
    setPeriod("30");
    setTagF("all");
    setUnreadOnly(false);
  };

  const exportCsv = () => {
    downloadCsv(
      `zinwe-feedback-${isoToday()}.csv`,
      ["Score", "Comment", "Company", "Person", "Email", "Source", "Sent from", "Date", "Tags"],
      rows.map((r) => [
        r.rating,
        r.message,
        r.customer.company ?? "",
        r.source === "member" ? (r.member?.name ?? "") : r.customer.full_name,
        r.customer.email,
        SOURCES.find((s) => s[0] === sourceOf(r))![1],
        fromLine(r),
        new Date(r.created_at).toISOString(),
        tagsOf(r)
          .map((t) => TAG_LABEL[t])
          .join(" "),
      ]),
    );
    toast(`Exported ${rows.length} ratings to zinwe-feedback-${isoToday()}.csv`);
  };

  const send = async (r: FeedbackRow) => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await sendCustomerEmail(r.customer.id, "About your Zinwe rating", toHtml(draft));
      const stamp = `Replied ${dayOnly(new Date().toISOString())} by ${me}`;
      update((l) => {
        l.replied[String(r.id)] = stamp;
        l.read = [...new Set([...l.read, r.id])];
        l.unread = l.unread.filter((x) => x !== r.id);
        return l;
      });
      setOpen(null);
      setDraft("");
      toast(`Email sent to ${r.source === "member" ? `the ${r.customer.company || r.customer.email} owner` : r.customer.email}.`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn’t send the email.", "bad");
    } finally {
      setSending(false);
    }
  };

  const draftFor = (r: FeedbackRow) => {
    const first = r.source === "member" ? firstName(r.member?.name ?? "", "") : firstName(r.customer.full_name, r.customer.email);
    const why = r.message ? " and for telling us why" : "";
    const ask =
      r.rating <= 6
        ? "I’m sorry it fell short. Could you tell me a bit more, or pick a time for a quick call?"
        : r.rating <= 8
          ? "What is the one thing that would make it a 10 for you?"
          : "It means a lot to a small team like ours.";
    return `Hi ${first},\n\nThanks for rating Zinwe ${r.rating} out of 10${why}. ${ask}\n\n${me}\nZinwe`;
  };

  const seg = (k: number, cls: string) => (k ? <span className={"fb-nps__seg " + cls} style={{ flex: `${k} 1 0` }} /> : null);

  return (
    <>
      <PageHeader
        title="Feedback"
        subtitle="Ratings from 1 to 10 sent from the dashboard, the Windows app and the link in our check-in emails. Use them to decide what to fix next."
      >
        {data ? (
          <span className="k">
            {unreadAll ? `${unreadAll} unread` : "All read"}{" "}
            {SAMPLES_ON ? <SampleTag what="Read state: this browser" /> : "(this browser)"}
          </span>
        ) : null}
        <button type="button" className="btn" onClick={exportCsv} disabled={!data}>
          <Icon name="download" />
          Export CSV
        </button>
      </PageHeader>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState rows={8} label="Loading ratings…" />
      ) : (
        <>
          <div className="fb-top">
            <section className="card fb-card" aria-labelledby="nps-h">
              <div className="fb-card__head">
                <h2 id="nps-h">Net score</h2>
                <span className="k">
                  Last {days} days · {SOURCES.find((s) => s[0] === src)![1]}
                </span>
              </div>
              <div className="fb-big">
                <div className="fb-big__col">
                  <b className="num fb-big__nps">{signed(nps)}</b>
                  <span className="k">NPS · promoters minus detractors</span>
                </div>
                <div className="fb-big__col">
                  <b className="num fb-big__avg">
                    {avg}
                    <span> / 10</span>
                  </b>
                  <span className="k">
                    Average · {n} {n === 1 ? "rating" : "ratings"}
                  </span>
                </div>
              </div>
              <div className="fb-nps">
                <div className="fb-nps__bar" aria-hidden="true">
                  {seg(p, "is-p")}
                  {seg(m, "is-m")}
                  {seg(d, "is-d")}
                </div>
                <ul className="fb-nps__legend">
                  {[
                    ["Promoters", p, "is-p", "Scored 9–10"],
                    ["Passives", m, "is-m", "Scored 7–8"],
                    ["Detractors", d, "is-d", "Scored 1–6"],
                  ].map(([label, k, cls, sub]) => (
                    <li key={String(label)}>
                      <span className="fb-nps__name">
                        <span className={"fb-nps__sw " + String(cls)} />
                        {label}
                      </span>
                      <span className="num fb-nps__n">
                        {k} <span className="k">· {pct(Number(k))}</span>
                      </span>
                      <span className="k">{sub}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="card fb-card fb-card--trend" aria-labelledby="trend-h">
              <div className="fb-card__head">
                <h2 id="trend-h">NPS by week</h2>
                <span className="k">Last 8 weeks · all sources</span>
              </div>
              <figure
                role="img"
                aria-label={
                  "NPS by week, last 8 weeks: " + weeks.map((w) => `week of ${w.wk} ${w.n ? (w.v > 0 ? "+" : "") + w.v : "no ratings"}`).join(", ")
                }
                className="fb-trend"
              >
                <div aria-hidden="true" className="fb-trend__y">
                  <span />
                  <span className="fb-trend__ytop">
                    <span>+50</span>
                    <span>0</span>
                  </span>
                  <span className="fb-trend__ybot">
                    <span>−50</span>
                  </span>
                  <span />
                </div>
                <div aria-hidden="true" className="fb-trend__plot">
                  <div className="fb-trend__cols">
                    {weeks.map((w, i) => {
                      const h = Math.max(3, Math.round((Math.min(Math.abs(w.v), 50) / 50) * 72));
                      const last = i === weeks.length - 1;
                      return (
                        <div key={w.wk} className="fb-trend__col">
                          <div className="fb-trend__pos">
                            {w.n && w.v >= 0 ? (
                              <>
                                <span className="num fb-trend__lab">{signed(w.v)}</span>
                                <span className={"fb-trend__bar" + (last ? " is-now" : "")} style={{ height: h }} />
                              </>
                            ) : null}
                          </div>
                          <div className="fb-trend__neg">
                            {w.n && w.v < 0 ? (
                              <>
                                <span className="fb-trend__bar is-neg" style={{ height: h }} />
                                <span className="num fb-trend__lab is-neg">{signed(w.v)}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="fb-trend__x">
                    {weeks.map((w, i) => (
                      <span key={w.wk} className={i === weeks.length - 1 ? "is-now" : ""}>
                        {w.wk}
                      </span>
                    ))}
                  </div>
                </div>
              </figure>
              <p className="k" style={{ margin: 0 }}>
                Week starting Monday. A week with no ratings shows no bar.
              </p>
            </section>
          </div>

          <section className="card fb-filters" aria-label="Filters">
            <div role="group" aria-label="Source" className="fb-chips">
              {SOURCES.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={"chip" + (src === key ? " on" : "")}
                  aria-pressed={src === key}
                  onClick={() => setSrc(key)}
                >
                  {label}
                  <span className="num fb-chip-n">{inPeriod.filter((r) => key === "all" || sourceOf(r) === key).length}</span>
                </button>
              ))}
            </div>
            <div className="fb-filters__row">
              <div className="seg" role="group" aria-label="Score">
                {BANDS.map(([key, label]) => (
                  <button key={key} type="button" className={band === key ? "on" : ""} aria-pressed={band === key} onClick={() => setBand(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="sr" htmlFor="per">
                Period
              </label>
              <select id="per" className="inp fb-sel" value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="3650">All time</option>
              </select>
              <label className="sr" htmlFor="tagf">
                Tag
              </label>
              <select id="tagf" className="inp fb-sel" value={tagF} onChange={(e) => setTagF(e.target.value as FeedbackTag | "all" | "none")}>
                <option value="all">Any tag</option>
                {TAGS.map((t) => (
                  <option key={t} value={t}>
                    {TAG_LABEL[t]}
                  </option>
                ))}
                <option value="none">No tag yet</option>
              </select>
              <label className="fb-unread">
                <input type="checkbox" checked={unreadOnly} onChange={() => setUnreadOnly((v) => !v)} />
                Unread only
              </label>
              <span className="k num fb-shown">
                {rows.length} {rows.length === 1 ? "rating" : "ratings"}
              </span>
            </div>
          </section>

          <section className="card fb-table" aria-label="Ratings">
            <div className="tbl-wrap">
              <table className="tbl fb-tbl">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 76 }}>
                      Score
                    </th>
                    <th scope="col">Comment</th>
                    <th scope="col" style={{ width: 220 }}>
                      Customer
                    </th>
                    <th scope="col" style={{ width: 100 }}>
                      Date
                    </th>
                    <th scope="col" style={{ width: 250 }}>
                      Follow up
                    </th>
                  </tr>
                </thead>
                {rows.map((r) => {
                  const t = tone(r.rating);
                  const isOpen = open === r.id;
                  const isNew = unread(r);
                  const tags = tagsOf(r);
                  const replied = local.replied[String(r.id)];
                  const member = r.source === "member";
                  const company = r.customer.company || r.customer.full_name || r.customer.email;
                  const person = member ? `${r.member?.name || "Someone"} (team member)` : r.customer.full_name || "Owner";
                  const email = member ? `on ${r.member?.hostname || "their PC"} · reply goes to the owner` : r.customer.email;
                  return (
                    <tbody key={r.id} className={isNew ? "is-unread" : ""}>
                      <tr>
                        <td>
                          <span className={"fb-score " + t.cls} aria-hidden="true">
                            {r.rating}
                          </span>
                          <span className="sr">{`Score ${r.rating} of 10, ${t.word}, from ${company}`}</span>
                        </td>
                        <td>
                          <div className="fb-cmt">
                            <p className={"fb-cmt__text" + (r.message ? (isNew ? " is-unread" : "") : " is-none")}>
                              {isNew ? (
                                <>
                                  <span className="dot fb-cmt__dot" aria-hidden="true" />
                                  <span className="sr">Unread. </span>
                                </>
                              ) : null}
                              {r.message || "No comment"}
                            </p>
                            {tags.length ? (
                              <div className="fb-tags">
                                {tags.map((tg) => (
                                  <button
                                    key={tg}
                                    type="button"
                                    className="fb-tag"
                                    aria-label={`Remove tag ${TAG_LABEL[tg]}`}
                                    onClick={() =>
                                      update((l) => {
                                        l.tags[String(r.id)] = (l.tags[String(r.id)] ?? []).filter((x) => x !== tg);
                                        return l;
                                      })
                                    }
                                  >
                                    {TAG_LABEL[tg]}
                                    <Icon name="close" size={14} strokeWidth={2} />
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            <span className="k">Sent from {fromLine(r)}</span>
                            {replied ? (
                              <span className="fb-replied">
                                <Icon name="check" size={14} strokeWidth={2} />
                                {replied}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div className="fb-who">
                            <b>{company}</b>
                            <span>{person}</span>
                            <span className="k fb-who__email">{email}</span>
                            <Link className="fb-who__open" to={`/subscribers?open=${r.customer.id}`}>
                              Open customer
                            </Link>
                          </div>
                        </td>
                        <td>
                          <div className="fb-date">
                            <span className="num">{dayOnly(r.created_at)}</span>
                            <span className="k num">{timeOnly(r.created_at)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="fb-follow">
                            <button
                              type="button"
                              className={"btn sm" + (r.rating <= 6 && !replied ? " dark" : "")}
                              aria-expanded={isOpen}
                              onClick={() => {
                                if (isOpen) setOpen(null);
                                else {
                                  setOpen(r.id);
                                  setDraft(draftFor(r));
                                }
                              }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="3" y="5" width="18" height="14" rx="2" />
                                <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
                              </svg>
                              Reply by email
                            </button>
                            {r.testimonial_id ? (
                              <Link className="lnk" to="/testimonials">
                                In testimonials
                              </Link>
                            ) : r.rating >= 8 && r.message.trim() ? (
                              <button type="button" className="lnk" onClick={() => navigate("/testimonials", { state: { fromFeedback: r } })}>
                                Use as testimonial
                              </button>
                            ) : null}
                            <div className="fb-follow__row">
                              <button
                                type="button"
                                className="lnk"
                                onClick={() => {
                                  update((l) => {
                                    if (isNew) {
                                      l.read = [...new Set([...l.read, r.id])];
                                      l.unread = l.unread.filter((x) => x !== r.id);
                                    } else {
                                      l.read = l.read.filter((x) => x !== r.id);
                                      l.unread = [...new Set([...l.unread, r.id])];
                                    }
                                    return l;
                                  });
                                  toast(isNew ? "Marked read." : "Marked unread.");
                                }}
                              >
                                {isNew ? "Mark read" : "Mark unread"}
                              </button>
                              <label className="sr" htmlFor={`tag-${r.id}`}>
                                {`Add a tag to the rating from ${company}`}
                              </label>
                              <select
                                id={`tag-${r.id}`}
                                className="inp fb-tagsel"
                                value=""
                                onChange={(e) => {
                                  const v = e.target.value as FeedbackTag;
                                  if (!v || tags.includes(v)) return;
                                  update((l) => {
                                    l.tags[String(r.id)] = [...(l.tags[String(r.id)] ?? []), v];
                                    return l;
                                  });
                                  toast(`Tagged ${TAG_LABEL[v]}.`);
                                }}
                              >
                                <option value="">Add tag</option>
                                {TAGS.map((tg) => (
                                  <option key={tg} value={tg}>
                                    {TAG_LABEL[tg]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr>
                          <td colSpan={5} className="fb-reply-cell">
                            <div className="fb-reply">
                              <div className="fb-reply__meta">
                                <span>
                                  <span className="k">To</span> {member ? `${r.customer.email} (owner)` : r.customer.email}
                                </span>
                                <span>
                                  <span className="k">Subject</span> About your Zinwe rating
                                </span>
                              </div>
                              <label className="sr" htmlFor={`ta-${r.id}`}>
                                {`Email to ${person}`}
                              </label>
                              <textarea id={`ta-${r.id}`} className="ta fb-reply__ta" value={draft} onChange={(e) => setDraft(e.target.value)} />
                              <div className="fb-reply__foot">
                                <span className="k">Sent by Zinwe’s email; it shows on the customer’s Emails tab in Subscribers.</span>
                                <div className="fb-reply__btns">
                                  <button type="button" className="btn" onClick={() => setOpen(null)}>
                                    Cancel
                                  </button>
                                  <button type="button" className="btn dark" disabled={!draft.trim() || sending} onClick={() => void send(r)}>
                                    {sending ? "Sending…" : "Send email"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  );
                })}
              </table>
              {rows.length === 0 ? (
                all.length === 0 ? (
                  <div className="fb-empty">
                    <b>No feedback yet</b>
                    <span className="k">Customers send it from the Feedback page in their dashboard; their team members from the Zinwe window.</span>
                  </div>
                ) : (
                  <div className="fb-empty">
                    <b>No ratings match these filters.</b>
                    <span className="k">Try a longer period or another source.</span>
                    <button type="button" className="btn" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </div>
                )
              ) : null}
            </div>
          </section>
          <p className="k" style={{ margin: 0 }}>
            Dashboard ratings come from the Feedback page and the pop-up after 14 days. Windows app ratings come from people on the
            customer's team, from the tray window. Email ratings come from the 14-day and 30-day check-in emails.
          </p>
        </>
      )}
    </>
  );
}

