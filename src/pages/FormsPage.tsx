import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, getForm, getForms, updateForm, type FormStatus, type FormSubmission } from "../lib/api";
import { refreshBadges } from "../lib/badges";
import { dateTime, relativeDay } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";

const STATUS: Record<FormStatus, { label: string; tone: string }> = {
  new: { label: "New", tone: "warn" },
  handled: { label: "Handled", tone: "good" },
};

const STATUS_FILTERS: { key: FormStatus | "all"; label: string }[] = [
  { key: "new", label: "New" },
  { key: "handled", label: "Handled" },
  { key: "all", label: "All" },
];

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

/**
 * Forms inbox: everything visitors submit on the website (contact, setup call, and any form added
 * later). One tab per form type, straight from the backend, so a new form needs no change here.
 * `?kind=contact` picks a tab; `?open=<id>` opens one submission.
 */
export function FormsPage(): ReactElement {
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const selectedId = Number(params.get("open")) || null;
  const [status, setStatus] = useState<FormStatus | "all">("new");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 300);

  const load = useCallback(
    () => getForms({ kind: kind || undefined, status: status === "all" ? undefined : status, q: q || undefined }),
    [kind, status, q],
  );
  const { data, error, pending, reload } = useLoad(load);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "kind") next.delete("open");
    setParams(next, { replace: true });
  };

  const totalNew = data?.kinds.reduce((sum, k) => sum + k.new, 0) ?? 0;
  const total = data?.kinds.reduce((sum, k) => sum + k.total, 0) ?? 0;
  const selected = data?.rows.find((r) => r.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Forms"
        subtitle="Everything visitors send from the website: contact messages, setup-call bookings and any new form."
        onReload={reload}
        pending={pending}
      >
        <input
          type="search"
          className="search"
          placeholder="Search name, email, company or text"
          aria-label="Search form submissions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </PageHeader>

      <div className="tabs" role="tablist" aria-label="Form type">
        {[{ kind: "", label: "All forms", total, new: totalNew }, ...(data?.kinds ?? [])].map((k) => (
          <button
            key={k.kind || "all"}
            type="button"
            role="tab"
            aria-selected={kind === k.kind}
            className={"tab" + (kind === k.kind ? " is-active" : "")}
            onClick={() => setParam("kind", k.kind || null)}
          >
            {k.label}
            {data ? (
              <span className={"tab__count" + (k.new > 0 ? " tab__count--hot" : "")}>
                {k.new > 0 ? `${k.new} new` : k.total}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="chips forms-filter" role="group" aria-label="Status">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={"chip chip--btn" + (status === f.key ? " is-active" : "")}
            aria-pressed={status === f.key}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
            {data && f.key !== "all" ? ` (${data.counts[f.key]})` : ""}
          </button>
        ))}
      </div>

      {error ? (
        <p className="alert alert--bad">{error}</p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="sup-layout">
          <div className="card sup-list" aria-label="Submissions">
            {data.rows.length === 0 ? (
              <div className="empty">
                <b>Nothing here</b>
                <span className="muted">
                  {q ? "No submissions match your search." : status === "new" ? "No new submissions." : "No submissions in this view."}
                </span>
              </div>
            ) : (
              data.rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={"sup-row" + (r.id === selectedId ? " is-active" : "") + (r.status === "new" ? " is-unread" : "")}
                  onClick={() => setParam("open", String(r.id))}
                >
                  <span className="sup-row__top">
                    <b>{r.name || r.email || "No name"}</b>
                    <span className="muted forms-when">{relativeDay(r.created_at)}</span>
                  </span>
                  <span className="sup-row__who">
                    {r.company ? <b>{r.company}</b> : null}
                    <span className="sup-row__person">{r.email}</span>
                  </span>
                  {r.subject || r.message ? (
                    <span className="forms-preview muted">{r.subject || r.message}</span>
                  ) : null}
                  <span className="sup-row__meta">
                    <span className={`pill pill--${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
                    <span className="pill pill--info">{r.kind_label}</span>
                  </span>
                </button>
              ))
            )}
          </div>

          {selectedId ? (
            <SubmissionPane
              key={selectedId}
              id={selectedId}
              fromList={selected}
              onChanged={reload}
              onClose={() => setParam("open", null)}
            />
          ) : (
            <div className="card sup-pane sup-pane--empty">
              <span className="muted">Pick a submission to see everything they sent.</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function SubmissionPane({
  id,
  fromList,
  onChanged,
  onClose,
}: {
  id: number;
  fromList: FormSubmission | null;
  onChanged: () => void;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  // Use the list's copy when it has one; a deep link to a row outside the current filter loads it.
  const [sub, setSub] = useState<FormSubmission | null>(fromList);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState(fromList?.note ?? "");
  const [busy, setBusy] = useState(false);
  const pane = useRef<HTMLElement>(null);

  useEffect(() => {
    if (sub) return;
    let alive = true;
    getForm(id)
      .then((row) => {
        if (!alive) return;
        setSub(row);
        setNote(row.note);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof ApiError ? err.message : "Couldn't load this submission.");
      });
    return () => {
      alive = false;
    };
  }, [id, sub]);

  // On a phone the details open below the list: bring them into view.
  const loaded = sub !== null;
  useEffect(() => {
    if (loaded && window.matchMedia("(max-width: 900px)").matches) {
      pane.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loaded]);

  const save = async (patch: { status?: FormStatus; note?: string }, done: string) => {
    setBusy(true);
    try {
      const row = await updateForm(id, patch);
      setSub(row);
      setNote(row.note);
      toast(done);
      onChanged();
      refreshBadges();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save it.", "bad");
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <div className="card sup-pane"><p className="alert alert--bad">{loadError}</p></div>;
  if (!sub) return <div className="card sup-pane"><p className="muted">Loading…</p></div>;

  const details = Object.entries(sub.details ?? {})
    .map(([key, value]) => [fieldLabel(key), fieldValue(value)] as const)
    .filter(([, value]) => value !== "");
  const replySubject = sub.subject ? `Re: ${sub.subject}` : `Your ${sub.kind_label.toLowerCase()} request to Zinwe`;
  const mailto = `mailto:${sub.email}?subject=${encodeURIComponent(replySubject)}`;
  const noteChanged = note.trim() !== sub.note;
  const fields: (readonly [string, ReactNode])[] = [
    ...(sub.email ? [["Email", <a href={mailto}>{sub.email}</a>] as const] : []),
    ...(sub.phone ? [["Phone", <a href={`tel:${sub.phone.replace(/[^\d+]/g, "")}`}>{sub.phone}</a>] as const] : []),
    ...(sub.company ? [["Company", sub.company] as const] : []),
    ...(sub.subject ? [["Topic", sub.subject] as const] : []),
    ...details,
  ];

  return (
    <section ref={pane} className="card sup-pane" aria-label={`${sub.kind_label} from ${sub.name || sub.email}`}>
      <header className="sup-pane__head">
        <div className="sup-pane__who">
          <button type="button" className="link-btn sup-pane__back" onClick={onClose}>
            ← All submissions
          </button>
          <h2 className="card__title">{sub.name || sub.email || "No name"}</h2>
          <p className="muted">
            {sub.kind_label} · received {dateTime(sub.created_at)}
          </p>
        </div>
        <div className="sup-pane__actions">
          <span className={`pill pill--${STATUS[sub.status].tone}`}>{STATUS[sub.status].label}</span>
          {sub.status === "new" ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void save({ status: "handled" }, "Marked handled.")}
            >
              Mark handled
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void save({ status: "new" }, "Moved back to New.")}
            >
              Reopen
            </button>
          )}
        </div>
      </header>

      <dl className="forms-fields">
        {fields.map(([label, value]) => (
          <div key={label} className="forms-fields__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {sub.message ? <div className="forms-message">{sub.message}</div> : null}

      {sub.status === "handled" && sub.handled_at ? (
        <p className="muted forms-handled">
          Handled{sub.handled_by ? ` by ${sub.handled_by}` : ""} · {dateTime(sub.handled_at)}
        </p>
      ) : null}

      <div className="sup-reply">
        <label className="forms-note-label" htmlFor={`form-note-${sub.id}`}>
          Internal note <span className="muted">(only the team sees it)</span>
        </label>
        <textarea
          id={`form-note-${sub.id}`}
          rows={3}
          maxLength={4000}
          placeholder="e.g. Called back on Monday, booked for Thursday 4 pm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="sup-reply__actions">
          {sub.email ? (
            <a className="btn btn--ghost" href={mailto}>
              Reply by email
            </a>
          ) : null}
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !noteChanged}
            onClick={() => void save({ note }, "Note saved.")}
          >
            Save note
          </button>
        </div>
      </div>
    </section>
  );
}
