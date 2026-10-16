import { useCallback, useState, type FormEvent, type ReactElement } from "react";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncements,
  getPlans,
  updateAnnouncement,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementInput,
  type AnnouncementKind,
  type AnnouncementPlacement,
  type AnnouncementStatus,
} from "../lib/api";
import { dateTime } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";

const KIND_LABEL: Record<AnnouncementKind, string> = {
  offer: "Offer",
  discount: "Discount",
  news: "News",
  version: "New version",
  maintenance: "Maintenance",
};

const HEADLINE_HINT: Record<AnnouncementKind, string> = {
  offer: "e.g. Free forever for up to 3 PCs",
  discount: "e.g. 20% off Businesses until 31 October",
  news: "e.g. Zinwe now works with Outlook attachments",
  version: "e.g. Zinwe 1.3 is out",
  maintenance: "e.g. Short maintenance on Sunday, 2:00–2:30 AM IST",
};

const PLACEMENT_LABEL: Record<AnnouncementPlacement, string> = {
  dashboard: "Dashboard",
  website: "Website",
  both: "Dashboard + website",
};

const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  everyone: "Everyone",
  free: "Free plan only",
  paid: "Paid plans only",
  plans: "Chosen plans",
};

const STATUS_PILL: Record<AnnouncementStatus, [string, string]> = {
  live: ["pill--good", "Live"],
  scheduled: ["pill--info", "Scheduled"],
  ended: ["pill--muted", "Ended"],
  off: ["pill--muted", "Off"],
};

/**
 * Ready-made starting points: they fill the type, where, who and button. Headlines that state a fact
 * (a discount, a version, a time) stay empty so nobody pushes a made-up offer by accident.
 */
const PRESETS: ReadonlyArray<{ label: string; value: Partial<AnnouncementInput> }> = [
  {
    label: "Discount",
    value: {
      kind: "discount",
      title: "",
      body: "Ask for it when you upgrade and we'll apply it to your payment.",
      cta_label: "Upgrade",
      cta_href: "/app/upgrade",
      placement: "dashboard",
      audience: "free",
    },
  },
  {
    label: "Offer (website)",
    value: {
      kind: "offer",
      title: "Free forever for up to 3 PCs",
      body: "Protect your office today. No card needed.",
      cta_label: "Start free",
      cta_href: "/signup?plan=free",
      placement: "website",
      audience: "everyone",
    },
  },
  {
    label: "New version",
    value: {
      kind: "version",
      title: "",
      body: "Your PCs update themselves. Here's what changed.",
      cta_label: "What's new",
      cta_href: "/blog",
      placement: "dashboard",
      audience: "everyone",
    },
  },
  {
    label: "Maintenance",
    value: {
      kind: "maintenance",
      title: "",
      body: "The dashboard may be slow for a few minutes. Your PCs stay protected.",
      cta_label: "",
      cta_href: "",
      placement: "dashboard",
      audience: "everyone",
      dismissible: false,
    },
  },
];

function emptyInput(): AnnouncementInput {
  return {
    title: "",
    body: "",
    kind: "offer",
    placement: "dashboard",
    audience: "everyone",
    plan_codes: [],
    cta_label: "",
    cta_href: "",
    starts_at: new Date().toISOString(),
    ends_at: null,
    is_active: true,
    dismissible: true,
    priority: 0,
  };
}

/** ISO → the value a <input type="datetime-local"> wants (local time, minutes). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Announcements: the bars customers see at the top of their dashboard and/or on zinwe.io (also sign-up
 * and onboarding). Push an offer, a discount, news, a new version or a maintenance note, choose who
 * sees it and when. The dashboard's own upgrade bar is automatic (from each customer's plan).
 */
export function AnnouncementsPage(): ReactElement {
  const load = useCallback(() => getAnnouncements(), []);
  const { data, error, pending, reload } = useLoad(load);
  const toast = useToast();
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const toggle = async (a: Announcement) => {
    setBusyId(a.id);
    try {
      await updateAnnouncement(a.id, { is_active: !a.is_active });
      toast(a.is_active ? "Switched off. Customers won't see it." : "Switched on.");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save.", "bad");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Bars at the top of the customer dashboard and on zinwe.io: offers, discounts, news, updates. The upgrade bar is automatic."
        onReload={reload}
        pending={pending}
      >
        <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
          New announcement
        </button>
      </PageHeader>

      {error ? (
        <p className="alert alert--bad">{error}</p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : data.length === 0 ? (
        <div className="card empty">
          <b>No announcements yet</b>
          <span className="muted">Push an offer or a note: customers see it on their next page load.</span>
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Message</th>
                  <th>Where</th>
                  <th>Who</th>
                  <th>When</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.map((a) => {
                  const [pillClass, pillText] = STATUS_PILL[a.status];
                  return (
                    <tr key={a.id} className={a.status === "live" ? undefined : "muted"}>
                      <td>
                        <span className="pill pill--muted">{KIND_LABEL[a.kind]}</span> <b>{a.title}</b>
                        {a.body ? <div className="muted">{a.body}</div> : null}
                        {a.cta_label ? (
                          <div className="muted mono">
                            {a.cta_label} → {a.cta_href}
                          </div>
                        ) : null}
                      </td>
                      <td className="nowrap">{PLACEMENT_LABEL[a.placement]}</td>
                      <td>
                        {a.placement === "website" ? "Every visitor" : AUDIENCE_LABEL[a.audience]}
                        {a.audience === "plans" && a.placement !== "website" ? (
                          <div className="muted">{a.plan_codes.join(", ")}</div>
                        ) : null}
                      </td>
                      <td className="nowrap">
                        {dateTime(a.starts_at)}
                        <div className="muted">{a.ends_at ? `until ${dateTime(a.ends_at)}` : "no end date"}</div>
                      </td>
                      <td>
                        <span className={`pill ${pillClass}`}>{pillText}</span>
                      </td>
                      <td>
                        <div className="actions">
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(a)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busyId === a.id}
                            onClick={() => void toggle(a)}
                          >
                            {a.is_active ? "Turn off" : "Turn on"}
                          </button>
                          <button type="button" className="link-btn link-btn--danger" onClick={() => setDeleting(a)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing ? (
        <AnnouncementEditor
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            toast(created ? `"${saved.title}" pushed.` : "Saved.");
            reload();
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteAnnouncement(deleting.id);
            setDeleting(null);
            toast("Deleted.");
            reload();
          }}
        >
          It disappears for every customer straight away. To pause it instead, use Turn off.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function AnnouncementEditor({
  existing,
  onClose,
  onSaved,
}: {
  existing: Announcement | null;
  onClose: () => void;
  onSaved: (saved: Announcement, created: boolean) => void;
}): ReactElement {
  const loadPlans = useCallback(() => getPlans(), []);
  const plans = useLoad(loadPlans);
  const [form, setForm] = useState<AnnouncementInput>(() => {
    if (!existing) return emptyInput();
    const { id: _id, status: _s, created_by: _c, created_at: _ca, updated_at: _u, ...input } = existing;
    return input;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof AnnouncementInput>(key: K, value: AnnouncementInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const togglePlan = (code: string) =>
    set("plan_codes", form.plan_codes.includes(code) ? form.plan_codes.filter((c) => c !== code) : [...form.plan_codes, code]);

  const ready =
    form.title.trim().length > 0 &&
    Boolean(form.cta_label.trim()) === Boolean(form.cta_href.trim()) &&
    (form.audience !== "plans" || form.placement === "website" || form.plan_codes.length > 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const payload = {
      ...form,
      title: form.title.trim(),
      body: form.body.trim(),
      cta_label: form.cta_label.trim(),
      cta_href: form.cta_href.trim(),
      // The website shows a message to every visitor: no dashboard audience to keep.
      ...(form.placement === "website" ? { audience: "everyone" as const, plan_codes: [] } : {}),
    };
    try {
      const saved = existing ? await updateAnnouncement(existing.id, payload) : await createAnnouncement(payload);
      onSaved(saved, !existing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? "Edit announcement" : "New announcement"}
      subtitle="Customers see it on their next page load. Closing it hides it for them until you edit it."
      onClose={onClose}
      footer={
        <div className="actions">
          <button type="submit" form="announcement-form" className="btn btn--primary" disabled={!ready || busy}>
            {busy ? "Saving…" : existing ? "Save" : "Push announcement"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <form id="announcement-form" onSubmit={submit}>
        {!existing ? (
          <div className="ann-presets">
            <span className="muted">Start from:</span>
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="chip ann-preset" onClick={() => setForm((f) => ({ ...f, ...p.value }))}>
                {p.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className={`ann-preview ann-preview--${form.kind}`} aria-label="Preview">
          <b>{form.title || "Your headline"}</b>
          {form.body ? <span> {form.body}</span> : null}
          {form.cta_label ? <span className="ann-preview__cta">{form.cta_label} →</span> : null}
          {form.dismissible ? <span className="ann-preview__x">×</span> : null}
        </div>

        <div className="ann-grid">
          <label className="field">
            <span>Type</span>
            <select className="plan-select ann-select" value={form.kind} onChange={(e) => set("kind", e.target.value as AnnouncementKind)}>
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Show on</span>
            <select
              className="plan-select ann-select"
              value={form.placement}
              onChange={(e) => set("placement", e.target.value as AnnouncementPlacement)}
            >
              {Object.entries(PLACEMENT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Headline (up to 120 characters)</span>
          <input
            value={form.title}
            maxLength={120}
            onChange={(e) => set("title", e.target.value)}
            placeholder={HEADLINE_HINT[form.kind]}
            required
          />
        </label>
        <label className="field">
          <span>Detail (optional, up to 280)</span>
          <input value={form.body} maxLength={280} onChange={(e) => set("body", e.target.value)} />
        </label>

        <div className="ann-grid">
          <label className="field">
            <span>Button text (optional)</span>
            <input value={form.cta_label} maxLength={40} onChange={(e) => set("cta_label", e.target.value)} placeholder="Upgrade" />
          </label>
          <label className="field">
            <span>Button link</span>
            <input
              value={form.cta_href}
              maxLength={300}
              onChange={(e) => set("cta_href", e.target.value)}
              placeholder="/app/upgrade?plan=businesses or https://…"
            />
          </label>
        </div>

        {form.placement !== "website" ? (
          <fieldset className="field ann-fieldset">
            <span>Who sees it on the dashboard</span>
            <div className="ann-radios">
              {Object.entries(AUDIENCE_LABEL).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="audience"
                    checked={form.audience === value}
                    onChange={() => set("audience", value as AnnouncementAudience)}
                  />{" "}
                  {label}
                </label>
              ))}
            </div>
            {form.audience === "plans" ? (
              <div className="ann-radios">
                {(plans.data ?? []).map((p) => (
                  <label key={p.code}>
                    <input type="checkbox" checked={form.plan_codes.includes(p.code)} onChange={() => togglePlan(p.code)} /> {p.name}
                  </label>
                ))}
              </div>
            ) : null}
            {form.placement === "both" ? (
              <small className="muted">The website shows it to every visitor.</small>
            ) : null}
          </fieldset>
        ) : null}

        <div className="ann-grid">
          <label className="field">
            <span>Starts</span>
            <input
              type="datetime-local"
              value={toLocalInput(form.starts_at)}
              onChange={(e) => set("starts_at", fromLocalInput(e.target.value) ?? new Date().toISOString())}
            />
          </label>
          <label className="field">
            <span>Ends (optional)</span>
            <input type="datetime-local" value={toLocalInput(form.ends_at)} onChange={(e) => set("ends_at", fromLocalInput(e.target.value))} />
          </label>
        </div>

        <div className="ann-checks">
          <label>
            <input type="checkbox" checked={form.dismissible} onChange={(e) => set("dismissible", e.target.checked)} /> Customers can close it
          </label>
          <label>
            <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} /> On
          </label>
          <label>
            Priority{" "}
            <input
              type="number"
              min={0}
              max={100}
              className="ann-priority"
              value={form.priority}
              onChange={(e) => set("priority", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            />
            <span className="muted"> (higher shows first)</span>
          </label>
        </div>

        {error ? <p className="alert alert--bad">{error}</p> : null}
      </form>
    </Modal>
  );
}
