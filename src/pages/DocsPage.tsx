import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import "../docs.css";

/**
 * Documentation tab -- LOCAL DEV ONLY. The route and nav item exist only when `import.meta.env.DEV`
 * (see App.tsx / Layout.tsx), and the pages come from the Vite dev server's `zinwe-docs` plugin
 * (vite.config.ts), which reads `<project>/docs/*.md`. Production builds contain neither.
 */

interface DocHeading {
  id: string;
  text: string;
  level: number;
}

interface DocMeta {
  slug: string;
  title: string;
  section: string;
  order: number;
  file: string;
  updated: string;
  headings: DocHeading[];
  text: string;
}

interface DocIndex {
  dir?: string;
  missing?: boolean;
  pages: DocMeta[];
}

const API = "/__zinwe_docs";

function snippet(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return "";
  const start = Math.max(0, i - 50);
  return (start > 0 ? "…" : "") + text.slice(start, i + q.length + 70).trim() + "…";
}

export default function DocsPage(): ReactElement {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [index, setIndex] = useState<DocIndex | null>(null);
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const articleRef = useRef<HTMLElement>(null);

  // Live refresh: the dev server tells us when a .md file changes.
  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return;
    const bump = () => setVersion((v) => v + 1);
    hot.on("zinwe-docs:changed", bump);
    return () => hot.off?.("zinwe-docs:changed", bump);
  }, []);

  useEffect(() => {
    fetch(`${API}/index.json`)
      .then((r) => r.json() as Promise<DocIndex>)
      .then(setIndex)
      .catch(() => setError("The project documentation isn't available on this copy of the back office."));
  }, [version]);

  const pages = index?.pages ?? [];
  const current = pages.find((p) => p.slug === slug) ?? null;

  // No slug: open the first page.
  useEffect(() => {
    if (!slug && pages.length) navigate(`/docs/${pages[0].slug}`, { replace: true });
  }, [slug, pages, navigate]);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    fetch(`${API}/page/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { html: string }) => {
        if (alive) {
          setHtml(d.html);
          setError(null);
        }
      })
      .catch(() => alive && setError(`There's no page called "${slug}".`));
    return () => {
      alive = false;
    };
  }, [slug, version]);

  // After a page renders: jump to #anchor, else to the top.
  useEffect(() => {
    if (!html) return;
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    const target = id ? document.getElementById(id) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  }, [html, hash]);

  const q = query.trim();
  const sections = useMemo(() => {
    const matches = q
      ? pages.filter((p) => p.title.toLowerCase().includes(q.toLowerCase()) || p.text.toLowerCase().includes(q.toLowerCase()))
      : pages;
    const groups = new Map<string, DocMeta[]>();
    for (const p of matches) groups.set(p.section, [...(groups.get(p.section) ?? []), p]);
    return [...groups.entries()];
  }, [pages, q]);

  // Links inside the rendered Markdown: keep /docs/... in the SPA (no full reload).
  const onArticleClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const a = (e.target as HTMLElement).closest("a");
      const href = a?.getAttribute("href");
      if (!a || !href || a.target === "_blank") return;
      if (href.startsWith("/docs/") || href.startsWith("#")) {
        e.preventDefault();
        navigate(href.startsWith("#") ? `/docs/${slug}${href}` : href);
      }
    },
    [navigate, slug],
  );

  const position = current ? pages.indexOf(current) : -1;
  const prev = position > 0 ? pages[position - 1] : null;
  const next = position >= 0 && position < pages.length - 1 ? pages[position + 1] : null;

  if (index?.missing) {
    return (
      <div className="card empty">
        <b>No documentation folder found</b>
        <span className="muted">
          The docs live in the project folder <code>docs/</code> next to the app repos. Copy the docs
          folder to this PC, then reload.
        </span>
      </div>
    );
  }

  return (
    <div className="docs">
      <aside className="docs__nav" aria-label="Documentation pages">
        <div className="docs__nav-head">
          <b>Documentation</b>
          <span className="docs__badge" title="Visible only when the admin runs locally (npm run dev)">
            local only
          </span>
        </div>
        <input
          type="search"
          className="search docs__search"
          placeholder="Search the docs"
          aria-label="Search the docs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {sections.map(([section, items]) => (
          <div key={section} className="docs__group">
            <span className="docs__group-title">{section}</span>
            {items.map((p) => (
              <Link
                key={p.slug}
                to={`/docs/${p.slug}`}
                className={"docs__link" + (p.slug === slug ? " is-active" : "")}
                onClick={() => setQuery("")}
              >
                {p.title}
                {q ? <small className="docs__hit">{snippet(p.text, q)}</small> : null}
              </Link>
            ))}
          </div>
        ))}
        {q && sections.length === 0 ? <p className="muted docs__none">Nothing matches “{q}”.</p> : null}
      </aside>

      <main className="docs__main">
        {error ? (
          <div className="card empty">
            <b>Couldn't open this page</b>
            <span className="muted">{error}</span>
          </div>
        ) : !html ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <article ref={articleRef} className="docs__article" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: html }} />
            <footer className="docs__foot">
              <div className="docs__pager">
                {prev ? (
                  <Link to={`/docs/${prev.slug}`} className="docs__pager-link">
                    <small>Previous</small>← {prev.title}
                  </Link>
                ) : (
                  <span />
                )}
                {next ? (
                  <Link to={`/docs/${next.slug}`} className="docs__pager-link is-next">
                    <small>Next</small>
                    {next.title} →
                  </Link>
                ) : null}
              </div>
              {current ? (
                <p className="muted docs__source">
                  Source: <code>docs/{current.file}</code> · updated {new Date(current.updated).toLocaleString()}
                </p>
              ) : null}
            </footer>
          </>
        )}
      </main>

      {current && current.headings.length > 1 ? (
        <nav className="docs__toc" aria-label="On this page">
          <span className="docs__group-title">On this page</span>
          {current.headings.map((h) => (
            <a
              key={h.id + h.text}
              href={`#${h.id}`}
              className={"docs__toc-link" + (h.level === 3 ? " is-sub" : "")}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/docs/${current.slug}#${h.id}`);
              }}
            >
              {h.text}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
