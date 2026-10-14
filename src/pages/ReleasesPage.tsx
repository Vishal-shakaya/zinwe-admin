import { useCallback, useState, type FormEvent, type ReactElement } from "react";
import { getReleases, publishRelease, updateRelease, type AgentRelease } from "../lib/api";
import { dateTime } from "../lib/format";
import { useLoad } from "../lib/useLoad";
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
          <span className="muted">Build the MSI (window-app\build.ps1 -Version x.y.z) and publish it above.</span>
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

/** Upload the MSI (or link an externally hosted one + its SHA-256), add notes, choose required/optional. */
function PublishForm({ onPublished }: { onPublished: () => void }): ReactElement {
  const toast = useToast();
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [required, setRequired] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [external, setExternal] = useState(false);
  const [url, setUrl] = useState("");
  const [sha256, setSha256] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0); // resets the file input after publishing

  const ready = /^\d+(\.\d+){1,3}$/.test(version.trim()) && (external ? url.trim() && sha256.trim().length === 64 : file);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
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
      setFormKey((k) => k + 1);
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't publish.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form key={formKey} className="card" onSubmit={submit} style={{ marginBottom: 20 }}>
      <h2 className="card__title">Publish a release</h2>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 16 }}>
        <label className="field">
          <span>Version</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="0.3.0" required />
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
          <input className="mono" value={sha256} onChange={(e) => setSha256(e.target.value)} placeholder="64 hex characters" />
        </label>
      ) : null}
      <label className="field">
        <span>What's new (shown to members above the Update button)</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} style={{ width: "100%", resize: "vertical" }} />
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "4px 0 12px" }}>
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        <span>
          <b>Required</b>
          <span className="muted">
            {" "}
            — PCs on an older version pause log in, breaks and log out until they install it. Protection stays on.
          </span>
        </span>
      </label>
      {error ? <p className="alert alert--bad">{error}</p> : null}
      <div className="actions">
        <button type="submit" className="btn btn--primary" disabled={!ready || busy}>
          {busy ? "Publishing…" : "Publish release"}
        </button>
        <button type="button" className="link-btn" onClick={() => setExternal((v) => !v)}>
          {external ? "Upload the .msi instead" : "Hosted elsewhere? Use a link"}
        </button>
      </div>
    </form>
  );
}
