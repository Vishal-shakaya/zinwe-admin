import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { getPlans, getSubscribers, type Subscriber } from "../lib/api";
import { methodLabel, money, titleCase } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import { countryOf } from "../content/fixtures/subscribers";
import { CustomerDrawer, type DrawerTab } from "./subscribers/CustomerDrawer";
import { EmailComposer } from "./subscribers/EmailComposer";
import {
  FILTERS,
  SORTS,
  ago,
  chipOf,
  companyName,
  cur,
  dLong,
  dSent,
  dShort,
  dueOf,
  isPaying,
  matchesCountry,
  matchesQuery,
  pcsUsed,
  pendingPayments,
  type CountryKey,
  type FilterKey,
  type SortKey,
} from "./subscribers/model";
import "../styles/subscribers.css";

const COUNTRIES: [CountryKey, string][] = [
  ["all", "All countries"],
  ["in", "India"],
  ["abroad", "Abroad"],
];

function untilText(r: Subscriber): { text: string; bad: boolean } {
  const sub = r.subscription;
  if (!sub) return { text: "—", bad: false };
  if (sub.is_trial && sub.ends_at) return { text: `Trial to ${dShort(sub.ends_at)}`, bad: false };
  if (!sub.ends_at) return { text: "No end date", bad: false };
  return { text: dLong(sub.ends_at), bad: sub.status === "expired" || new Date(sub.ends_at).getTime() < Date.now() };
}

function industryLabel(s: string): string {
  return titleCase(s.replace(/_/g, " ")).replace(/^It/, "IT");
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: Subscriber[]): string {
  const head = ["Company", "Owner", "Email", "Plan", "PCs used", "PC limit", "Country", "Paid until", "Status", "Last seen", "Joined"];
  const lines = rows.map((r) => {
    const u = pcsUsed(r);
    return [
      companyName(r),
      r.full_name,
      r.email,
      r.plan?.name ?? "",
      u.used,
      u.limit,
      countryOf(r).name,
      r.subscription?.ends_at ? r.subscription.ends_at.slice(0, 10) : "",
      chipOf(r).label,
      r.last_login ? r.last_login.slice(0, 16).replace("T", " ") : "",
      r.date_joined.slice(0, 10),
    ]
      .map(csvCell)
      .join(",");
  });
  return [head.join(","), ...lines].join("\n");
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Subscribers (AdminSubscribers board): every customer, their plan, PCs and payments. A paid plan turns on only
 * when its payment is approved in the customer panel. Deep links: `?review=<payment id>` (staff email, Dashboard),
 * `?open=<customer id>` (Support, Feedback, Subscriptions), `?compose=<customer id>` (Feedback "Email them"),
 * `?status=waiting|paying|free|trial|renewal|rejected|blocked`.
 */
export function SubscribersPage(): ReactElement {
  const loadSubs = useCallback(() => getSubscribers(), []);
  const loadPlans = useCallback(() => getPlans(), []);
  const subs = useLoad(loadSubs);
  const plans = useLoad(loadPlans);
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState<CountryKey>("all");
  const [sort, setSort] = useState<SortKey>("seen");
  const [open, setOpen] = useState<{ id: number; tab?: DrawerTab } | null>(null);
  const [compose, setCompose] = useState<{ id: number; template?: string } | null>(null);
  const [emailsVersion, setEmailsVersion] = useState(0);

  const filter: FilterKey = FILTERS.some((f) => f.key === params.get("status")) ? (params.get("status") as FilterKey) : "all";
  const setFilter = (key: FilterKey) => {
    const next = new URLSearchParams(params);
    if (key === "all") next.delete("status");
    else next.set("status", key);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => subs.data ?? [], [subs.data]);
  const onUpdated = (row: Subscriber) => subs.setData(rows.map((r) => (r.id === row.id ? row : r)));
  const onDeleted = (id: number) => subs.setData(rows.filter((r) => r.id !== id));

  // Deep links (kept from before the redesign).
  const review = params.get("review");
  const openParam = params.get("open");
  const composeParam = params.get("compose");
  useEffect(() => {
    if ((!review && !openParam && !composeParam) || !subs.data) return;
    const paymentId = Number(review);
    const found = review
      ? subs.data.find((r) => r.payments.some((p) => p.id === paymentId))
      : subs.data.find((r) => r.id === Number(openParam ?? composeParam));
    if (found && composeParam) setCompose({ id: found.id });
    else if (found) setOpen({ id: found.id, tab: review ? "payments" : undefined });
    else {
      toast(
        review ? `Payment #${review} isn't here any more (the customer may have been deleted).` : "That customer isn't here any more.",
        "bad",
      );
    }
    const next = new URLSearchParams(params);
    next.delete("review");
    next.delete("open");
    next.delete("compose");
    setParams(next, { replace: true });
  }, [review, openParam, composeParam, subs.data, params, setParams, toast]);

  const q = query.trim().toLowerCase();
  const base = useMemo(() => rows.filter((r) => matchesCountry(r, country) && matchesQuery(r, q)), [rows, country, q]);
  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return base.filter(test).sort(SORTS[sort]);
  }, [base, filter, sort]);

  const paying = rows.filter(isPaying).length;
  const total = rows.length;
  const free = rows.filter((r) => !isPaying(r)).length;
  const checks = rows.flatMap((r) => pendingPayments(r).map((p) => ({ r, p })));
  const openRow = open ? (rows.find((r) => r.id === open.id) ?? null) : null;
  const composeRow = compose ? (rows.find((r) => r.id === compose.id) ?? null) : null;
  const whole = !q && country === "all";

  const clearAll = () => {
    setQuery("");
    setCountry("all");
    setFilter("all");
  };

  const doExport = () => {
    const day = new Date().toISOString().slice(0, 10);
    download(`zinwe-subscribers-${day}.csv`, exportCsv(shown));
    toast(`Exported ${shown.length} customer${shown.length === 1 ? "" : "s"} to zinwe-subscribers-${day}.csv`);
  };

  return (
    <>
      <PageHeader
        title="Subscribers"
        subtitle="Customer accounts, their plans and payments. A paid plan turns on only when you approve its payment."
      >
        {subs.data ? (
          <span className="k num">
            {total} customer{total === 1 ? "" : "s"} · {paying} paying · {free} free
          </span>
        ) : null}
        <button type="button" className="btn" onClick={doExport} disabled={!subs.data}>
          <Icon name="download" />
          Export CSV
        </button>
      </PageHeader>

      {checks.length ? (
        <section aria-labelledby="chk-h" className="sb-checks">
          <div className="sb-checks__head">
            <div className="sb-checks__title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7A4D00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 10h18M7 15h4" />
              </svg>
              <h2 id="chk-h">{checks.length === 1 ? "1 payment to check" : `${checks.length} payments to check`}</h2>
              <span className="k">Plans stay off until you approve.</span>
            </div>
            <button type="button" className="btn sm" onClick={() => {
              setQuery("");
              setCountry("all");
              setFilter("waiting");
            }}>
              Show only these
            </button>
          </div>
          <div className="sb-checks__list">
            {checks.map(({ r, p }) => (
              <div key={p.id} className="sb-chk">
                <b className="sb-chk__co">{companyName(r)}</b>
                <span className="num sb-chk__amt">{money(dueOf(p), cur(p))}</span>
                <span className="k">
                  {methodLabel(p.method)} · {p.plan.name} {p.is_renewal ? "renewal" : "first payment"} · sent {dSent(p.submitted_at)}
                </span>
                {p.duplicate_of ? (
                  <span className="pill warn">
                    {p.duplicate_of.match === "receipt" ? "Same receipt seen before" : "Same UTR seen before"}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn sm dark sb-chk__go"
                  aria-label={`Check payment from ${companyName(r)}`}
                  onClick={() => setOpen({ id: r.id, tab: "payments" })}
                >
                  Check payment
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card sb-find" aria-label="Find customers">
        <div className="sb-find__row">
          <div className="sb-search">
            <label className="sr" htmlFor="sb-q">
              Search customers
            </label>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5E6167" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4 4" />
            </svg>
            <input
              id="sb-q"
              type="search"
              className="inp"
              placeholder="Search company, owner, email or city"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="seg" role="group" aria-label="Country">
            {COUNTRIES.map(([k, label]) => (
              <button key={k} type="button" className={country === k ? "on" : ""} aria-pressed={country === k} onClick={() => setCountry(k)}>
                {label}
              </button>
            ))}
          </div>
          <label className="sr" htmlFor="sb-sort">
            Sort by
          </label>
          <select id="sb-sort" className="inp sb-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="seen">Last seen first</option>
            <option value="joined">Newest sign-ups</option>
            <option value="until">Paid until, soonest</option>
            <option value="pcs">Most PCs used</option>
            <option value="name">Company A–Z</option>
          </select>
        </div>
        <div className="sb-find__row sb-find__row--chips">
          <div role="group" aria-label="Show" className="sb-chips">
            {FILTERS.map((f) => {
              const n = base.filter(f.test).length;
              if (f.key === "rejected" && n === 0 && filter !== "rejected") return null;
              return (
                <button
                  key={f.key}
                  type="button"
                  className={"chip" + (filter === f.key ? " on" : "")}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="num sb-chip-n">{subs.data ? n : "…"}</span>
                </button>
              );
            })}
          </div>
          <span className="k num sb-shown">
            {subs.data ? (whole ? `${shown.length} shown` : `${shown.length} of ${total} shown`) : ""}
          </span>
        </div>
      </section>

      {subs.error ? (
        <ErrorState message={subs.error} onRetry={subs.reload} title="The customer list couldn’t load" />
      ) : !subs.data ? (
        <LoadingState rows={8} label="Loading customers…" />
      ) : total === 0 ? (
        <div className="card">
          <EmptyState
            center
            icon="subscribers"
            title="No customers yet"
            body="Companies that sign up on zinwe.io show up here, with their plan, PCs and payments."
          />
        </div>
      ) : (
        <section className="card sb-table" aria-label="Customers">
          <div className="sb-table__scroll">
            <table className="sb-tbl">
              <caption className="sr">Customers · {shown.length} shown</caption>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Plan</th>
                  <th scope="col">PCs used</th>
                  <th scope="col">Country</th>
                  <th scope="col">Paid until</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const c = chipOf(r);
                  const u = pcsUsed(r);
                  const until = untilText(r);
                  const ctry = countryOf(r);
                  const co = companyName(r);
                  return (
                    <tr key={r.id} className={open?.id === r.id ? "sel" : ""} onClick={() => setOpen({ id: r.id })}>
                      <th scope="row">
                        <button
                          type="button"
                          className="sb-cobtn"
                          aria-label={`${co}, ${c.label}. Open details`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen({ id: r.id });
                          }}
                        >
                          {co}
                        </button>
                        <span className="k sb-ell">
                          {[r.company?.industry ? industryLabel(r.company.industry) : "No company yet", r.company?.city]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </th>
                      <td className="sb-owner">
                        <span className="sb-ell sb-owner__name">{r.full_name || "Unnamed"}</span>
                        <span className="k sb-ell">{r.email}</span>
                      </td>
                      <td className="sb-plan">{r.plan?.name ?? "—"}</td>
                      <td className="sb-pcs-cell">
                        <span className={"num " + (u.full ? "sb-pcs-full" : "sb-pcs-n")}>
                          {u.limit ? `${u.used} of ${u.limit}` : `${u.used} PCs`}
                          {u.full ? " · full" : ""}
                        </span>
                        <span className="bar sb-bar">
                          <span style={{ width: `${u.pct}%`, background: u.full ? "#A3260F" : undefined }} />
                        </span>
                      </td>
                      <td className="sb-ctry">
                        <span className="mono sb-cc">{ctry.cc}</span> {ctry.name}
                      </td>
                      <td className={"num sb-until" + (until.bad ? " is-bad" : "")}>{until.text}</td>
                      <td>
                        <span className={`pill ${c.tone}`}>
                          <span className="dot" />
                          {c.label}
                        </span>
                      </td>
                      <td className="k sb-seen">{ago(r.last_login)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones: one card per customer, a payment to check first. */}
          <ul className="sb-cards" aria-label="Customers">
            {shown.map((r) => {
              const c = chipOf(r);
              const u = pcsUsed(r);
              const pend = pendingPayments(r)[0];
              const co = companyName(r);
              return (
                <li key={r.id} className="sb-card">
                  {pend ? (
                    <button type="button" className="btn dark sb-card__review" onClick={() => setOpen({ id: r.id, tab: "payments" })}>
                      Check payment · {money(dueOf(pend), cur(pend))}
                    </button>
                  ) : null}
                  <button type="button" className="sb-card__main" onClick={() => setOpen({ id: r.id })} aria-label={`${co}, ${c.label}. Open details`}>
                    <span className="sb-card__top">
                      <b>{co}</b>
                      <span className={`pill ${c.tone}`}>
                        <span className="dot" />
                        {c.label}
                      </span>
                    </span>
                    <span className="k sb-ell">
                      {r.full_name || "Unnamed"} · {r.email}
                    </span>
                    <span className="sb-card__meta">
                      <span>{r.plan?.name ?? "No plan"}</span>
                      <span className="num">
                        {u.limit ? `${u.used} of ${u.limit} PCs` : `${u.used} PCs`}
                      </span>
                      <span className="num">{untilText(r).text}</span>
                    </span>
                    <span className="k">Last seen {ago(r.last_login).toLowerCase()}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {shown.length === 0 ? (
            <div className="sb-empty">
              <b>{q ? `No customers match "${query.trim()}"` : "No customers in this view"}</b>
              <span>Try the company name, the owner's name or email, or a city.</span>
              <button type="button" className="btn" onClick={clearAll}>
                Clear search and filters
              </button>
            </div>
          ) : null}
        </section>
      )}

      {subs.data ? (
        <>
          <p className="k sb-foot">
            Paying: on a paid plan with a current payment ({paying}). Free: everyone else, on Free forever, a trial or a
            lapsed plan ({free}).
          </p>
          <p className="k sb-foot">
            Payment to check: the customer paid by UPI, bank transfer or Skydo and uploaded a receipt. Razorpay payments
            turn plans on by themselves.
          </p>
        </>
      ) : null}

      {openRow ? (
        <CustomerDrawer
          key={openRow.id}
          row={openRow}
          plans={plans.data ?? []}
          initialTab={open?.tab}
          emailsVersion={emailsVersion}
          onClose={() => setOpen(null)}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
          onEmail={(template) => setCompose({ id: openRow.id, template })}
        />
      ) : null}
      {composeRow ? (
        <EmailComposer
          key={`${composeRow.id}-${compose?.template ?? ""}`}
          row={composeRow}
          initialTemplate={compose?.template}
          onClose={() => setCompose(null)}
          onSent={() => setEmailsVersion((v) => v + 1)}
        />
      ) : null}
    </>
  );
}
