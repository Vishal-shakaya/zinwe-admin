import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  listArticles,
  listGuides,
  listSeries,
  listSubscribers,
  type Article,
  type ArticleState,
} from "../../lib/blogApi";
import { PageHeader } from "../../components/PageHeader";

/* ---------- Tab counts (Articles · Series · Guides · Subscribers) ---------- */

export interface BlogCounts {
  articles?: number;
  series?: number;
  guides?: number;
  /** Confirmed newsletter subscribers. */
  subscribers?: number;
}

let cache: { at: number; counts: BlogCounts } | null = null;
const STALE_MS = 60_000;

/**
 * The four tab counts. Each blog page already loads its own list and passes that count in `known`; the other
 * three come from one parallel load, cached for a minute so moving between tabs doesn't reload everything.
 */
export function useBlogCounts(known: BlogCounts): BlogCounts {
  const [counts, setCounts] = useState<BlogCounts>(cache?.counts ?? {});
  useEffect(() => {
    if (cache && Date.now() - cache.at < STALE_MS) return;
    let alive = true;
    void Promise.allSettled([listArticles(), listSeries(), listGuides(), listSubscribers()]).then(([a, s, g, u]) => {
      const next: BlogCounts = {
        articles: a.status === "fulfilled" ? a.value.length : undefined,
        series: s.status === "fulfilled" ? s.value.length : undefined,
        guides: g.status === "fulfilled" ? g.value.length : undefined,
        subscribers: u.status === "fulfilled" ? u.value.counts.active : undefined,
      };
      cache = { at: Date.now(), counts: next };
      if (alive) setCounts(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  const merged = { ...counts };
  for (const [k, v] of Object.entries(known) as [keyof BlogCounts, number | undefined][]) if (v !== undefined) merged[k] = v;
  return merged;
}

/** Forget the cached counts (after creating or deleting something). */
export function staleBlogCounts(): void {
  cache = null;
}

const TABS: { to: string; label: string; key: keyof BlogCounts; end?: boolean }[] = [
  { to: "/blog", label: "Articles", key: "articles", end: true },
  { to: "/blog/series", label: "Series", key: "series" },
  { to: "/blog/guides", label: "Guides", key: "guides" },
  { to: "/blog/subscribers", label: "Subscribers", key: "subscribers" },
];

/** The AdminBlog board's header + section tabs, shared by the four blog list pages. */
export function BlogHeader({ action, known = {} }: { action: ReactNode; known?: BlogCounts }): ReactElement {
  const counts = useBlogCounts(known);
  return (
    <>
      <PageHeader
        title="Blog"
        subtitle={
          <>
            Articles, the series, guides and the newsletter for <span className="mono bl-mono13">zinwe.io/blog</span>.
          </>
        }
      >
        {action}
      </PageHeader>
      <nav aria-label="Blog sections" className="bl-tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => "bl-tab" + (isActive ? " on" : "")}>
            {t.label}
            <span className="k num">{counts[t.key] === undefined ? "" : counts[t.key]!.toLocaleString("en-IN")}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

/* ---------- Status + SEO (same rules on the list and in the editor) ---------- */

export const STATE_LABEL: Record<ArticleState, string> = { draft: "Draft", scheduled: "Scheduled", published: "Published" };

export function StatePill({ state }: { state: ArticleState }): ReactElement {
  return (
    <span className={`pill bl-st--${state}`}>
      <span className="dot" />
      {STATE_LABEL[state]}
    </span>
  );
}

export interface SeoCheck {
  ok: number;
  issues: string[];
  title: boolean;
  meta: boolean;
  alt: boolean;
}

/** Board rule: search title 30–60, meta description 70–160, cover image with alt text. */
export function seoCheck(a: {
  title: string;
  seo_title: string;
  meta_description: string;
  summary: string;
  cover: unknown;
  cover_alt: string;
}): SeoCheck {
  const t = (a.seo_title || a.title).length;
  const m = (a.meta_description || a.summary).length;
  const title = t >= 30 && t <= 60;
  const meta = m >= 70 && m <= 160;
  const alt = Boolean(a.cover) && a.cover_alt.trim().length > 0;
  const issues: string[] = [];
  if (!title) issues.push(t > 60 ? "Title too long" : "Title too short");
  if (!meta) issues.push(m === 0 ? "No meta description" : m > 160 ? "Meta description too long" : "Meta description too short");
  if (!alt) issues.push(a.cover ? "Cover has no alt text" : "No cover image");
  return { ok: [title, meta, alt].filter(Boolean).length, issues, title, meta, alt };
}

/* ---------- Dates (board style: "30 Oct, 09:00", "26 Oct 2026", "Edited 27 Oct") ---------- */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}
export function dayMonthYear(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}
export function dayMonthTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MON[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The line under the status pill on the list. */
export function stateWhen(a: Article): string {
  if (a.state === "scheduled" && a.published_at) return dayMonthTime(a.published_at);
  if (a.state === "published" && a.published_at) return dayMonthYear(a.published_at);
  return `Edited ${dayMonth(a.updated_at)}`;
}

/* ---------- CSV ---------- */

export function downloadCsv(name: string, header: string[], rows: string[][]): void {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const text = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
