import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ARTICLE_TYPES, STATE_PILL, listArticles, type Article, type ArticleState, type ArticleType } from "../lib/blogApi";
import { date, dateTime } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";
import { portalUrl } from "../content/emailTemplates";
import "../blog.css";

const STATUS_TABS: { key: "all" | ArticleState; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];

/** Every article (drafts too): filter by status and type, search, open one to edit. */
export function BlogPage(): ReactElement {
  const navigate = useNavigate();
  const load = useCallback(() => listArticles(), []);
  const list = useLoad(load);
  const [status, setStatus] = useState<"all" | ArticleState>("all");
  const [type, setType] = useState<"all" | ArticleType>("all");
  const [query, setQuery] = useState("");

  const rows = list.data ?? [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (a) =>
        (status === "all" || a.state === status) &&
        (type === "all" || a.type === type) &&
        (!q || a.title.toLowerCase().includes(q) || a.tags.includes(q)),
    );
  }, [rows, status, type, query]);
  const count = (fn: (a: Article) => boolean) => rows.filter(fn).length;

  return (
    <>
      <PageHeader
        title="Blog"
        subtitle="Write articles for search and for customers, then publish them on the website's blog."
        onReload={list.reload}
        pending={list.pending}
      >
        <input
          type="search"
          className="search"
          placeholder="Search titles or tags"
          aria-label="Search articles"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Link className="btn btn--ghost" to="/blog/subscribers">
          Subscribers
        </Link>
        <Link className="btn btn--primary" to="/blog/new">
          New article
        </Link>
      </PageHeader>

      <div className="tabs" role="tablist" aria-label="Status">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={status === t.key}
            className={"tab" + (status === t.key ? " is-active" : "")}
            onClick={() => setStatus(t.key)}
          >
            {t.label}
            {list.data ? (
              <span className="tab__count">{t.key === "all" ? rows.length : count((a) => a.state === t.key)}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="blog-types" role="group" aria-label="Type">
        <button type="button" className={"chip-btn" + (type === "all" ? " is-on" : "")} onClick={() => setType("all")}>
          All types
        </button>
        {ARTICLE_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={"chip-btn chip-btn--" + t.key + (type === t.key ? " is-on" : "")}
            onClick={() => setType(t.key)}
            title={t.hint}
          >
            {t.label}
            <span>{count((a) => a.type === t.key)}</span>
          </button>
        ))}
      </div>

      {list.error ? (
        <p className="alert alert--bad">{list.error}</p>
      ) : !list.data ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card empty">
          <b>No articles yet</b>
          <span className="muted">Write your first one: a tutorial or a release note is a good start.</span>
          <div>
            <Link className="btn btn--primary btn--sm" to="/blog/new">
              Write an article
            </Link>
          </div>
        </div>
      ) : (
        <div className="card table-card">
          <table className="sheet blog-sheet">
            <thead>
              <tr>
                <th>Article</th>
                <th>Type</th>
                <th>Status</th>
                <th>Published</th>
                <th>Updated</th>
                <th>Read</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className="blog-row" onClick={() => navigate(`/blog/${a.id}`)}>
                  <td>
                    <div className="blog-row__title">
                      {a.cover ? <img src={a.cover.url} alt="" className="blog-row__thumb" /> : <span className="blog-row__thumb is-empty" />}
                      <span>
                        <b>{a.title}</b>
                        <small className="muted block mono">/blog/{a.slug}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={"type-tag type-tag--" + a.type}>{a.type_label}</span>
                  </td>
                  <td>
                    <span className={"pill " + STATE_PILL[a.state].tone}>{STATE_PILL[a.state].label}</span>
                  </td>
                  <td className="nowrap">
                    {a.state !== "draft" && a.published_at ? (
                      a.state === "scheduled" ? (
                        <span title="Goes live on its own at this time">{dateTime(a.published_at)}</span>
                      ) : (
                        date(a.published_at)
                      )
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="nowrap">{date(a.updated_at)}</td>
                  <td className="nowrap">{a.reading_minutes} min</td>
                  <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                    <Link className="link-btn" to={`/blog/${a.id}`}>
                      Edit
                    </Link>
                    {a.state === "published" ? (
                      <a className="link-btn blog-row__view" href={`${portalUrl()}/blog/${a.slug}`} target="_blank" rel="noreferrer">
                        View ↗
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={7} className="sheet__empty">
                    No article matches these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
