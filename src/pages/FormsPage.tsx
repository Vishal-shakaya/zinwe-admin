import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, getForm, getForms, updateForm, type FormSubmission } from "../lib/api";
import { refreshBadges } from "../lib/badges";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";
import { ErrorState, LoadingState, SampleTag } from "../components/States";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import { contactedIds, setContacted, type BoardStatus } from "../content/fixtures/forms";
import { dayOnly, dayTime, downloadCsv, firstName, isoToday, timeOnly } from "./inbox/format";
import "../styles/forms.css";

const STATUS_LABEL: Record<BoardStatus, string> = { new: "New", contacted: "Contacted", done: "Done" };

/** Where each known form comes from (board hint line); a new kind gets a plain line. */
const KIND_HINT: Record<string, string> = {
  setup_call: "From the Book a setup call form · times are what they picked",
  demo_call: "From the Book a demo form · times are what they picked",
  contact: "From the Contact page",
  newsletter: "From the blog and the website footer",
  prereg: "Waitlists for the Mac app and the phone app",
};

/** "team_size" -> "Team size". */
function fieldLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A form-specific value as text; empty values are skipped. */
function fieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(fieldValue).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return out;
}

// Keys the board shows in its own rows; anything else is listed under them by its own label.
const KNOWN = ["pcs", "team_size", "topics", "concerns", "preferred_time", "when", "city", "location", "country", "page"];

/** The board's view of a submission, built from the API row (+ the local Contacted flag). */
function view(r: FormSubmission, contacted: number[]) {
  const d = r.details ?? {};
  const str = (k: string) => fieldValue(d[k]);
  const pcsRaw = str("pcs") || str("team_size");
  const pcs = pcsRaw ? `${pcsRaw.replace(/-/g, "–")}${/pc/i.test(pcsRaw) ? "" : " PCs"}` : "";
  const topicsRaw = d.topics ?? d.concerns;
  const topics = Array.isArray(topicsRaw)
    ? topicsRaw.map((t) => fieldValue(t)).filter(Boolean)
    : topicsRaw
      ? [fieldValue(topicsRaw)]
      : r.subject
        ? [r.subject]
        : [];
  const status: BoardStatus = r.status === "new" ? "new" : contacted.includes(r.id) ? "contacted" : "done";
  const extra = Object.entries(d)
    .filter(([k]) => !KNOWN.includes(k))
    .map(([k, v]) => [fieldLabel(k), fieldValue(v)] as const)
    .filter(([, v]) => v !== "");
  return {
    status,
    pcs,
    topics,
    when: str("preferred_time") || str("when"),
    city: str("city") || str("location") || str("country"),
    page: str("page"),
    extra,
  };
}

/** The next three working days (IST) for the "Book call" message. */
function nextSlots(): string[] {
  const out: string[] = [];
  const times = ["16:00", "11:00", "12:00"];
  const d = new Date();
  while (out.length < 3) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day === 0 || day === 6) continue;
    const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).replace(",", "");
    out.push(`${label}, ${times[out.length]} IST`);
  }
  return out;
}

/**
 * Forms inbox (AdminForms board): everything visitors submit on the website. One tab per form type, straight
 * from the backend, so a new form needs no change here. `?kind=contact` picks a tab; `?open=<id>` opens one.
 */
export function FormsPage(): ReactElement {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const selectedId = Number(params.get("open")) || null;
  const [st, setSt] = useState<BoardStatus | "all">("all");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 300);
  const [contacted, setContactedState] = useState<number[]>(contactedIds);

  const load = useCallback(() => getForms({ kind: kind || undefined, q: q || undefined }), [kind, q]);
  const { data, error, reload, setData } = useLoad(load);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "kind") next.delete("open");
    setParams(next, { replace: true });
  };

  const inKind = data?.rows ?? [];
  const rows = inKind.filter((r) => st === "all" || view(r, contacted).status === st);
  const selected = inKind.find((r) => r.id === selectedId) ?? null;
  const kinds = data?.kinds ?? [];
  const kindLabel = kind ? (kinds.find((k) => k.kind === kind)?.label ?? fieldLabel(kind)) : "All forms";

  /** Change a submission's status: New / Contacted / Done (Contacted + Done = handled on the server). */
  const changeStatus = async (r: FormSubmission, next: BoardStatus, quiet = false) => {
    try {
      const want = next === "new" ? "new" : "handled";
      const row = want === r.status ? r : await updateForm(r.id, { status: want });
      setContactedState(setContacted(r.id, next === "contacted"));
      if (data) setData({ ...data, rows: data.rows.map((x) => (x.id === row.id ? row : x)) });
      if (!quiet) toast(`${r.name || r.email}: ${next === "new" ? "moved back to New." : next === "contacted" ? "marked Contacted." : "marked Done."}`);
      if (want !== r.status) {
        refreshBadges();
        reload();
      }
      return row;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn’t save it.", "bad");
      return null;
    }
  };

  const exportCsv = () => {
    const name = `zinwe-${kind || "forms"}-${isoToday()}.csv`;
    downloadCsv(
      name,
      ["Form", "Status", "Name", "Email", "Phone", "Company", "PCs", "Topics", "Preferred time", "Message", "Submitted", "Note"],
      rows.map((r) => {
        const v = view(r, contacted);
        return [r.kind_label, STATUS_LABEL[v.status], r.name, r.email, r.phone, r.company, v.pcs, v.topics.join("; "), v.when, r.message, r.created_at, r.note];
      }),
    );
    toast(`Exported ${rows.length} ${kindLabel.toLowerCase()} to ${name}`);
  };

  let emptyTitle = "No new submissions.";
  let emptySub = `New ${kindLabel.toLowerCase()} show up here as soon as someone sends the form.`;
  if (q) {
    emptyTitle = `Nothing matches “${q}”.`;
    emptySub = "Search looks at name, email, company, topics and message.";
  } else if (st !== "all" && st !== "new") {
    emptyTitle = "Nothing in this view.";
    emptySub = `Try All to see every ${kind ? kindLabel.toLowerCase() : "submission"}.`;
  } else if (st === "all" && inKind.length === 0) {
    emptyTitle = "No submissions yet.";
  }

  const totalNew = kinds.reduce((s, k) => s + k.new, 0);
  const total = kinds.reduce((s, k) => s + k.total, 0);
  const tabs = [{ kind: "", label: "All forms", total, new: totalNew }, ...kinds];

  return (
    <>
      <PageHeader title="Forms" subtitle="What visitors send from zinwe.io. Each new submission also arrives by email at hello@zinwe.io.">
        <label className="sr" htmlFor="fq">
          Search submissions
        </label>
        <input
          id="fq"
          type="search"
          className="inp zfm-search"
          placeholder="Search name, email, company or text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn" onClick={exportCsv} disabled={!data}>
          <Icon name="download" />
          Export CSV
        </button>
      </PageHeader>

      <div role="tablist" aria-label="Form" className="zfm-tabs">
        {tabs.map((k) => {
          const on = kind === k.kind;
          return (
            <button
              key={k.kind || "all"}
              type="button"
              role="tab"
              aria-selected={on}
              className={"zfm-tab" + (on ? " on" : "")}
              onClick={() => {
                setSt("all");
                setParam("kind", k.kind || null);
              }}
            >
              {k.label}
              {data ? <span className={"pill num zfm-tab__n" + (k.new ? " is-new" : "")}>{k.new ? `${k.new} new` : k.total}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="zfm-bar">
        <div role="group" aria-label="Status" className="zfm-chips">
          {(["all", "new", "contacted", "done"] as const).map((c) => (
            <button key={c} type="button" className={"chip" + (st === c ? " on" : "")} aria-pressed={st === c} onClick={() => setSt(c)}>
              {c === "all" ? "All" : STATUS_LABEL[c]}
              <span className="num zfm-chip-n">{inKind.filter((r) => c === "all" || view(r, contacted).status === c).length}</span>
            </button>
          ))}
        </div>
        <span className="k">{kind ? (KIND_HINT[kind] ?? "From a form on zinwe.io") : "Every form on zinwe.io, newest first"}</span>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState rows={6} label="Loading submissions…" />
      ) : (
        <div className="zfm-layout">
          <section className="card zfm-list" aria-label="Submissions">
            <div className="tbl-wrap">
              <table className="tbl zfm-tbl">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 34 }}>
                      <span className="sr">New</span>
                    </th>
                    <th scope="col" style={{ width: "27%" }}>
                      Person
                    </th>
                    <th scope="col" style={{ width: "19%" }}>
                      Topics
                    </th>
                    <th scope="col">Message</th>
                    <th scope="col" style={{ width: 92 }}>
                      Submitted
                    </th>
                    <th scope="col" style={{ width: 136 }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const v = view(r, contacted);
                    const on = r.id === selectedId;
                    const isNew = v.status === "new";
                    const name = r.name || r.email || "No name";
                    return (
                      <tr key={r.id} className={on ? "is-on" : isNew ? "is-new" : ""}>
                        <td>
                          <span className={"zfm-dot" + (isNew ? " is-new" : "")} aria-hidden="true">
                            <span className="dot" />
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="zfm-who"
                            aria-label={`Open ${name}${isNew ? ", new" : ""}`}
                            aria-expanded={on}
                            onClick={() => setParam("open", String(r.id))}
                          >
                            <b className="zfm-clip zfm-who__name">{name}</b>
                            <span className="zfm-clip zfm-who__email">{r.email}</span>
                            <span className="k zfm-clip">
                              {r.company ? `${r.company}${v.pcs ? ` · ${v.pcs}` : ""}` : v.page ? `Signed up from ${v.page}` : r.kind_label}
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className="zfm-topics">
                            {v.topics.map((t) => (
                              <span key={t} className="zfm-topic">
                                {t}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td>
                          <span className="zfm-clamp">{r.message || "—"}</span>
                        </td>
                        <td>
                          <span className="zfm-when">
                            <span className="num">{dayOnly(r.created_at)}</span>
                            <span className="k num">{timeOnly(r.created_at)}</span>
                          </span>
                        </td>
                        <td>
                          <label className="sr" htmlFor={`st-${r.id}`}>
                            {`Status for ${name}`}
                          </label>
                          <select
                            id={`st-${r.id}`}
                            className={"zfm-stsel is-" + v.status}
                            value={v.status}
                            onChange={(e) => void changeStatus(r, e.target.value as BoardStatus)}
                          >
                            <option value="new">New</option>
                            <option value="contacted">Contacted</option>
                            <option value="done">Done</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 ? (
                <div className="zfm-empty">
                  <b>{emptyTitle}</b>
                  <span className="k">{emptySub}</span>
                  {q || st !== "all" ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setQuery("");
                        setSt("all");
                      }}
                    >
                      Clear search and filters
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          {selectedId ? (
            <SubmissionPane
              key={selectedId}
              id={selectedId}
              fromList={selected}
              contacted={contacted}
              onStatus={changeStatus}
              onSaved={(row) => {
                if (data) setData({ ...data, rows: data.rows.map((x) => (x.id === row.id ? row : x)) });
              }}
              onClose={() => setParam("open", null)}
            />
          ) : (
            <aside className="card zfm-pick">
              <b>Pick a submission</b>
              <span className="k">See everything they sent, reply or book a call.</span>
            </aside>
          )}
        </div>
      )}
    </>
  );
}

function SubmissionPane({
  id,
  fromList,
  contacted,
  onStatus,
  onSaved,
  onClose,
}: {
  id: number;
  fromList: FormSubmission | null;
  contacted: number[];
  onStatus: (r: FormSubmission, next: BoardStatus, quiet?: boolean) => Promise<FormSubmission | null>;
  onSaved: (row: FormSubmission) => void;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  // Use the list's copy when it has one; a deep link to a row outside the current filter loads it.
  const [loadedSub, setSub] = useState<FormSubmission | null>(null);
  const sub = fromList ?? loadedSub;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const pane = useRef<HTMLElement>(null);

  useEffect(() => {
    if (fromList || loadedSub) return;
    let alive = true;
    getForm(id)
      .then((row) => {
        if (alive) setSub(row);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof ApiError ? err.message : "Couldn’t load this submission.");
      });
    return () => {
      alive = false;
    };
  }, [id, fromList, loadedSub]);

  // On a phone the details open below the list: bring them into view.
  const loaded = sub !== null;
  useEffect(() => {
    if (loaded && window.matchMedia("(max-width: 900px)").matches) {
      pane.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loaded]);

  if (loadError)
    return (
      <aside className="card zfm-pane">
        <ErrorState message={loadError} title="This submission couldn’t load" />
      </aside>
    );
  if (!sub)
    return (
      <aside className="card zfm-pane">
        <LoadingState bare rows={6} label="Loading the submission…" />
      </aside>
    );

  const v = view(sub, contacted);
  const name = sub.name || sub.email || "No name";
  const first = firstName(sub.name, sub.email);
  const noteVal = note ?? sub.note;
  const replySubject = sub.subject ? `Re: ${sub.subject}` : `Your ${sub.kind_label.toLowerCase()} request to Zinwe`;
  const intro: Record<string, string> = {
    setup_call: `Thanks for booking a setup call with Zinwe. ${v.when ? `${v.when} works for us. ` : ""}We will call you on ${sub.phone || "the number you prefer"} and set up your first PC together. It takes about 20 minutes.`,
    demo_call: `Thanks for asking for a demo of Zinwe. ${v.when ? `${v.when} works for us. ` : ""}We will call you on ${sub.phone || "the number you prefer"}.`,
    newsletter: "Thanks for subscribing to the Zinwe newsletter. You will get one short email a month with tips to keep your office data safe.",
    prereg: "Thanks for pre-registering. We will email you the day it is ready, before anyone else.",
  };
  const replyFor = () => `Hi ${first},\n\n${intro[sub.kind] ?? "Thanks for writing to us. "}\n\nZinwe · zinwe.io`;
  const bookText = `Hi ${first}, this is the Zinwe team. Could we do a 20-minute call to set up your first PC? Pick a time that suits you:\n${nextSlots()
    .map((s) => `• ${s}`)
    .join("\n")}\nOr choose another slot at zinwe.io/book-a-call`;
  const handledLine =
    sub.status === "handled" && sub.handled_at
      ? `${v.status === "contacted" ? "Contacted" : "Done"} ${dayOnly(sub.handled_at)}${sub.handled_by ? ` by ${sub.handled_by}` : ""}`
      : "";

  const sendReply = async () => {
    if (!reply.trim()) return;
    const href = `mailto:${sub.email}?subject=${encodeURIComponent(replySubject)}&body=${encodeURIComponent(reply.trim())}`;
    window.location.href = href;
    const wasNew = v.status === "new";
    setReplyOpen(false);
    setReply("");
    if (wasNew) await onStatus(sub, "contacted", true);
    toast(`Reply opened in your email app${wasNew ? ". Marked Contacted." : "."}`);
  };

  const saveNote = async () => {
    setBusy(true);
    try {
      const row = await updateForm(sub.id, { note: noteVal.trim() });
      onSaved(row);
      setSub(row);
      setNote(null);
      toast("Note saved.");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn’t save it.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const rowsDl: [string, ReactElement | string][] = [
    ["Work email", <a href={`mailto:${sub.email}`}>{sub.email}</a>],
    ...(sub.phone ? ([["Phone", <a href={`tel:${sub.phone.replace(/[^\d+]/g, "")}`}>{sub.phone}</a>]] as [string, ReactElement][]) : []),
    ["Company", sub.company || "—"],
    ...(v.pcs ? ([["PCs", v.pcs]] as [string, string][]) : []),
  ];

  return (
    <aside ref={pane} className="card zfm-pane" aria-label={`${sub.kind_label} from ${name}`}>
      <div className="zfm-pane__head">
        <div className="zfm-pane__title">
          <span className="k zfm-pane__kind">{sub.kind_label}</span>
          <h2>{name}</h2>
          <span className="k">
            Received {dayTime(sub.created_at)}
            {v.page ? ` · ${v.page}` : ""}
          </span>
        </div>
        <button type="button" className="zfm-ibtn" aria-label="Close details" onClick={onClose}>
          <Icon name="close" strokeWidth={2} />
        </button>
      </div>

      <div className="zfm-pane__status">
        <label className="k zfm-pane__k" htmlFor="dst">
          Status
        </label>
        <select id="dst" className={"zfm-stsel is-" + v.status} value={v.status} onChange={(e) => void onStatus(sub, e.target.value as BoardStatus)}>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="done">Done</option>
        </select>
        {v.status === "contacted" ? <SampleTag what="Contacted: this browser" /> : null}
        <span className="k">{handledLine}</span>
      </div>

      <dl className="zfm-dl">
        {rowsDl.map(([k, val]) => (
          <div key={k} className="zfm-dl__row">
            <dt className="k">{k}</dt>
            <dd>{val}</dd>
          </div>
        ))}
        {v.topics.length ? (
          <div className="zfm-dl__row">
            <dt className="k">Topics</dt>
            <dd className="zfm-topics">
              {v.topics.map((t) => (
                <span key={t} className="zfm-topic">
                  {t}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        {v.when ? (
          <div className="zfm-dl__row">
            <dt className="k">Preferred time</dt>
            <dd className="is-strong">{v.when}</dd>
          </div>
        ) : null}
        {v.city ? (
          <div className="zfm-dl__row">
            <dt className="k">Location</dt>
            <dd>{v.city}</dd>
          </div>
        ) : null}
        {v.extra.map(([k, val]) => (
          <div key={k} className="zfm-dl__row">
            <dt className="k">{k}</dt>
            <dd>{val}</dd>
          </div>
        ))}
      </dl>

      {sub.message ? (
        <div className="zfm-msg">
          <h3 className="k">Message</h3>
          <p>{sub.message}</p>
        </div>
      ) : null}

      <div className="zfm-acts">
        <button
          type="button"
          className="btn dark"
          aria-expanded={replyOpen}
          onClick={() => {
            if (replyOpen) setReplyOpen(false);
            else {
              setReplyOpen(true);
              setReply(replyFor());
              setCopied(null);
            }
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
          </svg>
          Reply
        </button>
        {sub.kind !== "newsletter" ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              try {
                void navigator.clipboard?.writeText(bookText).catch(() => {});
              } catch {
                /* the text still shows below */
              }
              setCopied(bookText);
              setReplyOpen(false);
              toast("Scheduling message copied.");
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3.5" y="5" width="17" height="15" rx="2" />
              <path d="M3.5 10h17M8 3v4M16 3v4" />
            </svg>
            Book call
          </button>
        ) : null}
      </div>

      {replyOpen ? (
        <div className="zfm-reply">
          <span className="zfm-reply__to">
            <span className="k">To</span> {sub.email} <span className="k">· opens in your email app</span>
          </span>
          <label className="sr" htmlFor="rp">
            {`Reply to ${name}`}
          </label>
          <textarea id="rp" className="ta zfm-reply__ta" value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="zfm-reply__btns">
            <button type="button" className="btn" onClick={() => setReplyOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn dark" disabled={!reply.trim()} onClick={() => void sendReply()}>
              Send reply
            </button>
          </div>
        </div>
      ) : null}

      {copied ? (
        <div role="status" className="zfm-copied">
          <span className="zfm-copied__h">
            <Icon name="check" size={15} strokeWidth={2} />
            Copied. Paste it into your email or WhatsApp.
          </span>
          <p>{copied}</p>
        </div>
      ) : null}

      <div className="zfm-note">
        <label htmlFor={`note-${sub.id}`}>
          Internal note <span className="k">· only the team sees it</span>
        </label>
        <textarea
          id={`note-${sub.id}`}
          className="ta zfm-note__ta"
          maxLength={4000}
          placeholder="e.g. Called back on Monday, booked for Thursday 4 pm"
          value={noteVal}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="zfm-note__btns">
          <button type="button" className="btn" disabled={busy || noteVal.trim() === sub.note} onClick={() => void saveNote()}>
            {busy ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </aside>
  );
}
