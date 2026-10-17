import type { FormEvent, ReactElement } from "react";
import type { DuplicatePayment, Payment, Subscriber } from "../../lib/api";
import { date, dateTime, methodLabel, money, period } from "../../lib/format";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PaymentProof } from "../../components/PaymentProof";

/** What staff read off the receipt before approving (J8-01). */
export interface ReceiptCheck {
  amount: string;
  reference: string;
}

export const EMPTY_CHECK: ReceiptCheck = { amount: "", reference: "" };

/** The amount the customer had to pay for this payment (with tax), as a number and as text. */
export function amountDue(p: Payment): { value: number; text: string } {
  const raw = p.due_total ?? p.expected_inr;
  return { value: Number(raw), text: money(raw, p.currency ?? "INR") };
}

/** "₹ 1,145.78" / "1145.78" / "971" -> 1145.78; NaN when it isn't a number. */
export function parseAmount(text: string): number {
  const cleaned = text.replace(/[₹$,\s]/g, "");
  return cleaned && /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

export function checkReady(check: ReceiptCheck): boolean {
  return parseAmount(check.amount) > 0 && check.reference.trim().length > 0;
}

function amountMismatch(p: Payment, check: ReceiptCheck): boolean {
  const typed = parseAmount(check.amount);
  return Number.isFinite(typed) && Math.abs(typed - amountDue(p).value) > 0.005;
}

const SAME = { receipt: "the same receipt file", reference: "the same UTR / reference" } as const;
const STATUS_WORD = { submitted: "waiting", verified: "approved", rejected: "rejected" } as const;

/** J8-03: this payment shares its receipt file or UTR with another one. */
function DuplicateWarning({ dup }: { dup: DuplicatePayment }): ReactElement {
  const approved = dup.status === "verified";
  return (
    <p className={"rv-dup" + (approved ? " rv-dup--bad" : "")} role="alert">
      <b>
        {dup.match === "receipt" ? "Same receipt" : "Same reference"} as {STATUS_WORD[dup.status]} payment #{dup.id}
      </b>
      {" — "}
      {SAME[dup.match]}
      {dup.same_customer ? " this customer sent" : ` ${dup.customer_email} sent`} on {date(dup.submitted_at)}
      {dup.status === "rejected" && dup.rejection_reason ? ` and you rejected (“${dup.rejection_reason}”)` : ""}.
      {approved ? " One transfer can't pay twice: reject this one unless the bank shows two payments." : " Check it carefully."}
    </p>
  );
}

/**
 * The payment being reviewed: the receipt shown large (left / on top), what was due, and the two fields staff
 * fill from the receipt. Approve stays off until both are filled; a different amount is flagged.
 */
export function PaymentReview({
  payment,
  row,
  check,
  onCheck,
}: {
  payment: Payment;
  row: Subscriber;
  check: ReceiptCheck;
  onCheck: (check: ReceiptCheck) => void;
}): ReactElement {
  const due = amountDue(payment);
  const mismatch = amountMismatch(payment, check);
  const reportedDiffers = Math.abs(Number(payment.amount_inr) - due.value) > 0.005;
  const otherPayer =
    payment.payer_name && payment.payer_name.trim().toLowerCase() !== (row.full_name || "").trim().toLowerCase();
  const currencySign = (payment.currency ?? "INR") === "USD" ? "$" : "₹";

  return (
    <section className="msec msec--hot rv-section" aria-label="Payment waiting for approval">
      <h3 className="msec__title">
        {payment.upgrade_from
          ? `Upgrade from ${payment.upgrade_from} waiting for approval`
          : payment.is_renewal
            ? "Renewal payment waiting for approval"
            : "Payment waiting for approval"}
        <span className="pill pill--info">
          {payment.cycle && payment.cycle > 1 ? `Cycle ${payment.cycle} · renewal` : "Cycle 1 · first payment"}
        </span>
      </h3>
      {payment.duplicate_of ? <DuplicateWarning dup={payment.duplicate_of} /> : null}
      <div className="rv">
        <div className="rv__receipt">
          <PaymentProof paymentId={payment.id} hasProof={payment.has_proof} />
        </div>
        <div className="rv__side">
          <dl className="rv__facts">
            <div>
              <dt>Amount due</dt>
              <dd className="rv__due">{due.text}</dd>
            </div>
            {payment.would_cover ? (
              <div>
                <dt>{payment.is_renewal ? "Extends plan" : "Activates"} {payment.plan.name}</dt>
                <dd>{period(payment.would_cover.from, payment.would_cover.until)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Way</dt>
              <dd>
                {methodLabel(payment.method)} · paid {date(payment.paid_on)}
                <small className="block muted">sent {dateTime(payment.submitted_at)}</small>
              </dd>
            </div>
            {otherPayer ? (
              <div>
                <dt>Paid by</dt>
                <dd>{payment.payer_name}</dd>
              </div>
            ) : null}
            {payment.reference ? (
              <div>
                <dt>Reference the customer typed</dt>
                <dd className="mono">{payment.reference}</dd>
              </div>
            ) : null}
            {reportedDiffers ? (
              <div>
                <dt>Amount the customer typed</dt>
                <dd className="tone-warn">{money(payment.amount_inr, payment.currency ?? "INR")}</dd>
              </div>
            ) : null}
          </dl>

          <fieldset className="rv__check">
            <legend>Check the receipt</legend>
            <p className="rv__hint">Type what the receipt shows. Approve stays off until both are filled.</p>
            <label className="rv__field">
              <span>Amount on the receipt</span>
              <span className={"rv__money" + (mismatch ? " is-warn" : "")}>
                <span aria-hidden="true">{currencySign}</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="as shown on the receipt"
                  value={check.amount}
                  aria-invalid={mismatch || undefined}
                  aria-describedby={mismatch ? `rv-mismatch-${payment.id}` : undefined}
                  onChange={(e) => onCheck({ ...check, amount: e.target.value })}
                />
              </span>
            </label>
            <label className="rv__field">
              <span>UTR / reference on the receipt</span>
              <input
                className="mono"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                placeholder="e.g. 428917365402"
                value={check.reference}
                onChange={(e) => onCheck({ ...check, reference: e.target.value })}
              />
            </label>
            {mismatch ? (
              <p className="rv__warn" id={`rv-mismatch-${payment.id}`} role="alert">
                The receipt shows {money(parseAmount(check.amount), payment.currency ?? "INR")}, but {due.text} is due.
                Reject it, or approve only if you've agreed the difference with the customer.
              </p>
            ) : null}
          </fieldset>
        </div>
      </div>
    </section>
  );
}

/** J8-02: a money decision is confirmed once, naming who, how much, which plan and until when. */
export function ApproveConfirm({
  payment,
  row,
  check,
  onConfirm,
  onClose,
}: {
  payment: Payment;
  row: Subscriber;
  check: ReceiptCheck;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}): ReactElement {
  const who = row.company?.name || row.full_name || row.email;
  const typed = money(parseAmount(check.amount), payment.currency ?? "INR");
  const until = payment.would_cover ? date(payment.would_cover.until) : null;
  const mismatch = amountMismatch(payment, check);
  return (
    <ConfirmDialog
      title={`Approve ${typed} from ${who}?`}
      confirmLabel={payment.is_renewal ? "Approve & extend" : "Approve & activate"}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        {payment.upgrade_from ? (
          <>
            This switches <b>{who}</b> from {payment.upgrade_from} to <b>{payment.plan.name}</b> now
          </>
        ) : payment.is_renewal ? (
          <>
            This extends <b>{payment.plan.name}</b> for <b>{who}</b>
          </>
        ) : (
          <>
            This turns on <b>{payment.plan.name}</b> for <b>{who}</b>
          </>
        )}
        {until ? (
          <>
            {" "}
            until <b>{until}</b>
          </>
        ) : null}{" "}
        and emails {row.email} that it's active.
      </p>
      <p className="confirm__facts">
        Receipt: <b>{typed}</b> · UTR <b className="mono">{check.reference.replace(/s+/g, "").toUpperCase()}</b>
      </p>
      {mismatch ? (
        <p className="confirm__note confirm__note--warn">
          That's not the {amountDue(payment).text} due. Approve only if you've agreed the difference.
        </p>
      ) : null}
      {payment.duplicate_of ? (
        <p className="confirm__note confirm__note--warn">
          This payment shares its {payment.duplicate_of.match === "receipt" ? "receipt" : "reference"} with payment #
          {payment.duplicate_of.id}.
        </p>
      ) : null}
    </ConfirmDialog>
  );
}

/** Ready-made reasons (J8-24): a click fills the box with a sentence the customer will understand. */
const REJECT_REASONS: { label: string; text: string }[] = [
  { label: "No UTR visible", text: "We can't see a UTR / transaction ID on the receipt. Please send a screenshot that shows it." },
  { label: "Amount differs", text: "The amount on the receipt doesn't match the amount due. Please pay the difference or send the right receipt." },
  { label: "Paid to the wrong account", text: "This payment went to a different account, not to Zinwe (SKYTECHNO). Please check the payee and pay again." },
  { label: "Can't read the receipt", text: "We can't read the receipt. Please send a clearer screenshot or the PDF from your bank." },
  { label: "Not in our bank yet", text: "We can't find this payment in our bank account yet. If it went through, please send the bank's confirmation." },
];

/** Reject with a reason the customer sees: a multi-line box plus quick picks. */
export function RejectForm({
  reason,
  busy,
  onReason,
  onBack,
  onSubmit,
}: {
  reason: string;
  busy: boolean;
  onReason: (text: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}): ReactElement {
  return (
    <form
      className="modal-reject"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label className="modal-reject__label" htmlFor="reject-reason">
        Reason the customer will see <small>(emailed to them and shown on their Billing page)</small>
      </label>
      <div className="chips" role="group" aria-label="Quick reasons">
        {REJECT_REASONS.map((r) => (
          <button key={r.label} type="button" className="chip chip--btn" onClick={() => onReason(r.text)}>
            {r.label}
          </button>
        ))}
      </div>
      <textarea
        id="reject-reason"
        rows={3}
        maxLength={500}
        placeholder="e.g. No payment found in our bank for this UTR."
        value={reason}
        onChange={(e) => onReason(e.target.value)}
        autoFocus
      />
      <div className="modal-reject__actions">
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onBack}>
          Back
        </button>
        <button type="submit" className="btn btn--danger" disabled={busy || !reason.trim()}>
          {busy ? "Rejecting…" : "Reject payment"}
        </button>
      </div>
    </form>
  );
}
