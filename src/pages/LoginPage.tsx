import { useState, type FormEvent, type ReactElement } from "react";
import { ApiError, getMe, login } from "../lib/api";
import { clearToken, setToken } from "../lib/session";
import { BrandLogo } from "../components/BrandLogo";

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }): ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const token = await login(email.trim(), password);
      setToken(token);
      // Only staff may use the back office.
      const me = await getMe();
      if (!me.is_staff) {
        clearToken();
        setError("This account isn't a Zinwe staff account.");
        return;
      }
      onSignedIn();
    } catch (err) {
      clearToken();
      setError(err instanceof ApiError ? err.message : "Couldn't sign in. Check your details and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={onSubmit}>
        <BrandLogo height={28} className="brand--login" />
        <h1>Staff sign in</h1>
        <p className="muted">Internal tool for the Zinwe team.</p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error ? <p className="alert alert--bad">{error}</p> : null}

        <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
