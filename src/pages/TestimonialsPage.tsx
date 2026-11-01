import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ApiError,
  createTestimonial,
  deleteTestimonial,
  getTestimonials,
  updateTestimonial,
  type FeedbackRow,
  type Testimonial,
  type TestimonialInput,
} from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import "../styles/testimonials.css";

const RATINGS = [8, 9, 10];
const KINDS: [Testimonial["kind"], string][] = [
  ["owner", "Business owner"],
  ["member", "Team member"],
];
const QUOTE_MAX = 500;
// Keep these two in step with REVIEWS_MIN on the website and Testimonial.PUBLIC_LIMIT on the backend.
const HOME_MIN = 3;
const HOME_MAX = 6;

type Draft = TestimonialInput & { id: number | "new" };

const BLANK: Draft = {
  id: "new",
  kind: "owner",
  quote: "",
  rating: 10,
  name: "",
  role: "",
  company: "",
  permission: "",
  source_feedback: null,
};

/** A good feedback, ready to check. Nothing is saved until the team does, and the feedback itself never changes. */
function fromFeedback(r: FeedbackRow): Draft {
  const member = r.source === "member";
  return {
    ...BLANK,
    kind: member ? "member" : "owner",
    quote: r.message.trim().slice(0, QUOTE_MAX),
    rating: r.rating,
    name: (member ? r.member?.name : r.customer.full_name) ?? "",
    company: r.customer.company ?? "",
    source_feedback: r.id,
  };
}

function homeLine(live: number): string {
  if (live >= HOME_MIN) return `On Home now: the newest ${Math.min(live, HOME_MAX)}.`;
  const more = HOME_MIN - live;
  return `Not on Home yet: ${more} more to publish before the section shows.`;
}

function Editor({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const toast = useToast();
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));
  const filled = Boolean(d.quote.trim() && d.name.trim() && d.company.trim());
  const agreed = Boolean(d.permission.trim());

  const save = async (publish: boolean) => {
    setBusy(true);
    const { id, ...input } = d;
    const body = publish ? { ...input, is_published: true } : input;
    try {
      await (id === "new" ? createTestimonial(body) : updateTestimonial(id, body));
      toast(publish ? "Published to Home." : "Saved.");
      onSaved();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save that.", "bad");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={d.id === "new" ? "Add a testimonial" : "Edit testimonial"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={busy || !filled} onClick={() => void save(false)}>
            Save
          </button>
          <button type="button" className="btn dark" disabled={busy || !filled || !agreed} onClick={() => void save(true)}>
            Save and publish
          </button>
        </>
      }
    >
      <div className="tm-form">
        {d.source_feedback ? (
          <p className="tm-note">
            From private feedback. Ask this person first, and note below how they agreed. The feedback itself stays as it is.
          </p>
        ) : null}
        <div className="tm-pair">
          <div className="tm-field">
            <span className="lab">Who they are</span>
            <div className="seg" role="group" aria-label="Who they are">
              {KINDS.map(([key, label]) => (
                <button key={key} type="button" className={d.kind === key ? "on" : ""} aria-pressed={d.kind === key} onClick={() => patch({ kind: key })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="tm-field">
            <span className="lab">Rating out of 10</span>
            <div className="seg" role="group" aria-label="Rating out of 10">
              {RATINGS.map((n) => (
                <button key={n} type="button" className={d.rating === n ? "on" : ""} aria-pressed={d.rating === n} onClick={() => patch({ rating: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="tm-field">
          <label className="lab" htmlFor="tm-quote">
            Their words
          </label>
          <textarea id="tm-quote" className="ta" rows={4} maxLength={QUOTE_MAX} value={d.quote} onChange={(e) => patch({ quote: e.target.value })} />
          <span className="k">
            You can shorten it, but never change what they meant. {d.quote.length}/{QUOTE_MAX}
          </span>
        </div>
        <div className="tm-pair">
          <div className="tm-field">
            <label className="lab" htmlFor="tm-name">
              Name
            </label>
            <input id="tm-name" className="inp" maxLength={80} value={d.name} onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="tm-field">
            <label className="lab" htmlFor="tm-role">
              Role (optional)
            </label>
            <input id="tm-role" className="inp" maxLength={80} placeholder="Founder" value={d.role} onChange={(e) => patch({ role: e.target.value })} />
          </div>
        </div>
        <div className="tm-field">
          <label className="lab" htmlFor="tm-company">
            Company
          </label>
          <input id="tm-company" className="inp" maxLength={120} value={d.company} onChange={(e) => patch({ company: e.target.value })} />
        </div>
        <div className="tm-field">
          <label className="lab" htmlFor="tm-permission">
            How they agreed
          </label>
          <input
            id="tm-permission"
            className="inp"
            maxLength={200}
            placeholder="Email on 3 Nov"
            value={d.permission}
            onChange={(e) => patch({ permission: e.target.value })}
          />
          <span className="k">Needed to publish. Stays here, never on the website.</span>
        </div>
      </div>
    </Modal>
  );
}

export function TestimonialsPage(): ReactElement {
  const load = useCallback(() => getTestimonials(), []);
  const { data, error, reload } = useLoad(load);
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Testimonial | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  // Arriving from Feedback's "Use as testimonial": open the form once, and clear it so a refresh doesn't reopen it.
  const started = (location.state as { fromFeedback?: FeedbackRow } | null)?.fromFeedback;
  useEffect(() => {
    if (!started) return;
    setEditing(fromFeedback(started));
    navigate(".", { replace: true, state: null });
  }, [started, navigate]);

  const rows = data ?? [];
  const live = rows.filter((t) => t.is_published).length;

  const setPublished = async (t: Testimonial, is_published: boolean) => {
    setBusy(t.id);
    try {
      await updateTestimonial(t.id, { is_published });
      toast(is_published ? "Published to Home." : "Taken off the website.");
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't change that.", "bad");
    } finally {
      setBusy(null);
    }
  };

  const edit = (t: Testimonial) =>
    setEditing({
      id: t.id,
      kind: t.kind,
      quote: t.quote,
      rating: t.rating,
      name: t.name,
      role: t.role,
      company: t.company,
      permission: t.permission,
      source_feedback: t.source_feedback,
    });

  return (
    <>
      <PageHeader title="Testimonials" subtitle="Customers’ words on the Home page, rated 8 to 10. Only ones that are published show there.">
        <button type="button" className="btn dark" onClick={() => setEditing(BLANK)}>
          <Icon name="plus" />
          Add testimonial
        </button>
      </PageHeader>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="testimonials"
            title="No testimonials yet"
            body="Add one here, or use a good rating from Feedback once that person has agreed."
          />
        </div>
      ) : (
        <>
          <p className="tm-home k">{homeLine(live)}</p>
          <ul className="tm-list">
            {rows.map((t) => (
              <li key={t.id} className="card tm-row">
                <div className="tm-row__main">
                  <div className="tm-row__top">
                    <b className="num">{t.rating}/10</b>
                    <span className={"pill " + (t.is_published ? "good" : "muted")}>{t.is_published ? "Published" : "Not published"}</span>
                  </div>
                  <p className="tm-row__quote">“{t.quote}”</p>
                  <p className="tm-row__who">
                    <b>{t.name}</b>
                    {t.role ? `, ${t.role}` : ""}, {t.company}
                  </p>
                  <p className="k">{t.permission ? `Agreed: ${t.permission}` : "Not agreed yet"}</p>
                </div>
                <div className="tm-row__acts">
                  {t.is_published ? (
                    <button type="button" className="btn sm" disabled={busy === t.id} onClick={() => void setPublished(t, false)}>
                      Unpublish
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn sm dark"
                      disabled={busy === t.id || !t.permission}
                      title={t.permission ? undefined : "Edit it and note how they agreed first"}
                      onClick={() => void setPublished(t, true)}
                    >
                      Publish
                    </button>
                  )}
                  <button type="button" className="btn sm" onClick={() => edit(t)}>
                    Edit
                  </button>
                  <button type="button" className="btn sm danger" onClick={() => setDeleting(t)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing ? (
        <Editor
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete this testimonial?"
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteTestimonial(deleting.id);
            toast("Deleted.");
            reload();
          }}
        >
          It comes off the website straight away. Any feedback it came from stays.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
