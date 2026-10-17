import { useState, type ReactElement } from "react";
import { sendPasswordReset, setPassword, type Subscriber } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { portalUrl } from "../../content/emailTemplates";

/** A random 14-character password with upper, lower, digit and symbol (no look-alike characters). */
function generatePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%*?-"];
  const all = sets.join("");
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const chars = [...sets.map(pick), ...Array.from({ length: 10 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/**
 * J8-05: the safe default is an email with a code so the customer picks their own password (the website's
 * Forgot password flow). Setting one by hand is behind "Set one myself", and the customer is told by email.
 */
export function PasswordReset({
  row,
  onUpdated,
  onDone,
}: {
  row: Subscriber;
  onUpdated: (row: Subscriber) => void;
  onDone: () => void;
}): ReactElement {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [value, setValue] = useState("");
  const [tell, setTell] = useState(true);
  const [copied, setCopied] = useState(false);
  const site = portalUrl().replace(/^https?:\/\//, "");

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendPasswordReset(row.id);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send it.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy; select the password and copy it.", "bad");
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await setPassword(row.id, value, tell));
      toast(`New password saved; ${row.email} was signed out everywhere${tell ? " and emailed" : ""}.`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="msec pw-reset" aria-label="Reset password">
      <h3 className="msec__title">
        Reset password <span className="msec__aside">Passwords are stored encrypted and can't be shown</span>
      </h3>

      {sent ? (
        <p className="alert alert--good" role="status">
          Sent to <b>{row.email}</b>. Ask them to open <b>{site}/forgot-password</b>, enter their email and the 6-digit
          code from the email (it works for 10 minutes), then choose a new password.
        </p>
      ) : (
        <div className="pw-reset__row">
          <p className="pw-reset__lede">
            Email them a code to choose a new password themselves. Nobody on the team sees it, and their current password
            keeps working until they change it.
          </p>
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void sendCode()}>
            {busy && !manual ? "Sending…" : "Email a password reset"}
          </button>
        </div>
      )}

      {!manual ? (
        <button type="button" className="link-btn pw-reset__more" onClick={() => setManual(true)}>
          Set one myself…
        </button>
      ) : (
        <div className="pw-reset__manual">
          <p className="pop__hint">
            Only if they can't get email. They're signed out of every device; share the password privately (never by
            email).
          </p>
          <div className="pw-reset__row">
            <input
              className="pop__input mono"
              type="text"
              autoComplete="new-password"
              spellCheck={false}
              placeholder="New password, at least 8 characters"
              aria-label={`New password for ${row.email}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setValue(generatePassword())}>
              Generate
            </button>
            {value ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || value.length < 8}
              onClick={() => void save()}
            >
              {busy && manual ? "Saving…" : "Save password"}
            </button>
          </div>
          <label className="confirm__check">
            <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} />
            Email them that their password was changed (without the password)
          </label>
        </div>
      )}
      {error ? (
        <p className="row-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
