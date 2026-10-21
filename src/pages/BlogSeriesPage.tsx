import { useCallback, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  createSeries,
  deleteSeries,
  listSeries,
  updateSeries,
  uploadBlogImage,
  type BlogImageRef,
  type Series,
  type SeriesInput,
} from "../lib/blogApi";
import { date } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";
import { portalUrl } from "../content/emailTemplates";
import "../blog.css";

interface Form {
  title: string;
  slug: string;
  tagline: string;
  description: string;
  cover: BlogImageRef | null;
  cover_alt: string;
  planned_episodes: string;
  cadence: string;
  /** "1 | The Warning | Trust", one season a line. */
  seasons: string;
  position: string;
}

const EMPTY: Form = {
  title: "", slug: "", tagline: "", description: "", cover: null, cover_alt: "", planned_episodes: "0",
  cadence: "", seasons: "", position: "0",
};

const toForm = (s: Series): Form => ({
  title: s.title, slug: s.slug, tagline: s.tagline, description: s.description, cover: s.cover, cover_alt: s.cover_alt,
  planned_episodes: String(s.planned_episodes), cadence: s.cadence, position: String(s.position),
  seasons: s.seasons.map((x) => [x.number, x.title, x.theme].filter((v) => v !== "").join(" | ")).join("\n"),
});

/**
 * Members-only newsletter series (THE LAST FILE): the show's page on the website. Episodes are articles:
 * open one in the editor and pick the series under "Series episode".
 */
export function BlogSeriesPage(): ReactElement {
  const load = useCallback(() => listSeries(), []);
  const list = useLoad(load);
  const toast = useToast();
  const [editing, setEditing] = useState<Series | "new" | null>(null);
  const [removing, setRemoving] = useState<Series | null>(null);

  const toggle = async (s: Series) => {
    try {
      await updateSeries(s.id, { status: s.status === "published" ? "draft" : "published" });
      toast(s.status === "published" ? "Hidden from the website." : "Live on the website.");
      list.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't change it.", "bad");
    }
  };

  return (
    <>
      <PageHeader
        title="Series"
        subtitle="Members-only newsletter series. The opening of each episode is public; the full episode and its files are for confirmed subscribers."
        onReload={list.reload}
        pending={list.pending}
      >
        <Link className="btn btn--ghost" to="/blog">
          ← Articles
        </Link>
        <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
          New series
        </button>
      </PageHeader>

      {list.error ? (
        <p className="alert alert--bad">{list.error}</p>
      ) : !list.data ? (
        <p className="muted">Loading…</p>
      ) : list.data.length === 0 ? (
        <div className="card empty">
          <b>No series yet</b>
          <span className="muted">A series is a show: a cover, seasons and episodes. Episodes are written as articles.</span>
          <div>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing("new")}>
              Create the first series
            </button>
          </div>
        </div>
      ) : (
        <div className="series-grid">
          {list.data.map((s) => (
            <article key={s.id} className="card series-card">
              {s.cover ? <img className="series-card__art" src={s.cover.url} alt="" /> : <div className="series-card__art is-empty" />}
              <div className="series-card__body">
                <div className="series-card__top">
                  <h3>{s.title}</h3>
                  <span className={"pill " + (s.status === "published" ? "pill--good" : "pill--muted")}>
                    {s.status === "published" ? "Live" : "Draft"}
                  </span>
                </div>
                {s.tagline ? <p className="muted">{s.tagline}</p> : null}
                <p className="series-card__meta">
                  {s.episode_count} of {s.planned_episodes || "?"} episodes written · {s.seasons.length} seasons · updated {date(s.updated_at)}
                </p>
                <p className="mono series-card__url">/blog/series/{s.slug}</p>
                <div className="side-card__row">
                  <button type="button" className="link-btn" onClick={() => setEditing(s)}>
                    Edit
                  </button>
                  <Link className="link-btn" to={`/blog?series=${s.id}`}>
                    Episodes
                  </Link>
                  <Link className="link-btn" to={`/blog/new?series=${s.id}`}>
                    New episode
                  </Link>
                  <button type="button" className="link-btn" onClick={() => void toggle(s)}>
                    {s.status === "published" ? "Hide" : "Make live"}
                  </button>
                  {s.status === "published" ? (
                    <a className="link-btn" href={`${portalUrl()}/blog/series/${s.slug}`} target="_blank" rel="noreferrer">
                      View ↗
                    </a>
                  ) : null}
                  <button type="button" className="link-btn link-btn--danger" onClick={() => setRemoving(s)}>
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing ? (
        <SeriesEditor
          series={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          title="Delete this series?"
          confirmLabel="Delete series"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await deleteSeries(removing.id);
            toast("Series deleted. Its episodes are ordinary drafts now.");
            list.reload();
          }}
        >
          <p>
            <b>{removing.title}</b> will be removed. Its episodes stay as articles (out of the series). A series with live episodes can't be
            deleted: unpublish them first.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function SeriesEditor({ series, onClose, onSaved }: { series: Series | null; onClose: () => void; onSaved: () => void }): ReactElement {
  const toast = useToast();
  const [form, setForm] = useState<Form>(series ? toForm(series) : EMPTY);
  const [busy, setBusy] = useState<null | "save" | "cover">(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.title.trim()) {
      toast("Give the series a title.", "bad");
      return;
    }
    setBusy("save");
    const input: SeriesInput = {
      title: form.title,
      ...(form.slug ? { slug: form.slug } : {}),
      tagline: form.tagline,
      description: form.description,
      cover_image: form.cover?.id ?? null,
      cover_alt: form.cover_alt,
      planned_episodes: Math.max(0, Number(form.planned_episodes) || 0),
      cadence: form.cadence,
      seasons: form.seasons,
      position: Math.max(0, Number(form.position) || 0),
    };
    try {
      if (series) await updateSeries(series.id, input);
      else await createSeries(input);
      toast(series ? "Series saved." : "Series created (as a draft). Make it live when its first episode is ready.");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save.", "bad");
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

  return (
    <Modal
      title={series ? `Edit ${series.title}` : "New series"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!!busy} onClick={() => void save()}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="series-form">
        <label className="editor__field">
          <span>Title</span>
          <input value={form.title} maxLength={120} onChange={(e) => set("title", e.target.value)} placeholder="The Last File" />
        </label>
        <label className="editor__field">
          <span>
            URL <small>/blog/series/…, empty = from the title</small>
          </span>
          <input value={form.slug} maxLength={140} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} />
        </label>
        <label className="editor__field">
          <span>
            Tagline <small>one line under the title</small>
          </span>
          <input value={form.tagline} maxLength={200} onChange={(e) => set("tagline", e.target.value)} placeholder="One small mistake can change everything." />
        </label>
        <label className="editor__field">
          <span>
            Description <small>{form.description.length}/1200 · plain text</small>
          </span>
          <textarea rows={4} maxLength={1200} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </label>
        <div className="series-form__row">
          <label className="editor__field">
            <span>Episodes planned</span>
            <input type="number" min={0} max={999} value={form.planned_episodes} onChange={(e) => set("planned_episodes", e.target.value)} />
          </label>
          <label className="editor__field">
            <span>Cadence</span>
            <input value={form.cadence} maxLength={80} onChange={(e) => set("cadence", e.target.value)} placeholder="A new episode every week" />
          </label>
          <label className="editor__field">
            <span>
              Order <small>lowest first</small>
            </span>
            <input type="number" min={0} max={999} value={form.position} onChange={(e) => set("position", e.target.value)} />
          </label>
        </div>
        <label className="editor__field">
          <span>
            Seasons <small>one a line: number | title | theme</small>
          </span>
          <textarea
            rows={5}
            className="mono"
            value={form.seasons}
            onChange={(e) => set("seasons", e.target.value)}
            placeholder={"1 | The Warning | Trust\n2 | The Invisible Risk | Uncertainty"}
          />
        </label>
        <div className="editor__field">
          <span>
            Cover <small>wide artwork, 1920×1080 works best (the series page's backdrop)</small>
          </span>
          {form.cover ? (
            <img className="cover-preview" src={form.cover.url} alt={form.cover_alt || "Cover"} />
          ) : (
            <button type="button" className="cover-drop" onClick={() => coverInput.current?.click()} disabled={busy === "cover"}>
              {busy === "cover" ? "Uploading…" : "Add the series cover"}
              <small>PNG, JPG or WebP, up to 5 MB.</small>
            </button>
          )}
          <input
            ref={coverInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadCover(file);
              e.target.value = "";
            }}
          />
          {form.cover ? (
            <>
              <input aria-label="Cover alt text" value={form.cover_alt} maxLength={200} onChange={(e) => set("cover_alt", e.target.value)} placeholder="Alt text" />
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
        </div>
      </div>
    </Modal>
  );
}
