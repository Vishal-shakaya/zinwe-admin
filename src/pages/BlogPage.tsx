import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ARTICLE_TYPES, articlePath, listArticles, type Article, type ArticleState, type ArticleType } from "../lib/blogApi";
import { useLoad } from "../lib/useLoad";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Icon } from "../components/icons";
import { BlogHeader, StatePill, seoCheck, stateWhen } from "./blog/shared";
import "../blog.css";

const STATUS_CHIPS: { key: "all" | ArticleState; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];

/** Blog → Articles (AdminBlog board): filter by status and category, search, open one to edit. */
export function BlogPage(): ReactElement {
  const navigate = useNavigate();
  const load = useCallback(() => listArticles(), []);
  const list = useLoad(load);
  const [status, setStatus] = useState<"all" | ArticleState>("all");
  const [type, setType] = useState<"all" | ArticleType>("all");
  const [query, setQuery] = useState("");
  // ?series=<id> (from Blog → Series → Episodes): one series' episodes.
  const [params, setParams] = useSearchParams();
  const seriesId = Number(params.get("series")) || null;

  const all = useMemo(() => list.data ?? [], [list.data]);
  const rows = seriesId ? all.filter((a) => a.series === seriesId) : all;
  const q = query.trim().toLowerCase();
  const base = useMemo(
    () =>
      rows.filter(
        (a) => (type === "all" || a.type === type) && (!q || `${a.title} ${a.slug} ${a.type_label} ${a.tags}`.toLowerCase().includes(q)),
      ),
    [rows, type, q],
  );
  const inSt = (a: Article, k: "all" | ArticleState) => k === "all" || a.state === k;
  const shown = base.filter((a) => inSt(a, status));
  const clear = () => {
    setStatus("all");
    setType("all");
    setQuery("");
  };

  return (
    <>
      <BlogHeader
        known={{ articles: list.data?.length }}
        action={
          <Link className="btn dark" to={seriesId ? `/blog/new?series=${seriesId}` : "/blog/new"}>
            <Icon name="plus" />
            {seriesId ? "New episode" : "New article"}
          </Link>
        }
      />

      {seriesId ? (
        <p className="note info bl-series-note">
          Showing the episodes of <b>{rows[0]?.series_title ?? "this series"}</b>.{" "}
          <button type="button" className="link" onClick={() => setParams({})}>
            Show every article
          </button>
        </p>
      ) : null}

      <section className="card bl-filters" aria-label="Filters">
        <div role="group" aria-label="Status" className="bl-chips">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={"chip" + (status === c.key ? " on" : "")}
              aria-pressed={status === c.key}
              onClick={() => setStatus(c.key)}
            >
              {c.label}
              <span className="num bl-chip-n">{base.filter((a) => inSt(a, c.key)).length}</span>
            </button>
          ))}
        </div>
        <label className="sr" htmlFor="cat">
          Category
        </label>
        <select id="cat" className="inp bl-auto" value={type} onChange={(e) => setType(e.target.value as "all" | ArticleType)}>
          <option value="all">All categories</option>
          {ARTICLE_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="bl-grow">
          <label className="sr" htmlFor="q">
            Search articles
          </label>
          <input id="q" type="search" className="inp" placeholder="Search titles or tags" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </section>

      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <LoadingState rows={6} label="Loading articles…" />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="edit"
            title="No articles yet"
            body="Write your first one: a tutorial or a release note is a good start."
            action={
              <Link className="btn dark sm" to="/blog/new">
                Write an article
              </Link>
            }
          />
        </div>
      ) : (
        <section className="card" aria-label="Articles" style={{ overflow: "hidden" }}>
          <div className="tbl-wrap">
            <table className="tbl bl-tbl" style={{ minWidth: 920 }}>
              <thead>
                <tr>
                  <th scope="col">Article</th>
                  <th scope="col">Status</th>
                  <th scope="col">Category</th>
                  <th scope="col">Author</th>
                  <th scope="col" className="r">
                    Views
                  </th>
                  <th scope="col">SEO check</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => {
                  const sc = seoCheck(a);
                  return (
                    <tr key={a.id}>
                      <td style={{ maxWidth: 380 }}>
                        <button type="button" className="bl-tlink" onClick={() => navigate(`/blog/${a.id}`)}>
                          {a.title}
                        </button>
                        {a.series_title ? (
                          <div className="k bl-ep">
                            {a.series_title} · {a.season > 1 ? `S${a.season} · ` : ""}E{String(a.episode ?? 0).padStart(2, "0")}
                            {a.free_preview ? " · free" : " · members"}
                          </div>
                        ) : null}
                        <div className="k mono">{articlePath(a)}</div>
                      </td>
                      <td className="bl-nowrap">
                        <StatePill state={a.state} />
                        <div className="k">{stateWhen(a)}</div>
                      </td>
                      <td className="bl-nowrap">{a.type_label}</td>
                      <td className="bl-nowrap">{a.author_name || "Zinwe team"}</td>
                      <td className="num r" style={{ fontWeight: 600 }} title="Views aren't counted yet">
                        —
                      </td>
                      <td>
                        <span className={"pill " + (sc.ok === 3 ? "good" : "warn")}>SEO {sc.ok}/3</span>
                        <div className="k">
                          {sc.issues.length ? sc.issues[0] + (sc.issues.length > 1 ? ` +${sc.issues.length - 1}` : "") : "All good"}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 ? (
              <div className="bl-none">
                <span>No articles match.</span>
                <button type="button" className="btn" onClick={clear}>
                  Clear filters
                </button>
              </div>
            ) : null}
          </div>
        </section>
      )}
      <p className="k" style={{ margin: 0 }}>
        SEO check: search title 30–60 characters, meta description 70–160 characters, cover image with alt text.
      </p>
    </>
  );
}
