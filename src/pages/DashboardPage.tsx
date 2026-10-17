import { useCallback, type ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import { getMetrics } from "../lib/api";
import { inr } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";

const ORANGE = "#FD6D02";

export function DashboardPage(): ReactElement {
  const load = useCallback(() => getMetrics(), []);
  const { data, error, pending, reload } = useLoad(load);
  // Numbers, not "971.00" strings, so the axis scales from the real values.
  const revenue = (data?.revenue ?? []).map((r) => ({ month: r.month, revenue_inr: Number(r.revenue_inr) }));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="What needs you now, who's signing up, who's paying." onReload={reload} pending={pending} />

      {error ? (
        <p className="alert alert--bad">{error}</p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="stats stats--dash">
            <Stat
              label="Payments to check"
              value={String(data.totals.pending_payments)}
              note={data.totals.pending_payments ? "Needs attention" : "All clear"}
              highlight={data.totals.pending_payments > 0}
              to="/subscribers?status=waiting"
            />
            <Stat
              label="Support waiting"
              value={data.totals.support_waiting === undefined ? "—" : String(data.totals.support_waiting)}
              note={
                data.totals.support_waiting === undefined
                  ? "Open the inbox"
                  : data.totals.support_waiting
                    ? "Customers waiting for an answer"
                    : "Nobody waiting"
              }
              highlight={Boolean(data.totals.support_waiting)}
              to="/support"
            />
            <Stat label="Accounts" value={String(data.totals.users)} note={`${data.totals.verified_users} verified`} />
            <Stat
              label="Active plans"
              value={String(data.totals.active_subscriptions)}
              note={`${data.totals.paying} paying · ${data.totals.active_subscriptions - data.totals.paying} free`}
            />
            <Stat label="Revenue (verified)" value={inr(data.totals.revenue_inr)} note="All-time" />
            <Stat
              label="Feedback"
              value={data.totals.feedback.average === null ? "—" : `${data.totals.feedback.average}/10`}
              note={`${data.totals.feedback.count} response${data.totals.feedback.count === 1 ? "" : "s"}`}
              to="/feedback"
            />
          </div>

          <div className="charts">
            <div className="card">
              <h2 className="card__title">Sign-ups · last 30 days</h2>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.signups} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g-signups" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ORANGE} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={ORANGE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} domain={[0, (max: number) => Math.max(5, max)]} />
                  <Tooltip labelFormatter={(label) => shortDay(String(label))} />
                  <Area type="monotone" dataKey="count" name="Sign-ups" stroke={ORANGE} fill="url(#g-signups)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <h2 className="card__title">Revenue · last 6 months</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={revenue} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={64}
                    allowDecimals={false}
                    domain={[0, (max: number) => Math.max(1000, max)]}
                    tickFormatter={(v) => inr(v)}
                  />
                  <Tooltip formatter={(v) => inr(v as number)} labelFormatter={(label) => shortMonth(String(label))} />
                  <Bar dataKey="revenue_inr" name="Revenue" fill={ORANGE} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  note,
  highlight,
  to,
}: {
  label: string;
  value: string;
  note?: string;
  highlight?: boolean;
  /** Makes the whole tile a link to the page that acts on it. */
  to?: string;
}): ReactElement {
  const className = "stat" + (highlight ? " stat--hot" : "") + (to ? " stat--link" : "");
  const body = (
    <>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {note ? <span className="stat__note">{note}</span> : null}
    </>
  );
  return to ? (
    <Link className={className} to={to}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function shortDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function shortMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}
