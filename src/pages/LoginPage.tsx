import { useState, type FormEvent, type ReactElement } from "react";
import { ApiError, getMe, login } from "../lib/api";
import { clearToken, setToken } from "../lib/session";
import { useAdminEnv } from "../lib/env";
import { staff2faPreview, verifyStaffCode } from "../content/fixtures/staff2fa";
import { Icon } from "../components/icons";
import { BrandLogo, DevPill } from "../components/BrandLogo";
import "../styles/login.css";

type Step = "creds" | "code" | "done";

function todayLine(): string {
  const d = new Date();
  const date = d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  return `${date} · IST. Staff sessions end after 12 hours idle.`;
}

function ErrBox({ children }: { children: string }): ReactElement {
  return (
    <div role="alert" className="err-box">
      <Icon name="warn" strokeWidth={2} />
      <span>{children}</span>
    </div>
  );
}

/**
 * Staff sign-in (AdminLogin board). The real flow is the shared login API + the staff check.
 * The authenticator step is a board "Proposal": shown only as a local preview (content/fixtures/staff2fa.ts).
 */
export function LoginPage({ onSignedIn }: { onSignedIn: () => void }): ReactElement {
  const env = useAdminEnv();
  const dev = env === "dev";
  const [step, setStep] = useState<Step>("creds");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pwShown, setPwShown] = useState(false);
  const [emailBad, setEmailBad] = useState(false);
  const [credErr, setCredErr] = useState("");
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [doneAt, setDoneAt] = useState("");

  const submitCreds = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const em = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      setEmailBad(true);
      return;
    }
    if (!password) {
      setCredErr("Enter your password.");
      return;
    }
    setBusy(true);
    setCredErr("");
    try {
      const token = await login(em, password);
      setToken(token);
      // Only staff may use the back office.
      const me = await getMe();
      if (!me.is_staff) {
        clearToken();
        setPassword("");
        setCredErr("This account isn’t a Zinwe staff account.");
        return;
      }
      if (staff2faPreview()) {
        setStep("code");
        return;
      }
      onSignedIn();
    } catch (err) {
      clearToken();
      setPassword("");
      if (err instanceof ApiError && (err.status === 400 || err.status === 401)) {
        setCredErr("Email or password is wrong. Check both and try again.");
      } else {
        setCredErr(err instanceof ApiError ? err.message : "Couldn’t sign in. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (code.length !== 6) {
      setCodeErr("Enter all 6 digits.");
      return;
    }
    setBusy(true);
    setCodeErr("");
    const ok = await verifyStaffCode(code);
    setBusy(false);
    if (!ok) {
      setCode("");
      setCodeErr("That code didn’t work. Use the code showing in your app now.");
      return;
    }
    const now = new Date();
    setDoneAt(
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) +
        " on " +
        now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).replace(",", ""),
    );
    setStep("done");
  };

  return (
    <div className="zlogin">
      <div className="zlogin__col">
        <div className="zlogin__top">
          <BrandLogo height={28} extra={dev ? <DevPill /> : null} />
        </div>

        <section className="zlogin__card">
          {step === "creds" ? (
            <form onSubmit={(e) => void submitCreds(e)} noValidate className="zlogin__form">
              <div className="zlogin__head">
                <h1>Staff sign in</h1>
                <p>Internal tool for the Zinwe team.</p>
              </div>
              <div className="zlogin__field">
                <label htmlFor="em">Email</label>
                <input
                  id="em"
                  className={"inp" + (emailBad ? " bad" : "")}
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailBad(false);
                  }}
                  aria-invalid={emailBad}
                  aria-describedby={emailBad ? "em-err" : undefined}
                />
                {emailBad ? (
                  <span id="em-err" className="field-err">
                    Enter your zinwe.io email.
                  </span>
                ) : null}
              </div>
              <div className="zlogin__field">
                <label htmlFor="pw">Password</label>
                <div className="zlogin__pw">
                  <input
                    id="pw"
                    className={"inp" + (credErr ? " bad" : "")}
                    type={pwShown ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setCredErr("");
                    }}
                    aria-invalid={Boolean(credErr)}
                    style={{ paddingRight: 64 }}
                  />
                  <button
                    type="button"
                    className="link zlogin__show"
                    onClick={() => setPwShown((v) => !v)}
                    aria-label={pwShown ? "Hide password" : "Show password"}
                    aria-pressed={pwShown}
                  >
                    {pwShown ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              {credErr ? <ErrBox>{credErr}</ErrBox> : null}
              <button type="submit" className="btn dark" disabled={busy}>
                {busy ? "Signing in…" : "Continue"}
              </button>
              <span className="k">Forgot your password? Ask another Owner to reset it from Staff settings.</span>
            </form>
          ) : null}

          {step === "code" ? (
            <form onSubmit={(e) => void submitCode(e)} noValidate className="zlogin__form">
              <div className="zlogin__head" style={{ gap: 6 }}>
                <span className="pill outline" style={{ alignSelf: "flex-start" }}>
                  Proposal — decide for v1.3 · staff 2FA
                </span>
                <h1>Check your authenticator</h1>
                <p>
                  Signing in as <b style={{ color: "var(--ink)" }}>{email.trim()}</b>.{" "}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      clearToken();
                      setStep("creds");
                      setCode("");
                      setCodeErr("");
                      setPassword("");
                    }}
                  >
                    Not you?
                  </button>
                </p>
              </div>
              <div className="zlogin__field">
                <label htmlFor="code">Enter the 6-digit code from your authenticator app</label>
                <input
                  id="code"
                  className={"inp zlogin__code" + (codeErr ? " bad" : "")}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setCodeErr("");
                  }}
                  aria-invalid={Boolean(codeErr)}
                  aria-describedby="code-help"
                />
                <span id="code-help" className="k">
                  The code changes every 30 seconds.
                </span>
              </div>
              {codeErr ? <ErrBox>{codeErr}</ErrBox> : null}
              <label className="ck" style={{ gap: 10 }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={() => setRemember((v) => !v)}
                  style={{ width: 18, height: 18 }}
                />
                <span>Remember this device for 12 hours</span>
              </label>
              <button type="submit" className="btn dark" disabled={busy}>
                {busy ? "Checking…" : "Sign in"}
              </button>
              <span className="k">Lost your phone? Another Owner can reset your 2FA.</span>
            </form>
          ) : null}

          {step === "done" ? (
            <div role="status" className="zlogin__form" style={{ gap: 14 }}>
              <span aria-hidden="true" className="zlogin__ok">
                <Icon name="check" size={20} strokeWidth={2.2} />
              </span>
              <div className="zlogin__head">
                <h1>Signed in</h1>
                <p>
                  Signed in at {doneAt}.{" "}
                  {remember ? "This device stays signed in for 12 hours." : "You’ll sign in again with a code next time."}
                </p>
              </div>
              <button type="button" className="btn dark" onClick={onSignedIn}>
                Open the dashboard
              </button>
            </div>
          ) : null}
        </section>

        <p className="k zlogin__foot">{todayLine()}</p>
      </div>
    </div>
  );
}
