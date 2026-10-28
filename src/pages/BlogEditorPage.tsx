import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ARTICLE_TYPES,
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
import { EmptyState, LoadingState } from "../components/States";
import { Icon } from "../components/icons";
import { StatePill, seoCheck, staleBlogCounts } from "./blog/shared";
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
  newsletter_subject: string;
}

const EMPTY: Form = {
  title: "", slug: "", type: "tutorial", summary: "", body_html: "", cover: null, cover_alt: "",
  tags: "", seo_title: "", meta_description: "", author_name: "",
  series: null, season: 1, episode: "", teaser_html: "", free_preview: false, newsletter_subject: "",
};

const toForm = (a: Article): Form => ({
  title: a.title, slug: a.slug, type: a.type, summary: a.summary, body_html: a.body_html, cover: a.cover,
  cover_alt: a.cover_alt, tags: a.tags, seo_title: a.seo_title, meta_description: a.meta_description,
  author_name: a.author_name,
  series: a.series, season: a.season, episode: a.episode ? String(a.episode) : "", teaser_html: a.teaser_html,
  free_preview: a.free_preview, newsletter_subject: a.newsletter_subject,
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
    newsletter_subject: form.series ? form.newsletter_subject : "",
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
      <div className="card">
        <EmptyState
          icon="warn"
          title="This article couldn't be opened"
          body={loadError}
          action={
            <Link className="btn sm" to="/blog">
              Back to the blog
            </Link>
          }
        />
      </div>
    );
  }

  if (!isNew && !article) return <LoadingState rows={8} label="Loading the article…" />;

  const state = article?.state ?? "draft";
  const live = state === "published";
  const scheduled = state === "scheduled";
  const seoTitle = form.seo_title || form.title;
  const metaDesc = form.meta_description || form.summary;
  const metaLen = form.meta_description.length;
  const words = countWords(bodyText);
  const sc = seoCheck({ ...form, title: form.title });
  const checks = [
    { ok: sc.title, label: "Search title is 30–60 characters", now: `${seoTitle.length}` },
    { ok: sc.meta, label: "Description is 70–160 characters", now: `${metaDesc.length}` },
    { ok: sc.alt, label: "Cover image with alt text" },
    { ok: words >= 300, label: "At least 300 words", now: `${words}` },
    { ok: /<h2[\s>]/.test(form.body_html), label: "Has a heading (H2)" },
    { ok: form.tags.split(",").some((t) => t.trim()), label: "At least one tag" },
  ];
  const show = allSeries.find((x) => x.id === form.series) ?? null;
  const urlPrefix = show ? `/blog/series/${show.slug}/` : "/blog/";
  const host = portalUrl().replace(/^https?:\/\//, "");
  const later = !live && scheduleAt !== null;
  const ist = Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Kolkata";
  const metaHint =
    metaLen === 0
      ? form.summary
        ? "Empty: the excerpt is used. Write 70 to 160 characters."
        : "Write 70 to 160 characters."
      : metaLen < 70
        ? `${70 - metaLen} more characters to reach 70.`
        : metaLen > 160
          ? `${metaLen - 160} characters over. Google cuts it off.`
          : "Good length.";
  const saveState =
    busy === "save"
      ? "Saving…"
      : dirty
        ? draft && form.title.trim()
          ? "Unsaved changes · saves itself in a few seconds"
          : draft
            ? "Unsaved changes · add a title to save"
            : "Unsaved changes"
        : article
          ? "All changes saved"
          : "Not saved yet";

  const primary = () => {
    if (live) void save();
    else if (later && scheduleAt) void publish(new Date(scheduleAt));
    else void publish();
  };
  const primaryLabel =
    busy === "publish" ? (later ? "Scheduling…" : "Publishing…") : busy === "save" && live ? "Saving…" : live ? "Update" : later ? "Schedule" : "Publish now";

  return (
    <div className="bl-ed">
      <header className="bl-ed__head">
        <div className="bl-ed__left">
          <Link to="/blog" className="btn">
            <Icon name="chevronLeft" />
            All articles
          </Link>
          <h1>{article ? "Edit article" : "New article"}</h1>
          <StatePill state={state} />
          <span className="k" role="status">
            {saveState}
          </span>
        </div>
        <div className="bl-ed__right">
          {!live ? (
            <button type="button" className="btn" disabled={!!busy || (!dirty && !!article)} onClick={() => void save()}>
              {busy === "save" ? "Saving…" : scheduled ? "Save" : "Save draft"}
            </button>
          ) : null}
          <button type="button" className="btn dark" disabled={!!busy || (live && !dirty) || (later && !scheduleAt)} onClick={primary}>
            {primaryLabel}
          </button>
        </div>
      </header>

      <div className="bl-ed__grid">
        <div className="bl-ed__main">
          <section className="card bl-ed__card" aria-label="Article">
            <div className="bl-field">
              <label className="lab" htmlFor="et">
                Title
              </label>
              <input
                id="et"
                className="inp bl-ed__title"
                placeholder="Article title"
                maxLength={200}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </div>
            <div className="bl-field">
              <label className="lab" htmlFor="es">
                URL slug
              </label>
              <div className="bl-slug">
                <span className="mono">
                  {host}
                  {urlPrefix}
                </span>
                <input
                  id="es"
                  className="mono"
                  value={slug}
                  placeholder="url-of-the-article"
                  onChange={(e) => {
                    setSlugTouched(true);
                    // Letters, digits and dashes while typing; the server makes the final slug unique.
                    set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-"));
                  }}
                />
              </div>
              {live ? <span className="k">Changing the URL of a live article breaks links people already shared.</span> : null}
            </div>

            {form.series ? (
              <div className="bl-field">
                <span className="lab">
                  Public opening{" "}
                  <span className="k" style={{ fontWeight: 400 }}>
                    everyone sees this: the cold open that makes people want the rest (also the email teaser)
                  </span>
                </span>
                <div className="bl-body">
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
              </div>
            ) : null}

            <div className="bl-field">
              <span className="lab" id="body-l">
                {form.series ? "Members-only part" : "Article body"}
                {form.series ? (
                  <span className="k" style={{ fontWeight: 400 }}>
                    {" "}
                    the full case file: story, lesson, 10-minute challenge
                  </span>
                ) : null}
              </span>
              <div className="bl-body">
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
                <div className="bl-body__foot">
                  <span className="k num">
                    {words.toLocaleString("en-IN")} {words === 1 ? "word" : "words"} · about {Math.max(1, Math.ceil(words / 200))} min read
                  </span>
                  <span className="k">{draft ? "Autosaves a few seconds after you stop typing" : "Press Update to change the live article"}</span>
                </div>
              </div>
            </div>

            <div className="bl-field">
              <label className="lab" htmlFor="ex">
                Excerpt{" "}
                <span className="k" style={{ fontWeight: 400 }}>
                  {form.summary.length}/300
                </span>
              </label>
              <textarea
                id="ex"
                className="ta"
                rows={2}
                maxLength={300}
                style={{ minHeight: 0 }}
                placeholder="One or two sentences that make people want to read it."
                value={form.summary}
                onChange={(e) => set("summary", e.target.value)}
              />
              <span className="k">Shows on the blog list and in the newsletter email.</span>
            </div>
          </section>
        </div>

        <aside className="bl-ed__side">
          <section className="card bl-side" aria-labelledby="pub-h">
            <h2 id="pub-h">Publish</h2>
            {live ? (
              <div className="bl-col" style={{ gap: 8 }}>
                {article?.published_at ? <span className="k">First published {dateTime(article.published_at)}</span> : null}
                <div className="bl-inline">
                  {article ? (
                    <a className="btn sm" href={`${portalUrl()}${articlePath(article)}`} target="_blank" rel="noreferrer">
                      View on the website ↗
                    </a>
                  ) : null}
                  <button type="button" className="btn sm" disabled={!!busy} onClick={() => void unpublish()}>
                    {busy === "unpublish" ? "Unpublishing…" : "Unpublish"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {scheduled && article?.published_at ? (
                  <p className="bl-next" style={{ margin: 0 }}>
                    Goes live on its own <b>{dateTime(article.published_at)}</b>.{" "}
                    <button type="button" className="link" disabled={!!busy} onClick={() => void unpublish()}>
                      Unschedule
                    </button>
                  </p>
                ) : null}
                <div role="radiogroup" aria-label="When" className="bl-col" style={{ gap: 6 }}>
                  <label className="bl-radio">
                    <input type="radio" name="when" checked={!later} onChange={() => setScheduleAt(null)} />
                    Publish now
                  </label>
                  <label className="bl-radio">
                    <input type="radio" name="when" checked={later} onChange={() => setScheduleAt(toLocalInput(nextHour()))} />
                    {scheduled ? "Change the time" : "Schedule for later"}
                  </label>
                </div>
                {later ? (
                  <div className="bl-field">
                    <label className="lab" htmlFor="sch">
                      Goes live on its own at
                    </label>
                    <input
                      id="sch"
                      type="datetime-local"
                      className="inp"
                      value={scheduleAt ?? ""}
                      min={toLocalInput(new Date())}
                      onChange={(e) => setScheduleAt(e.target.value)}
                    />
                    <span className="k">{ist ? "India Standard Time" : "Your computer's local time"}</span>
                  </div>
                ) : null}
              </>
            )}
            {article ? (
              <button type="button" className="btn sm danger" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmDelete(true)}>
                Delete article
              </button>
            ) : null}
          </section>

          {article ? <NewsletterCard article={article} dirty={dirty} /> : null}

          <section className="card bl-side" aria-labelledby="det-h">
            <h2 id="det-h">Details</h2>
            <div className="bl-field">
              <label className="lab" htmlFor="ec">
                Category
              </label>
              <select id="ec" className="inp" value={form.type} onChange={(e) => set("type", e.target.value as ArticleType)}>
                {ARTICLE_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="k">{ARTICLE_TYPES.find((t) => t.key === form.type)?.hint}</span>
            </div>
            <div className="bl-field">
              <label className="lab" htmlFor="ea">
                Author
              </label>
              <input id="ea" className="inp" value={form.author_name} placeholder="Zinwe team" maxLength={120} onChange={(e) => set("author_name", e.target.value)} />
            </div>
            <div className="bl-field">
              <label className="lab" htmlFor="tg">
                Tags{" "}
                <span className="k" style={{ fontWeight: 400 }}>
                  comma-separated
                </span>
              </label>
              <input id="tg" className="inp" value={form.tags} placeholder="usb, dpdp, guide" onChange={(e) => set("tags", e.target.value)} />
            </div>
          </section>

          <section className="card bl-side" aria-labelledby="ser-h">
            <h2 id="ser-h">Series episode</h2>
            <div className="bl-field">
              <label className="lab" htmlFor="eser">
                Series{" "}
                <span className="k" style={{ fontWeight: 400 }}>
                  members-only: the body and files are for subscribers
                </span>
              </label>
              <select
                id="eser"
                className="inp"
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
            </div>
            {form.series ? (
              <>
                <div className="bl-two-fields">
                  <div className="bl-field">
                    <label className="lab" htmlFor="eseason">
                      Season
                    </label>
                    <select id="eseason" className="inp" value={form.season} onChange={(e) => set("season", Number(e.target.value))}>
                      {(show?.seasons.length ? show.seasons : [{ number: form.season, title: "", theme: "" }]).map((s) => (
                        <option key={s.number} value={s.number}>
                          {s.number}
                          {s.title ? ` · ${s.title}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="bl-field">
                    <label className="lab" htmlFor="eep">
                      Episode{" "}
                      <span className="k" style={{ fontWeight: 400 }}>
                        empty = next
                      </span>
                    </label>
                    <input
                      id="eep"
                      className="inp"
                      type="number"
                      min={1}
                      max={999}
                      value={form.episode}
                      placeholder="next"
                      onChange={(e) => set("episode", e.target.value)}
                    />
                  </div>
                </div>
                <div className="bl-field">
                  <label className="lab" htmlFor="esub">
                    Email subject{" "}
                    <span className="k" style={{ fontWeight: 400 }}>
                      the drip email; empty = the title
                    </span>
                  </label>
                  <input
                    id="esub"
                    className="inp"
                    value={form.newsletter_subject}
                    maxLength={200}
                    placeholder={form.title || "The file was correct. The recipient wasn't."}
                    onChange={(e) => set("newsletter_subject", e.target.value)}
                  />
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={form.free_preview} onChange={(e) => set("free_preview", e.target.checked)} />
                  <span>
                    <b>Free episode</b> <span className="k">anyone can read it in full (e.g. the pilot)</span>
                  </span>
                </label>
                {show && show.status === "draft" ? (
                  <p className="note warn">This series is a draft: its episodes aren't on the website until it's live (Blog → Series).</p>
                ) : null}
              </>
            ) : allSeries.length === 0 ? (
              <span className="k">
                No series yet. <Link to="/blog/series">Create one</Link>.
              </span>
            ) : null}
          </section>

          {article ? (
            <AttachmentsCard article={article} membersOnly={!!article.series && !article.free_preview} onChange={(next) => setArticle(next)} />
          ) : null}

          <section className="card bl-side" aria-labelledby="cov-h">
            <h2 id="cov-h">Cover image</h2>
            {form.cover ? (
              <div className="bl-col" style={{ gap: 6 }}>
                <img className="bl-cover" src={form.cover.url} alt={form.cover_alt || "Cover image, no alt text yet"} />
                <div className="bl-inline" style={{ justifyContent: "space-between" }}>
                  <button type="button" className="btn sm" disabled={busy === "cover"} onClick={() => coverInput.current?.click()}>
                    {busy === "cover" ? "Uploading…" : "Replace"}
                  </button>
                  <button type="button" className="btn sm danger" onClick={() => set("cover", null)}>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="bl-drop">
                <button type="button" className="btn sm" disabled={busy === "cover"} onClick={() => coverInput.current?.click()}>
                  {busy === "cover" ? "Uploading…" : "Upload image"}
                </button>
                <span className="k">PNG, JPG or WebP, up to 5 MB</span>
              </div>
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
            <span className="k">1200×630 works best for sharing.</span>
            <div className="bl-field">
              <label className="lab" htmlFor="alt">
                Alt text
              </label>
              <input
                id="alt"
                className="inp"
                placeholder="Describe the image for people who can't see it"
                maxLength={200}
                value={form.cover_alt}
                onChange={(e) => set("cover_alt", e.target.value)}
              />
            </div>
          </section>

          <section className="card bl-side" aria-labelledby="seo-h">
            <div className="bl-side__head">
              <h2 id="seo-h">Search</h2>
              <span className={"pill " + (sc.ok === 3 ? "good" : "warn")}>SEO {sc.ok}/3</span>
            </div>
            <div className="bl-field">
              <div className="bl-side__head">
                <label className="lab" htmlFor="st">
                  Search title{" "}
                  <span className="k" style={{ fontWeight: 400 }}>
                    empty = the title
                  </span>
                </label>
                <span className={"num bl-count" + (form.seo_title.length > 60 ? " is-bad" : "")}>{form.seo_title.length} / 60</span>
              </div>
              <input id="st" className="inp" value={form.seo_title} maxLength={70} onChange={(e) => set("seo_title", e.target.value)} />
            </div>
            <div className="bl-field">
              <div className="bl-side__head">
                <label className="lab" htmlFor="md">
                  Meta description
                </label>
                <span className={"num bl-count " + (metaLen >= 70 && metaLen <= 160 ? "is-good" : metaLen > 160 ? "is-bad" : "is-warn")}>
                  {metaLen} / 160
                </span>
              </div>
              <textarea
                id="md"
                className="ta"
                rows={3}
                style={{ minHeight: 0 }}
                maxLength={170}
                placeholder="The description people see under the title in Google."
                value={form.meta_description}
                onChange={(e) => set("meta_description", e.target.value)}
              />
              <span className="k">{metaHint}</span>
            </div>
            <ul className="bl-checks">
              {checks.map((c) => (
                <li key={c.label}>
                  <span className={"bl-mark " + (c.ok ? "ok" : "no")} aria-hidden="true">
                    {c.ok ? "OK" : "!"}
                  </span>
                  <span style={{ flex: "1 1 auto" }}>{c.label}</span>
                  {c.now ? <span className="k num">{c.now}</span> : null}
                  <span className="sr">{c.ok ? "passes" : "needs work"}</span>
                </li>
              ))}
            </ul>
            <div className="bl-serp" aria-label="Google preview">
              <span className="k">Google preview</span>
              <span className="bl-serp__url">
                {host.replace(/^www\./, "")}
                {urlPrefix.replace(/\//g, " › ").replace(/ › $/, "")} › {slug || "…"}
              </span>
              <span className="bl-serp__title">{(seoTitle || "Article title").slice(0, 62) + (seoTitle.length > 62 ? "…" : "")} | Zinwe</span>
              <span className="bl-serp__desc">
                {metaDesc ? metaDesc.slice(0, 158) + (metaDesc.length > 158 ? "…" : "") : "Add a meta description."}
              </span>
            </div>
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
            staleBlogCounts();
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
          role="alertdialog"
          onClose={() => blocker.reset()}
          footer={
            <>
              <button type="button" className="btn" onClick={() => blocker.reset()}>
                Stay here
              </button>
              <button type="button" className="btn danger" onClick={() => blocker.proceed()}>
                Discard changes
              </button>
              {form.title.trim() ? (
                <button
                  type="button"
                  className="btn dark"
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
          <p style={{ margin: 0 }}>
            {live ? "Your edits to this live article aren't saved yet." : "This article has changes that aren't saved yet."}{" "}
            {form.title.trim() ? "" : "Give it a title to save it."}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
