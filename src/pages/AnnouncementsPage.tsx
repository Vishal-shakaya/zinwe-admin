import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  ApiError,
  createAnnouncement,
  getAnnouncementReach,
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
import { dateTime, titleCase } from "../lib/format";
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
  const loadPlans = useCallback(() => getPlans(), []);
  const plans = useLoad(loadPlans);
  const planName = (code: string) => plans.data?.find((p) => p.code === code)?.name ?? titleCase(code);
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
                          <div className="muted">{a.plan_codes.map(planName).join(", ")}</div>
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

type FieldKey = "title" | "cta_label" | "cta_href" | "plan_codes" | "ends_at";

/** A link the bar can open: a page on zinwe.io (/…), an https:// link, or an email address (mailto:). */
function linkError(href: string): string | null {
  const v = href.trim();
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return null;
  if (v.startsWith("https://")) return null;
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(v)) return null;
  if (v.startsWith("http://")) return "Use https:// (secure links only).";
  if (/^[^@\s/]+@[^@\s]+\.[^@\s]+$/.test(v)) return `For an email address, write mailto:${v}`;
  return "Use a page on zinwe.io (starting with /), an https:// link, or mailto:hello@zinwe.io.";
}

function validate(form: AnnouncementInput): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  if (!form.title.trim()) errors.title = "Write the headline customers will see.";
  const label = form.cta_label.trim();
  const href = form.cta_href.trim();
  if (label && !href) errors.cta_href = "Add where the button goes, or clear the button text.";
  if (href && !label) errors.cta_label = "Add the button text, or clear the link.";
  const bad = linkError(href);
  if (bad) errors.cta_href = bad;
  if (form.placement !== "website" && form.audience === "plans" && form.plan_codes.length === 0) {
    errors.plan_codes = "Pick at least one plan.";
  }
  if (form.ends_at && new Date(form.ends_at).getTime() <= new Date(form.starts_at).getTime()) {
    errors.ends_at = "The end must be after the start.";
  }
  return errors;
}

/** How many customers the dashboard bar reaches now, for this audience (J8-19). */
function useReach(form: AnnouncementInput): { customers: number; total: number } | null {
  const [reach, setReach] = useState<{ customers: number; total: number } | null>(null);
  const plans = form.plan_codes.join(",");
  const dashboard = form.placement !== "website";
  useEffect(() => {
    if (!dashboard) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      getAnnouncementReach(form.audience, plans ? plans.split(",") : [])
        .then((r) => {
          if (alive) setReach(r);
        })
        .catch(() => {
          if (alive) setReach(null);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [form.audience, plans, dashboard]);
  return dashboard ? reach : null;
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
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const titleInput = useRef<HTMLInputElement>(null);
  const reach = useReach(form);

  const set = <K extends keyof AnnouncementInput>(key: K, value: AnnouncementInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const togglePlan = (code: string) =>
    set("plan_codes", form.plan_codes.includes(code) ? form.plan_codes.filter((c) => c !== code) : [...form.plan_codes, code]);

  const applyPreset = (value: Partial<AnnouncementInput>) => {
    setForm((f) => ({ ...f, ...value }));
    setErrors({});
    // Presets that leave the headline empty (a discount, a version, a time) want it written now.
    if (!value.title) window.setTimeout(() => titleInput.current?.focus(), 0);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) {
      const first = Object.keys(found)[0];
      window.setTimeout(() => document.getElementById(`ann-${first}`)?.focus(), 0);
      return;
    }
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
      const fields = e instanceof ApiError ? e.fields : {};
      const atFields = Object.fromEntries(
        Object.entries(fields).filter(([k]) => ["title", "cta_label", "cta_href", "plan_codes", "ends_at"].includes(k)),
      ) as Partial<Record<FieldKey, string>>;
      setErrors(atFields);
      // Anything not tied to a field shows in the footer.
      setError(Object.keys(atFields).length ? null : e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  };

  const fieldProps = (key: FieldKey) => ({
    id: `ann-${key}`,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `ann-${key}-error` : undefined,
  });
  const fieldError = (key: FieldKey) =>
    errors[key] ? (
      <small className="field__error" id={`ann-${key}-error`}>
        {errors[key]}
      </small>
    ) : null;

  const startsLater = new Date(form.starts_at).getTime() > Date.now() + 60_000;
  const reachText =
    form.placement === "website"
      ? "Shows to every visitor of zinwe.io"
      : reach
        ? `Shows to ${reach.customers} of ${reach.total} customer${reach.total === 1 ? "" : "s"} on the dashboard${form.placement === "both" ? " (and every website visitor)" : ""}`
        : null;

  return (
    <Modal
      title={existing ? "Edit announcement" : "New announcement"}
      subtitle="Customers see it on their next page load. Closing it hides it for them until you edit it."
      onClose={onClose}
      footer={
        <>
          {reachText ? <span className="modal__hint ann-reach">{reachText}</span> : null}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="announcement-form" className="btn btn--primary" disabled={busy}>
            {busy ? "Saving…" : existing ? "Save" : "Push announcement"}
          </button>
        </>
      }
    >
      <form id="announcement-form" onSubmit={submit} noValidate>
        {!existing ? (
          <div className="ann-presets">
            <span className="muted">Start from:</span>
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="chip ann-preset" onClick={() => applyPreset(p.value)}>
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
            ref={titleInput}
            value={form.title}
            maxLength={120}
            onChange={(e) => set("title", e.target.value)}
            placeholder={HEADLINE_HINT[form.kind]}
            {...fieldProps("title")}
          />
          {fieldError("title")}
        </label>
        <label className="field">
          <span>Detail (optional, up to 280)</span>
          <input value={form.body} maxLength={280} onChange={(e) => set("body", e.target.value)} />
        </label>

        <div className="ann-grid">
          <label className="field">
            <span>Button text (optional)</span>
            <input
              value={form.cta_label}
              maxLength={40}
              onChange={(e) => set("cta_label", e.target.value)}
              placeholder="Upgrade"
              {...fieldProps("cta_label")}
            />
            {fieldError("cta_label")}
          </label>
          <label className="field">
            <span>Button link</span>
            <input
              value={form.cta_href}
              maxLength={300}
              onChange={(e) => set("cta_href", e.target.value)}
              onBlur={() => {
                const bad = linkError(form.cta_href);
                if (bad) setErrors((er) => ({ ...er, cta_href: bad }));
              }}
              placeholder="/app/upgrade, https://… or mailto:hello@zinwe.io"
              {...fieldProps("cta_href")}
            />
            {fieldError("cta_href")}
          </label>
        </div>

        {form.placement !== "website" ? (
          <fieldset className="field ann-fieldset" aria-describedby={errors.plan_codes ? "ann-plan_codes-error" : undefined}>
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
              <div className="ann-radios" id="ann-plan_codes" tabIndex={-1}>
                {(plans.data ?? []).map((p) => (
                  <label key={p.code}>
                    <input type="checkbox" checked={form.plan_codes.includes(p.code)} onChange={() => togglePlan(p.code)} /> {p.name}
                  </label>
                ))}
              </div>
            ) : null}
            {fieldError("plan_codes")}
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
            <input
              type="datetime-local"
              value={toLocalInput(form.ends_at)}
              onChange={(e) => set("ends_at", fromLocalInput(e.target.value))}
              {...fieldProps("ends_at")}
            />
            {fieldError("ends_at")}
          </label>
        </div>

        <div className="ann-checks">
          <label>
            <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />{" "}
            {startsLater ? "Switched on (shows from the start time)" : "Live now"}
          </label>
          <label>
            <input type="checkbox" checked={form.dismissible} onChange={(e) => set("dismissible", e.target.checked)} />{" "}
            Customers can close it
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
        {!form.is_active ? (
          <p className="muted ann-off-note">Off: saved, but nobody sees it until you switch it on.</p>
        ) : null}

        {error ? <p className="alert alert--bad">{error}</p> : null}
      </form>
    </Modal>
  );
}
