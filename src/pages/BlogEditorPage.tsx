import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ARTICLE_TYPES,
  STATE_PILL,
  articlePath,
  createArticle,
  deleteArticle,
  getArticle,
  listSeries,
  publishArticle,
  unpublishArticle,
  updateArticle,
  uploadBlogImage,
  type Article,
  type ArticleInput,
  type ArticleType,
  type BlogImageRef,
  type Series,
} from "../lib/blogApi";
import { AttachmentsCard } from "../components/AttachmentsCard";
import { dateTime } from "../lib/format";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { NewsletterCard } from "../components/NewsletterCard";
import { RichTextEditor, type RichTextValue } from "../components/RichTextEditor";
import { useToast } from "../components/Toast";
import { portalUrl } from "../content/emailTemplates";
import "../blog.css";

interface Form {
  title: string;
  slug: string;
  type: ArticleType;
  summary: string;
  body_html: string;
  cover: BlogImageRef | null;
  cover_alt: string;
  tags: string;
  seo_title: string;
  meta_description: string;
  author_name: string;
  /** Series episode (null = an ordinary article). */
  series: number | null;
  season: number;
  /** "" = the next free number. */
  episode: string;
  teaser_html: string;
  free_preview: boolean;
}

const EMPTY: Form = {
  title: "", slug: "", type: "tutorial", summary: "", body_html: "", cover: null, cover_alt: "",
  tags: "", seo_title: "", meta_description: "", author_name: "",
  series: null, season: 1, episode: "", teaser_html: "", free_preview: false,
};

const toForm = (a: Article): Form => ({
  title: a.title, slug: a.slug, type: a.type, summary: a.summary, body_html: a.body_html, cover: a.cover,
  cover_alt: a.cover_alt, tags: a.tags, seo_title: a.seo_title, meta_description: a.meta_description,
  author_name: a.author_name,
  series: a.series, season: a.season, episode: a.episode ? String(a.episode) : "", teaser_html: a.teaser_html,
  free_preview: a.free_preview,
});

/** Same rule as the server (Django slugify), so the URL preview is what you'll get. */
function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[-\s_]+/g, "-")
    .slice(0, 200);
}

/** A Date as the value of an <input type="datetime-local"> (local time, minutes). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The start of the next hour (a sensible default for "Schedule for later"). */
function nextHour(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

const AUTOSAVE_MS = 10_000;

const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** Write, preview for search, and publish one article. /blog/new creates; /blog/:id edits. */
export function BlogEditorPage(): ReactElement {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const toast = useToast();
  const [search] = useSearchParams();
  const seriesParam = Number(search.get("series")) || null;
  // Members-only series, for the "Series episode" picker.
  const [allSeries, setAllSeries] = useState<Series[]>([]);
  useEffect(() => {
    listSeries()
      .then(setAllSeries)
      .catch(() => setAllSeries([]));
  }, []);

  const [article, setArticle] = useState<Article | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState<Form>(EMPTY);
  const [bodyText, setBodyText] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [slugTouched, setSlugTouched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "publish" | "unpublish" | "cover">(null);
  // "Schedule for later": a local date-time (yyyy-mm-ddThh:mm) while the picker is open.
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  // The editors normalise loaded HTML on mount; take that first emit as the saved baseline.
  const bodyBaseline = useRef(true);
  const teaserBaseline = useRef(true);

  // The article on screen; a new one saved for the first time moves to /blog/<id> without reloading it
  // (that would remount the editor under the cursor).
  const loadedId = useRef<number | null>(null);

  useEffect(() => {
    if (!isNew && loadedId.current === Number(id)) return;
    if (isNew) {
      loadedId.current = null;
      setArticle(null);
      // "New episode" from the Series page: /blog/new?series=<id>
      const start: Form = seriesParam ? { ...EMPTY, series: seriesParam, type: "newsletter" } : EMPTY;
      setForm(start);
      setSaved(start);
      setEditorKey((k) => k + 1);
      return;
    }
    let alive = true;
    getArticle(Number(id))
      .then((a) => {
        if (!alive) return;
        loadedId.current = a.id;
        setArticle(a);
        setForm(toForm(a));
        setSaved(toForm(a));
        setSlugTouched(true);
        bodyBaseline.current = true;
        teaserBaseline.current = true;
        setEditorKey((k) => k + 1);
      })
      .catch((err) => alive && setLoadError(err instanceof Error ? err.message : "Couldn't load this article."));
    return () => {
      alive = false;
    };
  }, [id, isNew, seriesParam]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  // Warn before leaving the page with unsaved edits: closing the tab (beforeunload) ...
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ... and moving elsewhere in the back office (J8-07): "← All articles", the sidebar, Back. Saving a
  // new article swaps /blog/new for /blog/<id>: that's the same article, so it never asks.
  const leaving = useRef(false); // set right before an intended navigation (after delete)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !leaving.current &&
      currentLocation.pathname !== nextLocation.pathname &&
      !(currentLocation.pathname === "/blog/new" && /^\/blog\/\d+$/.test(nextLocation.pathname)),
  );

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const slug = slugTouched ? form.slug : slugify(form.title);

  const payload = (): ArticleInput => ({
    title: form.title,
    ...(slugTouched || !isNew ? { slug: form.slug } : {}),
    type: form.type,
    summary: form.summary,
    body_html: form.body_html,
    cover_image: form.cover?.id ?? null,
    cover_alt: form.cover_alt,
    tags: form.tags,
    seo_title: form.seo_title,
    meta_description: form.meta_description,
    author_name: form.author_name,
    series: form.series,
    season: form.season,
    episode: form.series && form.episode ? Number(form.episode) : null,
    teaser_html: form.series ? form.teaser_html : "",
    free_preview: form.series ? form.free_preview : false,
  });

  /** `openSaved`: a new article moves to its own URL once saved (not when saving on the way out). */
  const save = async (quiet = false, openSaved = true): Promise<Article | null> => {
    if (!form.title.trim()) {
      toast("Give the article a title first.", "bad");
      return null;
    }
    setBusy("save");
    const sent = form;
    try {
      const next = article ? await updateArticle(article.id, payload()) : await createArticle(payload());
      loadedId.current = next.id;
      setArticle(next);
      // Server-normalised fields (slug, tags) come back; the body stays as the editor holds it. Anything typed
      // while it was saving (autosave) is kept: the form only takes the server copy if it didn't change meanwhile.
      const nextForm = { ...toForm(next), body_html: sent.body_html, teaser_html: sent.teaser_html };
      setForm((f) => (f === sent ? nextForm : f));
      setSaved(nextForm);
      setSlugTouched(true);
      if (!quiet) toast(next.status === "published" ? "Saved. The live article is updated." : "Draft saved.");
      if (!article && openSaved) navigate(`/blog/${next.id}`, { replace: true });
      return next;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save.", "bad");
      return null;
    } finally {
      setBusy(null);
    }
  };

  // Autosave (J8-07): a draft with a title saves itself 10 seconds after the last change. Published and
  // scheduled articles never autosave (that would change the live page); the leave guard covers them.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const draft = !article || article.state === "draft";
  const canAutosave = dirty && draft && form.title.trim().length > 0 && busy === null;
  useEffect(() => {
    if (!canAutosave) return;
    const timer = window.setTimeout(() => void saveRef.current(true), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [canAutosave, form]);

  /** Publish now (no `at`), or schedule for a future local date-time. */
  const publish = async (at?: Date) => {
    if (at && at.getTime() <= Date.now()) {
      toast("Pick a time in the future, or use Publish now.", "bad");
      return;
    }
    const current = dirty || !article ? await save(true) : article;
    if (!current) return;
    setBusy("publish");
    try {
      // A scheduled article published "now" needs an explicit time, or it keeps its future one.
      const when = at ?? (current.state === "scheduled" ? new Date() : undefined);
      const next = await publishArticle(current.id, when?.toISOString());
      setArticle(next);
      setScheduleAt(null);
      toast(
        next.state === "scheduled"
          ? `Scheduled. It goes live ${dateTime(next.published_at)}.`
          : next.series
            ? "Published. The episode is live on its series page."
            : "Published. It's live on the blog.",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't publish.", "bad");
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    if (!article) return;
    setBusy("unpublish");
    try {
      const wasScheduled = article.state === "scheduled";
      setArticle(await unpublishArticle(article.id));
      toast(wasScheduled ? "Unscheduled. It's a draft again." : "Unpublished. It's a draft again and off the website.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't unpublish.", "bad");
    } finally {
      setBusy(null);
    }
  };

  const uploadCover = async (file: File) => {
    setBusy("cover");
    try {
      const img = await uploadBlogImage(file);
      setForm((f) => ({ ...f, cover: img, cover_alt: f.cover_alt || f.title }));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't upload the image.", "bad");
    } finally {
      setBusy(null);
    }
  };

  const uploadInline = async (file: File): Promise<string> => {
    try {
      return (await uploadBlogImage(file)).url;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't upload the image.", "bad");
      throw err;
    }
  };

  if (loadError) {
    return (
      <div className="card empty">
        <b>This article couldn't be opened</b>
        <span className="muted">{loadError}</span>
        <div>
          <Link className="btn btn--ghost btn--sm" to="/blog">
            Back to the blog
          </Link>
        </div>
      </div>
    );
  }

  const state = article?.state ?? "draft";
  const live = state === "published";
  const scheduled = state === "scheduled";
  const seoTitle = form.seo_title || form.title;
  const metaDesc = form.meta_description || form.summary;
  const words = countWords(bodyText);
  const checks = [
    { ok: seoTitle.length >= 30 && seoTitle.length <= 60, label: "Search title is 30–60 characters", now: `${seoTitle.length}` },
    { ok: metaDesc.length >= 70 && metaDesc.length <= 160, label: "Description is 70–160 characters", now: `${metaDesc.length}` },
    { ok: words >= 300, label: "At least 300 words", now: `${words}` },
    { ok: /<h2[\s>]/.test(form.body_html), label: "Has a heading (H2)" },
    { ok: !!form.cover && !!form.cover_alt.trim(), label: "Cover image with alt text" },
    { ok: form.tags.split(",").some((t) => t.trim()), label: "At least one tag" },
  ];
  const score = checks.filter((c) => c.ok).length;
  const show = allSeries.find((x) => x.id === form.series) ?? null;
  const urlPrefix = show ? `/blog/series/${show.slug}/` : "/blog/";

  return (
    <div className="editor">
      <header className="editor__head">
        <Link to="/blog" className="link-btn editor__back">
          ← All articles
        </Link>
        <div className="editor__state">
          <span className={"pill " + STATE_PILL[state].tone}>{STATE_PILL[state].label}</span>
          <span className="muted">
            {busy === "save"
              ? "Saving…"
              : dirty
                ? draft && form.title.trim()
                  ? "Unsaved changes · saves itself in a few seconds"
                  : draft
                    ? "Unsaved changes · add a title to save"
                    : "Unsaved changes"
                : article
                  ? `Saved ${dateTime(article.updated_at)}`
                  : "Not saved yet"}
          </span>
        </div>
      </header>

      <div className="editor__grid">
        <div className="editor__main">
          <input
            className="editor__title"
            placeholder="Article title"
            aria-label="Title"
            maxLength={200}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
          />
          <div className="editor__slug">
            <span className="muted">
              {portalUrl().replace(/^https?:\/\//, "")}
              {urlPrefix}
            </span>
            <input
              aria-label="URL slug"
              value={slug}
              placeholder="url-of-the-article"
              onChange={(e) => {
                setSlugTouched(true);
                // Letters, digits and dashes while typing; the server makes the final slug unique.
                set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-"));
              }}
            />
          </div>
          {live && saved.slug && form.slug !== saved.slug ? (
            <p className="editor__warn">Changing the URL of a live article breaks links people already shared.</p>
          ) : null}

          <label className="editor__field">
            <span>
              Summary <small>{form.summary.length}/300 · shown on cards and in search results</small>
            </span>
            <textarea
              rows={2}
              maxLength={300}
              placeholder="One or two sentences that make people want to read it."
              value={form.summary}
              onChange={(e) => set("summary", e.target.value)}
            />
          </label>

          {form.series ? (
            <div className="editor__field">
              <span>
                Public opening <small>everyone sees this: the cold open that makes people want the rest (also the email teaser)</small>
              </span>
              <RichTextEditor
                key={`teaser-${editorKey}`}
                variant="article"
                label="Public opening"
                placeholder="4:42 PM. Tuesday. The phone rang…"
                initialHtml={form.teaser_html}
                onImageUpload={uploadInline}
                onChange={(v: RichTextValue) => {
                  const html = v.text ? v.html : "";
                  set("teaser_html", html);
                  if (teaserBaseline.current) {
                    teaserBaseline.current = false;
                    setSaved((s) => ({ ...s, teaser_html: html }));
                  }
                }}
              />
            </div>
          ) : null}

          <div className="editor__field">
            <span>
              {form.series ? "Members-only part" : "Article"}{" "}
              <small>
                {words} words · about {Math.max(1, Math.ceil(words / 200))} min read
                {form.series ? " · the full case file: story, lesson, 10-minute challenge" : ""}
              </small>
            </span>
            <RichTextEditor
              key={editorKey}
              variant="article"
              label="Article body"
              placeholder="Start writing… Use headings (H2) to structure it."
              initialHtml={form.body_html}
              onImageUpload={uploadInline}
              onChange={(v: RichTextValue) => {
                const html = v.text ? v.html : "";
                setBodyText(v.text);
                set("body_html", html);
                if (bodyBaseline.current) {
                  bodyBaseline.current = false;
                  setSaved((s) => ({ ...s, body_html: html }));
                }
              }}
            />
          </div>
        </div>

        <aside className="editor__side">
          <section className="side-card">
            <h3>Publish</h3>
            <div className="side-card__actions">
              <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy || (!dirty && !!article)} onClick={() => void save()}>
                {busy === "save" ? "Saving…" : state !== "draft" ? "Update" : "Save draft"}
              </button>
              {live ? (
                <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy} onClick={() => void unpublish()}>
                  {busy === "unpublish" ? "Unpublishing…" : "Unpublish"}
                </button>
              ) : (
                <button type="button" className="btn btn--primary btn--sm" disabled={!!busy} onClick={() => void publish()}>
                  {busy === "publish" ? "Publishing…" : scheduled ? "Publish now" : "Publish"}
                </button>
              )}
            </div>
            {scheduled && article?.published_at ? (
              <p className="side-card__note sched-note">
                Goes live on its own <b>{dateTime(article.published_at)}</b>.{" "}
                <button type="button" className="link-btn" disabled={!!busy} onClick={() => void unpublish()}>
                  Unschedule
                </button>
              </p>
            ) : null}
            {!live ? (
              scheduleAt === null ? (
                <button type="button" className="link-btn" disabled={!!busy} onClick={() => setScheduleAt(toLocalInput(nextHour()))}>
                  {scheduled ? "Change the time…" : "Schedule for later…"}
                </button>
              ) : (
                <div className="sched">
                  <label className="editor__field">
                    <span>
                      Go live at <small>your local time</small>
                    </span>
                    <input
                      type="datetime-local"
                      value={scheduleAt}
                      min={toLocalInput(new Date())}
                      onChange={(e) => setScheduleAt(e.target.value)}
                    />
                  </label>
                  <div className="side-card__row">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={!!busy || !scheduleAt}
                      onClick={() => void publish(new Date(scheduleAt))}
                    >
                      {busy === "publish" ? "Scheduling…" : "Schedule"}
                    </button>
                    <button type="button" className="link-btn" onClick={() => setScheduleAt(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )
            ) : null}
            {live && article ? (
              <a className="link-btn" href={`${portalUrl()}${articlePath(article)}`} target="_blank" rel="noreferrer">
                View on the website ↗
              </a>
            ) : null}
            {live && article?.published_at ? (
              <p className="side-card__note">First published {dateTime(article.published_at)}</p>
            ) : null}
            {article ? (
              <button type="button" className="link-btn link-btn--danger" onClick={() => setConfirmDelete(true)}>
                Delete article
              </button>
            ) : null}
          </section>

          {article ? <NewsletterCard article={article} dirty={dirty} /> : null}

          <section className="side-card">
            <h3>Series episode</h3>
            <label className="editor__field">
              <span>
                Series <small>members-only: the body and files are for subscribers</small>
              </span>
              <select
                value={form.series ?? ""}
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : null;
                  setForm((f) => ({ ...f, series: next, ...(next && f.type !== "newsletter" && !article ? { type: "newsletter" as ArticleType } : {}) }));
                }}
              >
                <option value="">None (an ordinary article)</option>
                {allSeries.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                    {x.status === "draft" ? " (draft)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {form.series ? (
              <>
                <div className="side-card__row">
                  <label className="editor__field">
                    <span>Season</span>
                    <select value={form.season} onChange={(e) => set("season", Number(e.target.value))}>
                      {(show?.seasons.length ? show.seasons : [{ number: form.season, title: "", theme: "" }]).map((s) => (
                        <option key={s.number} value={s.number}>
                          {s.number}
                          {s.title ? ` · ${s.title}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="editor__field">
                    <span>
                      Episode <small>empty = next</small>
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={form.episode}
                      placeholder="next"
                      onChange={(e) => set("episode", e.target.value)}
                    />
                  </label>
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={form.free_preview} onChange={(e) => set("free_preview", e.target.checked)} />
                  <span>
                    <b>Free episode</b> <small className="muted">anyone can read it in full (e.g. the pilot)</small>
                  </span>
                </label>
                {show && show.status === "draft" ? (
                  <p className="side-card__note is-warn">This series is a draft: its episodes aren't on the website until it's live (Blog → Series).</p>
                ) : null}
              </>
            ) : allSeries.length === 0 ? (
              <p className="side-card__note">
                No series yet. <Link to="/blog/series">Create one</Link>.
              </p>
            ) : null}
          </section>

          {article ? (
            <AttachmentsCard
              article={article}
              membersOnly={!!article.series && !article.free_preview}
              onChange={(next) => setArticle(next)}
            />
          ) : null}

          <section className="side-card">
            <h3>Type</h3>
            <div className="type-pick" role="radiogroup" aria-label="Article type">
              {ARTICLE_TYPES.map((t) => (
                <label key={t.key} className={"type-pick__opt type-tag--" + t.key + (form.type === t.key ? " is-on" : "")}>
                  <input type="radio" name="type" value={t.key} checked={form.type === t.key} onChange={() => set("type", t.key)} />
                  <b>{t.label}</b>
                  <small>{t.hint}</small>
                </label>
              ))}
            </div>
          </section>

          <section className="side-card">
            <h3>Cover image</h3>
            {form.cover ? (
              <img className="cover-preview" src={form.cover.url} alt={form.cover_alt || "Cover"} />
            ) : (
              <button type="button" className="cover-drop" onClick={() => coverInput.current?.click()} disabled={busy === "cover"}>
                {busy === "cover" ? "Uploading…" : "Add a cover image"}
                <small>PNG, JPG or WebP, up to 5 MB. 1200×630 works best for sharing.</small>
              </button>
            )}
            <input
              ref={coverInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadCover(file);
                e.target.value = "";
              }}
            />
            {form.cover ? (
              <>
                <label className="editor__field">
                  <span>Alt text <small>describes the image for search and screen readers</small></span>
                  <input value={form.cover_alt} maxLength={200} onChange={(e) => set("cover_alt", e.target.value)} />
                </label>
                <div className="side-card__row">
                  <button type="button" className="link-btn" onClick={() => coverInput.current?.click()}>
                    Replace
                  </button>
                  <button type="button" className="link-btn link-btn--danger" onClick={() => set("cover", null)}>
                    Remove
                  </button>
                </div>
              </>
            ) : null}
          </section>

          <section className="side-card">
            <h3>Details</h3>
            <label className="editor__field">
              <span>Tags <small>comma-separated</small></span>
              <input value={form.tags} placeholder="usb, dpdp, guide" onChange={(e) => set("tags", e.target.value)} />
            </label>
            <label className="editor__field">
              <span>Author</span>
              <input value={form.author_name} placeholder="Zinwe team" maxLength={120} onChange={(e) => set("author_name", e.target.value)} />
            </label>
          </section>

          <section className="side-card">
            <h3>
              Search (SEO) <span className={"seo-score" + (score >= 5 ? " is-good" : "")}>{score}/6</span>
            </h3>
            <div className="serp" aria-label="Google preview">
              <span className="serp__url">zinwe.io{urlPrefix.replace(/\//g, " › ").replace(/ › $/, "")} › {slug || "…"}</span>
              <span className="serp__title">{seoTitle ? seoTitle.slice(0, 62) + (seoTitle.length > 62 ? "…" : "") : "Search title"}</span>
              <span className="serp__desc">
                {metaDesc ? metaDesc.slice(0, 158) + (metaDesc.length > 158 ? "…" : "") : "The description people see under the title."}
              </span>
            </div>
            <label className="editor__field">
              <span>
                Search title <small className={form.seo_title.length > 60 ? "is-warn" : ""}>{form.seo_title.length}/70 · empty = the title</small>
              </span>
              <input value={form.seo_title} maxLength={70} onChange={(e) => set("seo_title", e.target.value)} />
            </label>
            <label className="editor__field">
              <span>
                Description{" "}
                <small className={form.meta_description.length > 160 ? "is-warn" : ""}>
                  {form.meta_description.length}/170 · empty = the summary
                </small>
              </span>
              <textarea rows={3} value={form.meta_description} maxLength={170} onChange={(e) => set("meta_description", e.target.value)} />
            </label>
            <ul className="seo-checks">
              {checks.map((c) => (
                <li key={c.label} className={c.ok ? "is-ok" : ""}>
                  <span aria-hidden="true">{c.ok ? "✓" : "•"}</span>
                  {c.label}
                  {c.now ? <small> ({c.now})</small> : null}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {confirmDelete && article ? (
        <ConfirmDialog
          title="Delete this article?"
          confirmLabel="Delete article"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteArticle(article.id);
            setSaved(form);
            leaving.current = true; // no unsaved-changes prompt on the way out
            toast("Article deleted.");
            navigate("/blog", { replace: true });
          }}
        >
          <p>
            <b>{article.title}</b> will be removed{state !== "draft" ? " from the website and" : ""} for good. Unpublish it instead if you
            might want it back.
          </p>
        </ConfirmDialog>
      ) : null}

      {blocker.state === "blocked" ? (
        <Modal
          title="Leave without saving?"
          size="small"
          onClose={() => blocker.reset()}
          footer={
            <>
              <button type="button" className="btn btn--ghost" onClick={() => blocker.reset()}>
                Stay here
              </button>
              <button type="button" className="btn btn--danger" onClick={() => blocker.proceed()}>
                Discard changes
              </button>
              {form.title.trim() ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (await save(true, false)) blocker.proceed();
                    else blocker.reset();
                  }}
                >
                  {busy === "save" ? "Saving…" : live ? "Update & leave" : "Save & leave"}
                </button>
              ) : null}
            </>
          }
        >
          <p>
            {live
              ? "Your edits to this live article aren't saved yet."
              : "This article has changes that aren't saved yet."}{" "}
            {form.title.trim() ? "" : "Give it a title to save it."}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
