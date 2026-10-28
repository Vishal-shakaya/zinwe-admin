import { useCallback, useRef, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createSeries,
  deleteSeries,
  getSeriesStats,
  listArticles,
  listSeries,
  updateSeries,
  uploadBlogImage,
  type Article,
  type BlogImageRef,
  type Series,
  type SeriesInput,
  type SeriesStats,
} from "../lib/blogApi";
import { useLoad } from "../lib/useLoad";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import { portalUrl } from "../content/emailTemplates";
import { BlogHeader, staleBlogCounts } from "./blog/shared";
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
  drip_enabled: boolean;
  drip_weekdays: number[];
  drip_hour: string;
}

const EMPTY: Form = {
  title: "", slug: "", tagline: "", description: "", cover: null, cover_alt: "", planned_episodes: "0",
  cadence: "", seasons: "", position: "0", drip_enabled: false, drip_weekdays: [0, 1, 3, 4], drip_hour: "9",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const toForm = (s: Series): Form => ({
  title: s.title, slug: s.slug, tagline: s.tagline, description: s.description, cover: s.cover, cover_alt: s.cover_alt,
  planned_episodes: String(s.planned_episodes), cadence: s.cadence, position: String(s.position),
  seasons: s.seasons.map((x) => [x.number, x.title, x.theme].filter((v) => v !== "").join(" | ")).join("\n"),
  drip_enabled: s.drip_enabled, drip_weekdays: s.drip_weekdays, drip_hour: String(s.drip_hour),
});

/** Mon-first weekday index of a date (the API's drip_weekdays use 0 = Monday). */
const monFirst = (d: Date) => (d.getDay() + 6) % 7;
const SEND_TIMES = [8, 9, 10, 18];

/** The next drip send: the first chosen weekday at the drip hour that is still ahead. */
function nextSend(weekdays: number[], hour: number): string | null {
  if (!weekdays.length) return null;
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(hour, 0, 0, 0);
    if (d.getTime() > now.getTime() && weekdays.includes(monFirst(d))) {
      return `${DAYS[monFirst(d)]} ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })}, ${String(hour).padStart(2, "0")}:00`;
    }
  }
  return null;
}

/**
 * Blog → Series (AdminBlog board): the series at a glance, its episodes, and the email drip. Episodes are
 * articles: open one in the editor (or "New episode"). The series details are edited in a dialog.
 */
export function BlogSeriesPage(): ReactElement {
  const load = useCallback(() => Promise.all([listSeries(), listArticles()]), []);
  const list = useLoad(load);
  const toast = useToast();
  const [editing, setEditing] = useState<Series | "new" | null>(null);
  const [removing, setRemoving] = useState<Series | null>(null);
  const [numbers, setNumbers] = useState<Series | null>(null);

  const series = list.data?.[0] ?? null;
  const articles = list.data?.[1] ?? [];

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
      <BlogHeader
        known={{ series: series?.length, articles: list.data ? articles.length : undefined }}
        action={
          series && series.length ? (
            <Link className="btn dark" to={`/blog/new?series=${series[0].id}`}>
              <Icon name="plus" />
              New episode
            </Link>
          ) : (
            <button type="button" className="btn dark" onClick={() => setEditing("new")}>
              <Icon name="plus" />
              New series
            </button>
          )
        }
      />

      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !series ? (
        <LoadingState rows={6} label="Loading the series…" />
      ) : series.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="blog"
            title="No series yet"
            body="A series is a show: a cover, seasons and episodes. Episodes are written as articles."
            action={
              <button type="button" className="btn dark sm" onClick={() => setEditing("new")}>
                Create the first series
              </button>
            }
          />
        </div>
      ) : (
        <>
          {series.map((s) => (
            <SeriesBlock
              key={s.id}
              series={s}
              episodes={articles.filter((a) => a.series === s.id)}
              onEdit={() => setEditing(s)}
              onNumbers={() => setNumbers(s)}
              onToggle={() => void toggle(s)}
              onDelete={() => setRemoving(s)}
              onChanged={list.reload}
            />
          ))}
          <p className="k" style={{ margin: 0 }}>
            Another show?{" "}
            <button type="button" className="link" onClick={() => setEditing("new")}>
              New series
            </button>
          </p>
        </>
      )}

      {editing ? (
        <SeriesEditor
          series={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            staleBlogCounts();
            list.reload();
          }}
        />
      ) : null}

      {numbers ? <SeriesNumbers series={numbers} onClose={() => setNumbers(null)} /> : null}

      {removing ? (
        <ConfirmDialog
          title="Delete this series?"
          confirmLabel="Delete series"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await deleteSeries(removing.id);
            staleBlogCounts();
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

function SeriesBlock({
  series: s,
  episodes,
  onEdit,
  onNumbers,
  onToggle,
  onDelete,
  onChanged,
}: {
  series: Series;
  episodes: Article[];
  onEdit: () => void;
  onNumbers: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onChanged: () => void;
}): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const loadStats = useCallback(() => getSeriesStats(s.id), [s.id]);
  const stats = useLoad<SeriesStats>(loadStats);
  const [drip, setDrip] = useState({ enabled: s.drip_enabled, weekdays: s.drip_weekdays, hour: s.drip_hour });
  const [confirmOn, setConfirmOn] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveDrip = async (next: typeof drip, msg: string) => {
    const before = drip;
    setDrip(next);
    setSaving(true);
    try {
      await updateSeries(s.id, { drip_enabled: next.enabled, drip_weekdays: next.weekdays, drip_hour: next.hour });
      toast(msg);
      onChanged();
    } catch (err) {
      setDrip(before);
      toast(err instanceof Error ? err.message : "Couldn't save the send settings.", "bad");
    } finally {
      setSaving(false);
    }
  };

  const ordered = [...episodes].sort((a, b) => a.season - b.season || (a.episode ?? 0) - (b.episode ?? 0));
  const out = ordered.filter((a) => a.state === "published").length;
  const byEp = new Map((stats.data?.episodes ?? []).map((e) => [e.slug, e]));
  const fmt = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-IN"));
  const next = nextSend(drip.weekdays, drip.hour);
  const times = SEND_TIMES.includes(drip.hour) ? SEND_TIMES : [...SEND_TIMES, drip.hour].sort((a, b) => a - b);

  return (
    <>
      <section className="card bl-ser" aria-labelledby={`ser-h-${s.id}`}>
        {s.cover ? (
          <img className="bl-ser__cover" src={s.cover.url} alt={s.cover_alt || "Series cover"} />
        ) : (
          <div className="bl-ph bl-ser__cover" role="img" aria-label="Series cover" />
        )}
        <div className="bl-ser__text">
          <div className="bl-ser__title">
            <h2 id={`ser-h-${s.id}`}>{s.title}</h2>
            <span className={"pill " + (s.status === "published" ? "good" : "bl-st--draft")}>
              <span className="dot" />
              {s.status === "published" ? "Live" : "Draft"}
            </span>
          </div>
          {s.tagline ? <span style={{ color: "var(--ink-2)" }}>{s.tagline}</span> : null}
          {s.description ? <span className="k bl-clamp">{s.description}</span> : null}
          <div className="bl-ser__acts">
            <button type="button" className="btn sm" onClick={onEdit}>
              Edit series
            </button>
            <button type="button" className="btn sm" onClick={onNumbers}>
              Numbers
            </button>
            <button type="button" className="btn sm" onClick={onToggle}>
              {s.status === "published" ? "Hide" : "Make live"}
            </button>
            {s.status === "published" ? (
              <a className="btn sm" href={`${portalUrl()}/blog/series/${s.slug}`} target="_blank" rel="noreferrer">
                View ↗
              </a>
            ) : null}
            <button type="button" className="btn sm danger" onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>
        <dl className="bl-ser__kpis">
          <div>
            <dt className="k">Episodes out</dt>
            <dd className="num">
              {out} <span className="k">of {s.planned_episodes || ordered.length}</span>
            </dd>
          </div>
          <div>
            <dt className="k">Members read</dt>
            <dd className="num">{fmt(stats.data?.members)}</dd>
          </div>
          <div>
            <dt className="k">Emails sent</dt>
            <dd className="num">{fmt(s.drip_stats.sent)}</dd>
          </div>
          <div>
            <dt className="k">Zinwe sign-ups</dt>
            <dd className="num">{fmt(stats.data?.signups)}</dd>
          </div>
        </dl>
      </section>

      <div className="bl-ser__row">
        <section className="card bl-eps" aria-labelledby={`ep-h-${s.id}`}>
          <div className="bl-eps__head">
            <h2 id={`ep-h-${s.id}`}>Episodes</h2>
            <span className="k">Drip day = which send a new subscriber gets it on</span>
          </div>
          {ordered.length === 0 ? (
            <EmptyState
              icon="edit"
              title="No episodes yet"
              body="Write the first episode as an article and pick this series under “Series episode”."
              action={
                <Link className="btn dark sm" to={`/blog/new?series=${s.id}`}>
                  New episode
                </Link>
              }
            />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl bl-tbl" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th scope="col">Episode</th>
                    <th scope="col">Access</th>
                    <th scope="col">Drip day</th>
                    <th scope="col" className="r">
                      Sent
                    </th>
                    <th scope="col" className="r">
                      Reads
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((a, i) => {
                    const st = byEp.get(a.slug);
                    return (
                      <tr key={a.id}>
                        <td>
                          <span className="k num">{a.episode ?? i + 1}</span>{" "}
                          <button type="button" className="bl-tlink bl-tlink--inline" onClick={() => navigate(`/blog/${a.id}`)}>
                            {a.title}
                          </button>
                          {a.state !== "published" ? (
                            <span className={"pill bl-st--" + a.state} style={{ marginLeft: 4 }}>
                              {a.state === "draft" ? "Draft" : "Scheduled"}
                            </span>
                          ) : null}
                        </td>
                        <td className="bl-nowrap">
                          <span className={"pill " + (a.free_preview ? "good" : "bl-st--draft")}>
                            {a.free_preview ? "Free, all public" : "Public opening · rest members-only"}
                          </span>
                        </td>
                        <td className="num bl-nowrap">Day {i + 1}</td>
                        <td className="num r">{st && a.state === "published" ? fmt(st.sent) : "—"}</td>
                        <td className="num r" style={{ fontWeight: 600 }}>
                          {st && a.state === "published" ? fmt(st.readers) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="bl-eps__foot">
            <Link to={`/blog?series=${s.id}`} className="k">
              Open the episodes in the article list
            </Link>
          </div>
        </section>

        <section className="card bl-drip" aria-labelledby={`drip-h-${s.id}`}>
          <div className="bl-drip__head">
            <button
              type="button"
              role="switch"
              className={"bl-sw" + (drip.enabled ? " on" : "")}
              aria-checked={drip.enabled}
              aria-labelledby={`drip-h-${s.id}`}
              disabled={saving}
              onClick={() =>
                drip.enabled ? void saveDrip({ ...drip, enabled: false }, "Series drip off.") : setConfirmOn(true)
              }
            >
              <span className="tr">
                <span className="kn" />
              </span>
            </button>
            <div className="bl-col">
              <h2 id={`drip-h-${s.id}`}>Email the episodes</h2>
              <span className="k">
                {drip.enabled ? "On · the series drip sends one episode per send day" : "Off · nobody gets episode emails"}
              </span>
            </div>
          </div>
          <fieldset className="bl-days">
            <legend className="lab">Send days</legend>
            <div className="bl-days__row">
              {DAYS.map((d, i) => (
                <label key={d} className="bl-ck">
                  <input
                    type="checkbox"
                    checked={drip.weekdays.includes(i)}
                    disabled={!drip.enabled || saving}
                    onChange={(e) =>
                      void saveDrip(
                        { ...drip, weekdays: e.target.checked ? [...drip.weekdays, i].sort() : drip.weekdays.filter((x) => x !== i) },
                        "Send days saved.",
                      )
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="bl-col" style={{ gap: 6 }}>
            <label className="lab" htmlFor={`sendt-${s.id}`}>
              Send time
            </label>
            <div className="bl-inline">
              <select
                id={`sendt-${s.id}`}
                className="inp bl-auto"
                disabled={!drip.enabled || saving}
                value={drip.hour}
                onChange={(e) => void saveDrip({ ...drip, hour: Number(e.target.value) }, "Send time saved.")}
              >
                {times.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
              <span className="k">in each subscriber's time zone</span>
            </div>
          </div>
          <p className="bl-next">
            {drip.enabled
              ? next
                ? `Next send: ${next} · ${s.drip_stats.readers.toLocaleString("en-IN")} subscribers get their next episode.`
                : "Pick at least one send day."
              : "Paused. Subscribers keep their place and continue when you turn it back on."}
          </p>
          <span className="k">One episode per send day, never more than one Zinwe email a day. A guide follow-up waits for the next free day.</span>
        </section>
      </div>

      {confirmOn ? (
        <ConfirmDialog
          title="Email the episodes to subscribers?"
          confirmLabel="Turn on"
          onClose={() => setConfirmOn(false)}
          onConfirm={async () => {
            await saveDrip({ ...drip, enabled: true }, "Series drip on.");
          }}
        >
          <p>
            Every confirmed subscriber gets the episodes of <b>{s.title}</b> in order, one per send day, starting with Episode 1. New
            subscribers get Episode 1 the moment they confirm.
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
      drip_enabled: form.drip_enabled,
      drip_weekdays: form.drip_weekdays,
      drip_hour: Math.min(23, Math.max(0, Number(form.drip_hour) || 0)),
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
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn dark" disabled={!!busy} onClick={() => void save()}>
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
        <fieldset className="series-drip">
          <legend>Email the episodes (the series drip)</legend>
          <label className="check-row">
            <input type="checkbox" checked={form.drip_enabled} onChange={(e) => set("drip_enabled", e.target.checked)} />
            <span>
              <b>Send every subscriber the episodes, one a day</b>{" "}
              <small className="muted">from Episode 1 (sent the moment they confirm), in order, only episodes already live</small>
            </span>
          </label>
          <div className="series-drip__days" role="group" aria-label="Send days">
            {DAYS.map((d, i) => (
              <label key={d} className={"day-pick" + (form.drip_weekdays.includes(i) ? " is-on" : "")}>
                <input
                  type="checkbox"
                  checked={form.drip_weekdays.includes(i)}
                  onChange={(e) =>
                    set(
                      "drip_weekdays",
                      e.target.checked ? [...form.drip_weekdays, i].sort() : form.drip_weekdays.filter((x) => x !== i),
                    )
                  }
                />
                {d}
              </label>
            ))}
          </div>
          <label className="editor__field series-drip__hour">
            <span>
              From <small>the reader's local time</small>
            </span>
            <select value={form.drip_hour} onChange={(e) => set("drip_hour", e.target.value)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <p className="side-card__note">
            {form.drip_weekdays.length} emails a week. Turning this on emails every confirmed subscriber, starting with Episode 1.
          </p>
        </fieldset>
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

/** The series as a growth loop: per episode, emails sent → members who read it → Zinwe sign-ups it started. */
function SeriesNumbers({ series, onClose }: { series: Series; onClose: () => void }): ReactElement {
  const load = useCallback(() => getSeriesStats(series.id), [series.id]);
  const stats = useLoad<SeriesStats>(load);
  const d = stats.data;
  return (
    <Modal title={`${series.title}: numbers`} subtitle="Members, reads and Zinwe sign-ups that started from the series" onClose={onClose}>
      {stats.error ? (
        <p className="err-box">{stats.error}</p>
      ) : !d ? (
        <LoadingState rows={4} bare />
      ) : (
        <>
          <div className="series-kpis">
            <div><b>{d.members}</b><span>members</span></div>
            <div><b>{d.referred}</b><span>joined via a share link</span></div>
            <div><b>{d.signups}</b><span>Zinwe sign-ups from the series</span></div>
            <div><b>{d.signups_by_referral}</b><span>…of them via a share link</span></div>
          </div>
          <div className="table-card">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Episode</th>
                  <th className="num">Emails sent</th>
                  <th className="num">Members read</th>
                  <th className="num">…from the email</th>
                  <th className="num">Zinwe sign-ups</th>
                </tr>
              </thead>
              <tbody>
                {d.episodes.map((e) => (
                  <tr key={e.slug}>
                    <td>
                      <b>{String(e.episode).padStart(2, "0")}</b> {e.title}
                    </td>
                    <td className="num">{e.sent}</td>
                    <td className="num">{e.readers}</td>
                    <td className="num">{e.via_email}</td>
                    <td className="num">{e.signups}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.top_sharers.length ? (
            <p className="side-card__note">
              Top sharers: {d.top_sharers.map((t) => `${t.email} (${t.referrals})`).join(", ")}
            </p>
          ) : null}
          <p className="side-card__note">
            Opens and clicks are in Brevo; visits and the members' gate are in Google Analytics / PostHog (events tlf_*, generate_lead,
            share, file_download).
          </p>
        </>
      )}
    </Modal>
  );
}
