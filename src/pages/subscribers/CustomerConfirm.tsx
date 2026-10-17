import { useState, type ReactElement } from "react";
import {
  blockSubscriber,
  changePlan,
  deleteSubscriber,
  type PlanSummary,
  type Subscriber,
} from "../../lib/api";
import { date, inr, money } from "../../lib/format";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";

export type Confirm = { kind: "plan"; plan: PlanSummary } | { kind: "delete" } | { kind: "block" } | null;

/** Plan-change, block and delete confirmations, shared by the table row and the customer window. */
export function CustomerConfirm({
  confirm,
  row,
  plans,
  onUpdated,
  onDeleted,
  onClose,
  onBlockInstead,
}: {
  confirm: Confirm;
  row: Subscriber;
  plans: PlanSummary[];
  onUpdated: (row: Subscriber) => void;
  onDeleted: (id: number) => void;
  onClose: () => void;
  /** "Block instead" from a delete that isn't allowed. */
  onBlockInstead: () => void;
}): ReactElement | null {
  if (confirm?.kind === "plan") {
    return <PlanConfirm plan={confirm.plan} row={row} plans={plans} onUpdated={onUpdated} onClose={onClose} />;
  }
  if (confirm?.kind === "block") return <BlockConfirm row={row} onUpdated={onUpdated} onClose={onClose} />;
  if (confirm?.kind === "delete") {
    return <DeleteConfirm row={row} onDeleted={onDeleted} onClose={onClose} onBlockInstead={onBlockInstead} />;
  }
  return null;
}

/** J8-11: say what the change does (an honest downgrade warning), optionally tell the customer, and confirm. */
function PlanConfirm({
  plan,
  row,
  plans,
  onUpdated,
  onClose,
}: {
  plan: PlanSummary;
  row: Subscriber;
  plans: PlanSummary[];
  onUpdated: (row: Subscriber) => void;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const [email, setEmail] = useState(true);
  const current = plans.find((p) => p.code === row.plan?.code) ?? null;
  const sub = row.subscription;
  const downgrade = current !== null && Number(plan.price_inr_monthly) < Number(current.price_inr_monthly);
  const paidUntil =
    sub && sub.status === "active" && !sub.is_trial && Number(sub.amount_inr) > 0 && sub.ends_at ? sub.ends_at : null;
  const overLimit = plan.max_devices > 0 && row.team.devices > plan.max_devices;
  const grantsPaid = Number(plan.price_inr_monthly) > 0;

  return (
    <ConfirmDialog
      title={`Switch to ${plan.name}?`}
      confirmLabel={`Switch to ${plan.name}`}
      danger={downgrade && paidUntil !== null}
      onClose={onClose}
      onConfirm={async () => {
        onUpdated(await changePlan(row.id, plan.code, email));
        toast(`${row.email} is now on ${plan.name}.${email ? " They were emailed." : ""}`);
      }}
    >
      <p>
        <b>{row.full_name || row.email}</b> moves from <b>{row.plan?.name ?? "no plan"}</b> to <b>{plan.name}</b> (
        {plan.max_devices} PCs) right away.
      </p>
      {downgrade && paidUntil ? (
        <p className="confirm__note confirm__note--warn">
          They paid for {current?.name} until <b>{date(paidUntil)}</b>. Switching now ends that today: the paid days are
          not carried over or refunded.
        </p>
      ) : null}
      {overLimit ? (
        <p className="confirm__note confirm__note--warn">
          They have <b>{row.team.devices} PCs</b> connected; {plan.name} covers {plan.max_devices}. The connected PCs keep
          working, but they can't add new ones until they're under the limit.
        </p>
      ) : null}
      {grantsPaid ? (
        <p className="confirm__note">
          This grants {plan.name} for one month <b>without a payment</b>. To charge for it, let the customer choose it and
          approve their payment instead.
        </p>
      ) : null}
      <label className="confirm__check">
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
        Email the customer about the change
      </label>
    </ConfirmDialog>
  );
}

/** J8-04: a reason, an optional "account paused" email (on by default), and a confirmation. */
function BlockConfirm({
  row,
  onUpdated,
  onClose,
}: {
  row: Subscriber;
  onUpdated: (row: Subscriber) => void;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState(true);
  return (
    <ConfirmDialog
      title={`Block ${row.company?.name || row.full_name || row.email}?`}
      confirmLabel="Block account"
      danger
      disabled={!reason.trim()}
      onClose={onClose}
      onConfirm={async () => {
        onUpdated(await blockSubscriber(row.id, reason.trim(), email));
        toast(`${row.email} is blocked and signed out.${email ? " They were emailed why." : ""}`);
      }}
    >
      <p>
        <b>{row.email}</b> is signed out everywhere and can't sign in until you unblock them. When they try, they're told
        the account is paused and to write to hello@zinwe.io. Their PCs and data stay as they are.
      </p>
      <label className="confirm__field">
        Reason <small>{email ? "(the customer sees this in the email)" : "(kept for your team)"}</small>
        <textarea
          rows={3}
          maxLength={500}
          value={reason}
          placeholder="e.g. The payment for October was reversed by the bank."
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
      </label>
      <label className="confirm__check">
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
        Email the customer that the account is paused, with this reason
      </label>
    </ConfirmDialog>
  );
}

/**
 * J8-12: say what goes with the account (payments waiting, approved payments), and refuse outright when there are
 * tax invoices: those must be kept for 8 years, so the account can only be blocked.
 */
function DeleteConfirm({
  row,
  onDeleted,
  onClose,
  onBlockInstead,
}: {
  row: Subscriber;
  onDeleted: (id: number) => void;
  onClose: () => void;
  onBlockInstead: () => void;
}): ReactElement {
  const toast = useToast();
  const waiting = row.payments.filter((p) => p.status === "submitted");
  const approved = row.payments.filter((p) => p.status === "verified");
  const invoices = approved.map((p) => p.invoice_number).filter((n): n is string => Boolean(n));

  if (invoices.length || (approved.length && approved.every((p) => p.invoice_number === undefined))) {
    // An older backend doesn't send invoice numbers: approved payments always have an invoice, so treat them as such.
    return (
      <Modal
        title="This account can't be deleted"
        size="small"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Close
            </button>
            {row.is_active ? (
              <button type="button" className="btn btn--primary" onClick={onBlockInstead}>
                Block instead…
              </button>
            ) : null}
          </>
        }
      >
        <div className="confirm">
          <p>
            <b>{row.email}</b> has {approved.length} approved payment{approved.length === 1 ? "" : "s"} (
            {inr(row.billing.total_paid_inr)}){invoices.length ? ` with tax invoice${invoices.length === 1 ? "" : "s"} ` : ""}
            {invoices.length ? <b>{invoices.join(", ")}</b> : null}.
          </p>
          <p className="confirm__note">
            Invoices and the payments behind them are tax records and must be kept for 8 years. Block the account to stop
            sign-in; their history stays.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <ConfirmDialog
      title="Delete this account?"
      confirmLabel="Delete account"
      danger
      confirmText={row.email}
      onClose={onClose}
      onConfirm={async () => {
        await deleteSubscriber(row.id);
        onDeleted(row.id);
        toast(`Deleted ${row.email}.`);
      }}
    >
      <p>
        This permanently removes <b>{row.email}</b> with their company, subscriptions, payment records, team, PCs and
        feedback. It can't be undone.
      </p>
      {waiting.length ? (
        <p className="confirm__note confirm__note--warn">
          {waiting.map((p) => money(p.due_total ?? p.amount_inr, p.currency ?? "INR")).join(" and ")}{" "}
          {waiting.length === 1 ? "is" : "are"} waiting for you to check. Deleting removes{" "}
          {waiting.length === 1 ? "it" : "them"} too: if they paid, sort that out first.
        </p>
      ) : null}
      <p className="confirm__note">Blocking is usually enough: it stops sign-in and keeps the history.</p>
    </ConfirmDialog>
  );
}
