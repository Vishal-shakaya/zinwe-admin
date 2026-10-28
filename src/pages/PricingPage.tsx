import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncements,
  getPricing,
  getSubscriptions,
  updatePricing,
  type AdminSubscription,
  type Announcement,
  type PlanPricing,
  type PricingCurrency,
  type PricingOverview,
  type RegionPriceInput,
} from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { ErrorState, LoadingState, SampleTag } from "../components/States";
import { Icon } from "../components/icons";
import { CUSTOM_PLAN, PLAN_EXTRAS, PREVIEW_VISITOR_PCS } from "../content/fixtures/pricing";
import "../styles/pricing.css";

/* ------------------------------------------------------------------ helpers */

/** A price as typed: "₹1,349" / "1349.5" -> number; anything else NaN. */
function num(t: string | undefined | null): number {
  const c = String(t ?? "").replace(/[₹$,\s]/g, "");
  return c && /^\d+(\.\d{1,2})?$/.test(c) ? Number(c) : Number.NaN;
}

function money(n: number, cur: "INR" | "USD"): string {
  if (!Number.isFinite(n)) return "—";
  const whole = Math.abs(n % 1) < 0.001;
  const opts = { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 };
  return cur === "USD" ? "$" + n.toLocaleString("en-US", opts) : "₹" + n.toLocaleString("en-IN", opts);
}

const rupee = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const dollar = (n: number) =>
  "$" + (Math.abs(n % 1) < 0.001 ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** The server's rule: list price minus a whole-percent discount, rounded to a whole unit, half up. */
function discounted(list: number, pct: number): number {
  return Math.floor((list * (100 - pct)) / 100 + 0.5 + 1e-9);
}

function hist(days: number): string {
  if (!(days > 0)) return "—";
  return days === 365 ? "1 year" : days % 365 === 0 ? `${days / 365} years` : `${days} days`;
}

const strip = (v: string) => String(Number(v));

function istDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/* ------------------------------------------------------------------ plan model <-> board fields */

/** The board's editable price fields for one paid plan (strings, as typed). */
interface Fields {
  inrM: string;
  inrY: string;
  /** Yearly = 12 × monthly (no yearly price set): follows the monthly price until typed over. */
  inrYAuto: boolean;
  was: string;
  usdM: string;
  usdY: string;
  usdYAuto: boolean;
}

type FieldKey = "inrM" | "inrY" | "usdM" | "usdY" | "was";

const FIELD_LABEL: Record<FieldKey, string> = {
  inrM: "India monthly",
  inrY: "India yearly",
  usdM: "Abroad monthly",
  usdY: "Abroad yearly",
  was: "Was price",
};
const FIELD_KEYS: FieldKey[] = ["inrM", "inrY", "usdM", "usdY", "was"];

function fieldsOf(p: PlanPricing): Fields {
  const inr = p.regions.INR;
  const usd = p.regions.USD;
  return {
    inrM: strip(inr.monthly.price),
    inrY: strip(inr.yearly.price),
    inrYAuto: !inr.yearly.custom,
    was: inr.monthly.discount_percent > 0 ? strip(inr.monthly.list) : "",
    usdM: Number(usd.monthly.list) > 0 ? strip(usd.monthly.price) : "",
    usdY: Number(usd.monthly.list) > 0 ? strip(usd.yearly.price) : "",
    usdYAuto: !usd.yearly.custom,
  };
}

/** What a field shows (yearly follows 12 × monthly while it isn't typed over). */
function shown(f: Fields, k: FieldKey): string {
  if (k === "inrY" && f.inrYAuto) {
    const m = num(f.inrM);
    return m > 0 ? String(Math.round(m * 12 * 100) / 100) : f.inrY;
  }
  if (k === "usdY" && f.usdYAuto) {
    const m = num(f.usdM);
    return m > 0 ? String(Math.round(m * 12 * 100) / 100) : f.usdY;
  }
  return f[k].trim();
}

function fmtField(k: FieldKey, v: string): string {
  const t = v.trim();
  if (k === "was") return t ? money(num(t), "INR") : "none";
  if (!t) return "none";
  return k === "usdM" || k === "usdY" ? money(num(t), "USD") : money(num(t), "INR");
}

/** Percent change of a price against the saved one; null when it can't be compared. */
function delta(saved: string, draft: string): number | null {
  const a = num(saved);
  const b = num(draft);
  if (!(a > 0) || !(b > 0) || a === b) return null;
  return Math.round(((b - a) / a) * 100);
}

/** The plan model keeps a list price + whole-percent discount: find the discount for this was → price. */
function wasSplit(was: number, price: number): { pct: number; ok: boolean; near: number[] } {
  const pct = Math.round(100 * (1 - price / was));
  const near = [pct - 1, pct, pct + 1].filter((p) => p >= 0 && p <= 90).map((p) => discounted(was, p));
  return { pct, ok: pct >= 0 && pct <= 90 && discounted(was, pct) === price, near: [...new Set(near)].sort((a, b) => b - a) };
}

function planError(f: Fields, usdSold: boolean): string {
  const m = num(f.inrM);
  const y = num(shown(f, "inrY"));
  if (!(m > 0)) return "Enter the monthly price in rupees.";
  if (m % 1) return "Use whole rupees for the monthly price.";
  if (!(y > 0)) return "Enter the yearly price in rupees.";
  if (y > m * 12 + 0.001) return `A year can’t cost more than 12 months (${money(m * 12, "INR")}).`;
  if (y < m * 6) return `A year can’t cost less than 6 months (${money(m * 6, "INR")}). Check for a missing digit.`;
  const w = f.was.trim();
  if (w) {
    const wn = num(w);
    if (!(wn > m)) return `The was price must be higher than the monthly price (${money(m, "INR")}), or empty.`;
    const split = wasSplit(wn, m);
    if (split.pct > 90) return "The was price can be at most 10 times the monthly price.";
    if (!split.ok)
      return `With a was price of ${money(wn, "INR")}, the monthly price is a whole-percent discount: ${split.near.map((n) => money(n, "INR")).join(" or ")}.`;
  }
  const um = num(f.usdM);
  const uy = num(shown(f, "usdY"));
  if (usdSold || f.usdM.trim() || f.usdY.trim()) {
    if (!(um > 0)) return "Enter the monthly price in dollars.";
    if (um % 1) return "Use whole dollars for the monthly price.";
    if (!(uy > 0)) return "Enter the yearly price in dollars.";
    if (uy > um * 12 + 0.001) return `Abroad: a year can’t cost more than 12 months (${money(um * 12, "USD")}).`;
    if (uy < um * 6) return `Abroad: a year can’t cost less than 6 months (${money(um * 6, "USD")}). Check for a missing digit.`;
  }
  return "";
}

/** The PATCH body for what changed (same endpoint and shape as before v1.3). */
function bodyFor(p: PlanPricing, saved: Fields, draft: Fields): Partial<Record<PricingCurrency, RegionPriceInput>> {
  const body: Partial<Record<PricingCurrency, RegionPriceInput>> = {};
  const changed = (k: FieldKey) => shown(draft, k) !== shown(saved, k);
  if (changed("inrM") || changed("inrY") || changed("was")) {
    const m = num(draft.inrM);
    const y = num(shown(draft, "inrY"));
    const w = num(draft.was);
    const pct = draft.was.trim() ? wasSplit(w, m).pct : 0;
    body.INR = {
      list_monthly: String(draft.was.trim() ? w : m),
      discount_percent: pct,
      yearly_price: Math.abs(y - m * 12) < 0.005 ? null : String(y),
    };
  }
  if (changed("usdM") || changed("usdY")) {
    const um = num(draft.usdM);
    const uy = num(shown(draft, "usdY"));
    // Keep the saved list price ("was") abroad when the new price is still a whole-percent discount from it.
    const list = Number(p.regions.USD.monthly.list);
    let input = { list: um, pct: 0 };
    if (list > um) {
      const split = wasSplit(list, um);
      if (split.ok) input = { list, pct: split.pct };
    }
    body.USD = {
      list_monthly: String(input.list),
      discount_percent: input.pct,
      yearly_price: Math.abs(uy - um * 12) < 0.005 ? null : String(uy),
    };
  }
  return body;
}

/** The body that puts a plan back to how it was (for Undo). */
function restoreBody(p: PlanPricing): Partial<Record<PricingCurrency, RegionPriceInput>> {
  const r = (c: PricingCurrency): RegionPriceInput => ({
    list_monthly: p.regions[c].monthly.list,
    discount_percent: p.regions[c].monthly.discount_percent,
    yearly_price: p.regions[c].yearly.custom ? p.regions[c].yearly.price : null,
  });
  return { INR: r("INR"), USD: r("USD") };
}

interface Change {
  plan: string;
  field: string;
  from: string;
  to: string;
  delta: number | null;
  big: boolean;
}

/* ------------------------------------------------------------------ page */

type ToastState = { text: string; undo?: () => void } | null;

/**
 * Plans and pricing (AdminPricing board). Prices come from and save to `admin/pricing/` (same PATCH shape as before):
 * the board's "India monthly" + "Was price" are the plan model's list price and whole-percent discount; yearly empty
 * = 12 × monthly. The preview is built from the draft, saved or not. Special-price offers are dashboard announcements
 * with an offer plan and price (`admin/announcements/`).
 */
export function PricingPage(): ReactElement {
  const load = useCallback(() => getPricing(), []);
  const { data, error, reload, setData } = useLoad(load);
  const [draft, setDraft] = useState<Record<string, Fields>>({});
  const [modal, setModal] = useState(false);
  const [bigOk, setBigOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [lastChanged, setLastChanged] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const [region, setRegion] = useState<"IN" | "AB">("IN");
  const [cycle, setCycle] = useState<"Monthly" | "Yearly">("Monthly");
  const [recBusy, setRecBusy] = useState("");

  const say = useCallback((text: string, undo?: () => void, ms = 5000) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const plans = useMemo(() => (data?.plans ?? []).filter((p) => p.code !== "custom"), [data]);
  const saved = useMemo(() => Object.fromEntries(plans.map((p) => [p.code, fieldsOf(p)])) as Record<string, Fields>, [plans]);

  // A fresh load (or a save) resets the draft to the saved prices.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const paid = plans.filter((p) => !p.is_free);
  const usdSold = (p: PlanPricing) => Number(p.regions.USD.monthly.list) > 0;
  const errors = Object.fromEntries(paid.map((p) => [p.code, draft[p.code] ? planError(draft[p.code], usdSold(p)) : ""]));
  const hasErrors = Object.values(errors).some(Boolean);

  const changes: Change[] = [];
  for (const p of paid) {
    const d = draft[p.code];
    const s = saved[p.code];
    if (!d || !s) continue;
    for (const k of FIELD_KEYS) {
      const a = shown(s, k);
      const b = shown(d, k);
      if (a === b) continue;
      const dl = delta(a, b);
      changes.push({ plan: p.name, field: FIELD_LABEL[k], from: fmtField(k, a), to: fmtField(k, b), delta: dl, big: dl !== null && Math.abs(dl) > 30 });
    }
  }
  const bigChanges = changes.filter((c) => c.big);
  const dirtyPlans = paid.filter((p) => draft[p.code] && FIELD_KEYS.some((k) => shown(draft[p.code], k) !== shown(saved[p.code], k)));

  const setF = (code: string, k: FieldKey, v: string) =>
    setDraft((cur) => {
      const next = { ...cur[code], [k]: v };
      if (k === "inrY") next.inrYAuto = false;
      if (k === "usdY") next.usdYAuto = false;
      return { ...cur, [code]: next };
    });

  const doSave = async () => {
    if (!data) return;
    setSaving(true);
    setSaveErr("");
    const before: PlanPricing[] = [];
    const after = new Map<string, PlanPricing>();
    try {
      for (const p of dirtyPlans) {
        const body = bodyFor(p, saved[p.code], draft[p.code]);
        if (!body.INR && !body.USD) continue;
        const next = await updatePricing(p.code, body);
        before.push(p);
        after.set(p.code, next);
      }
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Couldn’t save.");
      setSaving(false);
      if (after.size) reload();
      return;
    }
    const n = changes.length;
    setData({ ...data, plans: data.plans.map((p) => after.get(p.code) ?? p) } as PricingOverview);
    setSaving(false);
    setModal(false);
    setBigOk(false);
    setLastChanged(
      "Last changed " +
        new Date().toLocaleString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        }).replace(",", "") +
        " by you",
    );
    say(
      `Saved ${n} ${n === 1 ? "change" : "changes"}. New payments use the new prices from now.`,
      async () => {
        window.clearTimeout(toastTimer.current);
        try {
          const restored = new Map<string, PlanPricing>();
          for (const p of before) restored.set(p.code, await updatePricing(p.code, restoreBody(p)));
          setData({ ...data, plans: data.plans.map((p) => restored.get(p.code) ?? after.get(p.code) ?? p) } as PricingOverview);
          say("Undone. The Plans page and checkout are back to the old prices.", undefined, 4000);
        } catch (e) {
          say(e instanceof Error ? `Couldn’t undo: ${e.message}` : "Couldn’t undo.", undefined, 6000);
          reload();
        }
      },
      10_000,
    );
  };

  const makeRecommended = async (p: PlanPricing) => {
    setRecBusy(p.code);
    try {
      await updatePricing(p.code, { is_recommended: true });
      say(`${p.name} is now the recommended plan.`);
      reload();
    } catch (e) {
      say(e instanceof Error ? e.message : "Couldn’t save.");
    } finally {
      setRecBusy("");
    }
  };

  /* ---- at a glance */
  const paying = paid.reduce((n, p) => n + p.subscribers, 0);
  const freeCount = plans.filter((p) => p.is_free).reduce((n, p) => n + p.subscribers, 0);
  const savings = paid.map((p) => {
    const d = draft[p.code];
    if (!d) return 0;
    const m = num(d.inrM);
    const y = num(shown(d, "inrY"));
    return m > 0 && y > 0 && y < m * 12 ? Math.round((1 - y / (m * 12)) * 100) : 0;
  });
  const best = Math.max(0, ...savings);
  const gstRate = data?.gst_rate ?? 0;

  /* ---- offers (real: announcements with an offer plan) */
  const offersLoad = useCallback(() => Promise.all([getAnnouncements(), getSubscriptions()]), []);
  const offersState = useLoad(offersLoad);
  const liveOffers = (offersState.data?.[0] ?? []).filter((a) => a.offer_plan && (a.status === "live" || a.status === "scheduled")).length;

  return (
    <>
      <PageHeader
        title="Plans and pricing"
        subtitle="What each plan includes and costs, in India (₹, monthly or yearly, 18% GST on top) and abroad ($, monthly or yearly, no GST). One plan model feeds the Plans page, checkout and this screen."
      >
        {lastChanged ? <span className="k">{lastChanged}</span> : null}
      </PageHeader>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState rows={6} />
      ) : (
        <>
          <section aria-label="At a glance" className="zp-glance">
            <div className="card zp-kpi">
              <span className="k">Paying customers</span>
              <b className="num">{paying}</b>
              <span className="k">{freeCount} more on Free forever · paying ones keep their price until renewal</span>
            </div>
            <div className="card zp-kpi">
              <span className="k">Yearly price · India</span>
              <b className="num">{best ? `Save up to ${best}%` : "12 × monthly"}</b>
              <span className="k">
                {best ? "shown on the Plans page when Yearly is picked" : "no yearly discount yet; the owner decides · never below 6 months"}
              </span>
            </div>
            <div className="card zp-kpi">
              <span className="k">Tax</span>
              <b>{gstRate ? `${gstRate}% GST` : "No GST yet"}</b>
              <span className="k">{gstRate ? "added on top in India · none abroad" : "no seller GSTIN set · none abroad either"}</span>
            </div>
            <div className="card zp-kpi">
              <span className="k">Special offers running</span>
              <b className="num">{offersState.data ? liveOffers : "—"}</b>
              <span className="k">see Special-price offers below</span>
            </div>
          </section>

          <section aria-labelledby="plans-h" className="zp-sec">
            <div className="zp-sec__head">
              <h2 id="plans-h">The five plans</h2>
              <span className="k">Changed fields are tinted blue until you save. A year must cost between 6 and 12 months.</span>
            </div>
            <div className="zp-cards">
              {plans.map((p) =>
                draft[p.code] ? (
                  <PlanCard
                    key={p.code}
                    plan={p}
                    saved={saved[p.code]}
                    draft={draft[p.code]}
                    error={errors[p.code] ?? ""}
                    gstRate={gstRate}
                    onField={(k, v) => setF(p.code, k, v)}
                    onRecommend={() => void makeRecommended(p)}
                    recBusy={recBusy === p.code}
                  />
                ) : null,
              )}
              <article className="card zp-card" aria-label="Custom">
                <div className="zp-card__head">
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <h3>Custom</h3>
                    <span className="k">More than 50 PCs · quoted one by one</span>
                  </div>
                </div>
                <div className="zp-block zp-free" style={{ gap: 8 }}>
                  <b>Talk to us</b>
                  <span>No list price to edit. The Plans page shows “Talk to us” and links to the Contact page; each quote is agreed by email.</span>
                </div>
              </article>
            </div>
            {changes.length ? (
              <div role="region" aria-label="Unsaved changes" className="zp-savebar">
                <span style={{ fontWeight: 600 }}>
                  {changes.length} {changes.length === 1 ? "change" : "changes"} not saved
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn" onClick={() => setDraft(saved)}>
                    Discard
                  </button>
                  <button
                    type="button"
                    className="btn light"
                    disabled={hasErrors}
                    onClick={() => {
                      setBigOk(false);
                      setSaveErr("");
                      setModal(true);
                    }}
                  >
                    Save changes…
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <Preview plans={plans} draft={draft} region={region} cycle={cycle} setRegion={setRegion} setCycle={setCycle} gstRate={gstRate} />

          <Offers state={offersState} plans={paid} onSay={say} />
        </>
      )}

      {modal ? (
        <Modal
          title="Save new plans and prices?"
          size="small"
          role="alertdialog"
          className="zp-confirm"
          onClose={() => (saving ? undefined : setModal(false))}
          footer={
            <>
              <button type="button" className="btn" disabled={saving} onClick={() => setModal(false)}>
                Cancel
              </button>
              <button type="button" className="btn dark" disabled={saving || (bigChanges.length > 0 && !bigOk)} onClick={() => void doSave()}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          }
        >
          <ul className="zp-changes">
            {changes.map((c, i) => (
              <li key={i} className="num">
                <b>{c.plan}</b> · {c.field}: <span style={{ color: "var(--mute)" }}>{c.from}</span> → <b>{c.to}</b>{" "}
                {c.delta !== null ? (
                  <span className={c.big ? "zp-delta-big" : undefined} style={c.big ? undefined : { color: "var(--mute)" }}>
                    ({c.delta > 0 ? "+" : ""}
                    {c.delta}%)
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {bigChanges.length ? (
            <div className="zp-big">
              <b style={{ color: "#8a5300" }}>
                {bigChanges.length === 1 ? "1 change is more than 30%." : `${bigChanges.length} changes are more than 30%.`}
              </b>
              <span>A missing or extra digit is the usual cause. Check the Plans page preview before you save.</span>
              <label>
                <input type="checkbox" checked={bigOk} onChange={() => setBigOk((v) => !v)} style={{ width: 18, height: 18, margin: 0 }} /> I
                checked these and they are right
              </label>
            </div>
          ) : null}
          <p style={{ margin: 0, color: "var(--ink-2)" }}>
            Changes apply to new payments. Current subscribers keep their price until renewal. The Plans page and checkout update as soon
            as you save. You can undo for 10 seconds after saving.
          </p>
          {saveErr ? (
            <p className="err-box" role="alert">
              {saveErr}
            </p>
          ) : null}
        </Modal>
      ) : null}

      {toast ? (
        <div className="toasts">
          <div className="toast zp-toast" role="status">
            <span>{toast.text}</span>
            {toast.undo ? (
              <button type="button" onClick={() => void toast.undo?.()}>
                Undo
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ plan card */

function PlanCard({
  plan: p,
  saved,
  draft: d,
  error: err,
  gstRate,
  onField,
  onRecommend,
  recBusy,
}: {
  plan: PlanPricing;
  saved: Fields;
  draft: Fields;
  error: string;
  gstRate: number;
  onField: (k: FieldKey, v: string) => void;
  onRecommend: () => void;
  recBusy: boolean;
}): ReactElement {
  const extra = PLAN_EXTRAS[p.code];
  const dirty = FIELD_KEYS.some((k) => shown(d, k) !== shown(saved, k));
  const m = num(d.inrM);
  const y = num(shown(d, "inrY"));
  const um = num(d.usdM);
  const uy = num(shown(d, "usdY"));
  const months = m > 0 && y > 0 ? Math.round((y / m) * 10) / 10 : Number.NaN;
  const save = m > 0 && y > 0 && y < m * 12 ? Math.round((1 - y / (m * 12)) * 100) : 0;
  const wasP = num(d.was);
  const errHas = (s: string) => Boolean(err) && err.includes(s);
  const cls = (k: FieldKey, bad: boolean) => {
    if (bad) return "inp num bad";
    const a = shown(saved, k);
    const b = shown(d, k);
    if (a === b) return "inp num";
    const dl = delta(a, b);
    return dl !== null && Math.abs(dl) > 30 ? "inp num warn" : "inp num chg";
  };
  const warns = (["inrM", "inrY", "usdM", "usdY", "was"] as FieldKey[])
    .map((k) => {
      const dl = delta(shown(saved, k), shown(d, k));
      if (dl === null || Math.abs(dl) <= 30) return "";
      return `${FIELD_LABEL[k]} changes by ${dl > 0 ? "+" : ""}${dl}% (${fmtField(k, shown(saved, k))} → ${fmtField(k, shown(d, k))}). Check it before saving.`;
    })
    .filter(Boolean);
  const gst = gstRate / 100;

  return (
    <article className="card zp-card" aria-label={p.name}>
      <div className="zp-card__head">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h3>{p.name}</h3>
          <span className="k">
            {p.subscribers} {p.is_free ? "accounts on it" : "paying customers"}
          </span>
        </div>
        <div className="zp-card__flags">
          {dirty ? <span className="pill zp-unsaved">Not saved</span> : null}
          {p.is_recommended ? (
            <span className="pill good">Recommended</span>
          ) : !p.is_free ? (
            <button type="button" className="zp-rec-btn" onClick={onRecommend} disabled={recBusy}>
              {recBusy ? "Saving…" : "Make recommended"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="zp-grid2">
        <label className="zp-fl" title="Set in the plan model; not editable here yet">
          PC limit
          <input className="inp num" type="number" value={p.max_devices} disabled readOnly />
        </label>
        <label className="zp-fl" title="Sample value until the plan model serves it (content/fixtures/pricing.ts)">
          History, days
          <input className="inp num" type="number" value={extra?.historyDays ?? ""} disabled readOnly />
        </label>
      </div>

      {p.is_free ? (
        <div className="zp-block zp-free" style={{ gap: 8 }}>
          <b>₹0 · $0</b>
          <span>Free forever. No card, no end date. Owners move up when they need more PCs or longer history.</span>
        </div>
      ) : (
        <div className="zp-block">
          <label className="zp-fl">
            India · monthly
            <span className="zp-pre">
              <b aria-hidden="true">₹</b>
              <input
                className={cls("inrM", errHas("monthly price in rupees") || errHas("whole rupees") || errHas("whole-percent"))}
                inputMode="decimal"
                value={d.inrM}
                onChange={(e) => onField("inrM", e.target.value)}
              />
            </span>
            <span className="k">
              {shown(d, "inrM") !== shown(saved, "inrM") ? `Was ${money(num(saved.inrM), "INR")} a month` : `per month, before GST`}
            </span>
          </label>
          <label className="zp-fl">
            India · yearly
            <span className="zp-pre">
              <b aria-hidden="true">₹</b>
              <input
                className={cls("inrY", errHas("yearly price in rupees") || (errHas("A year") && !errHas("Abroad")))}
                inputMode="decimal"
                value={shown(d, "inrY")}
                onChange={(e) => onField("inrY", e.target.value)}
              />
            </span>
            <span className="k">
              {Number.isFinite(months)
                ? `= ${months} months${save ? ` · saves ${save}%` : " · same as paying monthly"} · allowed 6 to 12 months`
                : "per year, before GST · 6 to 12 months"}
            </span>
          </label>
          <div role="group" aria-label={`Set ${p.name} yearly price`} className="zp-quick">
            <span className="k">Year costs</span>
            {[12, 11, 10].map((mo) => (
              <button key={mo} type="button" className="zp-qchip" onClick={() => m > 0 && onField("inrY", String(Math.round(m * mo)))}>
                {mo} months
              </button>
            ))}
          </div>
          <div className="zp-grid2">
            <label className="zp-fl">
              Abroad · monthly
              <span className="zp-pre">
                <b aria-hidden="true">$</b>
                <input
                  className={cls("usdM", errHas("monthly price in dollars") || errHas("whole dollars"))}
                  inputMode="decimal"
                  placeholder="not sold"
                  value={d.usdM}
                  onChange={(e) => onField("usdM", e.target.value)}
                />
              </span>
            </label>
            <label className="zp-fl">
              Abroad · yearly
              <span className="zp-pre">
                <b aria-hidden="true">$</b>
                <input
                  className={cls("usdY", errHas("yearly price in dollars") || errHas("Abroad"))}
                  inputMode="decimal"
                  placeholder="not sold"
                  value={shown(d, "usdY")}
                  onChange={(e) => onField("usdY", e.target.value)}
                />
              </span>
            </label>
          </div>
          <span className="k" style={{ marginTop: -4 }}>
            {uy > 0 && um > 0
              ? `= ${money(Math.round((uy / 12) * 100) / 100, "USD")} a month when paid yearly · no GST`
              : "Not sold abroad yet: visitors outside India see the rupee price."}
          </span>
          <p className="zp-gst">
            {gstRate ? (
              <>
                GST {gstRate}% added in India:{" "}
                <b className="num">
                  {m > 0
                    ? `${money(Math.round(m * (1 + gst)), "INR")} a month incl GST` +
                      (y > 0 ? ` · ${money(Math.round(y * (1 + gst)), "INR")} a year incl GST` : "")
                    : "—"}
                </b>
              </>
            ) : (
              <>GST isn’t charged yet (no seller GSTIN set): customers in India pay the price above.</>
            )}
          </p>
          <div className="zp-grid2 zp-block zp-block--tight">
            <label className="zp-fl">
              Was price · India monthly
              <span className="zp-pre">
                <b aria-hidden="true">₹</b>
                <input
                  className={cls("was", errHas("was price"))}
                  inputMode="decimal"
                  placeholder="none"
                  value={d.was}
                  onChange={(e) => onField("was", e.target.value)}
                />
              </span>
            </label>
            <label className="zp-fl" title="No offer label in the plan model yet">
              Offer label
              <input className="inp" maxLength={24} placeholder="none" value="" disabled readOnly />
            </label>
          </div>
          <span className="k" style={{ marginTop: -4 }}>
            {wasP > 0
              ? `Plans page shows ${money(wasP, "INR")} crossed out next to ${money(m, "INR")} a month. Empty = no strikethrough.`
              : "No strikethrough on the Plans page. Type a was price to show one."}
          </span>
          {warns.length && !err ? <p className="zp-warnbox">{warns.join(" ")}</p> : null}
          {err ? (
            <p role="alert" className="zp-err">
              {err}
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ public preview */

function Preview({
  plans,
  draft,
  region,
  cycle,
  setRegion,
  setCycle,
  gstRate,
}: {
  plans: PlanPricing[];
  draft: Record<string, Fields>;
  region: "IN" | "AB";
  cycle: "Monthly" | "Yearly";
  setRegion: (r: "IN" | "AB") => void;
  setCycle: (c: "Monthly" | "Yearly") => void;
  gstRate: number;
}): ReactElement {
  const abroad = region === "AB";
  const yearly = cycle === "Yearly";
  const gst = 1 + gstRate / 100;
  const plusGst = gstRate ? " + GST" : "";
  const fitsCode = plans
    .filter((p) => !p.is_free && p.max_devices >= PREVIEW_VISITOR_PCS)
    .sort((a, b) => a.max_devices - b.max_devices)[0]?.code;

  const cards = [
    ...plans.map((p) => {
      const d = draft[p.code] ?? fieldsOf(p);
      const m = num(d.inrM);
      const y = num(shown(d, "inrY"));
      const w = num(d.was);
      const um = num(d.usdM);
      const uy = num(shown(d, "usdY"));
      const usd = um > 0;
      let price = "";
      let per = "";
      let incl = "";
      let sub = "";
      let was = "";
      if (p.is_free) {
        price = abroad ? "$0" : "₹0";
        per = "free forever";
      } else if (abroad && usd && !yearly) {
        price = dollar(um);
        per = "a month";
        sub = "No Indian GST.";
      } else if (abroad && usd) {
        price = dollar(uy);
        per = "a year";
        sub = `${dollar(Math.round((uy / 12) * 100) / 100)} a month, paid once a year. No Indian GST.`;
      } else if (!yearly) {
        price = rupee(m);
        per = `a month${plusGst}`;
        incl = gstRate ? `${rupee(m)} a month + GST · ${rupee(m * gst)} incl GST` : "";
        was = w > 0 ? rupee(w) : "";
      } else {
        price = rupee(y);
        per = `a year${plusGst}`;
        incl = gstRate ? `${rupee(y)} a year + GST (${rupee(y * gst)} incl GST)` : "";
        sub =
          Math.abs(y - m * 12) < 0.5
            ? `12 × ${rupee(m)} a month${w > 0 ? ` (was ${rupee(w)})` : ""}, paid once a year.`
            : `${rupee(y / 12)} a month, paid once a year. Saves ${Math.round((1 - y / (m * 12)) * 100)}% on 12 months.`;
      }
      const extra = PLAN_EXTRAS[p.code];
      return {
        key: p.code,
        name: p.name,
        tag: p.tagline,
        points: extra?.points ?? [],
        fits: p.code === fitsCode,
        price,
        per,
        incl,
        sub,
        was,
        custom: false,
        limit: `Up to ${p.max_devices} PCs · ${hist(extra?.historyDays ?? 0)} of history`,
        cta: p.is_free ? "Start free" : `Choose ${p.name}`,
      };
    }),
    {
      key: "custom",
      name: CUSTOM_PLAN.name,
      tag: CUSTOM_PLAN.tag,
      points: CUSTOM_PLAN.points,
      fits: false,
      price: "Talk to us",
      per: "",
      incl: "",
      sub: "We quote for the PCs you have.",
      was: "",
      custom: true,
      limit: "50+ PCs · history to suit you",
      cta: "Talk to us",
    },
  ];

  const pvNote = abroad
    ? "Dollars, no Indian GST."
    : yearly
      ? "Yearly: the price before GST, then the incl-GST total."
      : "Monthly: was price crossed out, price before GST, then the incl-GST total.";
  const payNote = abroad
    ? "Outside India you pay in US dollars, monthly or yearly, by card or US bank transfer. No Indian GST. Nothing is charged automatically."
    : "In India you pay in rupees plus 18% GST, monthly or yearly, by UPI or bank transfer, and get a GST invoice every time. Yearly costs the same as 12 months, paid at once. Nothing is charged automatically.";

  return (
    <section className="card zp-preview" aria-labelledby="pv-h">
      <div className="zp-preview__head">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h2 id="pv-h" style={{ margin: 0, fontSize: 18 }}>
            Plans page preview
          </h2>
          <span className="k">Built from the same plan model as zinwe.io/plans, with the prices above, saved or not.</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <div role="group" aria-label="Visitor from" className="zp-psegs">
            {(
              [
                ["IN", "India · ₹"],
                ["AB", "USA and elsewhere · $"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className={"zp-pseg" + (region === k ? " on" : "")} aria-pressed={region === k} onClick={() => setRegion(k)}>
                {label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="How often you pay" className="zp-psegs">
            {(["Monthly", "Yearly"] as const).map((c) => (
              <button key={c} type="button" className={"zp-pseg" + (cycle === c ? " on" : "")} aria-pressed={cycle === c} onClick={() => setCycle(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
      <figure aria-label="Preview of the public Plans page" className="zp-fig">
        <div className="zp-fig__top">
          <span className="mono">zinwe.io/plans · for a visitor with {PREVIEW_VISITOR_PCS} PCs</span>
          <span>{pvNote}</span>
        </div>
        <div className="zp-pcards">
          {cards.map((c) => (
            <div key={c.key} className={"zp-pcard" + (c.fits ? " fits" : "")}>
              {c.fits ? <span className="zp-fits">Fits {PREVIEW_VISITOR_PCS} PCs</span> : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div className="zp-pcard__name">
                  <b>{c.name}</b>
                </div>
                <span className="zp-muted">{c.tag}</span>
              </div>
              <div className="zp-price">
                {c.was ? (
                  <s className="num">
                    <span className="sr">was </span>
                    {c.was}
                  </s>
                ) : null}
                <b className={"num" + (c.custom ? " sm" : "")}>{c.price}</b>
                <span className="zp-muted">{c.per}</span>
              </div>
              {c.incl ? <span className="num zp-incl">{c.incl}</span> : null}
              {c.sub ? <span className="num zp-psub">{c.sub}</span> : null}
              <span className="zp-limit">{c.limit}</span>
              <ul className="zp-points">
                {c.points.map((pt) => (
                  <li key={pt}>{pt}</li>
                ))}
              </ul>
              <span aria-hidden="true" className={"zp-cta" + (c.fits ? " fits" : "")}>
                {c.cta}
              </span>
            </div>
          ))}
        </div>
        <span className="zp-paynote">{payNote}</span>
      </figure>
      <span className="k" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <SampleTag what="Sample: history days and card points" /> The bullet points and history lengths come from sample data until the plan
        model serves them.
      </span>
    </section>
  );
}

/* ------------------------------------------------------------------ special-price offers */

interface Customer {
  id: number;
  email: string;
  co: string;
  meta: string;
  cc: string;
  cur: "INR" | "USD";
  cycle: "monthly" | "yearly";
}

function customerOf(s: AdminSubscription): Customer {
  const plan = s.plan.name;
  let meta: string;
  if (s.amount_due === null) meta = plan;
  else if (s.is_trial) meta = `${plan} · trial${s.days_left !== null ? `, ${s.days_left} days left` : ""}`;
  else if (s.status === "expired") meta = `${plan} · expired${s.ends_at ? ` ${istDate(s.ends_at).slice(0, -5)}` : ""}`;
  else if (s.status === "pending_payment") meta = `${plan} · waiting for payment`;
  else meta = `${plan} · ${s.billing_cycle}`;
  const country = s.company?.country ?? "";
  return {
    id: s.owner.id,
    email: s.owner.email,
    co: s.company?.name || s.owner.name || s.owner.email,
    meta,
    cc: s.region === "IN" ? "IN" : country.slice(0, 2).toUpperCase() || "—",
    cur: s.currency,
    cycle: s.billing_cycle,
  };
}

function Offers({
  state,
  plans,
  onSay,
}: {
  state: ReturnType<typeof useLoad<[Announcement[], AdminSubscription[]]>>;
  plans: PlanPricing[];
  onSay: (text: string) => void;
}): ReactElement {
  const [pickQ, setPickQ] = useState("");
  const [pick, setPick] = useState<number[]>([]);
  const [oPlan, setOPlan] = useState("teams");
  const [oType, setOType] = useState<"pct" | "fixed">("pct");
  const [oVal, setOVal] = useState("");
  const [oUntil, setOUntil] = useState(() => {
    const d = new Date(Date.now() + 30 * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  const [oMsg, setOMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [apiErr, setApiErr] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  const [removing, setRemoving] = useState<Announcement | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const customers = useMemo(() => {
    const seen = new Set<number>();
    return (state.data?.[1] ?? [])
      .map(customerOf)
      .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
      .sort((a, b) => a.co.localeCompare(b.co));
  }, [state.data]);
  const byEmail = useMemo(() => new Map(customers.map((c) => [c.email.toLowerCase(), c])), [customers]);
  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const planBy = useMemo(() => new Map(plans.map((p) => [p.code, p])), [plans]);
  const plan = planBy.get(oPlan) ?? plans[0];

  const pq = pickQ.trim().toLowerCase();
  const list = customers.filter((c) => !pq || `${c.co} ${c.meta} ${c.email}`.toLowerCase().includes(pq));
  const picked = pick.map((id) => byId.get(id)).filter((c): c is Customer => Boolean(c));
  const abroad = picked.filter((c) => c.cur !== "INR");
  const cycles = [...new Set(picked.map((c) => c.cycle))];
  // The offer price is for one cycle of the customer's own plan (z_payments.offer_quote), so the cycle follows them.
  const oCycle: "monthly" | "yearly" = cycles.length === 1 ? cycles[0] : "monthly";
  const lp = plan ? (oCycle === "monthly" ? Number(plan.regions.INR.monthly.price) : Number(plan.regions.INR.yearly.price)) : 0;
  const v = num(oVal);
  let oErr = "";
  if (abroad.length) oErr = `Offers are in rupees: ${abroad.map((c) => c.co).join(", ")} ${abroad.length === 1 ? "pays" : "pay"} in dollars, so make them a separate deal.`;
  else if (cycles.length > 1) oErr = "The picked customers pay on different cycles (monthly and yearly). Make one offer per cycle.";
  else if (oVal && !(v > 0)) oErr = "Type a number.";
  else if (oType === "pct" && v >= 90) oErr = "Keep the discount below 90%.";
  else if (oType === "fixed" && v > 0 && v >= lp) oErr = `The offer price must be below the list price of ${money(lp, "INR")}.`;
  else if (oUntil && oUntil <= today) oErr = "Valid until must be after today.";
  const np = oType === "pct" ? Math.round((lp * (100 - v)) / 100) : v;
  let oLine = `Pick customers and type the ${oType === "pct" ? "discount" : "price"} to see what they pay.`;
  const ok = v > 0 && !oErr && plan;
  if (ok) {
    oLine = `${plan.name} ${oCycle}: ${money(lp, "INR")} → ${money(np, "INR")} + GST = ${money(Math.round(np * 118) / 100, "INR")} · ${Math.round((1 - np / lp) * 100)}% off`;
  }
  const ready = pick.length > 0 && ok && oUntil && oMsg.trim() && np >= 1;

  const reset = () => {
    setPick([]);
    setPickQ("");
    setOVal("");
    setOMsg("");
    setOType("pct");
    setOPlan("teams");
    setApiErr("");
  };

  const create = async () => {
    if (!ready || !plan) return;
    setBusy(true);
    setApiErr("");
    try {
      await createAnnouncement({
        title: oMsg.trim(),
        body: "",
        kind: "offer",
        placement: "dashboard",
        audience: "owners",
        plan_codes: [],
        owner_emails: picked.map((c) => c.email),
        cta_label: "",
        cta_href: "",
        offer_plan: plan.code,
        offer_price_inr: np.toFixed(2),
        starts_at: new Date().toISOString(),
        ends_at: `${oUntil}T23:59:59+05:30`,
        is_active: true,
        dismissible: true,
        priority: 0,
      });
      onSay(
        `Offer created. ${picked.length === 1 ? `${picked[0].co} sees` : `${picked.length} customers see`} it in their announcement bar until ${istDate(`${oUntil}T12:00:00+05:30`)}.`,
      );
      reset();
      state.reload();
    } catch (e) {
      setApiErr(e instanceof Error ? e.message : "Couldn’t create the offer.");
    } finally {
      setBusy(false);
    }
  };

  const offers = (state.data?.[0] ?? []).filter((a) => a.offer_plan);
  const rows = offers
    .map((a) => {
      const ended = a.status === "ended" || a.status === "off";
      const left = a.ends_at ? Math.ceil((new Date(a.ends_at).getTime() - Date.now()) / 86_400_000) : null;
      let st: string;
      let tone: string;
      if (a.status === "ended") {
        st = a.ends_at ? `Ended ${istDate(a.ends_at).slice(0, -5)}` : "Ended";
        tone = "muted";
      } else if (a.status === "off") {
        st = "Switched off";
        tone = "muted";
      } else if (a.status === "scheduled") {
        st = `Starts ${istDate(a.starts_at).slice(0, -5)}`;
        tone = "info";
      } else if (left !== null && left <= 3) {
        st = left <= 0 ? "Ends today" : `Ends in ${left} days`;
        tone = "warn";
      } else {
        st = a.offer_uses ? `Active · used ${a.offer_uses} ${a.offer_uses === 1 ? "time" : "times"}` : "Active · not used yet";
        tone = "good";
      }
      const names = a.owner_emails.map((e) => byEmail.get(e.toLowerCase())?.co ?? e);
      const op = a.offer_plan ? planBy.get(a.offer_plan) : undefined;
      const from = op ? Number(op.regions.INR.monthly.price) : 0;
      const to = Number(a.offer_price_inr ?? 0);
      return { a, ended, st, tone, names, op, from, to };
    })
    .filter((r) => showEnded || !r.ended);

  const remove = async (a: Announcement) => {
    await deleteAnnouncement(a.id);
    const names = a.owner_emails.map((e) => byEmail.get(e.toLowerCase())?.co ?? e);
    onSay(`Offer removed. ${names.join(", ")} ${names.length === 1 ? "no longer sees it." : "no longer see it."}`);
    state.reload();
  };

  return (
    <section aria-labelledby="of-h" className="zp-sec">
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h2 id="of-h">Special-price offers</h2>
        <span style={{ color: "var(--ink-3)" }}>
          A lower price for chosen customers only. They see your message in the announcement bar of their dashboard and get the price at
          checkout until the offer ends.
        </span>
      </div>

      {state.error ? (
        <ErrorState title="Offers couldn’t load" message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <LoadingState rows={4} />
      ) : (
        <>
          <div className="card zp-offer">
            <div>
              <h3>1. Customers</h3>
              <label className="sr" htmlFor="pq">
                Find customers
              </label>
              <input id="pq" type="search" className="inp" placeholder="Find by company or email" value={pickQ} onChange={(e) => setPickQ(e.target.value)} />
              <div className="zp-pick">
                {list.map((c) => {
                  const on = pick.includes(c.id);
                  return (
                    <label key={c.id}>
                      <input type="checkbox" checked={on} onChange={() => setPick((cur) => (on ? cur.filter((x) => x !== c.id) : [...cur, c.id]))} />
                      <span>
                        <b>{c.co}</b>
                        <span className="k">{c.meta}</span>
                      </span>
                      <span className="mono k" style={{ fontWeight: 600 }}>
                        {c.cc}
                      </span>
                    </label>
                  );
                })}
                {list.length === 0 ? <p style={{ margin: 0, padding: 14, color: "var(--ink-3)" }}>No customer matches.</p> : null}
              </div>
              <div className="zp-picked">
                <span className="k">{pick.length ? `${pick.length} picked:` : "Nobody picked yet."}</span>
                {picked.map((c) => (
                  <span key={c.id} className="pill">
                    {c.co}
                    <button type="button" aria-label={`Remove ${c.co}`} onClick={() => setPick((cur) => cur.filter((x) => x !== c.id))}>
                      <Icon name="close" size={12} strokeWidth={2.4} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <h3>2. Offer</h3>
              <div className="zp-grid2">
                <label className="zp-fl">
                  Plan
                  <select className="inp" value={oPlan} onChange={(e) => setOPlan(e.target.value)}>
                    {plans.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="zp-fl" title="The offer price is for one cycle of the customer’s own plan">
                  Billing
                  <select className="inp" value={oCycle} disabled aria-describedby="of-cycle">
                    <option value="monthly">Monthly (India only)</option>
                    <option value="yearly">Yearly</option>
                  </select>
                  <span id="of-cycle" className="k">
                    {pick.length ? "Follows the picked customers’ billing" : "Follows the customers you pick"}
                  </span>
                </label>
              </div>
              <div className="zp-ovals">
                <div className="seg" role="group" aria-label="Offer type">
                  {(
                    [
                      ["pct", "% off"],
                      ["fixed", "Fixed price"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={oType === k ? "on" : ""}
                      aria-pressed={oType === k}
                      onClick={() => {
                        setOType(k);
                        setOVal("");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="zp-fl" style={{ flex: "1 1 140px" }}>
                  {oType === "pct" ? "Discount, %" : "Offer price, ₹ before GST"}
                  <input
                    className="inp num"
                    inputMode="decimal"
                    placeholder={oType === "pct" ? "e.g. 20" : "e.g. 1499"}
                    value={oVal}
                    onChange={(e) => setOVal(e.target.value)}
                  />
                </label>
              </div>
              <p className={"zp-oline" + (ok ? " ok" : "")}>{oLine}</p>
              <label className="zp-fl">
                Valid until
                <input className="inp" type="date" min={today} value={oUntil} onChange={(e) => setOUntil(e.target.value)} />
              </label>
              <label className="zp-fl">
                <span>
                  Message in their announcement bar{" "}
                  <span className="k num">
                    {oMsg.length} of 120
                  </span>
                </span>
                <textarea
                  className="zp-txt"
                  maxLength={120}
                  placeholder="e.g. Teams at 20% off for you until 30 Nov. Pick it on the Billing page."
                  value={oMsg}
                  onChange={(e) => setOMsg(e.target.value)}
                />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="k">Their dashboard will show</span>
                <div className="zp-bar">
                  <span style={oMsg.trim() ? { fontWeight: 500 } : { color: "var(--mute)" }}>{oMsg.trim() || "Your message appears here."}</span>
                  <span className="zp-bar__see">See offer</span>
                </div>
              </div>
              {oErr || apiErr ? (
                <p role="alert" className="zp-err">
                  {oErr || apiErr}
                </p>
              ) : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn" onClick={reset}>
                  Clear
                </button>
                <button type="button" className="btn dark" disabled={!ready || busy} onClick={() => void create()}>
                  {busy ? "Creating…" : pick.length > 1 ? `Create offer for ${pick.length} customers` : "Create offer"}
                </button>
              </div>
            </div>
          </div>

          <div className="card zp-offers">
            <div className="zp-offers__head">
              <h3>Offers</h3>
              <label className="ck" style={{ minHeight: 32, gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={showEnded} onChange={() => setShowEnded((x) => !x)} /> Show ended offers
              </label>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 1000 }}>
                <div className="zp-og zp-og--head k" aria-hidden="true">
                  <span>Customers</span>
                  <span>Plan</span>
                  <span>Offer</span>
                  <span>Valid until</span>
                  <span>Status</span>
                  <span>Message</span>
                  <span />
                </div>
                {rows.length === 0 ? (
                  <p style={{ margin: 0, padding: "28px 16px", textAlign: "center", color: "var(--ink-3)" }}>No offers running. Create one above.</p>
                ) : null}
                {rows.map(({ a, st, tone, names, op, from, to }) => (
                  <div key={a.id} className="zp-og zp-og--row">
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <b>{names.length > 2 ? `${names[0]} and ${names.length - 1} more` : names.join(", ") || "—"}</b>
                      <span className="k">
                        {names.length} {names.length === 1 ? "customer" : "customers"} · made {istDate(a.created_at).slice(0, -5)}
                      </span>
                    </span>
                    <span>{op?.name ?? a.offer_plan}</span>
                    <span className="num">
                      {from > to ? <span style={{ textDecoration: "line-through", color: "var(--mute)" }}>{money(from, "INR")}</span> : null}{" "}
                      <b>{money(to, "INR")} + GST</b>
                      <span className="k" style={{ display: "block" }}>
                        {from > to ? `${Math.round((1 - to / from) * 100)}% off a month` : "Fixed price"} · one cycle
                      </span>
                    </span>
                    <span className="num">{a.ends_at ? istDate(a.ends_at) : "No end"}</span>
                    <span>
                      <span className={`pill ${tone}`}>
                        <span className="dot" />
                        {st}
                      </span>
                    </span>
                    <span className="k zp-og__msg">{a.title}</span>
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Remove offer for ${names.join(", ")}`}
                      onClick={() => setRemoving(a)}
                      style={{ width: 40, minHeight: 40, padding: 0 }}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <span className="k">
            Offers are dashboard announcements with a special price. Edit their wording, dates or audience in{" "}
            <Link to="/announcements">Announcements</Link>.
          </span>
        </>
      )}

      {removing ? (
        <ConfirmDialog
          title="Remove this offer?"
          confirmLabel="Remove offer"
          danger
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        >
          <p>
            {removing.owner_emails.map((e) => byEmail.get(e.toLowerCase())?.co ?? e).join(", ")} stop seeing it at once and can’t use the price
            any more. This can’t be undone; you can make a new offer.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
