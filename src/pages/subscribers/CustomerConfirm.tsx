import { useState, type ReactElement } from "react";
import { blockSubscriber, changePlan, type PlanSummary, type Subscriber } from "../../lib/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useToast } from "../../components/Toast";
import { PLAN_HISTORY } from "../../content/fixtures/subscribers";
import { companyName, dLong } from "./model";

const hist = (code: string | undefined) => (code ? (PLAN_HISTORY[code] ?? "—") : "—");

/**
 * Board "Move <company> to <plan>?" — J8-11: says what the change does (an honest downgrade warning) and confirms.
 * `email` comes from the "Email the owner about the change" box in the Actions tab.
 */
export function PlanConfirm({
  plan,
  row,
  plans,
  email,
  onUpdated,
  onClose,
}: {
  plan: PlanSummary;
  row: Subscriber;
  plans: PlanSummary[];
  email: boolean;
  onUpdated: (row: Subscriber) => void;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const current = plans.find((p) => p.code === row.plan?.code) ?? null;
  const sub = row.subscription;
  const co = companyName(row);
  const downgrade = current !== null && Number(plan.price_inr_monthly) < Number(current.price_inr_monthly);
  const paidUntil =
    sub && sub.status === "active" && !sub.is_trial && Number(sub.amount_inr) > 0 && sub.ends_at ? sub.ends_at : null;
  const over = plan.max_devices > 0 ? row.team.devices - plan.max_devices : 0;
  const grantsPaid = Number(plan.price_inr_monthly) > 0;

  return (
    <ConfirmDialog
      title={`Move ${co} to ${plan.name}?`}
      confirmLabel="Change plan"
      danger={downgrade && paidUntil !== null}
      onClose={onClose}
      onConfirm={async () => {
        onUpdated(await changePlan(row.id, plan.code, email));
        toast(`${co} is now on ${plan.name}.${email ? " The owner was emailed." : ""}`);
      }}
    >
      <p>
        From {row.plan?.name ?? "no plan"}
        {row.plan ? ` (${row.plan.max_devices} PCs, ${hist(row.plan.code)} history)` : ""} to {plan.name} (
        {plan.max_devices} PCs, {hist(plan.code)} history). {email ? `${row.email} gets an email.` : "No email is sent."}
      </p>
      {paidUntil && !downgrade ? <p className="confirm__note num">Paid until stays {dLong(paidUntil)}.</p> : null}
      {downgrade && paidUntil ? (
        <p className="confirm__note warn">
          They paid for {current?.name} until {dLong(paidUntil)}. Switching now ends that today: the paid days are not
          carried over or refunded.
        </p>
      ) : null}
      {over > 0 ? <p className="confirm__note warn">Over the new limit by {over} PCs.</p> : null}
      {grantsPaid ? (
        <p className="confirm__note">
          This grants {plan.name} for one month without a payment. To charge for it, let the customer choose it and
          approve their payment instead.
        </p>
      ) : null}
    </ConfirmDialog>
  );
}

/** J8-04: a reason, an optional "account paused" email (on by default), and a confirmation. */
export function BlockConfirm({
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
      title={`Block ${companyName(row)}?`}
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
        {row.email} is signed out everywhere and can’t sign in until you unblock them. When they try, they’re told the
        account is paused and to write to hello@zinwe.io. Their PCs and data stay as they are.
      </p>
      <label className="sb-fl">
        <span>
          Reason{" "}
          <span className="k" style={{ fontWeight: 400 }}>
            {email ? "The customer sees this in the email." : "Kept for your team."}
          </span>
        </span>
        <textarea
          className="sb-txt"
          maxLength={500}
          value={reason}
          placeholder="e.g. The payment for October was reversed by the bank."
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
      </label>
      <label className="sb-check">
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
        Email the customer that the account is paused, with this reason
      </label>
    </ConfirmDialog>
  );
}
