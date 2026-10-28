import { useCallback, useMemo, useState, type ReactElement } from "react";
import { deleteSubscriber, listSubscribers, type Subscriber, type SubscriberStatus } from "../lib/blogApi";
import { useLoad } from "../lib/useLoad";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import { BlogHeader, dayMonth, dayMonthYear, downloadCsv, staleBlogCounts, todayStamp } from "./blog/shared";
import "../blog.css";

const STATUS: Record<SubscriberStatus, { label: string; tone: string }> = {
  active: { label: "Confirmed", tone: "good" },
  pending: { label: "Not confirmed", tone: "warn" },
  unsubscribed: { label: "Unsubscribed", tone: "bl-st--gone" },
};
const FILTERS: ("all" | SubscriberStatus)[] = ["all", "active", "pending", "unsubscribed"];

type Source = "Blog" | "Series" | "Guide";
/** Where the sign-up came from, from the page it was made on (the API stores the page/source string). */
function sourceOf(s: Subscriber): Source {
  const v = s.source.toLowerCase();
  if (v.includes("guide")) return "Guide";
  if (v.includes("series") || v.includes("ref=") || v.includes("episode")) return "Series";
  return "Blog";
}
const SOURCE_NOTE: Record<Source, [string, string]> = {
  Blog: ["Blog", "articles and the blog page"],
  Series: ["The series", "series pages and ref links"],
  Guide: ["Guides", "guide downloads"],
};

const DAY = 86_400_000;

/** Blog → Subscribers (AdminBlog board): who signed up for the newsletter (double opt-in), where, and erase. */
export function BlogSubscribersPage(): ReactElement {
  const toast = useToast();
  const load = useCallback(() => listSubscribers(), []);
  const list = useLoad(load);
  const [filter, setFilter] = useState<"all" | SubscriberStatus>("all");
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<Subscriber | null>(null);

  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const counts = list.data?.counts;
  const q = query.trim().toLowerCase();
  const shown = rows.filter((s) => (filter === "all" || s.status === filter) && (!q || `${s.email} ${s.source}`.toLowerCase().includes(q)));

  const confirmed = rows.filter((s) => s.status === "active");
  const thisWeek = confirmed.filter((s) => s.confirmed_at && Date.now() - new Date(s.confirmed_at).getTime() < 7 * DAY).length;

  // New confirmed subscribers per week, last 8 weeks (weeks end today).
  const grow = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 8 }, (_, i) => {
      const end = now - (7 - i) * 7 * DAY;
      const start = end - 7 * DAY;
      const n = confirmed.filter((s) => {
        const t = s.confirmed_at ? new Date(s.confirmed_at).getTime() : NaN;
        return t > start && t <= end;
      }).length;
      return { n, label: dayMonth(new Date(start + DAY).toISOString()) };
    });
  }, [confirmed]);
  const growMax = Math.max(1, ...grow.map((w) => w.n));

  const sources = (["Blog", "Series", "Guide"] as Source[]).map((k) => ({ key: k, n: confirmed.filter((s) => sourceOf(s) === k).length }));
  const total = Math.max(1, confirmed.length);

  const exportCsv = () => {
    downloadCsv(
      `zinwe-subscribers-${todayStamp()}.csv`,
      ["Email", "Status", "Signed up on", "Source", "Joined", "Confirmed"],
      shown.map((s) => [s.email, STATUS[s.status].label, s.source, sourceOf(s), s.created_at.slice(0, 10), s.confirmed_at?.slice(0, 10) ?? ""]),
    );
    toast(`Exported ${shown.length} subscribers to zinwe-subscribers-${todayStamp()}.csv`);
  };

  return (
    <>
      <BlogHeader
        known={{ subscribers: counts?.active }}
        action={
          <button type="button" className="btn dark" onClick={exportCsv} disabled={!list.data}>
            <Icon name="download" />
            Export CSV
          </button>
        }
      />

      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || !counts ? (
        <LoadingState rows={6} label="Loading subscribers…" />
      ) : (
        <>
          <section aria-label="Totals" className="bl-totals">
            <div className="card bl-stat">
              <span className="k">Confirmed</span>
              <b className="num">{counts.active.toLocaleString("en-IN")}</b>
              <span className="k">Gets the emails · +{thisWeek} this week</span>
            </div>
            <div className="card bl-stat">
              <span className="k">Not confirmed</span>
              <b className="num">{counts.pending.toLocaleString("en-IN")}</b>
              <span className="k">Signed up, hasn't clicked the link</span>
            </div>
            <div className="card bl-stat">
              <span className="k">Unsubscribed</span>
              <b className="num">{counts.unsubscribed.toLocaleString("en-IN")}</b>
              <span className="k">Gets nothing</span>
            </div>
          </section>

          <div className="bl-two">
            <section className="card bl-panel" aria-labelledby="gr-h">
              <div className="bl-panel__head">
                <h2 id="gr-h">New confirmed subscribers</h2>
                <span className="k">Per week · last 8 weeks</span>
              </div>
              <div
                role="img"
                aria-label={`New confirmed subscribers per week: ${grow.map((w) => `${w.label} ${w.n}`).join(", ")}`}
                className="bl-grow-chart"
              >
                {grow.map((w) => (
                  <div key={w.label} className="bl-grow-col">
                    <span className="k num">{w.n}</span>
                    <span className="bl-grow-bar" style={{ height: Math.max(2, Math.round((w.n / growMax) * 110)) }} />
                  </div>
                ))}
              </div>
              <div className="bl-grow-x">
                {grow.map((w) => (
                  <span key={w.label} className="k">
                    {w.label}
                  </span>
                ))}
              </div>
            </section>
            <section className="card bl-panel" aria-labelledby="src-h">
              <div className="bl-panel__head">
                <h2 id="src-h">Where they signed up</h2>
                <span className="k">Confirmed subscribers</span>
              </div>
              {sources.map((r) => (
                <div key={r.key} className="bl-src">
                  <div className="bl-src__row">
                    <span>
                      <b>{SOURCE_NOTE[r.key][0]}</b> <span className="k">{SOURCE_NOTE[r.key][1]}</span>
                    </span>
                    <span className="num">
                      <b>{r.n.toLocaleString("en-IN")}</b> <span className="k">{Math.round((r.n / total) * 100)}%</span>
                    </span>
                  </div>
                  <span className="bar" style={{ height: 8 }}>
                    <span style={{ width: `${Math.round((r.n / total) * 100)}%` }} />
                  </span>
                </div>
              ))}
            </section>
          </div>

          <section className="card" aria-label="Subscribers" style={{ overflow: "hidden" }}>
            <div className="bl-tablebar">
              <div className="seg" role="group" aria-label="Status">
                {FILTERS.map((f) => (
                  <button key={f} type="button" className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {f === "all" ? "All" : STATUS[f].label}
                  </button>
                ))}
              </div>
              <div className="bl-grow">
                <label className="sr" htmlFor="sq">
                  Search subscribers
                </label>
                <input id="sq" type="search" className="inp" placeholder="Search email or page" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>
            {rows.length === 0 ? (
              <EmptyState
                icon="mail"
                title="No subscribers yet"
                body="The sign-up box is on the website's blog and under every article. New sign-ups get a confirmation email first."
              />
            ) : (
              <div className="tbl-wrap">
                <table className="tbl bl-tbl" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      <th scope="col">Email</th>
                      <th scope="col">Status</th>
                      <th scope="col">Signed up on</th>
                      <th scope="col">Source</th>
                      <th scope="col">Joined</th>
                      <th scope="col">
                        <span className="sr">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{s.email}</td>
                        <td>
                          <span className={"pill " + STATUS[s.status].tone}>
                            <span className="dot" />
                            {STATUS[s.status].label}
                          </span>
                        </td>
                        <td style={{ color: "var(--ink-2)" }}>{s.source || "—"}</td>
                        <td>{sourceOf(s)}</td>
                        <td className="bl-nowrap">{dayMonthYear(s.created_at)}</td>
                        <td className="r">
                          <button type="button" className="btn sm danger" aria-label={`Erase ${s.email}`} onClick={() => setRemoving(s)}>
                            Erase
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length === 0 ? <div className="bl-none">No subscribers match.</div> : null}
              </div>
            )}
          </section>
        </>
      )}

      {removing ? (
        <ConfirmDialog
          title="Erase this subscriber?"
          confirmLabel="Erase"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await deleteSubscriber(removing.id);
            staleBlogCounts();
            toast("Erased.");
            list.reload();
          }}
        >
          <p>
            <b style={{ overflowWrap: "anywhere" }}>{removing.email}</b> and their sign-up history are deleted for good. They get no more
            emails. This can't be undone.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
