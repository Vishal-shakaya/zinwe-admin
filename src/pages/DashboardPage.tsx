import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  getAnnouncements,
  getForms,
  getMetrics,
  getReleases,
  getSubscribers,
  getSubscriptions,
  getSupportTickets,
  type AdminMe,
  type AdminSubscription,
  type AgentRelease,
  type Announcement,
  type FormSubmission,
  type Metrics,
  type Subscriber,
  type SupportTicketRow,
} from "../lib/api";
import { ApiError } from "../lib/api";
import { methodLabel } from "../lib/format";
import { Icon, type IconName } from "../components/icons";
import { ErrorState, SampleTag } from "../components/States";
import {
  AGENT_VERSIONS_BY_DAY,
  AGENT_VERSION_LABELS,
  AGENT_VERSIONS_NOTE,
  WEBSITE_LIVE,
} from "../content/fixtures/dashboard";
import { getLogsStatus, type LogsStatus } from "../lib/logsApi";
import { useAdminEnv } from "../lib/env";
import { SAMPLES_ON } from "../lib/samples";
import "../styles/dashboard.css";

/* ---------- data ---------- */

interface Side {
  subscribers: Subscriber[] | null;
  subscriptions: AdminSubscription[] | null;
  support: SupportTicketRow[] | null;
  forms: FormSubmission[] | null;
  releases: AgentRelease[] | null;
  announcements: Announcement[] | null;
  /** Logs (FR-37): last deploy / backup and the failures nobody has handled. */
  logs: LogsStatus | null;
}

const EMPTY_SIDE: Side = {
  subscribers: null,
  subscriptions: null,
  support: null,
  forms: null,
  releases: null,
  announcements: null,
  logs: null,
};

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

/* ---------- formatting ---------- */

const TZ = "Asia/Kolkata";
const inr0 = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const inr2 = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const short = (n: number) => (n >= 1000 ? "₹" + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k" : "₹" + Math.round(n));
const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (d: Date) => {
  const [, m, day] = dayKey(d).split("-").map(Number);
  return `${day} ${MON[m - 1]}`;
};

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(now)) return hhmm(d);
  if (dayKey(d) === dayKey(yesterday)) return `Yesterday ${hhmm(d)}`;
  return dayMonth(d);
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day" : `${d} days`;
}

function greeting(): string {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ }));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function firstName(me: AdminMe): string {
  const full = (me.full_name || "").trim();
  if (full) return full.split(/\s+/)[0];
  const local = me.email.replace(/@.*/, "");
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/* ---------- div charts (board markup) ---------- */

interface Tick {
  label: string;
  pct: number;
}

function ticks(domain: number, step: number, fmt: (v: number) => string): Tick[] {
  const out: Tick[] = [];
  for (let v = 0; v <= domain + 0.0001; v += step) out.push({ label: fmt(v), pct: (v / domain) * 100 });
  return out;
}

function xLabelStyle(i: number, n: number): CSSProperties {
  if (i === 0) return { left: 0 };
  if (i === n - 1) return { right: 0 };
  return { left: "50%", transform: "translateX(-50%)" };
}

function Axis({ items, height }: { items: Tick[]; height: number }): ReactElement {
  return (
    <div aria-hidden="true" className="dbc__axis" style={{ height }}>
      {items.map((t) => (
        <span key={t.label} className="k num dbc__tick" style={{ bottom: `${t.pct}%` }}>
          {t.label}
        </span>
      ))}
    </div>
  );
}

function Gridlines({ items }: { items: Tick[] }): ReactElement {
  return (
    <>
      {items.map((t) =>
        t.pct === 0 ? null : <span key={t.label} aria-hidden="true" className="dbc__line" style={{ bottom: `${t.pct}%` }} />,
      )}
    </>
  );
}

function ChartEmpty({ text }: { text: string }): ReactElement {
  return (
    <div className="dbc__empty">
      <span>{text}</span>
    </div>
  );
}

/* ---------- page ---------- */

export function DashboardPage({ me }: { me: AdminMe }): ReactElement {
  const dev = useAdminEnv() === "dev";
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [side, setSide] = useState<Side>(EMPTY_SIDE);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [updated, setUpdated] = useState<string>("");
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [m, subs, subscriptions, support, forms, releases, announcements, logs] = await Promise.allSettled([
      getMetrics(),
      getSubscribers(),
      getSubscriptions(),
      getSupportTickets(),
      getForms({ status: "new" }),
      getReleases(),
      getAnnouncements(),
      getLogsStatus(),
    ]);
    if (m.status === "fulfilled") {
      setMetrics(m.value);
      setError(null);
    } else {
      setError(m.reason instanceof ApiError ? m.reason.message : "The admin API didn’t answer.");
    }
    setSide({
      subscribers: settled(subs),
      subscriptions: settled(subscriptions),
      support: settled(support)?.rows ?? null,
      forms: settled(forms)?.rows ?? null,
      releases: settled(releases),
      announcements: settled(announcements),
      logs: settled(logs),
    });
    setUpdated(hhmm(new Date()));
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  const now = new Date();
  const dateLine =
    now
      .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ })
      .toUpperCase() + " · IST";

  const view = useMemo(() => (metrics ? build(metrics, side) : null), [metrics, side]);

  return (
    <div className="zdash">
      <header className="phead">
        <div className="zdash__titlebox">
          <span className="k zdash__date">{dateLine}</span>
          <div className="zdash__titlerow">
            <h1 className="zdash__title">
              {greeting()}, {firstName(me)}
            </h1>
          </div>
        </div>
        <div className="phead__actions">
          <span className="k" role="status">
            {refreshing ? "Refreshing…" : updated ? `Updated ${updated} IST` : ""}
          </span>
          <button type="button" className="btn" onClick={() => setNonce((n) => n + 1)} disabled={refreshing}>
            <Icon name="refresh" />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      <SystemCard dev={dev} apiLive={!error && Boolean(metrics)} loading={!metrics && !error} logs={side.logs} />

      {error && !metrics ? (
        <ErrorState title="The dashboard couldn’t load" message={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : !view ? (
        <DashboardSkeleton />
      ) : (
        <>
          <NeedsNow view={view} />

          <section aria-label="Key numbers" className="zdash__tiles">
            {view.tiles.map((t) => (
              <Link key={t.label} className="tile" to={t.to}>
                <span className="zdash__tlabel">{t.label}</span>
                <b className="num zdash__tvalue">{t.value}</b>
                {t.extra ? <span className="num zdash__textra">{t.extra}</span> : null}
                <span className="k">{t.sub}</span>
              </Link>
            ))}
          </section>

          <div className="zdash__charts">
            <SignupsChart signups={metrics?.signups ?? []} />
            <RevenueChart view={view} />
            {SAMPLES_ON ? <VersionsChart /> : null}
          </div>

          <section className="card zdash__act" aria-labelledby="act-h">
            <div className="zdash__acthead">
              <h2 id="act-h">Recent activity</h2>
              {SAMPLES_ON ? (
                <Link to="/logs" className="zdash__more">
                  Full timeline in Logs
                </Link>
              ) : null}
            </div>
            {view.activity.length ? (
              view.activity.map((a) => (
                <Link key={a.key} className="zdash__actrow" to={a.to}>
                  <span aria-hidden="true" className="zdash__acticon">
                    <Icon name={a.icon} size={15} />
                  </span>
                  <span className="zdash__acttext">
                    <span>
                      <b>{a.title}</b> <span className="zdash__actdetail">· {a.detail}</span>
                    </span>
                    <span className="k">{a.who}</span>
                  </span>
                  <span className="k num zdash__actat">{a.at}</span>
                </Link>
              ))
            ) : (
              <p className="zdash__actempty">No activity yet. Sign-ups, payments, releases and announcements show up here.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* ---------- view model ---------- */

interface PayRow {
  id: number;
  co: string;
  plan: string;
  amt: string;
  split: string;
  method: string;
  hasProof: boolean;
  ago: string;
  at: string;
}

interface OtherRow {
  key: string;
  icon: IconName;
  tone: "plain" | "bad";
  title: string;
  body: string;
  meta: string;
  to: string;
  cta: string;
  sample?: boolean;
}

interface TileView {
  label: string;
  value: string;
  extra?: string;
  sub: string;
  to: string;
}

interface ActivityRow {
  key: string;
  icon: IconName;
  title: string;
  detail: string;
  who: string;
  at: string;
  ts: number;
  to: string;
}

interface View {
  payments: PayRow[];
  others: OtherRow[];
  needsSub: string;
  tiles: TileView[];
  revenue: { month: string; value: number }[];
  usdThisMonth: number;
  activity: ActivityRow[];
}

function build(m: Metrics, side: Side): View {
  const subs = side.subscribers ?? [];
  const cycleOf = new Map<number, string>();
  for (const s of side.subscriptions ?? []) cycleOf.set(s.owner.id, s.billing_cycle);

  // Needs you now: payments to check (newest first)
  const payments: PayRow[] = subs
    .flatMap((s) =>
      s.payments
        .filter((p) => p.status === "submitted")
        .map((p) => {
          const expected = Number(p.expected_inr || p.amount_inr);
          const due = p.due_total ? Number(p.due_total) : Number(p.amount_inr);
          const tax = Math.max(0, Math.round((due - expected) * 100) / 100);
          const kind = p.is_renewal ? "renewal" : p.upgrade_from ? "upgrade" : "first payment";
          const cycle = cycleOf.get(s.id);
          const sent = new Date(p.submitted_at);
          return {
            id: p.id,
            co: s.company?.name || s.full_name || s.email,
            plan: [p.plan.name, s.plan ? `${s.plan.max_devices} PCs` : "", cycle ? `${cycle} ${kind}` : kind]
              .filter(Boolean)
              .join(" · "),
            amt: inr2(due),
            split: tax > 0 ? `${inr2(expected)} + ${inr2(tax)} GST` : "No GST on this payment",
            method: methodLabel(p.method),
            hasProof: p.has_proof,
            ago: `Sent ${whenLabel(p.submitted_at)}`,
            at: Number.isNaN(sent.getTime()) ? "" : p.submitted_at,
          };
        }),
    )
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const others: OtherRow[] = [];
  const waiting = (side.support ?? []).filter((t) => t.status === "open");
  if (waiting.length) {
    const byNewest = [...waiting].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    const oldest = [...waiting].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
    const first = byNewest[0];
    const who = (t: SupportTicketRow) => t.customer.company || t.customer.full_name || t.customer.email;
    const body =
      waiting.length === 1
        ? `${who(first)} (${ageLabel(first.created_at)}), “${first.subject}”`
        : `First: ${who(first)} (${ageLabel(first.updated_at)}), “${first.subject}” · Oldest: ${who(oldest)} (${ageLabel(oldest.created_at)}), “${oldest.subject}”`;
    others.push({
      key: "support",
      icon: "support",
      tone: "plain",
      title: waiting.length === 1 ? "1 support conversation waiting for us" : `${waiting.length} support conversations waiting for us`,
      body,
      meta: `Oldest ${ageLabel(oldest.created_at)}`,
      to: "/support",
      cta: "Open Support",
    });
  }
  const forms = side.forms ?? [];
  if (forms.length) {
    const newest = [...forms].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    others.push({
      key: "forms",
      icon: "forms",
      tone: "plain",
      title: forms.length === 1 ? "1 new form" : `${forms.length} new forms`,
      body: newest
        .slice(0, 4)
        .map((f) => `${f.kind_label}: ${[f.name, f.company].filter(Boolean).join(", ")}`)
        .join(" · "),
      meta: `Newest ${whenLabel(newest[0].created_at)}`,
      to: "/forms",
      cta: "Open Forms",
    });
  }
  // Logs (FR-37): failed deploys / backups nobody has handled yet.
  const failed = side.logs?.attention ?? [];
  const failedCount = side.logs?.unresolved ?? 0;
  if (failed.length) {
    const kinds = new Set(failed.map((e) => e.type));
    const one = failedCount === 1 ? failed[0] : null;
    others.push({
      key: "logs",
      icon: "warn",
      tone: "bad",
      title: one
        ? one.type === "backup"
          ? /off-site copy failed/i.test(one.what)
            ? "Off-site backup failed"
            : "Backup failed"
          : one.type === "deploy"
            ? `${one.label} failed`
            : "A server job failed"
        : `${failedCount} server jobs failed${kinds.size === 1 && kinds.has("backup") ? " (backups)" : ""}`,
      body: failed
        .slice(0, 3)
        .map((e) => `${dayMonth(new Date(e.at))}, ${hhmm(new Date(e.at))}: ${e.what}`)
        .join(" · "),
      meta: `${failedCount === 1 ? "" : "Newest "}${ageLabel(failed[0].at)} ago`,
      to: "/logs",
      cta: "Open Logs",
    });
  }

  const oldestDates = [
    ...payments.map((p) => p.at),
    ...waiting.map((t) => t.created_at),
    ...forms.map((f) => f.created_at),
  ].filter(Boolean);
  const oldestIso = oldestDates.sort()[0];
  const parts = [
    payments.length ? `${payments.length} payment${payments.length === 1 ? "" : "s"}` : "",
    waiting.length ? `${waiting.length} support` : "",
    forms.length ? `${forms.length} form${forms.length === 1 ? "" : "s"}` : "",
    failedCount ? `${failedCount} failed job${failedCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const needsSub = parts.length ? parts.join(" · ") + (oldestIso ? ` · oldest waiting ${ageLabel(oldestIso)}` : "") : "All clear";

  // Tiles
  const t = m.totals;
  const signups = m.signups.map((s) => s.count);
  const thisWeek = signups.slice(-7).reduce((a, b) => a + b, 0);
  const lastWeek = signups.slice(-14, -7).reduce((a, b) => a + b, 0);
  let mrrInr = 0;
  let mrrUsd = 0;
  for (const s of side.subscriptions ?? []) {
    if (s.status !== "active" || s.is_trial) continue;
    const amt = Number(s.amount_inr) || 0;
    const monthly = s.billing_cycle === "yearly" ? amt / 12 : amt;
    if (s.currency === "USD") mrrUsd += monthly;
    else mrrInr += monthly;
  }
  const pcs = subs.reduce((a, s) => a + (s.team?.devices ?? 0), 0);
  const companiesWithPcs = subs.filter((s) => (s.team?.devices ?? 0) > 0).length;
  const live = (side.releases ?? []).filter((r) => r.is_active).sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
  const latest = live[0];
  const supportOpen = (side.support ?? []).filter((x) => x.status !== "closed");
  const oldestWaiting = waiting.length ? [...waiting].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0] : null;
  const tiles: TileView[] = [
    {
      label: "Subscribers",
      value: String(t.users),
      sub: t.users ? `${t.paying} paying · ${Math.max(0, t.users - t.paying)} free` : "No companies yet",
      to: "/subscribers",
    },
    {
      label: "MRR",
      value: side.subscriptions ? inr0(mrrInr) : "—",
      extra: mrrUsd > 0 ? `+ $${Math.round(mrrUsd)} / mo in USD` : undefined,
      sub: "Excl. GST · USD kept separate",
      to: "/subscriptions",
    },
    {
      label: "PCs protected",
      value: side.subscribers ? String(pcs) : "—",
      sub: pcs ? `Enrolled at ${companiesWithPcs} compan${companiesWithPcs === 1 ? "y" : "ies"}` : "No agents installed yet",
      to: "/subscribers",
    },
    {
      label: "Sign-ups this week",
      value: String(thisWeek),
      sub: lastWeek || thisWeek ? `${lastWeek} the week before` : "None last week either",
      to: "/subscribers",
    },
    {
      label: "Active agents",
      value: latest ? String(latest.adoption.total) : "0",
      sub: latest
        ? `Active PCs · ${latest.adoption.total ? Math.round((latest.adoption.updated / latest.adoption.total) * 100) : 0}% on ${latest.version} (latest)`
        : "No release published yet",
      to: "/releases",
    },
    {
      label: "Open support",
      value: side.support ? String(supportOpen.length) : "—",
      sub: waiting.length
        ? `${waiting.length} waiting on us · oldest ${ageLabel(oldestWaiting!.created_at)}`
        : supportOpen.length
          ? "Nobody waiting on us"
          : "Nobody waiting",
      to: "/support",
    },
  ];

  // Revenue + USD this month (invoices issued this month in dollars)
  const revenue = m.revenue.map((r) => ({ month: r.month, value: Number(r.revenue_inr) || 0 }));
  const thisMonth = dayKey(new Date()).slice(0, 7);
  let usdThisMonth = 0;
  for (const s of side.subscriptions ?? [])
    for (const inv of s.invoices)
      if (inv.currency === "USD" && inv.issued_at.slice(0, 7) === thisMonth) usdThisMonth += Number(inv.total) || 0;

  // Recent activity, from real records
  const activity: ActivityRow[] = [];
  const push = (row: Omit<ActivityRow, "at" | "ts"> & { iso: string }) => {
    const ts = new Date(row.iso).getTime();
    if (!Number.isFinite(ts)) return;
    activity.push({ ...row, at: whenLabel(row.iso), ts });
  };
  for (const s of subs) {
    const co = s.company?.name || s.full_name || s.email;
    push({
      key: `su${s.id}`,
      icon: "signup",
      title: "New sign-up",
      detail: [co, s.plan ? `${s.plan.name}, ${s.plan.max_devices} PCs` : ""].filter(Boolean).join(" · "),
      who: "Signed up on zinwe.io",
      iso: s.date_joined,
      to: `/subscribers?open=${s.id}`,
    });
    for (const p of s.payments) {
      if (p.status !== "verified" || !p.reviewed_at) continue;
      const total = p.due_total ? Number(p.due_total) : Number(p.amount_inr);
      push({
        key: `pa${p.id}`,
        icon: "check",
        title: "Payment approved",
        detail: `${co} · ${p.plan.name} · ${inr2(total)}${total > Number(p.expected_inr || p.amount_inr) ? " incl. GST" : ""} · ${methodLabel(p.method)}`,
        who: p.reviewed_by || "Paid online",
        iso: p.reviewed_at,
        to: `/subscribers?open=${s.id}`,
      });
    }
  }
  for (const r of side.releases ?? [])
    push({
      key: `re${r.id}`,
      icon: "releases",
      title: "Release published",
      detail: `Windows agent ${r.version} · ${r.required ? "Required" : "Optional"}`,
      who: r.published_by || "—",
      iso: r.published_at,
      to: "/releases",
    });
  for (const a of side.announcements ?? [])
    push({
      key: `an${a.id}`,
      icon: "announcements",
      title: "Announcement sent",
      detail: `${a.title} · ${a.audience === "everyone" ? "all owners" : a.audience === "owners" ? "chosen customers" : `${a.audience} plans`}`,
      who: a.created_by || "—",
      iso: a.created_at,
      to: "/announcements",
    });
  activity.sort((a, b) => b.ts - a.ts);

  return { payments, others, needsSub, tiles, revenue, usdThisMonth, activity: activity.slice(0, 6) };
}

/* ---------- sections ---------- */

function SystemCard({
  dev,
  apiLive,
  loading,
  logs,
}: {
  dev: boolean;
  apiLive: boolean;
  loading: boolean;
  logs: LogsStatus | null;
}): ReactElement {
  // Last deploy and last backup: this environment's Logs (FR-37). The Website pill is still sample (dev server only).
  const deploy = logs?.last_deploy ?? null;
  const backup = logs?.last_backup ?? null;
  const backupBad = backup?.result === "fail";
  const offsite = backup ? /off-site copy/i.test(backup.what) && !/not set up/i.test(backup.what) : false;
  const live = (
    <span className="pill good">
      <span className="dot" />
      Live
    </span>
  );
  return (
    <section aria-label="System" className="card zdash__sys">
      <span className="zdash__sysitem">
        <b>{dev ? "Dev API" : "Prod API"}</b>
        {loading ? (
          <span className="pill">
            <span className="dot" />
            Checking
          </span>
        ) : apiLive ? (
          live
        ) : (
          <span className="pill bad">
            <span className="dot" />
            Not answering
          </span>
        )}
      </span>
      {SAMPLES_ON ? (
        <span className="zdash__sysitem">
          <b>Website</b>
          {WEBSITE_LIVE ? live : null}
          <SampleTag what="Sample" />
        </span>
      ) : null}
      <span className="zdash__sysitem">
        <b>Admin</b>
        {live}
      </span>
      {deploy ? (
        <span className="zdash__sysitem">
          <span className="k">Last deploy</span>
          <span className="mono" style={{ fontSize: 12 }}>
            {deploy.what.match(/\d{8}-\d{4,6}/)?.[0] ?? deploy.label}
          </span>
          <span className="k">{whenLabel(deploy.at)}</span>
          {deploy.result !== "ok" ? (
            <span className={"pill " + (deploy.result === "rolled" ? "warn" : "bad")}>
              <span className="dot" />
              {deploy.result === "rolled" ? "Rolled back" : "Failed"}
            </span>
          ) : null}
        </span>
      ) : null}
      {backup ? (
        <span className="zdash__sysitem">
          <span className="k">Last backup</span>
          <span>{whenLabel(backup.at)}</span>
          <span className={"pill " + (backupBad ? "bad" : "good")}>
            <span className="dot" />
            {backupBad
              ? /off-site copy failed/i.test(backup.what)
                ? "Off-site copy failed"
                : "Failed"
              : offsite
                ? "Off-site copy OK"
                : "OK"}
          </span>
        </span>
      ) : null}
      <Link to="/logs" className="zdash__sysmore">
        Open logs
      </Link>
    </section>
  );
}

function NeedsNow({ view }: { view: View }): ReactElement {
  const has = view.payments.length > 0 || view.others.length > 0;
  return (
    <section className="card zdash__needs" aria-labelledby="needs-h">
      <div className="zdash__needshead">
        <h2 id="needs-h">Needs you now</h2>
        <span className="k">{view.needsSub}</span>
      </div>
      {has ? (
        <div className="zdash__needslist">
          {view.payments.length ? (
            <>
              <div className="zdash__payhead">
                <h3>{view.payments.length === 1 ? "1 payment to check" : `${view.payments.length} payments to check`}</h3>
                <span className="k">Customers uploaded proof. Find each one in the bank or UPI statement, then approve.</span>
              </div>
              {view.payments.map((p) => (
                <div key={p.id} className="zdash__pay">
                  <span aria-hidden="true" className="zdash__ico zdash__ico--pay">
                    <Icon name="pay" size={17} />
                  </span>
                  <div className="zdash__payco">
                    <b>{p.co}</b>
                    <span className="k">{p.plan}</span>
                  </div>
                  <div className="zdash__payamt">
                    <b className="num">{p.amt}</b>
                    <span className="k num">{p.split}</span>
                  </div>
                  <div className="zdash__paymeta">
                    <span>
                      <span className="pill">{p.method}</span>
                    </span>
                    <Link to={`/subscribers?review=${p.id}`} className="zdash__proof">
                      {p.hasProof ? "Proof: receipt uploaded" : "No proof uploaded"}
                    </Link>
                  </div>
                  <span className="k zdash__ago">{p.ago}</span>
                  <Link className="btn dark" to={`/subscribers?review=${p.id}`} aria-label={`Check payment from ${p.co}`}>
                    Check payment
                  </Link>
                </div>
              ))}
            </>
          ) : null}
          {view.others.map((o) => (
            <div key={o.key} className="zdash__other">
              <span aria-hidden="true" className={"zdash__ico" + (o.tone === "bad" ? " zdash__ico--bad" : "")}>
                <Icon name={o.icon} size={17} />
              </span>
              <div className="zdash__othertext">
                <b>
                  {o.title} {o.sample ? <SampleTag /> : null}
                </b>
                <span className="zdash__otherbody">{o.body}</span>
              </div>
              <span className="k zdash__othermeta">{o.meta}</span>
              <Link className="btn" to={o.to}>
                {o.cta}
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="zdash__clear">
          <span aria-hidden="true" className="zdash__clearicon">
            <Icon name="check" size={18} strokeWidth={2} />
          </span>
          <div className="zdash__cleartext">
            <b>Nothing needs you right now</b>
            <span className="k">No payments to check, nobody waiting in Support, no new forms, backups OK.</span>
          </div>
        </div>
      )}
    </section>
  );
}

function SignupsChart({ signups }: { signups: Metrics["signups"] }): ReactElement {
  const values = signups.map((s) => s.count);
  const max = Math.max(0, ...values);
  const dom = Math.max(4, Math.ceil(max / 2) * 2);
  const total = values.reduce((a, b) => a + b, 0);
  const n = values.length;
  const labelAt = new Set([0, 7, 14, 21, n - 1]);
  const items = ticks(dom, dom / 4, (v) => String(v));
  const thisWeek = values.slice(-7).reduce((a, b) => a + b, 0);
  return (
    <section className="card zdash__chart zdash__chart--full" aria-labelledby="ch-sign">
      <div className="zdash__charthead">
        <div className="zdash__chartttl">
          <h2 id="ch-sign">Sign-ups per day</h2>
          <span className="k">New company accounts · last 30 days</span>
        </div>
        <div className="zdash__chartnums">
          <span>
            <b className="num">{total}</b> <span className="k">in 30 days</span>
          </span>
          <span>
            <b className="num">{max}</b> <span className="k">busiest day</span>
          </span>
        </div>
      </div>
      <div
        role="img"
        aria-label={`Bar chart of sign-ups per day for the last 30 days: ${total} in total, at most ${max} on one day, ${thisWeek} this week.`}
        className="dbc dbc--sign"
      >
        <Axis items={items} height={170} />
        <div className="dbc__plot" style={{ height: 170 }}>
          <Gridlines items={items} />
          <div className="dbc__bars" style={{ gap: 3 }}>
            {signups.map((s, i) => (
              <span
                key={s.date}
                title={`${dayMonth(new Date(s.date))} · ${s.count} ${s.count === 1 ? "sign-up" : "sign-ups"}`}
                className="dbc__bar"
                style={{ height: `${(s.count / dom) * 100}%`, background: i === n - 1 ? "#16181B" : "#3B4048" }}
              />
            ))}
          </div>
          {total === 0 ? <ChartEmpty text="No sign-ups in the last 30 days. They show here as soon as a company creates an account." /> : null}
        </div>
        <span />
        <div aria-hidden="true" className="dbc__x" style={{ gap: 3 }}>
          {signups.map((s, i) => (
            <span key={s.date} className="dbc__xcell">
              <span className={"k dbc__xlabel" + (i > 0 && i < n - 1 ? " dbc__xlabel--mid" : "")} style={xLabelStyle(i, n)}>
                {labelAt.has(i) ? (i === n - 1 ? "Today" : dayMonth(new Date(s.date))) : ""}
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function niceStep(max: number): number {
  const raw = Math.max(1, max) / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function monthName(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return MON[m - 1];
}

function RevenueChart({ view }: { view: View }): ReactElement {
  const rev = view.revenue;
  const max = Math.max(0, ...rev.map((r) => r.value));
  const step = niceStep(max || 10000);
  const dom = Math.max(step * 5, Math.ceil(max / step) * step);
  const items = ticks(dom, step, (v) => (v ? short(v) : "₹0"));
  const empty = max === 0;
  const last = rev[rev.length - 1];
  return (
    // Full width when the (sample) versions chart beside it is hidden in production builds.
    <section className={"card zdash__chart" + (SAMPLES_ON ? "" : " zdash__chart--full")} aria-labelledby="ch-rev">
      <div className="zdash__chartttl">
        <h2 id="ch-rev">Revenue per month</h2>
        <span className="k">Verified INR payments · last 6 months</span>
      </div>
      <div className="zdash__legend">
        <span>
          <span aria-hidden="true" className="zdash__sw" style={{ background: "#3B4048" }} />
          Verified payments, as recorded
        </span>
      </div>
      <div
        role="img"
        aria-label={`Bar chart of verified revenue per month: ${rev.map((r) => `${monthName(r.month)} ${inr0(r.value)}`).join(", ")}.`}
        className="dbc dbc--rev"
      >
        <Axis items={items} height={190} />
        <div className="dbc__plot" style={{ height: 190 }}>
          <Gridlines items={items} />
          <div className="dbc__bars" style={{ gap: 8 }}>
            {rev.map((r, i) => (
              <div key={r.month} className="dbc__slot">
                <div
                  title={`${monthName(r.month)}${i === rev.length - 1 ? " (to date)" : ""} · ${inr0(r.value)}`}
                  className="dbc__stack"
                  style={{ height: `${(r.value / dom) * 100}%`, display: r.value ? "flex" : "none" }}
                >
                  <span className="num dbc__top">{short(Math.round(r.value / 100) * 100)}</span>
                  <span style={{ display: "block", flex: "1 0 0", background: i === rev.length - 1 ? "#16181B" : "#3B4048", borderRadius: "3px 3px 0 0" }} />
                </div>
              </div>
            ))}
          </div>
          {empty ? <ChartEmpty text="No verified payments yet." /> : null}
        </div>
        <span />
        <div aria-hidden="true" className="dbc__x dbc__x--months" style={{ gap: 8 }}>
          {rev.map((r, i) => (
            <span key={r.month} className="dbc__month">
              <span className="k" style={{ color: "var(--ink-2)" }}>
                {monthName(r.month)}
              </span>
              <span className="k" style={{ fontSize: 11 }}>
                {i === rev.length - 1 ? "to date" : " "}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="zdash__chartfoot">
        <span>
          <span className="k">{last ? new Date(`${last.month}-01`).toLocaleDateString("en-GB", { month: "long" }) : "This month"} so far</span>{" "}
          <b className="num">{inr0(last?.value ?? 0)}</b>
        </span>
        <span>
          <span className="k">Paid in USD, not in chart</span> <b className="num">${Math.round(view.usdThisMonth)}</b>{" "}
          <span className="k">via Skydo</span>
        </span>
      </div>
    </section>
  );
}

function VersionsChart(): ReactElement {
  const data = AGENT_VERSIONS_BY_DAY;
  const dom = 250;
  const items = ticks(dom, 50, (v) => String(v));
  const COL = ["#16181B", "#6E747C", "#C9CCD1"];
  const today = data[data.length - 1].counts;
  const labelAt = new Set([0, 4, 8, data.length - 1]);
  return (
    <section className="card zdash__chart" aria-labelledby="ch-ver">
      <div className="zdash__chartttl">
        <h2 id="ch-ver">
          Agent versions in use <SampleTag />
        </h2>
        <span className="k">PCs online each day, by Windows agent version · last 14 days</span>
      </div>
      <div className="zdash__legend">
        {AGENT_VERSION_LABELS.map((label, i) => (
          <span key={label}>
            <span
              aria-hidden="true"
              className="zdash__sw"
              style={{ background: COL[i], outline: i === 2 ? "1px solid #A9ACB1" : undefined, outlineOffset: -1 }}
            />
            {label} <b className="num" style={{ color: "var(--ink)" }}>{today[i]}</b>
          </span>
        ))}
      </div>
      <div
        role="img"
        aria-label={`Stacked bar chart of PCs online per day by agent version, last 14 days. Today: ${today[0]} on ${AGENT_VERSION_LABELS[0]}, ${today[1]} on ${AGENT_VERSION_LABELS[1]}, ${today[2]} older.`}
        className="dbc dbc--rev"
        style={{ paddingTop: 8 }}
      >
        <Axis items={items} height={190} />
        <div className="dbc__plot" style={{ height: 190 }}>
          <Gridlines items={items} />
          <div className="dbc__bars" style={{ gap: 4 }}>
            {data.map((d) => {
              const tot = d.counts[0] + d.counts[1] + d.counts[2];
              return (
                <div
                  key={d.day}
                  title={`${dayMonth(new Date(d.day))} · ${AGENT_VERSION_LABELS[0]}: ${d.counts[0]}, ${AGENT_VERSION_LABELS[1]}: ${d.counts[1]}, older: ${d.counts[2]}`}
                  className="dbc__vstack"
                  style={{ height: `${(tot / dom) * 100}%` }}
                >
                  {d.counts.map((c, i) => (
                    <span key={i} style={{ display: "block", flex: `${c} 0 0`, background: COL[i] }} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        <span />
        <div aria-hidden="true" className="dbc__x" style={{ gap: 4 }}>
          {data.map((d, i) => (
            <span key={d.day} className="dbc__xcell">
              <span
                className={"k dbc__xlabel" + (i > 0 && i < data.length - 1 ? " dbc__xlabel--mid" : "")}
                style={xLabelStyle(i, data.length)}
              >
                {labelAt.has(i) ? (i === data.length - 1 ? "Today" : dayMonth(new Date(d.day))) : ""}
              </span>
            </span>
          ))}
        </div>
      </div>
      <span className="k zdash__chartnote">{AGENT_VERSIONS_NOTE}</span>
    </section>
  );
}

function DashboardSkeleton(): ReactElement {
  return (
    <div role="status" aria-live="polite" className="zdash__skel">
      <span className="sr">Loading the dashboard…</span>
      <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="shimmer" style={{ height: 18, width: 160 }} />
        <span className="shimmer" style={{ height: 14, width: "70%" }} />
        <span className="shimmer" style={{ height: 14, width: "55%" }} />
      </div>
      <div className="zdash__tiles">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="tile">
            <span className="shimmer" style={{ height: 12, width: "60%" }} />
            <span className="shimmer" style={{ height: 26, width: "40%" }} />
            <span className="shimmer" style={{ height: 10, width: "80%" }} />
          </div>
        ))}
      </div>
      <div className="card" style={{ height: 240 }} />
    </div>
  );
}
