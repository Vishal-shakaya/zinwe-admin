import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { getFeedback, type FeedbackRow } from "../lib/api";
import { dateTime } from "../lib/format";
import { pageName } from "../lib/pages";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";

type Band = "all" | "high" | "mid" | "low";

const BANDS: { key: Band; label: string; test: (r: number) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "high", label: "Happy (9–10)", test: (r) => r >= 9 },
  { key: "mid", label: "Okay (7–8)", test: (r) => r >= 7 && r <= 8 },
  { key: "low", label: "Unhappy (1–6)", test: (r) => r <= 6 },
];

function tone(rating: number): string {
  if (rating >= 9) return "good";
  if (rating >= 7) return "warn";
  return "bad";
}

/** What owners tell us from the dashboard's Feedback page (rating 1–10 + a note). */
export function FeedbackPage(): ReactElement {
  const load = useCallback(() => getFeedback(), []);
  const { data, error, pending, reload } = useLoad(load);
  const [band, setBand] = useState<Band>("all");

  const rows: FeedbackRow[] = useMemo(() => {
    const test = BANDS.find((b) => b.key === band)?.test ?? (() => true);
    return (data?.rows ?? []).filter((r) => test(r.rating));
  }, [data, band]);

  const counts = useMemo(() => {
    const all = data?.rows ?? [];
    return {
      high: all.filter((r) => r.rating >= 9).length,
      mid: all.filter((r) => r.rating >= 7 && r.rating <= 8).length,
      low: all.filter((r) => r.rating <= 6).length,
    };
  }, [data]);

  const maxBar = Math.max(1, ...(data?.summary.distribution.map((d) => d.count) ?? [1]));

  return (
    <>
      <PageHeader title="Feedback" subtitle="Ratings and notes from customers, to decide what to improve next." onReload={reload} pending={pending} />

      {error ? (
        <p className="alert alert--bad">{error}</p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat__label">Average rating</span>
              <span className="stat__value">{data.summary.average === null ? "—" : `${data.summary.average}/10`}</span>
              <span className="stat__note">
                {data.summary.count} response{data.summary.count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Happy (9–10)</span>
              <span className="stat__value tone-good">{counts.high}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Okay (7–8)</span>
              <span className="stat__value tone-warn">{counts.mid}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Unhappy (1–6)</span>
              <span className="stat__value tone-bad">{counts.low}</span>
            </div>
          </div>

          {data.summary.count > 0 ? (
            <div className="card dist" aria-label="How ratings are spread">
              <h2 className="card__title">Ratings spread</h2>
              <div className="dist__bars">
                {data.summary.distribution.map((d) => (
                  <div key={d.rating} className="dist__col" title={`${d.count} × ${d.rating}/10`}>
                    <span className="dist__n">{d.count || ""}</span>
                    <span
                      className={"dist__bar dist__bar--" + tone(d.rating)}
                      style={{ height: `${(d.count / maxBar) * 100}%` }}
                    />
                    <span className="dist__label">{d.rating}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="tabs" role="tablist" aria-label="Filter by rating">
            {BANDS.map((b) => (
              <button
                key={b.key}
                type="button"
                role="tab"
                aria-selected={band === b.key}
                className={"tab" + (band === b.key ? " is-active" : "")}
                onClick={() => setBand(b.key)}
              >
                {b.label}
              </button>
            ))}
          </div>

          {data.rows.length === 0 ? (
            <div className="card empty">
              <b>No feedback yet</b>
              <span className="muted">Customers can send it from the Feedback page in their dashboard.</span>
            </div>
          ) : rows.length === 0 ? (
            <p className="muted">No feedback in this range.</p>
          ) : (
            <div className="card table-card">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Rating</th>
                    <th>Feedback</th>
                    <th>Customer</th>
                    <th>Sent</th>
                    <th>Follow up</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className={"score score--" + tone(r.rating)}>{r.rating}</span>
                      </td>
                      <td className="fb-msg">
                        {r.message ? r.message : <span className="muted">No comment</span>}
                        {r.page ? <small className="muted block">Sent from {pageName(r.page)}</small> : null}
                      </td>
                      <td>
                        <b>{r.customer.full_name || r.customer.email}</b>
                        <small className="muted block">{r.customer.email}</small>
                        {r.customer.company ? <small className="muted block">{r.customer.company}</small> : null}
                      </td>
                      <td className="nowrap">{dateTime(r.created_at)}</td>
                      <td>
                        <div className="fb-actions">
                          <Link
                            className={"btn btn--sm " + (r.rating <= 6 ? "btn--primary" : "btn--ghost")}
                            to={`/subscribers?compose=${r.customer.id}`}
                          >
                            Email them
                          </Link>
                          <Link className="link-btn" to={`/subscribers?open=${r.customer.id}`}>
                            Open customer
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
