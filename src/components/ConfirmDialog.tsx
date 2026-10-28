import { useState, type ReactElement, type ReactNode } from "react";
import { Modal } from "./Modal";

/**
 * A focused yes/no decision. `confirmText`: the user must type this exact text first
 * (for actions that can't be undone, like deleting an account).
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  confirmText,
  disabled,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  confirmText?: string;
  /** Keep the confirm button off (e.g. until a required reason is typed in the dialog). */
  disabled?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}): ReactElement {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked =
    Boolean(disabled) || (confirmText !== undefined && typed.trim().toLowerCase() !== confirmText.toLowerCase());

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't do that.");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="small"
      role="alertdialog"
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={"btn " + (danger ? "danger-fill" : "dark")}
            disabled={busy || locked}
            onClick={() => void go()}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm">{children}</div>
      {confirmText !== undefined ? (
        <label className="confirm__type">
          Type <b>{confirmText}</b> to confirm
          <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
      ) : null}
      {error ? (
        <p className="err-box" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
