import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  createReleaseNote,
  deleteReleaseNote,
  getReleaseNotes,
  getReleases,
  updateReleaseNote,
  type ReleaseNote,
} from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { BELL_SAMPLE_ALERT, getDisplay, setDisplay, type NoteDisplay } from "../content/fixtures/whatsnew";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorState, LoadingState, SampleTag } from "../components/States";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import "../styles/whatsnew.css";

type SecKey = "neu" | "imp" | "fix";
const SECS: [SecKey, string, string][] = [
  ["neu", "New", "things you couldn’t do before"],
  ["imp", "Improved", "works better"],
  ["fix", "Fixed", "bugs gone"],
];
const HEADING_KEY: Record<string, SecKey> = {
  new: "neu",
  "what's new": "neu",
  "what’s new": "neu",
  added: "neu",
  improved: "imp",
  better: "imp",
  changed: "imp",
  fixed: "fix",
  fixes: "fix",
};

type Sections = Record<SecKey, string[]>;

/** The note body is plain text: "## Heading" then "- point" lines. Returns ok=false for anything else. */
function parseBody(body: string): { sec: Sections; ok: boolean } {
  const sec: Sections = { neu: [], imp: [], fix: [] };
  let cur: SecKey = "neu";
  let ok = true;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,3}\s+(.+)$/);
    if (h) {
      const key = HEADING_KEY[h[1].trim().toLowerCase()];
      if (key) cur = key;
      else ok = false;
      continue;
    }
    const b = line.match(/^[-*•]\s+(.+)$/);
    if (b) sec[cur].push(b[1].trim());
    else ok = false;
  }
  return { sec, ok };
}

function serialize(sec: Sections): string {
  return SECS.map(([k, label]) => {
    const pts = sec[k].map((t) => t.trim()).filter(Boolean);
    return pts.length ? `## ${label}\n${pts.map((t) => `- ${t}`).join("\n")}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDay(d: string): string {
  if (!d) return "No date";
  const [y, m, day] = d.split("-").map(Number);
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${M[m - 1]} ${y}`;
}

function cmpVer(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

interface Draft {
  /** "new" for an unsaved note. */
  id: number | "new";
  version: string;
  title: string;
  date: string;
  summary: string;
  sec: Sections;
  /** Body that isn't in the "## / -" shape: edited as raw text so nothing is lost. */
  raw: string | null;
  status: ReleaseNote["status"];
}

function toDraft(n: ReleaseNote): Draft {
  const { sec, ok } = parseBody(n.body);
  return {
    id: n.id,
    version: n.version,
    title: n.title,
    date: n.published_at ? isoDay(new Date(n.published_at)) : isoDay(new Date()),
    summary: n.summary,
    sec: ok ? sec : { neu: [], imp: [], fix: [] },
    raw: ok ? null : n.body,
    status: n.status,
  };
}

function blankDraft(version = "", title = "", sec?: Sections): Draft {
  return {
    id: "new",
    version,
    title,
    date: isoDay(new Date()),
    summary: "",
    sec: sec ?? { neu: [""], imp: [], fix: [] },
    raw: null,
    status: "draft",
  };
}

const STATUS: Record<ReleaseNote["status"], [string, string]> = {
  live: ["good", "Published"],
  scheduled: ["info", "Scheduled"],
  draft: ["wn-draft", "Draft"],
};

/**
 * What's new (AdminWhatsNew board, FR-21): release notes for customers. The list, the editor with New / Improved /
 * Fixed points, a live preview (Help page / bell), publish / unpublish / delete. A note stays a draft until published.
 */
export function ReleaseNotesPage(): ReactElement {
  const load = useCallback(() => getReleaseNotes(), []);
  const { data, error, reload } = useLoad(load);
  const loadRel = useCallback(() => getReleases(), []);
  const releases = useLoad(loadRel);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [base, setBase] = useState<string>("");
  const [pending, setPending] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState<"web" | "dash">("web");
  const [display, setDisp] = useState<NoteDisplay>(getDisplay("new"));
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLElement>(null);

  const notes = useMemo(() => data ?? [], [data]);
  const dirty = draft !== null && JSON.stringify(draft) !== base;

  const open = useCallback((d: Draft) => {
    setDraft(d);
    setBase(d.id === "new" ? "" : JSON.stringify(d));
    setDisp(getDisplay(String(d.id)));
  }, []);

  // First load: open the newest note (or nothing).
  useEffect(() => {
    if (data && draft === null && data.length) open(toDraft(data[0]));
  }, [data, draft, open]);

  const pick = (d: Draft) => {
    if (dirty) setPending(d);
    else open(d);
    window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30);
  };

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const patchSec = (k: SecKey, fn: (a: string[]) => string[]) =>
    setDraft((d) => (d ? { ...d, sec: { ...d.sec, [k]: fn(d.sec[k].slice()) } } : d));
  const patchDisplay = (p: Partial<NoteDisplay>) => {
    setDisp((cur) => {
      const next = { ...cur, ...p };
      if (draft) setDisplay(String(draft.id), next);
      return next;
    });
  };

  // "Release notes are behind the product": the newest live agent release has no published note.
  const latestRelease = useMemo(() => {
    const live = (releases.data ?? []).filter((r) => r.is_active);
    return live.sort((a, b) => cmpVer(b.version, a.version))[0] ?? null;
  }, [releases.data]);
  const noteFor = latestRelease ? notes.find((n) => n.version === latestRelease.version) : undefined;
  const behind = Boolean(data && latestRelease && (!noteFor || noteFor.status !== "live"));

  const body = (d: Draft) => (d.raw !== null ? d.raw : serialize(d.sec));
  const firstPoint = (d: Draft) => [...d.sec.neu, ...d.sec.imp, ...d.sec.fix].map((t) => t.trim()).find(Boolean) ?? "";

  const publishedAt = (d: Draft): string => {
    const today = isoDay(new Date());
    if (!d.date || d.date <= today) return new Date().toISOString();
    return new Date(`${d.date}T09:00:00`).toISOString();
  };

  const save = async (mode: "draft" | "publish" | "live" | "unpublish") => {
    if (!draft) return;
    const d = draft;
    if ((mode === "publish" || mode === "live") && (!d.version.trim() || !d.title.trim())) {
      toast("Add the version and a title.", "bad");
      return;
    }
    if (mode === "draft" && !d.title.trim()) {
      toast("Add a title to save it.", "bad");
      return;
    }
    if (!d.version.trim()) {
      toast("Add the version.", "bad");
      return;
    }
    setBusy(true);
    try {
      const input = {
        version: d.version.trim(),
        title: d.title.trim(),
        summary: d.summary.trim() || firstPoint(d),
        body: body(d),
      };
      let saved = d.id === "new" ? await createReleaseNote(input) : await updateReleaseNote(d.id, input);
      if (mode === "publish") saved = await updateReleaseNote(saved.id, { published_at: publishedAt(d) });
      if (mode === "unpublish") saved = await updateReleaseNote(saved.id, { published_at: null });
      if (mode === "live" && d.status !== "draft") {
        const was = notes.find((n) => n.id === d.id)?.published_at;
        if (!was || isoDay(new Date(was)) !== d.date) saved = await updateReleaseNote(saved.id, { published_at: publishedAt(d) });
      }
      if (d.id === "new") setDisplay(String(saved.id), display);
      open(toDraft(saved));
      toast(
        mode === "publish"
          ? saved.status === "scheduled"
            ? `Scheduled for ${fmtDay(d.date)}. It goes live by itself.`
            : "Published. It’s in the dashboard under Help → What’s new."
          : mode === "unpublish"
            ? "Unpublished: back to a draft."
            : mode === "live"
              ? "Saved. The live note is updated."
              : "Saved as a draft. Customers see it only after you publish it.",
      );
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t save.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const live = notes.filter((n) => n.status !== "draft").length;
  const drafts = notes.length - live;
  const d = draft;
  const isLive = d ? d.status !== "draft" : false;
  const pvSecs = d
    ? SECS.map(([k, label]) => ({ label, items: d.sec[k].map((t) => t.trim()).filter(Boolean) })).filter((s) => s.items.length)
    : [];
  const rawPreview = d?.raw ? parseBody(d.raw).sec : null;
  const earlier = notes.filter((n) => n.id !== d?.id && n.status === "live").slice(0, 3);
  const listRows: { key: string; draft: Draft; current: boolean; note: ReleaseNote | null }[] = [
    ...(d && d.id === "new" ? [{ key: "new", draft: d, current: true, note: null }] : []),
    ...notes.map((n) => ({ key: String(n.id), draft: toDraft(n), current: d?.id === n.id, note: n })),
  ];

  return (
    <>
      <PageHeader
        title="What's new"
        subtitle={
          <>
            Release notes for customers. Shown in the dashboard under <b>Help → What's new</b>, and in the dashboard bell. A
            note stays a draft until you publish it.
          </>
        }
      >
        <button type="button" className="btn dark" onClick={() => pick(blankDraft())}>
          <Icon name="plus" />
          New release note
        </button>
      </PageHeader>

      {behind && latestRelease ? (
        <section aria-labelledby="behind-h" className="wn-behind">
          <div className="wn-behind__text">
            <Icon name="clock" size={20} />
            <div>
              <h2 id="behind-h">Release notes are behind the product</h2>
              <p>
                {noteFor
                  ? `The Zinwe ${latestRelease.version} draft is ready. Publish it so customers know what changed${latestRelease.required ? " and why the update is required" : ""}.`
                  : `Zinwe ${latestRelease.version} is live${latestRelease.required ? " as a required update" : ""}, but it has no release note yet.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() =>
              noteFor
                ? pick(toDraft(noteFor))
                : pick(
                    blankDraft(latestRelease.version, "", {
                      neu: [],
                      imp: latestRelease.notes ? [latestRelease.notes] : [""],
                      fix: [],
                    }),
                  )
            }
          >
            {noteFor ? `Open the ${latestRelease.version} draft` : `Write the ${latestRelease.version} note`}
          </button>
        </section>
      ) : null}

      <section className="card wn-list" aria-labelledby="list-h">
        <div className="wn-list__head">
          <h2 id="list-h">Release notes</h2>
          {data ? (
            <span className="k">
              {live} published · {drafts} draft{drafts === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        {error ? (
          <div style={{ padding: "0 16px 16px" }}>
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : !data ? (
          <LoadingState rows={4} bare />
        ) : listRows.length === 0 ? (
          <EmptyState
            icon="whatsnew"
            title="No release notes yet"
            body="Write the first one: it stays a draft until you publish it."
          />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl wn-tbl">
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Title</th>
                  <th scope="col">Date</th>
                  <th scope="col">Status</th>
                  <th scope="col">Shown on</th>
                  <th scope="col">
                    <span className="sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((r) => {
                  const disp = r.current ? display : getDisplay(r.key);
                  const [cls, label] = STATUS[r.draft.status];
                  const aud = [disp.help ? "Help page" : "", disp.bell ? "Bell" : ""].filter(Boolean).join(" · ") || "Nowhere yet";
                  return (
                    <tr key={r.key} className={r.current ? "is-current" : undefined}>
                      <td className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                        {r.draft.version || "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="wn-tlink"
                          aria-current={r.current ? "true" : undefined}
                          onClick={() => !r.current && pick(r.draft)}
                        >
                          {r.draft.title || "Untitled note"}
                        </button>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {r.note?.published_at ? fmtDay(isoDay(new Date(r.note.published_at))) : r.note ? "Not published" : "Not saved"}
                      </td>
                      <td>
                        <span className={`pill ${cls}`}>
                          <span className="dot" />
                          {label}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-2)" }}>{aud}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`Edit release note ${r.draft.version || "untitled"}`}
                          onClick={() => !r.current && pick(r.draft)}
                        >
                          {r.current ? "Editing" : "Edit"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {d ? (
        <div className="wn-grid">
          <section ref={editorRef} className="card wn-card" aria-labelledby="ed-h">
            <div className="wn-card__head">
              <h2 id="ed-h">{d.version ? `Zinwe ${d.version}` : "New release note"}</h2>
              <span className={`pill ${STATUS[d.status][0]}`}>
                <span className="dot" />
                {d.id === "new" ? "Draft · not saved" : STATUS[d.status][1]}
              </span>
            </div>

            <div className="wn-field">
              <label className="lab" htmlFor="wn-t">
                Title
              </label>
              <input
                id="wn-t"
                className="inp"
                maxLength={120}
                value={d.title}
                placeholder="What changed, in a few words"
                onChange={(e) => patch({ title: e.target.value })}
              />
            </div>
            <div className="wn-two">
              <div className="wn-field">
                <label className="lab" htmlFor="wn-v">
                  Version
                </label>
                <input
                  id="wn-v"
                  className="inp mono"
                  maxLength={20}
                  value={d.version}
                  placeholder="1.3.0"
                  onChange={(e) => patch({ version: e.target.value })}
                />
              </div>
              <div className="wn-field">
                <label className="lab" htmlFor="wn-d">
                  Date
                </label>
                <input id="wn-d" type="date" className="inp" value={d.date} onChange={(e) => patch({ date: e.target.value })} />
              </div>
            </div>

            {d.raw !== null ? (
              <div className="wn-field">
                <label className="lab" htmlFor="wn-raw">
                  Notes{" "}
                  <span className="k" style={{ fontWeight: 400 }}>
                    “## ” for a heading, “- ” for a point
                  </span>
                </label>
                <textarea
                  id="wn-raw"
                  className="ta"
                  rows={10}
                  value={d.raw}
                  onChange={(e) => patch({ raw: e.target.value })}
                />
                <span className="k">
                  This note was written before the New / Improved / Fixed editor.{" "}
                  <button
                    type="button"
                    className="link"
                    onClick={() => patch({ raw: null, sec: parseBody(d.raw ?? "").sec })}
                  >
                    Switch to points
                  </button>{" "}
                  (lines that aren’t points are dropped).
                </span>
              </div>
            ) : (
              SECS.map(([k, label, hint]) => (
                <fieldset key={k} className="wn-sec">
                  <legend className="lab">
                    {label}{" "}
                    <span className="k" style={{ fontWeight: 400 }}>
                      {hint}
                    </span>
                  </legend>
                  {d.sec[k].map((t, i) => (
                    <div key={i} className="wn-point">
                      <span aria-hidden="true" className="wn-bullet" />
                      <input
                        className="inp"
                        aria-label={`${label}, point ${i + 1}`}
                        value={t}
                        onChange={(e) => {
                          const v = e.target.value;
                          patchSec(k, (a) => {
                            a[i] = v;
                            return a;
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="wn-ib"
                        aria-label={`Remove ${label.toLowerCase()} point ${i + 1}`}
                        onClick={() =>
                          patchSec(k, (a) => {
                            a.splice(i, 1);
                            return a;
                          })
                        }
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  ))}
                  <div>
                    <button type="button" className="btn sm" onClick={() => patchSec(k, (a) => [...a, ""])}>
                      <Icon name="plus" size={14} strokeWidth={2} />
                      Add a point
                    </button>
                  </div>
                </fieldset>
              ))
            )}

            <div className="wn-field">
              <span className="lab">
                Image{" "}
                <span className="k" style={{ fontWeight: 400 }}>
                  optional
                </span>{" "}
                <SampleTag what="Not saved yet" />
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 5 * 1024 * 1024) {
                    toast("That image is over 5 MB.", "bad");
                    return;
                  }
                  patchDisplay({ image: { url: URL.createObjectURL(f), name: f.name, size: f.size } });
                }}
              />
              {display.image ? (
                <div className="wn-img">
                  <img src={display.image.url} alt="" className="wn-img__thumb" />
                  <div className="wn-img__meta">
                    <span className="mono" style={{ fontSize: 13 }}>
                      {display.image.name}
                    </span>
                    <span className="k">{Math.round(display.image.size / 1024)} KB</span>
                  </div>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      patchDisplay({ image: null });
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="wn-drop">
                  <span className="k">PNG, JPG or WebP, up to 5 MB. A picture of the new screen in the dashboard works best.</span>
                  <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
                    Add an image
                  </button>
                </div>
              )}
            </div>

            <div className="wn-field" style={{ gap: 8 }}>
              <span className="lab">
                Shown on <SampleTag what="Not saved yet" />
              </span>
              <div className="wn-checks">
                <label className="ck">
                  <input type="checkbox" checked={display.help} onChange={() => patchDisplay({ help: !display.help })} />
                  Dashboard · Help → What's new
                </label>
                <label className="ck">
                  <input type="checkbox" checked={display.bell} onChange={() => patchDisplay({ bell: !display.bell })} />
                  Dashboard · bell
                </label>
              </div>
            </div>

            <label className="sw wn-banner">
              <input
                type="checkbox"
                role="switch"
                checked={display.banner}
                onChange={() => patchDisplay({ banner: !display.banner })}
              />
              <span className="tr">
                <span />
              </span>
              <span className="wn-banner__text">
                <span className="lab">Show the release banner on the blog</span>
                <span className="k" style={{ fontWeight: 400 }}>
                  A thin strip above the blog: "Zinwe {d.version || "x"} is out. See what's new."
                </span>
              </span>
            </label>

            <div className="wn-actions">
              {isLive ? (
                <div className="wn-flex">
                  <button type="button" className="btn dark" disabled={busy} onClick={() => void save("live")}>
                    {busy ? "Saving…" : "Save changes"}
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void save("unpublish")}>
                    Unpublish
                  </button>
                </div>
              ) : (
                <div className="wn-flex">
                  <button type="button" className="btn dark" disabled={busy} onClick={() => void save("publish")}>
                    {busy ? "Saving…" : d.date > isoDay(new Date()) ? "Schedule" : "Publish"}
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void save("draft")}>
                    Save draft
                  </button>
                </div>
              )}
              {dirty ? <span className="k">Unsaved changes</span> : null}
              <button type="button" className="btn danger" style={{ marginLeft: "auto" }} onClick={() => setDeleting(true)}>
                Delete
              </button>
            </div>
          </section>

          <section className="card wn-card" aria-labelledby="pv-h">
            <div className="wn-card__head">
              <div style={{ display: "flex", flexDirection: "column" }}>
                <h2 id="pv-h">Live preview</h2>
                <span className="k">Updates as you type.</span>
              </div>
              <div className="seg" role="group" aria-label="Preview">
                <button type="button" className={pv === "web" ? "on" : ""} aria-pressed={pv === "web"} onClick={() => setPv("web")}>
                  Help page
                </button>
                <button type="button" className={pv === "dash" ? "on" : ""} aria-pressed={pv === "dash"} onClick={() => setPv("dash")}>
                  Bell
                </button>
              </div>
            </div>

            {pv === "web" ? (
              <div className="wn-pv">
                <div className="wn-pv__bar">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5E6167" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="5" y="10.5" width="14" height="9.5" rx="1.5" />
                    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
                  </svg>
                  <span>Dashboard · Help → What's new</span>
                </div>
                {!display.help ? (
                  <div className="wn-pv__off">Not shown in Help → What's new. Tick it under Shown on.</div>
                ) : (
                  <div className="wn-pv__page">
                    <span className="wn-pv__eyebrow">What's new</span>
                    <article className="wn-pv__card">
                      <span className="wn-pv__meta">
                        Zinwe {d.version} · {fmtDay(d.date)}
                      </span>
                      <h3>{d.title || "Your title"}</h3>
                      {display.image ? <img src={display.image.url} alt="Release image" className="wn-pv__img" /> : null}
                      {(rawPreview
                        ? SECS.map(([k, label]) => ({ label, items: rawPreview[k] })).filter((s) => s.items.length)
                        : pvSecs
                      ).map((s) => (
                        <div key={s.label} className="wn-pv__sec">
                          <h4>{s.label}</h4>
                          <ul>
                            {s.items.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </article>
                    {earlier.length ? (
                      <div className="wn-pv__earlier">
                        <span className="wn-pv__meta">Earlier</span>
                        {earlier.map((e) => (
                          <span key={e.id} style={{ fontSize: 13 }}>
                            <b>Zinwe {e.version}</b> · {e.title}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : (
              <div className="wn-bell">
                {!display.bell ? (
                  <div className="wn-pv__off" style={{ background: "transparent" }}>
                    Not shown in the bell. Tick Dashboard · bell under Shown on.
                  </div>
                ) : (
                  <div className="wn-bell__panel">
                    <div className="wn-bell__head">
                      <b>Notifications</b>
                      <span>1 new</span>
                    </div>
                    <div className="wn-bell__note">
                      <span className="wn-bell__tag">What's new · Zinwe {d.version}</span>
                      <b style={{ fontSize: 15 }}>{d.title || "Your title"}</b>
                      <span style={{ fontSize: 13, color: "#2E2A25" }}>
                        {d.summary.trim() || firstPoint(d) || "The first point of the note shows here."}
                      </span>
                      <span className="wn-bell__link">Read the full note</span>
                    </div>
                    <div className="wn-bell__row">
                      <span style={{ fontSize: 13 }}>{BELL_SAMPLE_ALERT.title}</span>
                      <span style={{ fontSize: 12, color: "#6B6358" }}>{BELL_SAMPLE_ALERT.meta}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {deleting && d ? (
        <ConfirmDialog
          title="Delete this release note?"
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            if (d.id !== "new") await deleteReleaseNote(d.id);
            setDeleting(false);
            const rest = notes.filter((n) => n.id !== d.id);
            setDraft(null);
            if (rest.length) open(toDraft(rest[0]));
            toast("Deleted.");
            reload();
          }}
        >
          <p>It disappears from Help → What's new and the bell. This can't be undone.</p>
        </ConfirmDialog>
      ) : null}

      {pending ? (
        <ConfirmDialog
          title="Leave without saving?"
          confirmLabel="Leave without saving"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            open(pending);
            setPending(null);
          }}
        >
          <p>Your changes to {d?.version ? `Zinwe ${d.version}` : "this note"} aren’t saved yet.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
