import { useCallback, useMemo, useState, type ReactElement } from "react";
import {
  getPricing,
  updatePricing,
  type PlanPricing,
  type PricingCurrency,
  type RegionPriceInput,
  type RegionPricing,
} from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";

const REGIONS: ReadonlyArray<{ currency: PricingCurrency; name: string; symbol: string }> = [
  { currency: "INR", name: "India", symbol: "₹" },
  { currency: "USD", name: "International", symbol: "$" },
];

/** Yearly shortcuts: a year costs this many monthly payments (12 = no yearly discount). */
const YEAR_MONTHS = [12, 11, 10, 9] as const;

function money(value: number, currency: PricingCurrency): string {
  const n = Number.isFinite(value) ? value : 0;
  return currency === "INR"
    ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** The list price minus the discount, rounded to a whole rupee / dollar (as the server does). */
function discounted(list: number, pct: number): number {
  return Math.round((list * (100 - pct)) / 100);
}

interface Draft {
  list: string;
  pct: string;
  /** The whole year; "" = 12 x the monthly price. */
  yearly: string;
}

function draftOf(region: RegionPricing): Draft {
  return {
    list: String(Number(region.monthly.list)),
    pct: String(region.monthly.discount_percent),
    yearly: region.yearly.custom ? String(Number(region.yearly.price)) : "",
  };
}

interface Computed {
  list: number;
  pct: number;
  month: number;
  year: number;
  yearList: number;
  saving: number;
  error: string | null;
}

function compute(d: Draft, currency: PricingCurrency): Computed {
  const list = Number(d.list);
  const pct = Number(d.pct);
  const month = Number.isFinite(list) && Number.isFinite(pct) ? discounted(list, pct) : 0;
  const yearInput = d.yearly.trim() === "" ? null : Number(d.yearly);
  const year = yearInput ?? month * 12;
  let error: string | null = null;
  if (d.list.trim() === "" || !Number.isFinite(list) || list < 0) error = "Enter the monthly list price.";
  else if (currency === "INR" && list <= 0) error = "A paid plan needs a price in rupees.";
  else if (!Number.isInteger(pct) || pct < 0 || pct > 90) error = "The discount is a whole number from 0 to 90.";
  else if (yearInput !== null && (!Number.isFinite(yearInput) || yearInput < 1)) error = "Enter the yearly price, or leave it empty.";
  else if (yearInput !== null && month > 0 && yearInput > month * 12) error = "A year can't cost more than 12 months.";
  const saving = month > 0 && year < month * 12 ? Math.round((1 - year / (month * 12)) * 100) : 0;
  return { list, pct, month, year, yearList: list * 12, saving, error };
}

/**
 * Plans & pricing (2026-10-23): what each plan costs in India (₹, GST on top) and internationally ($), monthly and
 * yearly. A month is a list price and a discount; a year is its own price (empty = 12 months). Customers already
 * paying keep their price; changes apply to new payments, upgrades and changes of cycle.
 */
export function PricingPage(): ReactElement {
  const load = useCallback(() => getPricing(), []);
  const { data, error, pending, reload } = useLoad(load);
  const paying = data ? data.plans.reduce((n, p) => n + p.subscribers, 0) : 0;
  const bestSaving = data
    ? Math.max(0, ...data.plans.map((p) => Math.max(p.regions.INR.yearly.saving_percent, p.regions.USD.yearly.saving_percent)))
    : 0;

  return (
    <>
      <PageHeader
        title="Plans & pricing"
        subtitle="What each plan costs in India and internationally, billed monthly or yearly. Customers see it on the plans page and at checkout."
        onReload={reload}
        pending={pending}
      />
      {error ? (
        <p className="alert alert--bad">{error}</p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <section className="pr-kpis" aria-label="At a glance">
            <div className="pr-kpi">
              <span className="pr-kpi__label">Paying customers</span>
              <b className="pr-kpi__value">{paying}</b>
              <span className="pr-kpi__hint">keep their price until they change plan or cycle</span>
            </div>
            <div className="pr-kpi">
              <span className="pr-kpi__label">Best yearly saving</span>
              <b className="pr-kpi__value pr-kpi__value--good">{bestSaving}%</b>
              <span className="pr-kpi__hint">shown as "Save up to {bestSaving}%" on the plans page</span>
            </div>
            <div className="pr-kpi">
              <span className="pr-kpi__label">Tax</span>
              <b className="pr-kpi__value">{data.gst_rate ? `${data.gst_rate}% GST` : "No GST"}</b>
              <span className="pr-kpi__hint">added on top in India · none internationally</span>
            </div>
            <div className="pr-kpi pr-kpi--how">
              <span className="pr-kpi__label">How a price is made</span>
              <span className="pr-how">
                <i>List price</i> − <i>discount</i> = <b>monthly price</b>
              </span>
              <span className="pr-how">
                <b>Yearly</b> = one price for 12 months
              </span>
            </div>
          </section>
          <div className="pr-grid">
            {data.plans.map((plan) => (
              <PlanCard key={plan.code} plan={plan} gstRate={data.gst_rate} onRecommended={reload} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function PlanCard({
  plan: initial,
  gstRate,
  onRecommended,
}: {
  plan: PlanPricing;
  gstRate: number;
  onRecommended: () => void;
}): ReactElement {
  const toast = useToast();
  const [plan, setPlan] = useState(initial);
  const [drafts, setDrafts] = useState<Record<PricingCurrency, Draft>>(() => ({
    INR: draftOf(initial.regions.INR),
    USD: draftOf(initial.regions.USD),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = useMemo(() => ({ INR: draftOf(plan.regions.INR), USD: draftOf(plan.regions.USD) }), [plan]);
  const changed = (c: PricingCurrency) =>
    drafts[c].list !== saved[c].list || drafts[c].pct !== saved[c].pct || drafts[c].yearly !== saved[c].yearly;
  const dirty = changed("INR") || changed("USD");
  const computed = { INR: compute(drafts.INR, "INR"), USD: compute(drafts.USD, "USD") };
  const invalid = REGIONS.map((r) => computed[r.currency].error && changed(r.currency) ? `${r.name}: ${computed[r.currency].error}` : null).find(Boolean);

  const set = (c: PricingCurrency, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [c]: { ...d[c], ...patch } }));
    setError(null);
  };

  const save = async () => {
    if (!dirty || invalid) return;
    setSaving(true);
    setError(null);
    const body: Partial<Record<PricingCurrency, RegionPriceInput>> = {};
    for (const { currency } of REGIONS) {
      if (!changed(currency)) continue;
      const d = drafts[currency];
      body[currency] = {
        list_monthly: d.list,
        discount_percent: Number(d.pct),
        yearly_price: d.yearly.trim() === "" ? null : d.yearly.trim(),
      };
    }
    try {
      const next = await updatePricing(plan.code, body);
      setPlan(next);
      setDrafts({ INR: draftOf(next.regions.INR), USD: draftOf(next.regions.USD) });
      toast(`${plan.name}: prices saved. New payments use them now.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  const recommend = async () => {
    try {
      await updatePricing(plan.code, { is_recommended: true });
      toast(`${plan.name} is now the recommended plan.`);
      onRecommended();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save.", "bad");
    }
  };

  return (
    <article className={"pr-card" + (plan.is_recommended ? " is-rec" : "") + (dirty ? " is-dirty" : "")}>
      <header className="pr-card__head">
        <div>
          <h2 className="pr-card__name">
            {plan.name}
            {plan.is_recommended ? <span className="pr-rec">★ Recommended</span> : null}
          </h2>
          <p className="pr-card__tag">
            {plan.max_devices ? `Up to ${plan.max_devices} PCs` : "Any number of PCs"}
            {plan.tagline ? ` · ${plan.tagline}` : ""}
          </p>
        </div>
        <div className="pr-card__meta">
          <span className="pr-paying">
            <b>{plan.subscribers}</b> paying
          </span>
          {!plan.is_recommended && !plan.is_free ? (
            <button type="button" className="pr-link" onClick={() => void recommend()}>
              ☆ Make recommended
            </button>
          ) : null}
        </div>
      </header>

      {plan.is_free ? (
        <p className="pr-free">Free forever: no price to set. Up to {plan.max_devices} PCs.</p>
      ) : (
        <div className="pr-regions">
          {REGIONS.map((region) => (
            <RegionEditor
              key={region.currency}
              region={region}
              draft={drafts[region.currency]}
              computed={computed[region.currency]}
              gstRate={region.currency === "INR" ? gstRate : 0}
              changed={changed(region.currency)}
              onChange={(patch) => set(region.currency, patch)}
            />
          ))}
        </div>
      )}

      {plan.is_free ? null : (
        <footer className="pr-card__foot">
          <span className={"pr-state" + (invalid || error ? " is-bad" : dirty ? " is-dirty" : "")} role="status">
            {invalid ?? error ?? (dirty ? `Unsaved changes · ${plan.subscribers} paying customers keep their price` : "All saved")}
          </span>
          <div className="pr-card__actions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!dirty || saving}
              onClick={() => {
                setDrafts(saved);
                setError(null);
              }}
            >
              Reset
            </button>
            <button type="button" className="btn btn--primary" disabled={!dirty || Boolean(invalid) || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save prices"}
            </button>
          </div>
        </footer>
      )}
    </article>
  );
}

function RegionEditor({
  region,
  draft,
  computed: c,
  gstRate,
  changed,
  onChange,
}: {
  region: (typeof REGIONS)[number];
  draft: Draft;
  computed: Computed;
  gstRate: number;
  changed: boolean;
  onChange: (patch: Partial<Draft>) => void;
}): ReactElement {
  const cur = region.currency;
  const notSold = cur === "USD" && Number(draft.list) <= 0;
  const tax = gstRate ? ` + GST` : "";
  const yearlyMonths = c.month > 0 ? c.year / c.month : 12;
  const id = (name: string) => `pr-${cur}-${name}`;

  return (
    <section className={"pr-region" + (changed ? " is-changed" : "")} aria-label={region.name}>
      <h3 className="pr-region__head">
        <span className={`pr-flag pr-flag--${cur.toLowerCase()}`} aria-hidden="true">
          {region.symbol}
        </span>
        {region.name}
        <small>
          {region.symbol} {cur} · {gstRate ? `${gstRate}% GST on top` : "no GST"}
        </small>
      </h3>

      <div className="pr-row">
        <label className="pr-field" htmlFor={id("list")}>
          <span>List price / month</span>
          <span className="pr-input">
            <i>{region.symbol}</i>
            <input
              id={id("list")}
              inputMode="decimal"
              value={draft.list}
              onChange={(e) => onChange({ list: e.target.value.replace(/[^\d.]/g, "") })}
            />
          </span>
        </label>
        <label className="pr-field pr-field--pct" htmlFor={id("pct")}>
          <span>Discount</span>
          <span className="pr-input">
            <input
              id={id("pct")}
              inputMode="numeric"
              value={draft.pct}
              onChange={(e) => onChange({ pct: e.target.value.replace(/\D/g, "").slice(0, 2) })}
            />
            <i>%</i>
          </span>
        </label>
      </div>
      <input
        type="range"
        className="pr-slider"
        min={0}
        max={90}
        step={1}
        value={Number(draft.pct) || 0}
        onChange={(e) => onChange({ pct: e.target.value })}
        aria-label={`${region.name} discount`}
        style={{ ["--pct" as string]: `${((Number(draft.pct) || 0) / 90) * 100}%` }}
      />

      {notSold ? (
        <p className="pr-note">Not sold internationally: customers outside India see the rupee price.</p>
      ) : (
        <>
          <div className="pr-result">
            <span className="pr-result__label">Monthly</span>
            <span className="pr-result__price">
              {money(c.month, cur)}
              <small>/mo{tax}</small>
            </span>
            {c.pct > 0 && c.list > c.month ? (
              <span className="pr-result__was">
                <s>{money(c.list, cur)}</s>
                <span className="pr-off">{c.pct}% off</span>
              </span>
            ) : null}
          </div>

          <div className="pr-year">
            <div className="pr-year__head">
              <label htmlFor={id("year")}>Billed yearly</label>
              {c.saving > 0 ? <span className="pr-save">Save {c.saving}%</span> : <span className="pr-nosave">No yearly discount</span>}
            </div>
            <span className="pr-input pr-input--wide">
              <i>{region.symbol}</i>
              <input
                id={id("year")}
                inputMode="decimal"
                placeholder={`${c.month * 12} (12 months)`}
                value={draft.yearly}
                onChange={(e) => onChange({ yearly: e.target.value.replace(/[^\d.]/g, "") })}
              />
              <em>/ year</em>
            </span>
            <div className="pr-chips" role="group" aria-label="Yearly shortcuts">
              {YEAR_MONTHS.map((m) => {
                const on = Math.abs(yearlyMonths - m) < 0.01;
                return (
                  <button
                    key={m}
                    type="button"
                    className={"pr-chip" + (on ? " is-on" : "")}
                    onClick={() => onChange({ yearly: m === 12 ? "" : String(c.month * m) })}
                    disabled={c.month <= 0}
                  >
                    {m === 12 ? "12 months" : `${12 - m} month${12 - m === 1 ? "" : "s"} free`}
                  </button>
                );
              })}
            </div>
            <div className="pr-bars" aria-hidden="true">
              <div className="pr-bar">
                <span className="pr-bar__label">12 × monthly</span>
                <span className="pr-bar__track">
                  <span className="pr-bar__fill" style={{ width: "100%" }} />
                </span>
                <span className="pr-bar__value">{money(c.month * 12, cur)}</span>
              </div>
              <div className="pr-bar pr-bar--year">
                <span className="pr-bar__label">Yearly</span>
                <span className="pr-bar__track">
                  <span className="pr-bar__fill" style={{ width: `${c.month > 0 ? Math.min(100, (c.year / (c.month * 12)) * 100) : 100}%` }} />
                </span>
                <span className="pr-bar__value">{money(c.year, cur)}</span>
              </div>
            </div>
            <p className="pr-preview">
              Customers see{" "}
              <b>
                {money(Math.round(c.year / 12), cur)} a month, billed yearly ({money(c.year, cur)}
                {tax})
              </b>
            </p>
          </div>
        </>
      )}
    </section>
  );
}
