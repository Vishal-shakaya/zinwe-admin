import { useState, type ReactElement } from "react";
import type { DuplicatePayment, Payment, Subscriber } from "../../lib/api";
import { methodLabel, money } from "../../lib/format";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PaymentProof } from "../../components/PaymentProof";
import { Icon } from "../../components/icons";
import { STATEMENT_ACCOUNT } from "../../content/fixtures/subscribers";
import { companyName, cur, dLong, dSent, dueOf, firstName, isoDay, normRef, parseAmount } from "./model";

/** What staff fill in while checking one payment (board steps 1 and 2). */
export interface ReceiptCheck {
  amount: string;
  reference: string;
  found: boolean;
  on: string;
  seen: string;
}

export const EMPTY_CHECK: ReceiptCheck = { amount: "", reference: "", found: false, on: "", seen: "" };

type MsgTone = "idle" | "ok" | "bad" | "warn";

/** Everything the board derives from the check: messages, readiness, short/over-paid. */
export function evaluate(p: Payment, ck: ReceiptCheck) {
  const c = cur(p);
  const due = dueOf(p);
  const typedAmt = parseAmount(ck.amount);
  const amtOk = Math.abs(typedAmt - due) < 0.005;
  const customerRef = normRef(p.reference || "");
  const refTyped = normRef(ck.reference);
  // When the customer typed no reference, the one on the receipt is all we have: any non-empty one passes.
  const refOk = refTyped !== "" && (customerRef === "" || refTyped === customerRef);
  // A UTR that differs from what the customer typed warns but does not block (customers mistype references;
  // before v1.3 staff could always approve with the receipt's UTR). Approve still needs a UTR typed.
  const refFilled = refTyped !== "";
  const today = isoDay(new Date());
  const seen = parseAmount(ck.seen);
  const onOk = Boolean(ck.on) && ck.on >= p.paid_on && ck.on <= today;
  const seenOk = seen > 0;
  const diff = seenOk ? Math.round((seen - due) * 100) / 100 : 0;
  const short = ck.found && seenOk && diff < -0.004;
  const overPaid = ck.found && seenOk && diff > 0.004;

  let stmtMsg =
    "Approve stays off until you find the money in the statement. Not there yet? Wait, or reject with “Not in our bank yet”.";
  let stmtTone: MsgTone = "idle";
  if (ck.found && !ck.on) stmtMsg = "Pick the date the money arrived.";
  else if (ck.found && !onOk) {
    stmtMsg = `The date must be between ${dLong(p.paid_on)} (paid) and today.`;
    stmtTone = "bad";
  } else if (ck.found && !ck.seen) stmtMsg = "Type the amount the statement shows.";
  else if (ck.found && !seenOk) {
    stmtMsg = "Type a number, like 2834.00";
    stmtTone = "bad";
  } else if (short) {
    stmtMsg = `Arrived ${dLong(ck.on)}, but short of the amount due.`;
    stmtTone = "warn";
  } else if (overPaid) {
    stmtMsg = `Arrived ${dLong(ck.on)}, more than the amount due.`;
    stmtTone = "ok";
  } else if (ck.found) {
    stmtMsg = `Arrived in full on ${dLong(ck.on)}.`;
    stmtTone = "ok";
  }

  const amountFilled = typedAmt > 0;
  const ready = refFilled && amountFilled && ck.found && onOk && seenOk && !short;
  let hint = "Receipt and statement agree.";
  if (!refFilled || !amountFilled) hint = "Step 1: type the amount and the UTR from the receipt.";
  else if (!ck.found || !onOk || !seenOk) hint = "Step 2: find the payment in the bank or UPI statement.";
  else if (short) hint = "Short-paid. Part payments can’t be approved.";
  else if (overPaid) hint = `Over-paid by ${money(diff, c)}. Approve, then refund the difference.`;

  const amtMsg = !ck.amount
    ? `Due: ${money(due, c)}`
    : amtOk
      ? "Matches the amount due"
      : Number.isNaN(typedAmt)
        ? "Type a number, like 3344.12"
        : `Receipt shows ${money(typedAmt, c)}, but ${money(due, c)} is due. Step 2 decides what to do.`;
  const amtTone: MsgTone = !ck.amount ? "idle" : amtOk ? "ok" : Number.isNaN(typedAmt) ? "bad" : "warn";
  const refMsg = !ck.reference
    ? customerRef
      ? `Compare with ${p.reference}, the reference the customer typed`
      : "The customer typed no reference: type the one on the receipt"
    : refOk
      ? customerRef
        ? "Matches the reference the customer typed"
        : "Saved with the approval"
      : `Different from ${p.reference}, which the customer typed. Make sure it is the same payment.`;
  const refTone: MsgTone = !ck.reference ? "idle" : refOk ? "ok" : "warn";

  return { c, due, typedAmt, seen, diff, short, overPaid, ready, hint, stmtMsg, stmtTone, amtMsg, amtTone, refMsg, refTone };
}

const SAME = { receipt: "receipt file", reference: "UTR" } as const;
const STATUS_WORD = { submitted: "waiting", verified: "approved", rejected: "rejected" } as const;

function dupText(dup: DuplicatePayment): { head: string; text: string } {
  const head = `Same ${SAME[dup.match]} as ${STATUS_WORD[dup.status]} payment #${dup.id}.`;
  const who = dup.same_customer ? "This customer" : dup.customer_email;
  let text = `${who} sent it on ${dLong(dup.submitted_at)}`;
  if (dup.status === "rejected") text += dup.rejection_reason ? ` and you rejected it (“${dup.rejection_reason}”).` : " and you rejected it.";
  else text += ".";
  text +=
    dup.status === "verified"
      ? " One transfer can’t pay twice: reject this one unless the bank shows two payments."
      : " Check it carefully.";
  return { head, text };
}

/** Ready-made reasons (board copy): a click fills the box with a sentence the customer will understand. */
const QUICK: [string, string][] = [
  ["No UTR visible", "We can't see a UTR / transaction ID on the receipt. Please send a photo or PDF of the receipt that shows it."],
  ["Amount differs", "The amount on the receipt doesn't match the amount due. Please pay the difference or send the right receipt."],
  ["Paid to the wrong account", "This payment went to a different account, not to Zinwe (SKYTECHNO). Please check the payee and pay again."],
  ["Can't read the receipt", "We can't read the receipt. Please send a clearer photo or the PDF from your bank."],
  ["Not in our bank yet", "We can't find this payment in our bank account yet. If it went through, please send the bank's confirmation."],
];

const msgClass = (t: MsgTone) => `sb-msg sb-msg--${t}`;

/**
 * One payment waiting for approval (board "Payments" tab): the receipt, what was due, step 1 (type what the
 * receipt shows), step 2 (find it in the bank / UPI statement), then Approve or Reject with a reason.
 */
export function PendingPayment({
  payment: p,
  row,
  check,
  onCheck,
  onApprove,
  onReject,
  onAskRest,
}: {
  payment: Payment;
  row: Subscriber;
  check: ReceiptCheck;
  onCheck: (c: ReceiptCheck) => void;
  /** Called after the staff member confirms; resolves when the API call is done. */
  onApprove: (amount: string, reference: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  /** Short-paid: email the owner for the rest (opens the composer). */
  onAskRest: () => void;
}): ReactElement {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejectErr, setRejectErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const ev = evaluate(p, check);
  const set = (patch: Partial<ReceiptCheck>) => onCheck({ ...check, ...patch });
  const sign = ev.c === "USD" ? "$" : "₹";
  const first = firstName(row);
  const typedDiffers = Math.abs(Number(p.amount_inr) - ev.due) > 0.005;
  const otherPayer = p.payer_name && p.payer_name.trim().toLowerCase() !== (row.full_name || "").trim().toLowerCase();
  const label = p.upgrade_from ? "Approve and upgrade" : p.is_renewal ? "Approve and extend" : "Approve and activate";
  const dup = p.duplicate_of ? dupText(p.duplicate_of) : null;

  const facts: { k: string; v: string; cls?: string }[] = [
    { k: "Amount due", v: money(ev.due, ev.c), cls: "sb-fact--due" },
    {
      k: "Customer typed",
      v: `${money(p.amount_inr, ev.c)} · ${typedDiffers ? "differs from due" : "same as due"}`,
      cls: typedDiffers ? "sb-fact--warn" : undefined,
    },
    { k: "Reference typed", v: p.reference || "None", cls: p.reference ? "sb-fact--mono" : "sb-fact--mute" },
    { k: "Way", v: `${methodLabel(p.method)} · paid ${dLong(p.paid_on)} · sent ${dSent(p.submitted_at)}` },
  ];
  if (otherPayer) facts.push({ k: "Paid by", v: p.payer_name });
  if (p.would_cover) {
    facts.push({
      k: p.upgrade_from ? `Upgrades from ${p.upgrade_from}` : p.is_renewal ? "Extends" : "Activates",
      v: `${p.plan.name} · ${dLong(p.would_cover.from)} to ${dLong(p.would_cover.until)}`,
    });
  }

  const reject = async () => {
    setBusy(true);
    setRejectErr(null);
    try {
      await onReject(reason.trim());
      setRejecting(false);
      setReason("");
    } catch (err) {
      setRejectErr(err instanceof Error ? err.message : "Couldn’t reject the payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Payment waiting for approval" className="sb-pend">
      <div className="sb-pend__top">
        <h3>
          {p.upgrade_from
            ? `Upgrade from ${p.upgrade_from} waiting for approval`
            : p.is_renewal
              ? "Renewal payment waiting for approval"
              : "First payment waiting for approval"}
        </h3>
        <span className="pill sb-pill-cycle">
          {p.cycle && p.cycle > 1 ? `Cycle ${p.cycle} · renewal` : "Cycle 1 · first payment"}
        </span>
      </div>
      {dup ? (
        <p role="alert" className="sb-dupwarn">
          <b>{dup.head}</b> {dup.text}
        </p>
      ) : (
        <p className="sb-dupok">
          <Icon name="check" strokeWidth={2} />
          Duplicate check: no other payment uses this UTR or this receipt file.
        </p>
      )}

      <div className="sb-pend__grid">
        <PaymentProof paymentId={p.id} hasProof={p.has_proof} />
        <div className="sb-pend__side">
          <dl className="sb-facts">
            {facts.map((x) => (
              <div key={x.k}>
                <dt className="k">{x.k}</dt>
                <dd className={x.cls}>{x.v}</dd>
              </div>
            ))}
          </dl>
          <fieldset className="sb-step">
            <legend>1. Check the receipt</legend>
            <span className="k sb-step__lede">
              Type what the receipt shows. The reference must match what the customer typed.
            </span>
            <label className="sb-fl">
              Amount on the receipt
              <span className="sb-money">
                <span aria-hidden="true">{sign}</span>
                <input
                  className="inp num"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="as shown on the receipt"
                  value={check.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                />
              </span>
            </label>
            <span className={msgClass(ev.amtTone)}>{ev.amtMsg}</span>
            <label className="sb-fl">
              UTR / reference on the receipt
              <input
                className="inp mono"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                placeholder="e.g. 428917365402"
                value={check.reference}
                onChange={(e) => set({ reference: e.target.value })}
              />
            </label>
            <span className={msgClass(ev.refTone)}>{ev.refMsg}</span>
          </fieldset>
        </div>
      </div>

      <fieldset className={"sb-step" + (ev.ready ? " is-ready" : ev.short ? " is-short" : "")}>
        <legend>2. Found in bank/UPI statement</legend>
        <span className="k sb-step__lede">
          A receipt can be edited; the bank statement can’t. Open the {STATEMENT_ACCOUNT} and find this payment by its
          UTR.
        </span>
        <label className="sb-found">
          <input type="checkbox" checked={check.found} onChange={() => set({ found: !check.found })} /> I found this
          payment in the statement
        </label>
        {check.found ? (
          <div className="sb-found__grid">
            <label className="sb-fl">
              Date it arrived
              <input
                className="inp"
                type="date"
                min={p.paid_on}
                max={isoDay(new Date())}
                value={check.on}
                onChange={(e) => set({ on: e.target.value })}
              />
            </label>
            <label className="sb-fl">
              Amount seen in the statement
              <span className="sb-money">
                <span aria-hidden="true">{sign}</span>
                <input
                  className="inp num"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="as credited"
                  value={check.seen}
                  onChange={(e) => set({ seen: e.target.value })}
                />
              </span>
            </label>
          </div>
        ) : null}
        <span className={msgClass(ev.stmtTone)}>{ev.stmtMsg}</span>
        {ev.short ? (
          <div role="alert" className="sb-short">
            <b>
              Short-paid by {money(-ev.diff, ev.c)}. The statement shows {money(ev.seen, ev.c)}; {money(ev.due, ev.c)} is
              due.
            </b>
            <span>
              A plan can’t be approved for part of its price, so Approve stays off. Ask {first} for the rest; when it
              arrives, type the total of both credits above.
            </span>
            <div className="sb-short__row">
              <button type="button" className="btn sm" onClick={onAskRest}>
                Ask {first} for the rest
              </button>
              <span className="k">Emails {row.email} with the amount and our bank details.</span>
            </div>
          </div>
        ) : null}
        {ev.overPaid ? (
          <div role="status" className="sb-over">
            <b>Over-paid by {money(ev.diff, ev.c)}.</b> You can approve. Send the difference back from the account it
            arrived in and note it under Remarks; refunds aren’t recorded here yet.
          </div>
        ) : null}
      </fieldset>

      {!rejecting ? (
        <div className="sb-pend__actions">
          <span className="k sb-pend__hint">{ev.hint}</span>
          <button type="button" className="btn" onClick={() => setRejecting(true)}>
            Reject…
          </button>
          <button type="button" className="btn dark" disabled={!ev.ready} onClick={() => ev.ready && setAsking(true)}>
            {label}
          </button>
        </div>
      ) : (
        <form
          className="sb-reject"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) void reject();
          }}
        >
          <label className="sb-fl" htmlFor={`rej-${p.id}`}>
            <span>
              Reason the customer will see{" "}
              <span className="k" style={{ fontWeight: 400 }}>
                Emailed to them and shown on their Billing page.
              </span>
            </span>
          </label>
          <div role="group" aria-label="Quick reasons" className="sb-qchips">
            {QUICK.map(([lab, text]) => (
              <button key={lab} type="button" className="sb-qchip" onClick={() => setReason(text)}>
                {lab}
              </button>
            ))}
          </div>
          <textarea
            id={`rej-${p.id}`}
            className="sb-txt"
            maxLength={500}
            placeholder="e.g. No payment found in our bank for this UTR."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          {rejectErr ? (
            <p className="err-box" role="alert">
              {rejectErr}
            </p>
          ) : null}
          <div className="sb-reject__row">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
            >
              Back
            </button>
            <button type="submit" className="btn danger-fill" disabled={busy || !reason.trim()}>
              {busy ? "Rejecting…" : "Reject payment"}
            </button>
          </div>
        </form>
      )}

      {asking ? (
        <ApproveConfirm
          payment={p}
          row={row}
          check={check}
          label={label}
          onConfirm={() => onApprove(check.amount.replace(/[₹$,\s]/g, ""), check.reference.trim())}
          onClose={() => setAsking(false)}
        />
      ) : null}
    </section>
  );
}

/** J8-02 / board: a money decision is confirmed once, naming who, how much, which plan and until when. */
function ApproveConfirm({
  payment: p,
  row,
  check,
  label,
  onConfirm,
  onClose,
}: {
  payment: Payment;
  row: Subscriber;
  check: ReceiptCheck;
  label: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}): ReactElement {
  const ev = evaluate(p, check);
  const co = companyName(row);
  const until = p.would_cover ? dLong(p.would_cover.until) : null;
  const what = p.upgrade_from
    ? `This moves ${co} from ${p.upgrade_from} to ${p.plan.name}`
    : `${p.is_renewal ? "This extends " : "This turns on "}${p.plan.name} for ${co}`;
  const warns: string[] = [];
  if (p.duplicate_of) {
    warns.push(
      `This ${p.duplicate_of.match === "receipt" ? "receipt" : "UTR"} was used before on payment #${p.duplicate_of.id} (${STATUS_WORD[p.duplicate_of.status]}).`,
    );
  }
  if (Math.abs(ev.typedAmt - ev.due) > 0.005) {
    warns.push(`The receipt shows ${money(ev.typedAmt, ev.c)}, not the ${money(ev.due, ev.c)} due.`);
  }
  if (ev.overPaid) warns.push(`Over-paid by ${money(ev.diff, ev.c)}. After approving, send it back.`);
  return (
    <ConfirmDialog
      title={`Approve ${money(ev.due, ev.c)} from ${co}?`}
      confirmLabel={label}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        {what}
        {until ? ` until ${until}` : ""}, makes the tax invoice and emails {row.email} that it is active.
      </p>
      <p className="confirm__note num">
        Statement: {money(ev.seen, ev.c)} arrived {dLong(check.on)} · UTR {normRef(check.reference)}{" "}
        {normRef(p.reference || "") ? "matches the receipt" : "from the receipt"}
      </p>
      {warns.length ? <p className="confirm__note warn">{warns.join(" ")}</p> : null}
    </ConfirmDialog>
  );
}
