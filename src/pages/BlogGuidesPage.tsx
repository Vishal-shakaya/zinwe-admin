import { useCallback, useRef, useState, type ReactElement } from "react";
import {
  createGuide,
  deleteGuide,
  listGuides,
  testGuideFollowups,
  updateGuide,
  uploadBlogImage,
  uploadGuidePdf,
  type BlogImageRef,
  type Guide,
  type GuideInput,
} from "../lib/blogApi";
import { date } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import { portalUrl } from "../content/emailTemplates";
import { BlogHeader, staleBlogCounts } from "./blog/shared";
import "../blog.css";

/** "a | b" lines <-> [{a, b}] (contents: title | note; highlights: value | label). */
const toLines = (rows: Record<string, string>[], a: string, b: string) => rows.map((r) => [r[a], r[b]].filter(Boolean).join(" | ")).join("\n");
const fromLines = (text: string, a: string, b: string) =>
  text
    .split("\n")
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter((p) => p[0])
    .map((p) => ({ [a]: p[0], [b]: p.slice(1).join(" | ") }));

/** The guide's topic line (board: "ONLINE", "DATA" …): its first tag, else its tracking code. */
function topicOf(g: Guide): string {
  const tag = g.tags.split(",").map((t) => t.trim()).find(Boolean);
  return tag || g.campaign.replace(/^guide-/, "") || "Guide";
}

/**
 * Blog → Guides (AdminBlog board): free e-guides (PDF). The page is public; the PDF downloads for members of the
 * free membership (the newsletter list). Each guide has follow-up emails that go out only once approved.
 */
export function BlogGuidesPage(): ReactElement {
  const load = useCallback(() => listGuides(), []);
  const list = useLoad(load);
  const toast = useToast();
  const [editing, setEditing] = useState<Guide | "new" | null>(null);
  const [removing, setRemoving] = useState<Guide | null>(null);
  const [approving, setApproving] = useState<Guide | null>(null);
  const [testing, setTesting] = useState<number | null>(null);

  const testEmails = async (g: Guide) => {
    setTesting(g.id);
    try {
      const r = await testGuideFollowups(g.id);
      toast(`Sent ${r.sent} of ${r.of} test emails to ${r.to}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send the tests.", "bad");
    } finally {
      setTesting(null);
    }
  };

  const setFollowups = async (g: Guide, on: boolean) => {
    try {
      await updateGuide(g.id, { followups_enabled: on });
      toast(on ? `Follow-up emails approved for ${g.title}.` : "Follow-up emails off.");
      list.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't change it.", "bad");
    }
  };

  const toggle = async (g: Guide) => {
    try {
      await updateGuide(g.id, { status: g.status === "published" ? "draft" : "published" });
      toast(g.status === "published" ? "Hidden from the website." : "Live on the website.");
      list.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't change it.", "bad");
    }
  };

  return (
    <>
      <BlogHeader
        known={{ guides: list.data?.length }}
        action={
          <button type="button" className="btn dark" onClick={() => setEditing("new")}>
            <Icon name="plus" />
            New guide
          </button>
        }
      />

      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <LoadingState rows={6} label="Loading guides…" />
      ) : list.data.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="download"
            title="No guides yet"
            body="Add a guide, upload its PDF and cover, then make it live."
            action={
              <button type="button" className="btn dark sm" onClick={() => setEditing("new")}>
                New guide
              </button>
            }
          />
        </div>
      ) : (
        <div className="bl-guides">
          {list.data.map((g) => {
            const sentOf = (day: number) => g.followup_stats.find((x) => x.day === day)?.sent ?? 0;
            const n = g.followups.length;
            return (
              <section key={g.id} className="card bl-guide" aria-label={g.title}>
                <div className="bl-guide__top">
                  {g.cover ? <img className="bl-guide__cover" src={g.cover.url} alt="" /> : <div className="bl-ph bl-guide__cover" aria-hidden="true" />}
                  <div className="bl-guide__text">
                    <div className="bl-guide__topic">
                      <span className="k bl-caps">{topicOf(g)}</span>
                      <span className={"pill " + (g.status === "published" ? "good" : "bl-st--draft")}>
                        <span className="dot" />
                        {g.status === "published" ? "Live" : "Draft"}
                      </span>
                    </div>
                    <h2>{g.title}</h2>
                    <span className="k">{g.has_file ? `PDF · ${g.page_count} pages` : "No PDF yet"}</span>
                  </div>
                  <dl className="bl-guide__kpis">
                    <div>
                      <dt className="k">Downloads</dt>
                      <dd className="num">{g.stats.downloads.toLocaleString("en-IN")}</dd>
                    </div>
                    <div>
                      <dt className="k">Sign-ups</dt>
                      <dd className="num">{g.stats.signups.toLocaleString("en-IN")}</dd>
                    </div>
                  </dl>
                </div>

                {n ? (
                  <>
                    <div className="bl-guide__fu">
                      <div className="bl-col" style={{ gap: 2 }}>
                        <span className="lab">
                          Follow-up emails{" "}
                          <span className="k" style={{ fontWeight: 400 }}>
                            · {g.followups_enabled ? n : 0} of {n} approved
                          </span>
                        </span>
                        <span className="k">After a member's first download, from 09:00 their time.</span>
                      </div>
                      <div className="bl-inline">
                        <div className="seg sm" role="group" aria-label={`Follow-up emails for ${g.title}`}>
                          <button
                            type="button"
                            className={g.followups_enabled ? "on" : ""}
                            aria-pressed={g.followups_enabled}
                            onClick={() => (g.followups_enabled ? undefined : setApproving(g))}
                          >
                            Approved
                          </button>
                          <button
                            type="button"
                            className={g.followups_enabled ? "" : "off"}
                            aria-pressed={!g.followups_enabled}
                            onClick={() => (g.followups_enabled ? void setFollowups(g, false) : undefined)}
                          >
                            Off
                          </button>
                        </div>
                        <button type="button" className="btn sm" disabled={testing === g.id} onClick={() => void testEmails(g)}>
                          {testing === g.id ? "Sending…" : "Send test"}
                        </button>
                      </div>
                    </div>
                    <ul className="bl-mails">
                      {g.followups.map((m) => {
                        const sent = sentOf(m.day);
                        return (
                          <li key={m.day + m.subject}>
                            <span className="mono bl-mails__day">Day {m.day}</span>
                            <span className="bl-mails__subj">
                              <span>{m.subject}</span>
                              <span className="k num">{sent ? `sent ${sent.toLocaleString("en-IN")}` : "not sent yet"}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : null}

                <div className="bl-guide__acts">
                  <button type="button" className="btn sm" onClick={() => setEditing(g)}>
                    Edit
                  </button>
                  <button type="button" className="btn sm" onClick={() => void toggle(g)}>
                    {g.status === "published" ? "Hide" : "Make live"}
                  </button>
                  {g.status === "published" ? (
                    <a className="btn sm" href={`${portalUrl()}/blog/guides/${g.slug}`} target="_blank" rel="noreferrer">
                      View ↗
                    </a>
                  ) : null}
                  <button type="button" className="btn sm danger" onClick={() => setRemoving(g)}>
                    Delete
                  </button>
                  <span className="k bl-guide__meta">
                    {g.has_file ? `${Math.round(g.size / 1024)} KB` : "no PDF"} · {g.campaign || "no tracking code"} · updated {date(g.updated_at)}
                  </span>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editing ? (
        <GuideEditor
          guide={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            staleBlogCounts();
            list.reload();
          }}
        />
      ) : null}

      {approving ? (
        <ConfirmDialog
          title="Turn on the follow-up emails?"
          confirmLabel="Approve and turn on"
          onClose={() => setApproving(null)}
          onConfirm={async () => {
            await setFollowups(approving, true);
          }}
        >
          <p>
            Members who download <b>{approving.title}</b> will get {approving.followups.length} emails over{" "}
            {Math.max(...approving.followups.map((f) => f.day))} days, starting with members who download it from now on (earlier downloads get
            none). Send yourself the test emails first if you haven't read them.
          </p>
        </ConfirmDialog>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title="Delete this guide?"
          confirmLabel="Delete guide"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await deleteGuide(removing.id);
            staleBlogCounts();
            toast("Guide deleted.");
            list.reload();
          }}
        >
          <p>
            <b>{removing.title}</b> and its PDF will be removed from the website for good. Hide it instead if you might want it back.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

interface Form {
  title: string;
  slug: string;
  subtitle: string;
  summary: string;
  description: string;
  audience: string;
  contents: string;
  highlights: string;
  feature_line: string;
  tags: string;
  campaign: string;
  position: string;
  cover: BlogImageRef | null;
  cover_alt: string;
  samples: BlogImageRef[];
}

const toForm = (g: Guide | null): Form => ({
  title: g?.title ?? "", slug: g?.slug ?? "", subtitle: g?.subtitle ?? "", summary: g?.summary ?? "",
  description: g?.description ?? "", audience: g?.audience ?? "",
  contents: g ? toLines(g.contents, "title", "note") : "", highlights: g ? toLines(g.highlights, "value", "label") : "",
  feature_line: g?.feature_line ?? "", tags: g?.tags ?? "", campaign: g?.campaign ?? "", position: String(g?.position ?? 0),
  cover: g?.cover ?? null, cover_alt: g?.cover_alt ?? "", samples: g?.sample_pages ?? [],
});

function GuideEditor({ guide, onClose, onSaved }: { guide: Guide | null; onClose: () => void; onSaved: () => void }): ReactElement {
  const toast = useToast();
  const [form, setForm] = useState<Form>(toForm(guide));
  const [current, setCurrent] = useState<Guide | null>(guide);
  const [busy, setBusy] = useState<null | "save" | "cover" | "samples" | "pdf">(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const samplesInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const input = (): GuideInput => ({
    title: form.title,
    ...(form.slug ? { slug: form.slug } : {}),
    subtitle: form.subtitle, summary: form.summary, description: form.description, audience: form.audience,
    contents: fromLines(form.contents, "title", "note") as GuideInput["contents"],
    highlights: fromLines(form.highlights, "value", "label") as GuideInput["highlights"],
    feature_line: form.feature_line, tags: form.tags, campaign: form.campaign,
    position: Math.max(0, Number(form.position) || 0),
    cover_image: form.cover?.id ?? null, cover_alt: form.cover_alt, sample_pages: form.samples.map((s) => s.id),
  });

  /** Save (create the first time); returns the saved guide. */
  const save = async (close: boolean): Promise<Guide | null> => {
    if (!form.title.trim()) {
      toast("Give the guide a title.", "bad");
      return null;
    }
    setBusy("save");
    try {
      const g = current ? await updateGuide(current.id, input()) : await createGuide(input());
      setCurrent(g);
      if (close) {
        toast(current ? "Guide saved." : "Guide created (a draft). Upload the PDF, then make it live.");
        onSaved();
      }
      return g;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save.", "bad");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const uploadImages = async (files: FileList, kind: "cover" | "samples") => {
    setBusy(kind);
    try {
      const imgs: BlogImageRef[] = [];
      for (const f of Array.from(files)) imgs.push(await uploadBlogImage(f));
      if (kind === "cover") setForm((f) => ({ ...f, cover: imgs[0], cover_alt: f.cover_alt || `${f.title}: cover` }));
      else setForm((f) => ({ ...f, samples: [...f.samples, ...imgs].slice(0, 8) }));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't upload the image.", "bad");
    } finally {
      setBusy(null);
    }
  };

  const uploadPdf = async (file: File) => {
    const g = current ?? (await save(false));
    if (!g) return;
    setBusy("pdf");
    try {
      setCurrent(await uploadGuidePdf(g.id, file));
      toast("PDF uploaded.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't upload the PDF.", "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={guide ? `Edit ${guide.title}` : "New guide"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn dark" disabled={!!busy} onClick={() => void save(true)}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="series-form">
        <label className="editor__field">
          <span>Title</span>
          <input value={form.title} maxLength={160} onChange={(e) => set("title", e.target.value)} placeholder="How to protect your business online" />
        </label>
        <div className="series-form__row">
          <label className="editor__field">
            <span>
              URL <small>/blog/guides/…</small>
            </span>
            <input value={form.slug} maxLength={160} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} />
          </label>
          <label className="editor__field">
            <span>
              Tracking code <small>e.g. guide-scams</small>
            </span>
            <input value={form.campaign} maxLength={24} onChange={(e) => set("campaign", e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} />
          </label>
          <label className="editor__field">
            <span>Order</span>
            <input type="number" min={0} max={999} value={form.position} onChange={(e) => set("position", e.target.value)} />
          </label>
        </div>
        <label className="editor__field">
          <span>Subtitle <small>the promise under the title</small></span>
          <input value={form.subtitle} maxLength={300} onChange={(e) => set("subtitle", e.target.value)} />
        </label>
        <label className="editor__field">
          <span>Summary <small>{form.summary.length}/300 · cards and search results</small></span>
          <textarea rows={2} maxLength={300} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
        </label>
        <label className="editor__field">
          <span>Who it's for</span>
          <input value={form.audience} maxLength={200} onChange={(e) => set("audience", e.target.value)} placeholder="Owners and managers without an IT team" />
        </label>
        <label className="editor__field">
          <span>Highlights <small>one a line: value | label (the numbers on the cover)</small></span>
          <textarea rows={3} className="mono" value={form.highlights} onChange={(e) => set("highlights", e.target.value)} placeholder={"30 | Day action plan\n6 | Printable checklists"} />
        </label>
        <label className="editor__field">
          <span>Contents <small>one chapter a line: title | short note</small></span>
          <textarea rows={6} className="mono" value={form.contents} onChange={(e) => set("contents", e.target.value)} />
        </label>
        <label className="editor__field">
          <span>Description <small>what the reader gets; paragraphs</small></span>
          <textarea rows={4} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </label>
        <label className="editor__field">
          <span>How Zinwe helps <small>shipped features only</small></span>
          <input value={form.feature_line} maxLength={300} onChange={(e) => set("feature_line", e.target.value)} />
        </label>
        <label className="editor__field">
          <span>Tags <small>match the guide to blog articles and episodes</small></span>
          <input value={form.tags} maxLength={200} onChange={(e) => set("tags", e.target.value)} placeholder="scams, phishing, invoice, payments" />
        </label>

        <div className="editor__field">
          <span>PDF <small>the guide itself, up to 9 MB (members' download)</small></span>
          <div className="side-card__row">
            <button type="button" className="btn sm" disabled={!!busy} onClick={() => pdfInput.current?.click()}>
              {busy === "pdf" ? "Uploading…" : current?.has_file ? "Replace the PDF" : "Upload the PDF"}
            </button>
            {current?.has_file ? <small className="muted">{current.page_count} pages · {Math.round(current.size / 1024)} KB · {current.filename}</small> : null}
          </div>
          <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPdf(f); e.target.value = ""; }} />
        </div>

        <div className="editor__field">
          <span>Cover <small>the PDF's first page as an image (portrait)</small></span>
          {form.cover ? <img className="guide-cover-preview" src={form.cover.url} alt="" /> : null}
          <div className="side-card__row">
            <button type="button" className="link-btn" disabled={!!busy} onClick={() => coverInput.current?.click()}>
              {busy === "cover" ? "Uploading…" : form.cover ? "Replace" : "Add the cover"}
            </button>
            {form.cover ? <button type="button" className="link-btn link-btn--danger" onClick={() => set("cover", null)}>Remove</button> : null}
          </div>
          <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { if (e.target.files?.length) void uploadImages(e.target.files, "cover"); e.target.value = ""; }} />
        </div>

        <div className="editor__field">
          <span>Sample pages <small>2–4 pages shown on the public page</small></span>
          {form.samples.length ? (
            <div className="guide-samples">
              {form.samples.map((s) => (
                <span key={s.id}>
                  <img src={s.url} alt="" />
                  <button type="button" className="link-btn link-btn--danger" onClick={() => set("samples", form.samples.filter((x) => x.id !== s.id))}>Remove</button>
                </span>
              ))}
            </div>
          ) : null}
          <button type="button" className="link-btn" disabled={!!busy} onClick={() => samplesInput.current?.click()}>
            {busy === "samples" ? "Uploading…" : "Add sample pages"}
          </button>
          <input ref={samplesInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { if (e.target.files?.length) void uploadImages(e.target.files, "samples"); e.target.value = ""; }} />
        </div>
      </div>
    </Modal>
  );
}
