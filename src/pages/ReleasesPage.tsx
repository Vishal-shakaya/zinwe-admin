import { useCallback, useState, type FormEvent, type ReactElement } from "react";
import { getReleaseReach, getReleases, publishRelease, updateRelease, type AgentRelease } from "../lib/api";
import { dateTime } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";

function megabytes(size: number | null): string {
  return size === null ? "—" : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Windows agent releases. Publishing one offers it to every PC on an older version within a minute: the
 * widget shows "Update now" (one click: download, SHA-256 check, silent install, Zinwe reopens). A required
 * release also pauses the member's log in / break / log out until they've updated.
 */
export function ReleasesPage(): ReactElement {
  const load = useCallback(() => getReleases(), []);
  const { data, error, pending, reload } = useLoad(load);
  const toast = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);

  const change = async (release: AgentRelease, patch: Parameters<typeof updateRelease>[1], done: string) => {
    setBusyId(release.id);
    try {
      await updateRelease(release.id, patch);
      toast(done);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save.", "bad");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Releases"
        subtitle="Publish a new Windows agent. PCs on an older version see Update now within a minute."
        onReload={reload}
        pending={pending}
      />

      <PublishForm onPublished={reload} />

      {error ? (
        <p className="alert alert--bad">{error}</p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : data.length === 0 ? (
        <div className="card empty">
          <b>No releases yet</b>
          <span className="muted">
            When there's a new version of the Windows app, ask the developers for its installer (the .msi file) and its
            version number, then publish it above.
          </span>
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Update</th>
                  <th>PCs updated</th>
                  <th>Installer</th>
                  <th>Published</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className={r.is_active ? undefined : "muted"}>
                    <td>
                      <b>Zinwe {r.version}</b>
                      {r.notes ? <div className="muted">{r.notes}</div> : null}
                    </td>
                    <td>
                      {!r.is_active ? (
                        <span className="pill pill--muted">Withdrawn</span>
                      ) : r.required ? (
                        <span className="pill pill--warn">Required</span>
                      ) : (
                        <span className="pill pill--info">Optional</span>
                      )}
                    </td>
                    <td className="nowrap">
                      <b>{r.adoption.updated}</b> of {r.adoption.total}
                    </td>
                    <td>
                      <div>{r.hosted === "upload" ? `Uploaded · ${megabytes(r.size)}` : "External link"}</div>
                      <div className="mono muted" title={r.sha256}>
                        SHA-256 {r.sha256.slice(0, 12)}…
                      </div>
                    </td>
                    <td className="nowrap">
                      {dateTime(r.published_at)}
                      {r.published_by ? <div className="muted">{r.published_by}</div> : null}
                    </td>
                    <td>
                      <div className="actions">
                        {r.is_active ? (
                          <>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={busyId === r.id}
                              onClick={() =>
                                change(r, { required: !r.required }, r.required ? "Now optional." : "Now required.")
                              }
                            >
                              {r.required ? "Make optional" : "Make required"}
                            </button>
                            <button
                              type="button"
                              className="link-btn link-btn--danger"
                              disabled={busyId === r.id}
                              onClick={() => change(r, { is_active: false }, `Zinwe ${r.version} withdrawn.`)}
                            >
                              Withdraw
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busyId === r.id}
                            onClick={() => change(r, { is_active: true }, `Zinwe ${r.version} offered again.`)}
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

const VERSION_RE = /^\d+(\.\d+){1,3}$/;

/** Upload the MSI (or link an externally hosted one + its SHA-256), add notes, choose required/optional. */
function PublishForm({ onPublished }: { onPublished: () => void }): ReactElement {
  const toast = useToast();
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  // Optional unless ticked (J8-06): a required update pauses log in / breaks / log out on every older PC.
  const [required, setRequired] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [external, setExternal] = useState(false);
  const [url, setUrl] = useState("");
  const [sha256, setSha256] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0); // resets the file input after publishing
  const [confirm, setConfirm] = useState<{ older: number; total: number } | "unknown" | null>(null);

  const versionOk = VERSION_RE.test(version.trim());
  const versionError = version.trim() && !versionOk ? "Use numbers with dots, like 1.4.0 (no letters or spaces)." : null;
  const shaError = external && sha256.trim() && !/^[0-9a-fA-F]{64}$/.test(sha256.trim()) ? "That isn't 64 letters and digits." : null;
  const missing = !version.trim()
    ? "Type the version number."
    : !versionOk
      ? null
      : external
        ? !url.trim()
          ? "Paste the download link."
          : sha256.trim().length !== 64
            ? "Paste the SHA-256 of the .msi."
            : null
        : !file
          ? "Choose the .msi file."
          : null;
  const ready = versionOk && !missing && !shaError;

  /** First the confirmation, with how many PCs get it (J8-06). */
  const askFirst = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setError(null);
    try {
      setConfirm(await getReleaseReach(version.trim()));
    } catch {
      setConfirm("unknown");
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const release = await publishRelease({
        version: version.trim(),
        notes: notes.trim(),
        required,
        ...(external ? { download_url: url.trim(), sha256: sha256.trim() } : { file }),
      });
      toast(`Zinwe ${release.version} published. PCs will see it within a minute.`);
      setVersion("");
      setNotes("");
      setFile(null);
      setUrl("");
      setSha256("");
      setRequired(false);
      setFormKey((k) => k + 1);
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't publish.");
    } finally {
      setBusy(false);
    }
  };

  const pcs = confirm && confirm !== "unknown" ? confirm.older : null;
  const pcsText = pcs === null ? "Every PC on an older version" : `${pcs} PC${pcs === 1 ? "" : "s"}`;

  return (
    <>
      <form key={formKey} className="card release-form" onSubmit={askFirst} style={{ marginBottom: 20 }} noValidate>
        <h2 className="card__title">Publish a release</h2>
        <div className="release-form__grid">
          <label className="field">
            <span>Version</span>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.4.0"
              aria-invalid={versionError ? true : undefined}
              aria-describedby="release-version-hint"
              required
            />
            <small id="release-version-hint" className={versionError ? "field__error" : "field__hint"}>
              {versionError ?? "Numbers like 1.4.0, higher than the last release."}
            </small>
          </label>
          {external ? (
            <label className="field">
              <span>Download link (https)</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/ZinweAgent-0.3.0.msi" />
            </label>
          ) : (
            <label className="field">
              <span>Installer (.msi)</span>
              <input type="file" accept=".msi" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>
        {external ? (
          <label className="field">
            <span>SHA-256 of the .msi</span>
            <input
              className="mono"
              value={sha256}
              onChange={(e) => setSha256(e.target.value)}
              placeholder="64 letters and digits, from the developers"
              aria-invalid={shaError ? true : undefined}
            />
            {shaError ? <small className="field__error">{shaError}</small> : null}
          </label>
        ) : null}
        <label className="field">
          <span>What's new (shown to members above the Update button)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} style={{ width: "100%", resize: "vertical" }} />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "4px 0 12px" }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <span>
            <b>Make it required</b>
            <span className="muted">
              {" "}
              — only for urgent fixes: PCs on an older version pause log in, breaks and log out until they install it.
              Protection stays on. Leave it off and members update when they choose.
            </span>
          </span>
        </label>
        {error ? <p className="alert alert--bad">{error}</p> : null}
        <div className="actions">
          <button type="submit" className="btn btn--primary" disabled={!ready || busy}>
            {busy ? "Publishing…" : "Publish release…"}
          </button>
          <button type="button" className="link-btn" onClick={() => setExternal((v) => !v)}>
            {external ? "Upload the .msi instead" : "Hosted elsewhere? Use a link"}
          </button>
          {!ready && missing ? <small className="muted">{missing}</small> : null}
        </div>
      </form>

      {confirm ? (
        <ConfirmDialog
          title={`Publish Zinwe ${version.trim()}${required ? " as required" : ""}?`}
          confirmLabel={required ? "Publish as required" : "Publish"}
          danger={required}
          onClose={() => setConfirm(null)}
          onConfirm={submit}
        >
          {required ? (
            <p>
              <b>{pcsText}</b> will <b>pause log in, breaks and log out</b> until their member installs the update. Use
              this only for an urgent fix.
            </p>
          ) : (
            <p>
              <b>{pcsText}</b> will see “Update now” within a minute. Members choose when to install it; nothing pauses.
            </p>
          )}
          {confirm !== "unknown" ? (
            <p className="confirm__note">
              {confirm.total} PC{confirm.total === 1 ? " is" : "s are"} connected in all; {confirm.total - confirm.older} already
              run {version.trim()} or newer.
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
