import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  ApiError,
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncementReach,
  getAnnouncements,
  getPlans,
  getSubscribers,
  updateAnnouncement,
  type Announcement,
  type AnnouncementInput,
  type AnnouncementKind,
  type AnnouncementPlacement,
} from "../lib/api";
import { titleCase } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import {
  BAR_LADDER,
  COUNTRIES,
  EMAIL_ANNOUNCEMENTS_AVAILABLE,
  PREVIEW_AS,
  PREVIEW_OWNER,
  SYSTEM_BARS,
  type PreviewAs,
} from "../content/fixtures/announcements";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ErrorState, LoadingState, SampleTag } from "../components/States";
import { Icon, PathIcon } from "../components/icons";
import { useToast } from "../components/Toast";
import "../styles/announcements.css";

/* ---------- Board vocabulary ---------- */

const KINDS: [AnnouncementKind, string][] = [
  ["news", "Info"],
  ["offer", "Offer"],
  ["discount", "Discount"],
  ["maintenance", "Maintenance"],
  ["version", "New release"],
];
const KIND_LABEL = Object.fromEntries(KINDS) as Record<AnnouncementKind, string>;

const KIND_PILL: Record<AnnouncementKind, string> = {
  news: "an-k-info",
  offer: "an-k-offer",
  discount: "an-k-offer",
  maintenance: "an-k-maint",
  version: "an-k-rel",
};

const KIND_ICON: Record<AnnouncementKind, string> = {
  news: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  offer: "M20 12l-8 8-9-9V3h8zM7.5 7.5h.01",
  discount: "M20 12l-8 8-9-9V3h8zM7.5 7.5h.01",
  maintenance: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z",
  version: "M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z",
};
const SYS_ICON = {
  warn: "M12 3.5L2.5 20h19zM12 10v4.5M12 17.5h.01",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  pcs: "M3 4h18v12H3zM8 20h8M12 16v4",
};

/** Bar colours in the customer dashboard: [bar background, text, button background, button text]. */
const KIND_BAR: Record<AnnouncementKind, [string, string, string, string]> = {
  news: ["#E6ECF3", "#1F3A5A", "#1F3A5A", "#fff"],
  offer: ["#16181B", "#fff", "#fff", "#16181B"],
  discount: ["#16181B", "#fff", "#fff", "#16181B"],
  maintenance: ["#FDF0D5", "#5C3A00", "#5C3A00", "#fff"],
  version: ["#E4F2EA", "#134D2F", "#134D2F", "#fff"],
};

const TITLE_PH: Record<AnnouncementKind, string> = {
  news: "e.g. USB rules are now in Data safety",
  offer: "e.g. 20% off Businesses until 15 Nov",
  discount: "e.g. 20% off Businesses until 15 Nov",
  maintenance: "e.g. Short maintenance on Sunday, 02:00–02:30 IST",
  version: "e.g. Windows app 1.3.0 is out",
};

const PLACEMENTS: [AnnouncementPlacement, string][] = [
  ["dashboard", "Dashboard"],
  ["website", "Website"],
  ["both", "Dashboard + website"],
];
const PLACEMENT_LABEL = Object.fromEntries(PLACEMENTS) as Record<AnnouncementPlacement, string>;

type Tab = "active" | "scheduled" | "ended";
const TAB_OF: Record<Announcement["status"], Tab> = { live: "active", scheduled: "scheduled", ended: "ended", off: "ended" };

/* ---------- Helpers ---------- */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "28 Oct, 14:40" (local time), as on the board. */
function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MON[d.getMonth()]}${year}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

/** "Upgrade for ₹1.00 + GST": the button an offer gets when no button is written. */
function offerButton(price: string | null): string {
  const n = Number(price);
  return Number.isFinite(n) && n > 0 ? `Upgrade for ₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })} + GST` : "Upgrade";
}

/** A link the bar can open: a page on zinwe.io (/…), an https:// link, or an email address (mailto:). */
function linkError(href: string): string | null {
  const v = href.trim();
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return null;
  if (v.startsWith("https://")) return null;
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(v)) return null;
  if (v.startsWith("http://")) return "Use https:// (secure links only).";
  if (/^[^@\s/]+@[^@\s]+\.[^@\s]+$/.test(v)) return `For an email address, write mailto:${v}`;
  return "Use a dashboard page starting with / or an https:// link (or mailto:hello@zinwe.io).";
}

function emptyInput(): AnnouncementInput {
  return {
    title: "",
    body: "",
    kind: "news",
    placement: "dashboard",
    audience: "everyone",
    plan_codes: [],
    owner_emails: [],
    cta_label: "",
    cta_href: "",
    offer_plan: null,
    offer_price_inr: null,
    starts_at: new Date().toISOString(),
    ends_at: null,
    is_active: true,
    dismissible: true,
    priority: 0,
  };
}

function toInput(a: Announcement): AnnouncementInput {
  const { id: _id, status: _s, created_by: _c, created_at: _ca, updated_at: _u, offer_uses: _o, ...input } = a;
  return input;
}

type FieldKey = "title" | "cta_label" | "cta_href" | "plan_codes" | "owner_emails" | "offer_plan" | "offer_price_inr" | "placement" | "ends_at";
const FIELD_KEYS: ReadonlyArray<FieldKey> = ["title", "cta_label", "cta_href", "plan_codes", "owner_emails", "offer_plan", "offer_price_inr", "placement", "ends_at"];

function validate(form: AnnouncementInput, startsAt: string): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  if (!form.title.trim()) errors.title = "Write the headline customers will see.";
  const label = form.cta_label.trim();
  const href = form.cta_href.trim();
  if (label && !href) errors.cta_href = "Add where the button goes, or clear the button text.";
  else if (href && !label && !form.offer_plan) errors.cta_label = "Add the button text, or clear the link.";
  const bad = linkError(href);
  if (bad) errors.cta_href = bad;
  if (form.placement !== "website" && form.audience === "plans" && form.plan_codes.length === 0) {
    errors.plan_codes = "Pick at least one plan.";
  }
  if (form.audience === "owners") {
    if (form.placement === "website") errors.placement = "A message for chosen customers shows on the dashboard.";
    else if (form.owner_emails.length === 0) errors.owner_emails = "Add at least one customer.";
    else if (form.owner_emails.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) errors.owner_emails = "One of these isn't an email address.";
  }
  if (form.offer_plan) {
    const price = Number(form.offer_price_inr);
    if (!form.offer_price_inr || !Number.isFinite(price)) errors.offer_price_inr = "Write the special price.";
    else if (price < 1) errors.offer_price_inr = "At least ₹1.00 (online payments can't be smaller).";
    if (form.placement === "website") errors.placement = "Special prices show on the dashboard, where customers pay.";
  }
  if (form.ends_at && new Date(form.ends_at).getTime() <= new Date(startsAt).getTime()) {
    errors.ends_at = "The end must be after the start.";
  }
  return errors;
}

/* ---------- Page ---------- */

/**
 * Announcements (AdminAnnouncements board): the bar at the top of customers' dashboards (and/or zinwe.io).
 * List by Active / Scheduled / Ended, a composer with live preview, and a confirmation naming who gets it.
 */
export function AnnouncementsPage(): ReactElement {
  const load = useCallback(() => getAnnouncements(), []);
  const { data, error, reload } = useLoad(load);
  const loadPlans = useCallback(() => getPlans(), []);
  const plans = useLoad(loadPlans);
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("active");
  const [form, setForm] = useState<AnnouncementInput>(emptyInput);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [later, setLater] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [previewAs, setPreviewAs] = useState<PreviewAs>("normal");
  const composerRef = useRef<HTMLDivElement>(null);
  const [planCounts, setPlanCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState<number | null>(null);

  const planList = plans.data ?? [];
  const planName = (code: string) => planList.find((p) => p.code === code)?.name ?? titleCase(code);

  // Customers per plan (for the plan options and each row's audience size).
  useEffect(() => {
    if (!plans.data) return;
    let alive = true;
    void Promise.all(
      plans.data.map((p) =>
        getAnnouncementReach("plans", [p.code])
          .then((r) => [p.code, r.customers, r.total] as const)
          .catch(() => [p.code, 0, 0] as const),
      ),
    ).then((rows) => {
      if (!alive) return;
      setPlanCounts(Object.fromEntries(rows.map(([c, n]) => [c, n])));
      setTotal(rows[0]?.[2] ?? null);
    });
    return () => {
      alive = false;
    };
  }, [plans.data]);

  const freeCodes = planList.filter((p) => Number(p.price_inr_monthly) <= 0).map((p) => p.code);
  const countOf = (a: Pick<AnnouncementInput, "audience" | "plan_codes" | "owner_emails">): number | null => {
    const sum = (codes: string[]) => codes.reduce((s, c) => s + (planCounts[c] ?? 0), 0);
    if (a.audience === "everyone") return total;
    if (a.audience === "plans") return sum(a.plan_codes);
    if (a.audience === "free") return sum(freeCodes);
    if (a.audience === "paid") return sum(planList.map((p) => p.code).filter((c) => !freeCodes.includes(c)));
    return a.owner_emails.length;
  };
  const audLabel = (a: Pick<AnnouncementInput, "audience" | "plan_codes" | "owner_emails" | "placement">): string => {
    if (a.placement === "website") return "Every visitor of zinwe.io";
    if (a.audience === "everyone") return "Everyone";
    if (a.audience === "free") return "Free plan only";
    if (a.audience === "paid") return "Paid plans only";
    if (a.audience === "plans") return `Plan: ${a.plan_codes.map(planName).join(", ") || "none"}`;
    return a.owner_emails.length === 1 ? a.owner_emails[0] : `${a.owner_emails.length} chosen customers`;
  };

  const all = useMemo(() => data ?? [], [data]);
  const counts = { active: 0, scheduled: 0, ended: 0 };
  all.forEach((a) => {
    counts[TAB_OF[a.status]] += 1;
  });
  const rows = all.filter((a) => TAB_OF[a.status] === tab);

  /* ----- composer ----- */

  const set = <K extends keyof AnnouncementInput>(key: K, value: AnnouncementInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const startNew = () => {
    setForm(emptyInput());
    setEditing(null);
    setLater(false);
    setErrors({});
  };

  const loadInto = (a: Announcement, dup: boolean) => {
    const input = toInput(a);
    if (dup) {
      setForm({ ...input, starts_at: new Date().toISOString(), ends_at: null, is_active: true });
      setEditing(null);
      setLater(false);
    } else {
      setForm(input);
      setEditing(a);
      setLater(a.status === "scheduled");
    }
    setErrors({});
    window.setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  const effectiveStart = (): string => {
    if (later) return form.starts_at;
    if (editing && new Date(editing.starts_at).getTime() <= Date.now()) return editing.starts_at;
    return new Date().toISOString();
  };

  const reachNow = useReach(form);
  const reachN = form.placement === "website" ? null : (reachNow?.customers ?? countOf(form));
  const reachText = form.placement === "website" ? "every visitor of zinwe.io" : `${reachN ?? "…"} ${reachN === 1 ? "customer" : "customers"}`;

  const tryConfirm = () => {
    const found = validate(form, effectiveStart());
    setErrors(found);
    if (Object.keys(found).length) {
      toast("Fix the highlighted fields first.", "bad");
      const first = Object.keys(found)[0];
      window.setTimeout(() => document.getElementById(`ann-${first}`)?.focus(), 0);
      return;
    }
    setConfirming(true);
  };

  const submit = async () => {
    const payload: AnnouncementInput = {
      ...form,
      title: form.title.trim(),
      body: form.body.trim(),
      cta_label: form.cta_label.trim(),
      cta_href: form.cta_href.trim(),
      starts_at: effectiveStart(),
      owner_emails: form.audience === "owners" ? form.owner_emails : [],
      offer_price_inr: form.offer_plan ? form.offer_price_inr : null,
      // The website shows a message to every visitor: no dashboard audience to keep.
      ...(form.placement === "website" ? { audience: "everyone" as const, plan_codes: [], owner_emails: [] } : {}),
    };
    try {
      const saved = editing ? await updateAnnouncement(editing.id, payload) : await createAnnouncement(payload);
      const n = reachText;
      toast(
        editing
          ? "Saved. Customers see the new version on their next page load."
          : saved.status === "scheduled"
            ? `Scheduled for ${fmt(saved.starts_at)}. ${n} will see it.`
            : `Sent. ${n.charAt(0).toUpperCase()}${n.slice(1)} see it on their next page load.`,
      );
      setTab(TAB_OF[saved.status]);
      startNew();
      reload();
    } catch (e) {
      const fields = e instanceof ApiError ? e.fields : {};
      const atFields = Object.fromEntries(Object.entries(fields).filter(([k]) => (FIELD_KEYS as ReadonlyArray<string>).includes(k))) as Partial<
        Record<FieldKey, string>
      >;
      if (Object.keys(atFields).length) {
        setErrors(atFields);
        toast("Fix the highlighted fields first.", "bad");
        return;
      }
      throw e;
    }
  };

  const rowAction = async (a: Announcement, patch: Partial<AnnouncementInput>, done: string) => {
    setBusyId(a.id);
    try {
      await updateAnnouncement(a.id, patch);
      toast(done);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t save.", "bad");
    } finally {
      setBusyId(null);
    }
  };

  const err = (k: FieldKey) =>
    errors[k] ? (
      <span className="an-err" id={`ann-${k}-error`}>
        {errors[k]}
      </span>
    ) : null;
  const fp = (k: FieldKey) => ({
    id: `ann-${k}`,
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? `ann-${k}-error` : undefined,
  });

  const dashboard = form.placement !== "website";
  const paidPlans = planList.filter((p) => Number(p.price_inr_monthly) > 0);
  const startLabel = later ? fmt(form.starts_at) : editing && editing.status === "live" ? `From ${fmt(editing.starts_at)}` : `Now (${fmt(new Date().toISOString())})`;
  const primaryLabel = editing ? "Save changes" : later ? "Schedule" : "Send now";
  const titleMax = Math.max(80, form.title.length);
  const msgMax = Math.max(160, form.body.length);
  const btnMax = Math.max(24, form.cta_label.length);

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="The bar at the top of customers' dashboards. It shows one bar at a time, and plan or payment bars always come first."
      >
        <button
          type="button"
          className="btn dark"
          onClick={() => {
            startNew();
            window.setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
          }}
        >
          <Icon name="plus" strokeWidth={2} />
          New announcement
        </button>
      </PageHeader>

      <section className="card an-list" aria-label="Announcements">
        <div className="an-list__bar">
          <div className="seg" role="group" aria-label="Show">
            {(
              [
                ["active", "Active"],
                ["scheduled", "Scheduled"],
                ["ended", "Ended"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} type="button" className={tab === k ? "on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>
                {label} <span className={"num an-tabn" + (tab === k ? " on" : "")}>{data ? counts[k] : ""}</span>
              </button>
            ))}
          </div>
          <span className="k">Views count each customer once per day. Clicks are on the bar's button.</span>
        </div>
        {error ? (
          <div style={{ padding: 16 }}>
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : !data ? (
          <LoadingState rows={4} bare />
        ) : rows.length === 0 ? (
          <div className="an-empty">
            <b>{{ active: "Nothing is showing right now.", scheduled: "Nothing scheduled.", ended: "Nothing has ended yet." }[tab]}</b>
            <span className="k">Customers see only the plan and payment bars until you send one.</span>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl an-tbl">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 130 }}>
                    Type
                  </th>
                  <th scope="col">Announcement</th>
                  <th scope="col" style={{ width: 170 }}>
                    Audience
                  </th>
                  <th scope="col" style={{ width: 160 }}>
                    Dates
                  </th>
                  <th scope="col" style={{ width: 140 }}>
                    Views · clicks
                  </th>
                  <th scope="col" style={{ width: 200 }}>
                    <span className="sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const n = a.placement === "website" ? null : countOf(a);
                  const extra = [
                    PLACEMENT_LABEL[a.placement],
                    a.cta_label ? `${a.cta_label} → ${a.cta_href}` : a.offer_plan ? `${offerButton(a.offer_price_inr)} → upgrade` : "No button",
                    a.dismissible ? "can be closed" : "stays until it ends",
                    a.priority ? `priority ${a.priority}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <tr key={a.id}>
                      <td>
                        <span className={`pill ${KIND_PILL[a.kind]}`}>{KIND_LABEL[a.kind]}</span>
                        {a.status === "off" ? <div className="k" style={{ marginTop: 4 }}>Switched off</div> : null}
                      </td>
                      <td>
                        <div className="an-cell">
                          <b style={{ fontSize: 14 }}>{a.title}</b>
                          {a.body ? <span className="an-cell__msg">{a.body}</span> : null}
                          <span className="k">{extra}</span>
                          {a.offer_plan ? (
                            <span className="k">
                              Special price: {planName(a.offer_plan)} at ₹{a.offer_price_inr} + GST, online · used {a.offer_uses} time
                              {a.offer_uses === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="an-col">
                          <span>{audLabel(a)}</span>
                          <span className="k num">{n === null ? (a.placement === "website" ? "zinwe.io" : "") : `${n} customers`}</span>
                        </div>
                      </td>
                      <td>
                        <div className="an-col">
                          <span className="num">
                            {a.status === "scheduled" ? "Starts " : "From "}
                            {fmt(a.starts_at)}
                          </span>
                          <span className="k num">{a.ends_at ? `until ${fmt(a.ends_at)}` : "no end date"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="an-col">
                          <span className="num">{a.status === "scheduled" ? "Not shown yet" : "Not counted yet"}</span>
                          <span className="k">{a.status === "scheduled" ? "" : "Counts come with the API"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="an-acts">
                          {a.status === "live" || a.status === "scheduled" ? (
                            <button type="button" className="btn sm" aria-label={`Edit ${a.title}`} onClick={() => loadInto(a, false)}>
                              Edit
                            </button>
                          ) : null}
                          {a.status === "live" ? (
                            <button
                              type="button"
                              className="btn sm danger"
                              disabled={busyId === a.id}
                              onClick={() => void rowAction(a, { is_active: false }, "Ended. Customers stop seeing it on their next page load.")}
                            >
                              End now
                            </button>
                          ) : null}
                          {a.status === "scheduled" ? (
                            <button type="button" className="btn sm danger" onClick={() => setDeleting(a)}>
                              Cancel
                            </button>
                          ) : null}
                          {a.status === "off" ? (
                            <button
                              type="button"
                              className="btn sm"
                              disabled={busyId === a.id}
                              onClick={() => void rowAction(a, { is_active: true }, "Switched on.")}
                            >
                              Turn on
                            </button>
                          ) : null}
                          {a.status === "ended" || a.status === "off" ? (
                            <>
                              <button type="button" className="btn sm" aria-label={`Use ${a.title} again`} onClick={() => loadInto(a, true)}>
                                Use again
                              </button>
                              <button type="button" className="btn sm danger" onClick={() => setDeleting(a)}>
                                Delete
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div id="composer" ref={composerRef} className="an-compose">
        <section className="card an-form" aria-labelledby="cmp-h">
          <div className="an-form__head">
            <h2 id="cmp-h">{editing ? "Edit announcement" : "New announcement"}</h2>
            {editing ? (
              <button type="button" className="btn sm" onClick={startNew}>
                Start a new one instead
              </button>
            ) : null}
          </div>

          <div className="an-fl">
            <span className="lab" id="type-l">
              Type
            </span>
            <div className="seg" role="group" aria-labelledby="type-l" style={{ alignSelf: "flex-start" }}>
              {KINDS.map(([k, label]) => (
                <button key={k} type="button" className={form.kind === k ? "on" : ""} aria-pressed={form.kind === k} onClick={() => set("kind", k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="an-fl">
            <div className="an-fl__row">
              <label className="lab" htmlFor="ann-title">
                Headline
              </label>
              <span className="k num">
                {form.title.length} / {titleMax}
              </span>
            </div>
            <input
              className={"inp" + (errors.title ? " bad" : "")}
              maxLength={titleMax}
              placeholder={TITLE_PH[form.kind]}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              {...fp("title")}
            />
            {err("title")}
          </div>

          <div className="an-fl">
            <div className="an-fl__row">
              <label className="lab" htmlFor="a-msg">
                Message{" "}
                <span className="k" style={{ fontWeight: 400 }}>
                  · optional, one short line
                </span>
              </label>
              <span className="k num">
                {form.body.length} / {msgMax}
              </span>
            </div>
            <textarea
              id="a-msg"
              className="ta an-ta"
              maxLength={msgMax}
              placeholder="The dashboard may be slow for a few minutes. Your PCs stay protected."
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
            />
          </div>

          <div className="an-two">
            <div className="an-fl">
              <label className="lab" htmlFor="ann-cta_label">
                Button text
              </label>
              <input
                className={"inp" + (errors.cta_label ? " bad" : "")}
                maxLength={btnMax}
                placeholder={form.offer_plan ? offerButton(form.offer_price_inr) : "What's new"}
                value={form.cta_label}
                onChange={(e) => set("cta_label", e.target.value)}
                {...fp("cta_label")}
              />
            </div>
            <div className="an-fl">
              <label className="lab" htmlFor="ann-cta_href">
                Link
              </label>
              <input
                className={"inp" + (errors.cta_href ? " bad" : "")}
                maxLength={300}
                placeholder="/app/upgrade or https://zinwe.io/…"
                value={form.cta_href}
                onChange={(e) => set("cta_href", e.target.value)}
                onBlur={() => {
                  const bad = linkError(form.cta_href);
                  if (bad) setErrors((er) => ({ ...er, cta_href: bad }));
                }}
                {...fp("cta_href")}
              />
            </div>
          </div>
          {errors.cta_label || errors.cta_href ? <span className="an-err" style={{ marginTop: -10 }}>{errors.cta_label ?? errors.cta_href}</span> : null}

          <fieldset className="an-set">
            <legend className="lab">Where it shows</legend>
            <div className="an-opts">
              {PLACEMENTS.map(([k, label]) => (
                <Opt key={k} name="where" on={form.placement === k} onPick={() => set("placement", k)}>
                  {label}
                </Opt>
              ))}
            </div>
            {err("placement")}
          </fieldset>

          <fieldset className="an-set">
            <legend className="lab">Who sees it</legend>
            {dashboard ? (
              <>
                <div className="an-opts">
                  <Opt name="aud" on={form.audience === "everyone"} onPick={() => set("audience", "everyone")}>
                    Everyone
                  </Opt>
                  <Opt
                    name="aud"
                    on={form.audience === "plans" || form.audience === "free" || form.audience === "paid"}
                    onPick={() => set("audience", "plans")}
                  >
                    By plan
                  </Opt>
                  <Opt name="aud" on={false} disabled onPick={() => undefined}>
                    By country <SampleTag what="Soon" />
                  </Opt>
                  <Opt name="aud" on={form.audience === "owners"} onPick={() => set("audience", "owners")}>
                    Chosen customers
                  </Opt>
                </div>
                {form.audience === "plans" || form.audience === "free" || form.audience === "paid" ? (
                  <div role="group" aria-label="Plans" className="an-box" id="ann-plan_codes" tabIndex={-1}>
                    <Opt name="planset" on={form.audience === "free"} onPick={() => set("audience", "free")}>
                      Every free plan
                    </Opt>
                    <Opt name="planset" on={form.audience === "paid"} onPick={() => set("audience", "paid")}>
                      Every paid plan
                    </Opt>
                    {planList.map((p) => {
                      const on = form.audience === "plans" && form.plan_codes.includes(p.code);
                      return (
                        <label key={p.code} className={"an-opt" + (on ? " on" : "")}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              const base = form.audience === "plans" ? form.plan_codes : [];
                              setForm((f) => ({
                                ...f,
                                audience: "plans",
                                plan_codes: base.includes(p.code) ? base.filter((c) => c !== p.code) : [...base, p.code],
                              }));
                              setErrors((e) => ({ ...e, plan_codes: undefined }));
                            }}
                          />
                          {p.name} <span className="k num">{planCounts[p.code] ?? ""}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                {form.audience === "owners" ? (
                  <ChosenCustomers
                    emails={form.owner_emails}
                    onChange={(list) => set("owner_emails", list)}
                    invalid={Boolean(errors.owner_emails)}
                  />
                ) : null}
                {err("plan_codes")}
                {err("owner_emails")}
                <span className="an-reach">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="9" cy="8" r="3.5" />
                    <path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" />
                    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.7 2.6 3 5.2" />
                  </svg>
                  <span>
                    Reaches <b className="num">{reachText}</b> right now
                    {form.placement === "both" ? " (and every website visitor)" : ""}
                  </span>
                </span>
                <span className="sr">{COUNTRIES.length} countries available soon</span>
              </>
            ) : (
              <span className="an-reach">Every visitor of zinwe.io sees it. Dashboard audiences apply to dashboard bars only.</span>
            )}
          </fieldset>

          {dashboard ? (
            <fieldset className="an-set">
              <legend className="lab">
                Special price{" "}
                <span className="k" style={{ fontWeight: 400 }}>
                  · optional
                </span>
              </legend>
              <div className="an-two">
                <div className="an-fl">
                  <label className="sr" htmlFor="ann-offer_plan">
                    Special price plan
                  </label>
                  <select
                    className="inp"
                    value={form.offer_plan ?? ""}
                    onChange={(e) => set("offer_plan", e.target.value || null)}
                    {...fp("offer_plan")}
                  >
                    <option value="">No special price</option>
                    {paidPlans.map((p) => (
                      <option key={p.code} value={p.code}>
                        Upgrade to {p.name}
                      </option>
                    ))}
                  </select>
                  {err("offer_plan")}
                </div>
                {form.offer_plan ? (
                  <div className="an-fl">
                    <label className="sr" htmlFor="ann-offer_price_inr">
                      Price in ₹, before GST
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      inputMode="decimal"
                      className={"inp" + (errors.offer_price_inr ? " bad" : "")}
                      value={form.offer_price_inr ?? ""}
                      placeholder="Price in ₹, before GST"
                      onChange={(e) => set("offer_price_inr", e.target.value || null)}
                      {...fp("offer_price_inr")}
                    />
                    {err("offer_price_inr")}
                  </div>
                ) : null}
              </div>
              {form.offer_plan ? (
                <span className="k">
                  One billing cycle, paid online only, once per customer, while this is live. Renewals are at the normal price. Leave
                  the button empty: it becomes "{offerButton(form.offer_price_inr)}".
                </span>
              ) : null}
            </fieldset>
          ) : null}

          <fieldset className="an-set" style={{ gap: 10 }}>
            <legend className="lab">When</legend>
            <div className="an-opts">
              <Opt name="when" on={!later} onPick={() => setLater(false)}>
                Now
              </Opt>
              <Opt
                name="when"
                on={later}
                onPick={() => {
                  setLater(true);
                  if (new Date(form.starts_at).getTime() <= Date.now()) {
                    const d = new Date();
                    d.setDate(d.getDate() + 1);
                    d.setHours(9, 0, 0, 0);
                    set("starts_at", d.toISOString());
                  }
                }}
              >
                At a set time
              </Opt>
            </div>
            <div className="an-two">
              {later ? (
                <div className="an-fl">
                  <label className="lab" htmlFor="a-start">
                    Starts
                  </label>
                  <input
                    id="a-start"
                    type="datetime-local"
                    className="inp"
                    value={toLocalInput(form.starts_at)}
                    onChange={(e) => set("starts_at", fromLocalInput(e.target.value) ?? new Date().toISOString())}
                  />
                </div>
              ) : null}
              <div className="an-fl">
                <label className="lab" htmlFor="ann-ends_at">
                  Ends{" "}
                  <span className="k" style={{ fontWeight: 400 }}>
                    · leave empty to keep it on
                  </span>
                </label>
                <input
                  type="datetime-local"
                  className={"inp" + (errors.ends_at ? " bad" : "")}
                  value={toLocalInput(form.ends_at)}
                  onChange={(e) => set("ends_at", fromLocalInput(e.target.value))}
                  {...fp("ends_at")}
                />
              </div>
            </div>
            {err("ends_at")}
          </fieldset>

          <div className="an-switches">
            <label className="sw">
              <input type="checkbox" role="switch" checked={form.dismissible} onChange={(e) => set("dismissible", e.target.checked)} />
              <span className="tr" aria-hidden="true">
                <span />
              </span>
              <span className="an-sw__text">
                Customers can close it
                <span className="k">
                  {form.dismissible ? "A close button hides it for that customer." : "It stays until the end date. Use this for maintenance."}
                </span>
              </span>
            </label>
            <label className="sw" title="Email sending for announcements isn’t available yet">
              <input type="checkbox" role="switch" checked={false} disabled={!EMAIL_ANNOUNCEMENTS_AVAILABLE} onChange={() => undefined} />
              <span className="tr" aria-hidden="true">
                <span />
              </span>
              <span className="an-sw__text">
                <span>
                  Also email it <SampleTag what="Soon" />
                </span>
                <span className="k">Only shown in the dashboard.</span>
              </span>
            </label>
            <div className="an-prio">
              <label className="lab" htmlFor="a-prio">
                Priority
              </label>
              <input
                id="a-prio"
                type="number"
                min={0}
                max={100}
                className="inp an-prio__inp"
                value={form.priority}
                onChange={(e) => set("priority", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              />
              <span className="k">When two announcements apply, the higher one shows first.</span>
            </div>
          </div>

          <div className="an-form__foot">
            <button type="button" className="btn" onClick={startNew}>
              Clear
            </button>
            <button type="button" className="btn dark" onClick={tryConfirm}>
              {primaryLabel}
            </button>
          </div>
        </section>

        <Preview form={form} previewAs={previewAs} setPreviewAs={setPreviewAs} />
      </div>

      {confirming ? (
        <Confirm
          title={
            editing
              ? `Save changes for ${reachText}?`
              : later
                ? `Schedule for ${fmt(form.starts_at)}?`
                : `Send to ${reachText} now?`
          }
          lead={later ? "It appears in their dashboards at the start time." : "It appears in their dashboards on their next page load."}
          go={primaryLabel}
          rows={[
            { k: "Type", v: KIND_LABEL[form.kind] },
            { k: "Headline", v: form.title.trim() },
            { k: "Where", v: PLACEMENT_LABEL[form.placement] },
            { k: "Audience", v: dashboard ? `${audLabel(form)} · ${reachText}` : "Every visitor of zinwe.io" },
            { k: "Shows", v: startLabel + (form.ends_at ? ` until ${fmt(form.ends_at)}` : ", no end date") },
            { k: "Can be closed", v: form.dismissible ? "Yes" : "No" },
            ...(form.offer_plan ? [{ k: "Special price", v: `${planName(form.offer_plan)} at ₹${form.offer_price_inr} + GST, online` }] : []),
            { k: "Email", v: "Not emailed" },
          ]}
          onClose={() => setConfirming(false)}
          onConfirm={submit}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={deleting.status === "scheduled" ? "Cancel this announcement?" : `Delete "${deleting.title}"?`}
          confirmLabel={deleting.status === "scheduled" ? "Cancel it" : "Delete"}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const wasScheduled = deleting.status === "scheduled";
            await deleteAnnouncement(deleting.id);
            setDeleting(null);
            toast(wasScheduled ? "Cancelled. It will not be shown." : "Deleted.");
            reload();
          }}
        >
          <p>
            {deleting.status === "scheduled"
              ? "It will not be shown to anyone. This can't be undone."
              : "It disappears for good. This can't be undone."}
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/* ---------- Pieces ---------- */

function Opt({
  name,
  on,
  onPick,
  disabled,
  children,
}: {
  name: string;
  on: boolean;
  onPick: () => void;
  disabled?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <label className={"an-opt" + (on ? " on" : "") + (disabled ? " is-off" : "")}>
      <input type="radio" name={name} checked={on} disabled={disabled} onChange={onPick} />
      {children}
    </label>
  );
}

/** How many customers the dashboard bar reaches now, for this audience (J8-19). */
function useReach(form: AnnouncementInput): { customers: number; total: number } | null {
  const [reach, setReach] = useState<{ customers: number; total: number } | null>(null);
  const plans = form.plan_codes.join(",");
  const emails = form.audience === "owners" ? form.owner_emails.join(",") : "";
  const dashboard = form.placement !== "website";
  useEffect(() => {
    if (!dashboard) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      getAnnouncementReach(form.audience, plans ? plans.split(",") : [], emails ? emails.split(",") : [])
        .then((r) => alive && setReach(r))
        .catch(() => alive && setReach(null));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [form.audience, plans, emails, dashboard]);
  return dashboard ? reach : null;
}

/** Chosen customers: type a company or sign-in email; companies resolve to the owner's sign-in email. */
function ChosenCustomers({
  emails,
  onChange,
  invalid,
}: {
  emails: string[];
  onChange: (list: string[]) => void;
  invalid: boolean;
}): ReactElement {
  const loadSubs = useCallback(() => getSubscribers(), []);
  const subs = useLoad(loadSubs);
  const [text, setText] = useState("");
  const byEmail = new Map((subs.data ?? []).map((s) => [s.email.toLowerCase(), s.company?.name || s.full_name || s.email]));
  const add = () => {
    const v = text.trim();
    if (!v) return;
    const hit = (subs.data ?? []).find((s) => s.company?.name.toLowerCase() === v.toLowerCase() || s.email.toLowerCase() === v.toLowerCase());
    const found = hit ? [hit.email.toLowerCase()] : v.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    onChange(Array.from(new Set([...emails, ...found])));
    setText("");
  };
  return (
    <div className="an-box an-box--col">
      <div className="an-addrow">
        <label className="sr" htmlFor="ann-owner_emails">
          Add a customer by company or sign-in email
        </label>
        <input
          id="ann-owner_emails"
          className={"inp" + (invalid ? " bad" : "")}
          list="an-custs"
          placeholder="Company or sign-in email"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <datalist id="an-custs">
          {(subs.data ?? []).map((s) => (
            <option key={s.id} value={s.company?.name || s.email}>
              {s.email}
            </option>
          ))}
        </datalist>
        <button type="button" className="btn" onClick={add}>
          Add
        </button>
      </div>
      {emails.length ? (
        <div className="an-chips">
          {emails.map((e) => {
            const name = byEmail.get(e);
            return (
              <span key={e} className="an-chip">
                {name && name !== e ? `${name} · ${e}` : e}
                <button type="button" className="an-chip__x" aria-label={`Remove ${name ?? e}`} onClick={() => onChange(emails.filter((x) => x !== e))}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <path d="M7 7l10 10M17 7L7 17" />
                  </svg>
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Preview({
  form,
  previewAs,
  setPreviewAs,
}: {
  form: AnnouncementInput;
  previewAs: PreviewAs;
  setPreviewAs: (v: PreviewAs) => void;
}): ReactElement {
  const winner = previewAs === "normal" ? "ann" : previewAs;
  const wi = BAR_LADDER.findIndex((l) => l.key === winner);
  let bar: ReactElement;
  if (previewAs === "normal") {
    const [bg, fg, bbg, bfg] = KIND_BAR[form.kind];
    const btn = form.cta_label.trim() || (form.offer_plan ? offerButton(form.offer_price_inr) : "");
    bar = (
      <div className="an-pv__bar" style={{ background: bg, color: fg }}>
        <span className="an-pv__icon">
          <PathIcon d={KIND_ICON[form.kind]} size={15} strokeWidth={2} />
        </span>
        <span className="an-pv__text">
          <b style={{ fontWeight: 700, opacity: form.title.trim() ? 1 : 0.6 }}>{form.title.trim() || "Your headline"}</b>{" "}
          <span>{form.body.trim()}</span>
        </span>
        {btn ? (
          <span className="an-pv__btn" style={{ background: bbg, color: bfg }}>
            {btn} →
          </span>
        ) : null}
        {form.dismissible ? (
          <span aria-hidden="true" className="an-pv__x">
            <Icon name="close" size={15} strokeWidth={2} />
          </span>
        ) : null}
      </div>
    );
  } else {
    const y = SYSTEM_BARS[previewAs];
    bar = (
      <div className="an-pv__bar" style={{ background: y.bar, color: y.fg }}>
        <span className="an-pv__icon">
          <PathIcon d={SYS_ICON[y.icon]} size={15} strokeWidth={2} />
        </span>
        <span className="an-pv__text">
          <b style={{ fontWeight: 700 }}>{y.title}</b> <span>{y.msg}</span>
        </span>
        {y.btn ? (
          <span className="an-pv__btn" style={{ background: y.btnBg, color: y.btnFg }}>
            {y.btn} →
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <section aria-labelledby="pv-h" className="an-side">
      <div className="card an-pvcard">
        <div className="an-pvcard__head">
          <h2 id="pv-h">Live preview</h2>
          <div className="an-pvas">
            <label className="k" htmlFor="pv-as" style={{ fontWeight: 600 }}>
              Preview as
            </label>
            <select id="pv-as" className="inp an-pvas__sel" value={previewAs} onChange={(e) => setPreviewAs(e.target.value as PreviewAs)}>
              {PREVIEW_AS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <figure aria-label="Preview of the customer dashboard" className="an-pv">
          <div aria-hidden="true" className="an-pv__chrome">
            <span className="an-pv__dots">
              <span />
              <span />
              <span />
            </span>
            <span className="mono an-pv__url">{form.placement === "website" ? "zinwe.io" : "app.zinwe.io/app"}</span>
          </div>
          <div className="an-pv__body">
            <div aria-hidden="true" className="an-pv__side">
              <span className="an-pv__logo" />
              <span className="an-pv__line" style={{ marginTop: 8 }} />
              <span className="an-pv__line" />
              <span className="an-pv__line" />
              <span className="an-pv__line" />
            </div>
            <div className="an-pv__main">
              {bar}
              <div aria-hidden="true" className="an-pv__content">
                <span className="an-pv__hello">Good afternoon, {PREVIEW_OWNER}</span>
                <div className="an-pv__tiles">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="an-pv__big" />
              </div>
            </div>
          </div>
        </figure>
        {winner !== "ann" ? (
          <p role="status" className="an-waits">
            This customer sees the {SYSTEM_BARS[previewAs as Exclude<PreviewAs, "normal">].name} bar instead. Your announcement shows once
            that clears.
          </p>
        ) : null}
      </div>

      <div className="card an-ladder">
        <h3>Which bar wins</h3>
        <p className="k" style={{ margin: 0 }}>
          The dashboard shows one bar at a time. The first that applies to the customer wins.
        </p>
        <ol>
          {BAR_LADDER.map((l, i) => (
            <li key={l.key} className={i === wi ? "is-on" : i < wi ? "is-skip" : ""}>
              <span className="num an-ladder__n">{i + 1}</span>
              <span style={{ flex: "1 1 auto", minWidth: 0 }}>{l.label}</span>
              <span className="k" style={{ fontWeight: 600 }}>
                {i === wi ? "Showing" : i < wi ? "Doesn’t apply" : "Waits"}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Confirm({
  title,
  lead,
  go,
  rows,
  onClose,
  onConfirm,
}: {
  title: string;
  lead: string;
  go: string;
  rows: { k: string; v: string }[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save.");
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      size="small"
      role="alertdialog"
      className="an-dialog"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Go back
          </button>
          <button type="button" className="btn dark" disabled={busy} onClick={() => void run()}>
            {busy ? "Saving…" : go}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, color: "var(--ink-3)" }}>{lead}</p>
      <dl className="an-dialog__facts">
        {rows.map((r) => (
          <div key={r.k}>
            <dt className="k">{r.k}</dt>
            <dd>{r.v}</dd>
          </div>
        ))}
      </dl>
      {error ? (
        <p className="err-box" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
