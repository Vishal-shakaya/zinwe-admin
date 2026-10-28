import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { getReleaseReach, getReleases, publishRelease, updateRelease, type AgentRelease } from "../lib/api";
import { dateTime } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { useAdminEnv } from "../lib/env";
import {
  AGENT_VERSIONS_EXACT,
  AGENT_VERSIONS_IN_USE,
  MIN_AGENT_VERSION,
  MIN_VERSION_OPTIONS,
  SIGNER,
} from "../content/fixtures/releases";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorState, LoadingState, SampleTag } from "../components/States";
import { Icon, PathIcon } from "../components/icons";
import { useToast } from "../components/Toast";
import "../styles/releases.css";

const COPY_D =
  "M8 8h12v12H8zM16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8";
const VERSION_RE = /^\d+(\.\d+){1,3}$/;
const SHA_RE = /^[0-9a-fA-F]{64}$/;

function megabytes(size: number | null): string {
  return size === null ? "—" : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function cmp(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

function fileName(r: AgentRelease): string {
  const tail = r.download_url ? decodeURIComponent(r.download_url.split("?")[0].split("/").pop() ?? "") : "";
  return tail.toLowerCase().endsWith(".msi") ? tail : `ZinweSetup-${r.version}.msi`;
}

function shaShort(sha: string): string {
  return sha.length > 20 ? `${sha.slice(0, 10)}…${sha.slice(-6)}` : sha;
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

interface ConfirmRow {
  k: string;
  v: string;
  mono?: boolean;
}
interface ConfirmSpec {
  title: string;
  lead: string;
  rows: ConfirmRow[];
  note: string;
  go: string;
  run: () => Promise<void>;
}

/** Board confirmation: title, one line, a grey fact box, a note, Cancel + the action. */
function ConfirmBox({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await spec.run();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t do that.");
      setBusy(false);
    }
  };
  return (
    <Modal
      title={spec.title}
      size="small"
      role="alertdialog"
      className="rl-dialog"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn dark" disabled={busy} onClick={() => void go()}>
            {busy ? "Working…" : spec.go}
          </button>
        </>
      }
    >
      <p className="rl-dialog__lead">{spec.lead}</p>
      <dl className="rl-dialog__facts">
        {spec.rows.map((r) => (
          <div key={r.k}>
            <dt className="k">{r.k}</dt>
            <dd className={r.mono ? "mono rl-dialog__mono" : undefined}>{r.v}</dd>
          </div>
        ))}
      </dl>
      <p className="k" style={{ margin: 0 }}>
        {spec.note}
      </p>
      {error ? (
        <p className="err-box" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

/**
 * Windows agent releases (AdminReleases board). Publishing offers it to every PC on an older version within a
 * minute: the tray app shows "Update now" (download, SHA-256 check, silent install). A required release also
 * pauses Start day / Take a break / End day until the PC has updated.
 */
export function ReleasesPage(): ReactElement {
  const load = useCallback(() => getReleases(), []);
  const { data, error, reload } = useLoad(load);
  const toast = useToast();
  const env = useAdminEnv();
  const envLabel = env === "prod" ? "Prod" : "Dev";
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [connected, setConnected] = useState<number | null>(null);
  const flowRef = useRef<HTMLElement>(null);

  // Connected PCs in all (the reach of an impossible version = every PC).
  useEffect(() => {
    let alive = true;
    getReleaseReach("9999.0.0")
      .then((r) => alive && setConnected(r.total))
      .catch(() => alive && setConnected(null));
    return () => {
      alive = false;
    };
  }, [data]);

  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => cmp(b.version, a.version)), [data]);
  const current = sorted.find((r) => r.is_active) ?? null;
  const total = current?.adoption.total ?? connected ?? 0;

  /** PCs exactly on a version = updated(this) − updated(next newer active release). */
  const pcsOn = (r: AgentRelease): number | null => {
    if (!r.is_active) return null;
    const newer = sorted.filter((x) => x.is_active && cmp(x.version, r.version) > 0);
    const next = newer[newer.length - 1];
    return Math.max(0, r.adoption.updated - (next ? next.adoption.updated : 0));
  };

  const patch = async (r: AgentRelease, p: Parameters<typeof updateRelease>[1], done: string) => {
    setBusyId(r.id);
    try {
      await updateRelease(r.id, p);
      toast(done);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t save.", "bad");
    } finally {
      setBusyId(null);
    }
  };

  const askRequired = (r: AgentRelease) => {
    if (r.required) {
      void patch(r, { required: false }, `Zinwe ${r.version} is now optional.`);
      return;
    }
    const older = Math.max(0, r.adoption.total - r.adoption.updated);
    setConfirm({
      title: `Make Zinwe ${r.version} required?`,
      lead: `This applies to all ${r.adoption.total} PCs on ${envLabel}.`,
      rows: [
        {
          k: "PCs affected",
          v:
            `${older} of ${r.adoption.total} PCs are on an older version and must update` +
            (r.adoption.updated ? `. ${r.adoption.updated} already have ${r.version}.` : "."),
        },
        {
          k: "What they see",
          v: `The tray app shows “Update needed: Zinwe ${r.version}” with Update now. Start day, Take a break and End day wait until it is installed, about a minute.`,
        },
        { k: "Use it for", v: "Security fixes. Anything else can stay optional." },
      ],
      note: "You can make it optional again at any time.",
      go: "Make required",
      run: async () => {
        await updateRelease(r.id, { required: true });
        toast(`Zinwe ${r.version} is now required for ${older} PCs.`);
        reload();
      },
    });
  };

  const askWithdraw = (r: AgentRelease) => {
    setConfirm({
      title: `Withdraw Zinwe ${r.version}?`,
      lead: "PCs stop being offered this version within a minute.",
      rows: [
        { k: "Installer", v: `${fileName(r)} · ${megabytes(r.size)}` },
        { k: "PCs on it", v: `${pcsOn(r) ?? 0} PCs keep it; nobody else gets it.` },
      ],
      note: "You can restore it later from All releases.",
      go: "Withdraw",
      run: async () => {
        await updateRelease(r.id, { is_active: false });
        toast(`Zinwe ${r.version} withdrawn.`);
        reload();
      },
    });
  };

  const openFlow = () => {
    setFlowOpen(true);
    window.setTimeout(() => flowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const copy = (text: string, msg: string) => {
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* ignore */
    }
    toast(msg);
  };

  return (
    <>
      <PageHeader
        title="Releases"
        subtitle="Windows agent installers. A new release reaches every PC on an older version within a minute: the tray app shows Update now, checks the SHA-256 and installs silently."
      >
        <button type="button" className="btn dark" onClick={openFlow}>
          <Icon name="plus" />
          New release
        </button>
      </PageHeader>

      <div className="rl-env">
        <span className="k" style={{ fontWeight: 600 }}>
          Environment
        </span>
        <span className={"pill " + (env === "prod" ? "dark" : "rl-pill-dev")}>{envLabel}</span>
        <span className="k">
          {window.location.host} · {total} PCs · set in the admin menu, not on this page
        </span>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <div className="rl-grid">
          <LoadingState rows={6} />
          <LoadingState rows={6} />
        </div>
      ) : (
        <div className="rl-grid">
          {current ? (
            <CurrentCard
              r={current}
              envLabel={envLabel}
              busy={busyId === current.id}
              onCopy={() => copy(current.sha256, `SHA-256 of Zinwe ${current.version} copied.`)}
              onRequired={() => askRequired(current)}
              onWithdraw={() => askWithdraw(current)}
            />
          ) : (
            <section className="card">
              <EmptyState
                icon="releases"
                title="No releases yet"
                body="When there’s a new version of the Windows app, ask the developers for its installer (the .msi file), then publish it with New release."
                action={
                  <button type="button" className="btn dark" onClick={openFlow}>
                    <Icon name="plus" />
                    New release
                  </button>
                }
              />
            </section>
          )}
          <VersionsCard
            latest={current?.version ?? null}
            envLabel={envLabel}
            onAskMin={(spec) => setConfirm(spec)}
            onSay={(m) => toast(m)}
          />
        </div>
      )}

      {flowOpen ? (
        <NewRelease
          sectionRef={flowRef}
          current={current}
          env={env}
          envLabel={envLabel}
          onAsk={setConfirm}
          onCopy={copy}
          onPublished={reload}
          onDone={() => setFlowOpen(false)}
        />
      ) : null}

      <section id="rel-list" className="card rl-list" aria-labelledby="list-h">
        <div className="rl-list__head">
          <h2 id="list-h">All releases</h2>
          <span className="k">Every PC on an older version is offered the newest live release. Withdrawn ones are offered to nobody.</span>
        </div>
        {error ? null : !data ? (
          <LoadingState rows={4} bare />
        ) : sorted.length === 0 ? (
          <EmptyState title="No releases yet" body="Published installers show here with how many PCs run each one." icon="releases" />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl rl-tbl">
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Update</th>
                  <th scope="col">Published</th>
                  <th scope="col" className="r">
                    PCs on it
                  </th>
                  <th scope="col">Notes</th>
                  <th scope="col">
                    <span className="sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const on = pcsOn(r);
                  const isCur = current?.id === r.id;
                  return (
                    <tr key={r.id} className={r.is_active ? undefined : "is-gone"}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <b>Zinwe {r.version}</b>
                        {isCur ? <span className="pill good rl-cur">Current</span> : null}
                        <div className="k mono">
                          {r.hosted === "upload" ? fileName(r) : "External link"} · {megabytes(r.size)}
                        </div>
                      </td>
                      <td>
                        {r.is_active ? (
                          <span className={"pill " + (env === "prod" ? "dark" : "rl-pill-dev")}>
                            {env === "prod" ? "Prod" : "Dev only"}
                          </span>
                        ) : (
                          <span className="pill rl-pill-gone">Withdrawn</span>
                        )}
                      </td>
                      <td>
                        {!r.is_active ? (
                          <span className="pill rl-pill-none">—</span>
                        ) : r.required ? (
                          <span className="pill warn">Required</span>
                        ) : (
                          <span className="pill rl-pill-opt">Optional</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {dateTime(r.published_at)}
                        {r.published_by ? <div className="k">{r.published_by}</div> : null}
                      </td>
                      <td className="num r" style={{ fontWeight: 600 }}>
                        {on === null || on === 0 ? "—" : on}
                      </td>
                      <td className="rl-notes">{r.notes || <span className="k">No notes</span>}</td>
                      <td>
                        <div className="rl-actions">
                          {r.is_active ? (
                            isCur ? null : (
                              <>
                                <button
                                  type="button"
                                  className="btn sm"
                                  disabled={busyId === r.id}
                                  onClick={() => askRequired(r)}
                                >
                                  {r.required ? "Make optional" : "Make required"}
                                </button>
                                <button
                                  type="button"
                                  className="btn sm danger"
                                  disabled={busyId === r.id}
                                  onClick={() => askWithdraw(r)}
                                >
                                  Withdraw
                                </button>
                              </>
                            )
                          ) : (
                            <button
                              type="button"
                              className="btn sm"
                              disabled={busyId === r.id}
                              onClick={() => void patch(r, { is_active: true }, `Zinwe ${r.version} offered again.`)}
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="k" style={{ margin: 0 }}>
        Every installer is checked against the signer thumbprint pinned in ZinweSigners before it is offered. Releases and
        promotions are written to Logs.
      </p>

      {confirm ? <ConfirmBox spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </>
  );
}

function Fact({ k, children, center }: { k: string; children: ReactNode; center?: boolean }): ReactElement {
  return (
    <div className={"rl-fact" + (center ? " is-center" : "")}>
      <dt className="k">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function CurrentCard({
  r,
  envLabel,
  busy,
  onCopy,
  onRequired,
  onWithdraw,
}: {
  r: AgentRelease;
  envLabel: string;
  busy: boolean;
  onCopy: () => void;
  onRequired: () => void;
  onWithdraw: () => void;
}): ReactElement {
  const { updated, total } = r.adoption;
  const pct = total ? Math.max(2, Math.round((updated / total) * 100)) : 2;
  return (
    <section className="card rl-card" aria-labelledby="cur-h">
      <div className="rl-card__top">
        <div className="rl-card__title">
          <span className="k">Current release on {envLabel}</span>
          <h2 id="cur-h">Zinwe {r.version}</h2>
        </div>
        <div className="rl-card__pills">
          <span className={"pill " + (r.required ? "warn" : "rl-pill-opt")}>{r.required ? "Required" : "Optional"}</span>
          <span className="pill dark">Live on {envLabel}</span>
        </div>
      </div>
      <dl className="rl-facts">
        <Fact k="Published">
          {dateTime(r.published_at)} {r.published_by ? <span className="k">· {r.published_by}</span> : null}
        </Fact>
        <Fact k="Installer">
          <span className="mono" style={{ fontSize: 13 }}>
            {r.hosted === "upload" ? fileName(r) : "External link"}
          </span>{" "}
          <span className="k">· {megabytes(r.size)}</span>
        </Fact>
        <Fact k="SHA-256" center>
          <span className="rl-flex">
            <span className="mono rl-sha" title={r.sha256}>
              {shaShort(r.sha256)}
            </span>
            <button type="button" className="btn sm" aria-label="Copy SHA-256" onClick={onCopy}>
              <PathIcon d={COPY_D} size={14} />
              Copy
            </button>
          </span>
        </Fact>
        <Fact k="Signed by">
          <span className="rl-col">
            <span>
              {SIGNER.name} <span className="k mono">· {SIGNER.thumbprint}</span> <SampleTag />
            </span>
            <span className="pill warn">
              <Icon name="warn" size={13} strokeWidth={2} />
              {SIGNER.pending}
            </span>
          </span>
        </Fact>
        <Fact k="PCs updated" center>
          <span className="rl-col" style={{ alignItems: "stretch" }}>
            <span>
              <b className="num">
                {updated} of {total}
              </b>{" "}
              <span className="k">· the rest see Update now</span>
            </span>
            <span className="bar" role="img" aria-label={`${updated} of ${total} PCs updated`}>
              <span style={{ width: `${pct}%` }} />
            </span>
          </span>
        </Fact>
      </dl>
      {r.notes ? <p className="rl-notebox">{r.notes}</p> : null}
      <div className="rl-card__actions">
        <button type="button" className="btn" disabled={busy} onClick={onRequired}>
          {r.required ? "Make optional" : "Make required"}
        </button>
        <a className="btn" href="#rel-list">
          All releases
        </a>
        <button type="button" className="btn danger" style={{ marginLeft: "auto" }} disabled={busy} onClick={onWithdraw}>
          Withdraw
        </button>
      </div>
    </section>
  );
}

/** Agent versions in use + minimum version: SAMPLE (content/fixtures/releases.ts). */
function VersionsCard({
  latest,
  envLabel,
  onAskMin,
  onSay,
}: {
  latest: string | null;
  envLabel: string;
  onAskMin: (spec: ConfirmSpec) => void;
  onSay: (m: string) => void;
}): ReactElement {
  const [minVer, setMinVer] = useState(MIN_AGENT_VERSION);
  const [minSaved, setMinSaved] = useState(MIN_AGENT_VERSION);
  const all = AGENT_VERSIONS_IN_USE.reduce((a, u) => a + u.pcs, 0);
  const below = AGENT_VERSIONS_EXACT.filter(([v]) => cmp(v, minVer) < 0).reduce((a, [, n]) => a + n, 0);
  const latestUse = latest ?? AGENT_VERSIONS_IN_USE[0].label;
  const onLatest = AGENT_VERSIONS_IN_USE.find((u) => u.label === latestUse)?.pcs ?? 0;
  const toUpdate = all - onLatest;
  const aria = `Of ${all} PCs: ${AGENT_VERSIONS_IN_USE.map((u) => `${u.pcs} on ${u.label}`).join(", ")}`;

  const askMin = () =>
    onAskMin({
      title: `Set the minimum version to ${minVer}?`,
      lead: below ? `${below} of ${all} PCs are below ${minVer}.` : `Every PC on ${envLabel} already meets ${minVer}.`,
      rows: [
        { k: "PCs affected", v: `${below} of ${all} PCs` },
        {
          k: "What they see",
          v: below
            ? "The tray app says “Zinwe needs an update to keep working” with Update now. They can’t start their day until they update."
            : "Nothing changes for anyone today.",
        },
        { k: "Minimum now", v: minSaved },
      ],
      note: below > 20 ? "That is a lot of PCs. Check the list in Customers › PCs first." : "You can change it again at any time.",
      go: "Set minimum",
      run: async () => {
        setMinSaved(minVer);
        onSay(`Minimum agent version is now ${minVer}. (Sample data: not saved yet.)`);
      },
    });

  return (
    <section className="card rl-card" aria-labelledby="use-h">
      <div className="rl-use__head">
        <h2 id="use-h">
          Agent versions in use <SampleTag />
        </h2>
        <span className="k">
          {envLabel} · {all} PCs · last heartbeat in 24 h
        </span>
      </div>
      <div role="img" aria-label={aria} className="rl-stack">
        {AGENT_VERSIONS_IN_USE.map((u) => (
          <span key={u.label} style={{ flex: `${u.pcs} 1 0`, background: u.colour }} />
        ))}
      </div>
      <ul className="rl-use">
        {AGENT_VERSIONS_IN_USE.map((u) => (
          <li key={u.label}>
            <span className="rl-sw" style={{ background: u.colour }} />
            <b className="mono">{u.label}</b>
            <span className="num" style={{ textAlign: "right" }}>
              <b>{u.pcs}</b> <span className="k">PCs</span>
            </span>
            <span className="rl-flex">
              <span className="k num">{((u.pcs / all) * 100).toFixed(u.pcs < 10 ? 1 : 0)}%</span>
              {cmp(u.lowest, minSaved) < 0 ? <span className="pill bad">Below minimum</span> : null}
              {u.label === latestUse ? <span className="pill good">Latest</span> : null}
              {u.note ? <span className="k">{u.note}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <div className="rl-toupdate">
        <span>
          <b className="num" style={{ fontSize: 18 }}>
            {toUpdate}
          </b>{" "}
          PCs to update <span className="k">· not on {latestUse} yet</span>
        </span>
        <button
          type="button"
          className="btn sm"
          onClick={() => onSay(`${toUpdate} PCs to update. The PC list by version comes with the versions API.`)}
        >
          See the PCs
        </button>
      </div>
      <div className="rl-min">
        <label className="lab" htmlFor="minv">
          Minimum agent version
        </label>
        <div className="rl-flex" style={{ gap: 8 }}>
          <select id="minv" className="inp mono rl-minsel" value={minVer} onChange={(e) => setMinVer(e.target.value)}>
            {MIN_VERSION_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <button type="button" className="btn dark" disabled={minVer === minSaved} onClick={askMin}>
            Save
          </button>
        </div>
        <span className={below > 20 ? "rl-min__note is-bad" : "rl-min__note"}>
          {below === 0
            ? "Every PC meets this. Older PCs can’t start their day until they update."
            : `${below}${below === 1 ? " PC is" : " PCs are"} below ${minVer} and can’t start their day until ${below === 1 ? "it updates" : "they update"}.`}
        </span>
      </div>
    </section>
  );
}

type Stage = "idle" | "reading" | "ready" | "published";

/** New release: upload the MSI (or link + SHA-256) → check → notes → publish (reach confirmation first). */
function NewRelease({
  sectionRef,
  current,
  env,
  envLabel,
  onAsk,
  onCopy,
  onPublished,
  onDone,
}: {
  sectionRef: RefObject<HTMLElement | null>;
  current: AgentRelease | null;
  env: "prod" | "dev";
  envLabel: string;
  onAsk: (spec: ConfirmSpec) => void;
  onCopy: (text: string, msg: string) => void;
  onPublished: () => void;
  onDone: () => void;
}): ReactElement {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [external, setExternal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [sha, setSha] = useState("");
  const [url, setUrl] = useState("");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  // Optional unless switched on (J8-06): a required update pauses Start day / breaks / End day on every older PC.
  const [required, setRequired] = useState(false);
  const [published, setPublished] = useState<string | null>(null);

  const pick = async (f: File | null) => {
    setFile(f);
    if (!f) {
      setStage("idle");
      return;
    }
    const v = f.name.match(/(\d+\.\d+\.\d+(?:\.\d+)?)/)?.[1] ?? "";
    setVersion(v);
    setStage("reading");
    try {
      setSha(await sha256Hex(f));
    } catch {
      setSha("");
    }
    setStage("ready");
    toast("File read. Version and SHA-256 checked.");
  };

  const v = version.trim();
  const versionOk = VERSION_RE.test(v);
  const higher = versionOk && (!current || cmp(v, current.version) > 0);
  const shaOk = SHA_RE.test(sha.trim());
  const urlOk = /^https:\/\/\S+$/.test(url.trim());
  const hasSource = external ? urlOk && shaOk : Boolean(file) && stage === "ready";
  const ready = hasSource && versionOk && higher;
  const missing = external
    ? !urlOk
      ? "Paste the https download link."
      : !shaOk
        ? "Paste the SHA-256 of the .msi (64 letters and digits)."
        : null
    : !file
      ? "Choose the .msi file."
      : null;

  const stepIdx = published ? 4 : ready ? 3 : external || file ? 2 : 1;
  const STEPS = ["Upload", "Check", "Notes", "Dev, then Prod"];
  const size = file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "";

  const askPublish = async () => {
    if (!ready) return;
    let reach: { older: number; total: number } | null = null;
    try {
      reach = await getReleaseReach(v);
    } catch {
      reach = null;
    }
    const pcs = reach ? `${reach.older} PCs` : "Every PC on an older version";
    const all = reach ? `${reach.total}` : "all";
    onAsk({
      title: `Publish Zinwe ${v} to ${envLabel}?`,
      lead: required
        ? `It is a required update. ${pcs} on ${envLabel} get it within a minute, and nobody can start their day until it is installed.`
        : `${pcs} on ${envLabel} see Update now within a minute. People choose when to install it.`,
      rows: [
        { k: "Installer", v: external ? url.trim() : `${file?.name ?? ""} · ${size}` },
        { k: "SHA-256", v: sha.trim() || "Computed on the server after upload", mono: Boolean(sha.trim()) },
        { k: "Signed by", v: `${SIGNER.name} · thumbprint ${SIGNER.thumbprint} · self-signed, OV certificate pending` },
        {
          k: "PCs affected",
          v: reach
            ? `${reach.older} of ${all} PCs on ${envLabel} · ${required ? "required" : "optional"} · ${reach.total - reach.older} already run ${v} or newer`
            : `Every PC on an older version · ${required ? "required" : "optional"}`,
        },
        {
          k: "What they see",
          v: required
            ? "The tray app shows “Update needed” with Update now. Start day waits until the install finishes, about a minute."
            : "The tray app shows Update now. They pick when.",
        },
      ],
      note: "Check the SHA-256 matches the build you signed. You can withdraw it later; PCs that already installed it keep it.",
      go: `Publish to ${envLabel}`,
      run: async () => {
        const release = await publishRelease({
          version: v,
          notes: notes.trim(),
          required,
          ...(external ? { download_url: url.trim(), sha256: sha.trim() } : { file }),
        });
        setPublished(release.version);
        setStage("published");
        toast(`Zinwe ${release.version} published to ${envLabel}. PCs get it within a minute.`);
        onPublished();
      },
    });
  };

  return (
    <section ref={sectionRef} id="new-rel" className="card rl-new" aria-labelledby="new-h">
      <div className="rl-new__head">
        <div className="rl-card__title">
          <h2 id="new-h" style={{ fontSize: 16 }}>
            New release
          </h2>
          <span className="k">
            {env === "dev"
              ? "Goes to Dev first. Promote it to Prod once it works on the test PCs."
              : "Publish it on Dev first and check it on the test PCs, then publish the same file here."}
          </span>
        </div>
        <ol aria-label="Steps" className="rl-steps">
          {STEPS.map((l, i) => (
            <li
              key={l}
              className={"pill " + (i + 1 < stepIdx ? "good" : i + 1 === stepIdx ? "dark" : "rl-pill-step")}
              aria-current={i + 1 === stepIdx ? "step" : undefined}
            >
              <span className="num">{i + 1}</span> {l}
            </li>
          ))}
        </ol>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".msi"
        className="sr"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void pick(e.target.files?.[0] ?? null)}
      />

      {!external && !file ? (
        <div
          className="rl-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void pick(f);
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3E4147" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 15V4M7 9l5-5 5 5" />
            <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
          </svg>
          <b>Drop the installer here</b>
          <span className="k">Windows installer (.msi), up to 300 MB. The version is read from the file name and the SHA-256 from the file.</span>
          <div className="rl-flex" style={{ justifyContent: "center", gap: 8 }}>
            <button type="button" className="btn dark" onClick={() => fileRef.current?.click()}>
              Choose .msi file
            </button>
            <button type="button" className="btn" onClick={() => setExternal(true)}>
              Hosted elsewhere? Use a link
            </button>
          </div>
        </div>
      ) : null}

      {external && !published ? (
        <div className="rl-linkbox">
          <div className="rl-field">
            <label className="lab" htmlFor="rl-url">
              Download link (https)
            </label>
            <input
              id="rl-url"
              className={"inp mono" + (url.trim() && !urlOk ? " bad" : "")}
              value={url}
              placeholder="https://…/ZinweSetup-1.3.0.msi"
              onChange={(e) => {
                setUrl(e.target.value);
                const m = e.target.value.match(/(\d+\.\d+\.\d+(?:\.\d+)?)/)?.[1];
                if (m && !version) setVersion(m);
              }}
            />
          </div>
          <div className="rl-field">
            <label className="lab" htmlFor="rl-sha">
              SHA-256 of the .msi
            </label>
            <input
              id="rl-sha"
              className={"inp mono" + (sha.trim() && !shaOk ? " bad" : "")}
              value={sha}
              placeholder="64 letters and digits, from the developers"
              onChange={(e) => setSha(e.target.value)}
            />
            {sha.trim() && !shaOk ? <span className="field-err">That isn’t 64 letters and digits.</span> : null}
          </div>
          <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setExternal(false)}>
            Upload the .msi instead
          </button>
        </div>
      ) : null}

      {!external && file ? (
        <div className="rl-file">
          <span className="rl-file__icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2B2F35" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
              <path d="M14 3.5V8h4.5" />
            </svg>
          </span>
          <div className="rl-file__main">
            <div className="rl-file__row">
              <b className="mono" style={{ fontSize: 13 }}>
                {file.name}
              </b>
              <span className="k num">
                {stage === "reading" ? `Reading the file · ${size}` : published ? `Uploaded · ${size}` : `Ready to upload · ${size}`}
              </span>
            </div>
            <span
              className="bar"
              role="progressbar"
              aria-label="File check"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={stage === "reading" ? 50 : 100}
            >
              <span style={{ width: stage === "reading" ? "50%" : "100%", background: stage === "reading" ? undefined : "#17603A" }} />
            </span>
          </div>
          {!published ? (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setFile(null);
                setSha("");
                setStage("idle");
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              Replace
            </button>
          ) : null}
        </div>
      ) : null}

      {(external || (file && stage !== "reading")) ? (
        <div className="rl-ready">
          <div className="rl-checks">
            <div className="rl-check">
              <label className="k" htmlFor="rl-ver">
                Version
              </label>
              <span className="rl-flex">
                <input
                  id="rl-ver"
                  className={"inp mono rl-ver" + (v && !versionOk ? " bad" : "")}
                  value={version}
                  placeholder="1.3.0"
                  disabled={Boolean(published)}
                  onChange={(e) => setVersion(e.target.value)}
                />
                <span className="k">
                  {!v
                    ? "Type the version, like 1.3.0."
                    : !versionOk
                      ? "Use numbers with dots, like 1.4.0 (no letters or spaces)."
                      : current
                        ? higher
                          ? `· read from the file name · higher than ${current.version}, the current ${envLabel} release`
                          : `· not higher than ${current.version}, the current ${envLabel} release`
                        : "· read from the file name · the first release"}
                </span>
              </span>
              {versionOk ? (
                <span className={"pill " + (higher ? "good" : "bad")}>
                  <span className="dot" />
                  {higher ? "OK" : "Too low"}
                </span>
              ) : (
                <span />
              )}
            </div>
            <div className="rl-check">
              <span className="k">SHA-256</span>
              <span className="rl-col" style={{ gap: 2, minWidth: 0 }}>
                <span className="mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                  {shaOk ? sha.trim() : "—"}
                </span>
                <span className="k">
                  {external
                    ? "From the developers. PCs check it before they install."
                    : "Read in your browser; the server computes it again after upload. PCs check it before they install."}
                </span>
              </span>
              {shaOk ? (
                <button
                  type="button"
                  className="btn sm"
                  aria-label="Copy SHA-256 of the new installer"
                  onClick={() => onCopy(sha.trim(), `SHA-256 of Zinwe ${v || "the new installer"} copied.`)}
                >
                  <PathIcon d={COPY_D} size={14} />
                  Copy
                </button>
              ) : (
                <span />
              )}
            </div>
            <div className="rl-check">
              <span className="k">Signature</span>
              <span className="rl-col">
                <span>
                  Signed by {SIGNER.name}{" "}
                  <span className="k">
                    · thumbprint <span className="mono">{SIGNER.thumbprint}</span>, pinned in ZinweSigners
                  </span>{" "}
                  <SampleTag />
                </span>
                <span className="pill warn">{SIGNER.pending}</span>
              </span>
              <span className="k">PCs check it</span>
            </div>
          </div>

          <div className="rl-field">
            <label className="lab" htmlFor="notes">
              What's new{" "}
              <span className="k" style={{ fontWeight: 400 }}>
                · shown to members above the Update button
              </span>
            </label>
            <textarea
              id="notes"
              className="ta"
              rows={3}
              maxLength={2000}
              value={notes}
              disabled={Boolean(published)}
              onChange={(e) => setNotes(e.target.value)}
            />
            <span className="k">Plain sentences. The full customer note goes on the What's new page.</span>
          </div>

          <div className="rl-col" style={{ gap: 8, alignItems: "stretch" }}>
            <label className="sw rl-req">
              <input
                type="checkbox"
                role="switch"
                checked={required}
                disabled={Boolean(published)}
                onChange={(e) => setRequired(e.target.checked)}
                aria-describedby="req-help"
              />
              <span className="tr">
                <span />
              </span>
              <span className="rl-col" style={{ gap: 0 }}>
                <span className="lab">Required update</span>
                <span id="req-help" className="k" style={{ fontWeight: 400 }}>
                  Off: members choose when to update. On: the update must be installed first.
                </span>
              </span>
            </label>
            {required ? (
              <div role="note" className="rl-warn">
                <Icon name="warn" size={18} />
                <span>
                  <b>PCs can't start their day until they update.</b> Start day, Take a break and End day wait on every older
                  PC until the install finishes. Use it for security fixes.
                </span>
              </div>
            ) : null}
          </div>

          <div className="rl-new__foot">
            {published ? (
              <div className="rl-flex" style={{ gap: 10, width: "100%" }}>
                <span className={"pill " + (env === "prod" ? "dark" : "rl-pill-dev")}>{envLabel}</span>
                <span style={{ flex: "1 1 260px" }}>
                  Zinwe {published} is live on {envLabel}. PCs see Update now within a minute.
                </span>
                <Link className="btn" to="/whats-new">
                  Write the release note
                </Link>
                <button type="button" className="btn" onClick={onDone}>
                  Done
                </button>
              </div>
            ) : (
              <div className="rl-flex" style={{ gap: 10 }}>
                <button type="button" className="btn dark" disabled={!ready} onClick={() => void askPublish()}>
                  Publish to {envLabel}
                </button>
                <span className="k">
                  {!ready && missing
                    ? missing
                    : env === "dev"
                      ? "Only the test PCs on Dev get it."
                      : "Every PC on Prod on an older version gets it."}
                </span>
                <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={onDone}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
