import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import {
  actOnContact, campaignAction, createCampaign, getAudiences, getBlocked, getCampaign, getCampaigns, getContacts, importContacts, patchCampaign, saveEmail,
  type Audience, type CampaignDetail, type Contact, type ContactStatus, type ImportResult, type Sender,
} from "../../lib/marketingApi";
import { useLoad } from "../../lib/useLoad";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";
import { ErrorState, LoadingState } from "../../components/States";
import { useToast } from "../../components/Toast";
import { GOALS, THEMES } from "./data";
import { FLOW_DIAGRAM } from "./flowDiagram";
import "../../styles/marketing.css";

const TABS: [string, string][] = [["home", "Home"], ["campaigns", "Campaigns"], ["flow", "Flow"], ["emails", "Emails"], ["contacts", "Contacts"], ["replies", "Replies"], ["reports", "Reports"], ["settings", "Settings"]];
const STATUS: Record<ContactStatus, [string, string]> = {
  new: ["Ready", ""], cold: ["Cold", "warn"], waiting: ["Waiting for reply", "warn"], opted: ["Opted in", "good"], signed: ["Signed up", "good"],
  paused: ["Paused", "warn"], snoozed: ["Snoozed", ""], closed: ["Closed", ""], finished: ["Finished", ""], suppressed: ["Do not email", "bad"],
};
const SENDABLE: ContactStatus[] = ["new", "cold", "opted", "signed"];
const RULES = [
  ["Yes", "Opted in", "good", "Save the reply as proof and send the next setup email"],
  ["Signed up, no reply", "Signed up", "good", "Emails 3–5 only; Email 5 asks for a “yes”"],
  ["Installed", "No change", "", "Skip Emails 3–4"],
  ["No reply after Email 2", "Closed", "", "Stop, no more emails"],
  ["Not now", "Snoozed", "warn", "Stop; check back once only if they agree to a date"],
  ["Question", "Paused", "warn", "Wait until you reply personally"],
  ["Out of office", "No change", "", "Flow continues"],
  ["No or unsubscribe", "Do not email", "bad", "Block the same day, never add back"],
  ["Hard bounce", "Do not email", "bad", "Block and check the address"],
  ["Spam complaint", "Do not email", "bad", "Block and pause all sending"],
  ["Wrong person", "Do not email", "bad", "Add someone only if they name the right contact"],
];

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const isDue = (c: Contact) => SENDABLE.includes(c.status) && c.next_email > 0 && !!c.next_date && c.next_date <= today();
const fill = (text: string, c: { first_name: string; firm: string }) => text.replace(/\{\{FirstName\}\}/g, c.first_name).replace(/\{\{Firm\}\}/g, c.firm);
const nice = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—");
const Pill = ({ s }: { s: ContactStatus }) => <span className={"pill " + STATUS[s][1]}>{STATUS[s][0]}</span>;

interface Ctx {
  c: CampaignDetail;
  sender: Sender;
  contacts: Contact[];
  run: (work: () => Promise<unknown>, done?: string) => Promise<boolean>;
  go: (tab: string) => void;
  openContact: (c: Contact) => void;
}

function Checks({ c }: { c: CampaignDetail }): ReactElement {
  return (
    <div className="todo">
      {c.checks.map((x) => (
        <div key={x.key} className={x.done ? "done" : ""}>
          <span className={"pill " + (x.done ? "good" : "warn")}>{x.done ? "Done" : "To do"}</span>
          <span>{x.label}</span>
        </div>
      ))}
    </div>
  );
}

function Health({ c }: { c: CampaignDetail }): ReactElement {
  const h = c.report.health;
  const tiles: [string, string, string][] = [
    ["Bounce rate", `${h.bounce_rate}%`, "Keep under 3%"],
    ["Unsubscribe rate", `${h.unsubscribe_rate}%`, "Keep under 0.5%"],
    ["Spam complaints", String(h.complaints), "Pause at any complaint"],
  ];
  return (
    <section className="card editor">
      <h2>List health</h2>
      <div className="psy">
        {tiles.map(([a, b, d]) => (
          <div key={a}><span>{a}</span><b className="hnum num">{b}</b><span>{d}</span></div>
        ))}
      </div>
    </section>
  );
}

function HomeTab({ c, go }: Ctx): ReactElement {
  const todo: [number, string, string, string][] = [
    [c.ready_today, "emails ready for your approval", "Review", "contacts"],
    [c.counts.paused, "replies waiting for your answer", "Open replies", "replies"],
    [c.counts.waiting, "contacts with no reply after Email 2", "Review", "replies"],
  ];
  return (
    <>
      <div className="hgrid">
        <section className="card editor">
          <h2>What needs you today</h2>
          <div className="todo">
            {todo.map(([n, label, action, tab]) => (
              <div key={label} className={n ? "" : "done"}>
                <b className="num">{n}</b>
                <span>{label}</span>
                {n ? <button type="button" className="btn sm" onClick={() => go(tab)}>{action}</button> : <span className="k">All clear</span>}
              </div>
            ))}
          </div>
        </section>
        <section className="card editor">
          <h2>Ready to send?</h2>
          <Checks c={c} />
          <button type="button" className="btn sm mk-start" onClick={() => go("settings")}>Open settings</button>
        </section>
      </div>
      <div className="tiles">
        {c.report.funnel.map((f) => (
          <div key={f.label} className="card tile"><b>{f.value}</b><span className="k">{f.label}</span></div>
        ))}
      </div>
      <Health c={c} />
    </>
  );
}

function CampaignsTab({ c, sender, run }: Ctx): ReactElement {
  const [step, setStep] = useState(0);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [launching, setLaunching] = useState(false);
  useEffect(() => { void getAudiences().then(setAudiences).catch(() => undefined); }, []);
  const theme = THEMES.find((t) => t[0] === c.theme) ?? THEMES[0];
  const names = ["Goal and theme", "Audience", "Emails", "Schedule", "Review"];
  const save = (patch: Parameters<typeof patchCampaign>[1]) => void run(() => patchCampaign(c.id, patch), "Saved.");
  const ready = c.checks.every((x) => x.done);
  return (
    <>
      <div className="wiz" role="group" aria-label="Campaign steps">
        {names.map((n, i) => (
          <button key={n} type="button" className={i === step ? "on" : i < step ? "past" : ""} onClick={() => setStep(i)}><b>{i + 1}</b>{n}</button>
        ))}
      </div>
      <section className="card editor">
        {step === 0 ? (
          <>
            <h2>What is this campaign for?</h2>
            <div className="two">
              <label className="fl">Campaign name<input className="inp" key={c.name} defaultValue={c.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== c.name) save({ name: e.target.value.trim() }); }} /></label>
              <label className="fl">Goal
                <select className="inp" value={c.goal} onChange={(e) => save({ goal: e.target.value })}>{GOALS.map((g) => <option key={g}>{g}</option>)}</select>
              </label>
              <label className="fl">Theme
                <select className="inp" value={c.theme} onChange={(e) => save({ theme: e.target.value })}>{THEMES.map((t) => <option key={t[0]}>{t[0]}</option>)}</select>
              </label>
              <label className="fl">One urgent problem<input className="inp" key={c.problem} defaultValue={c.problem} onBlur={(e) => { if (e.target.value !== c.problem) save({ problem: e.target.value }); }} /></label>
              <label className="fl">Custom offer<input className="inp" key={c.offer} defaultValue={c.offer} onBlur={(e) => { if (e.target.value !== c.offer) save({ offer: e.target.value }); }} /></label>
            </div>
            <p className="scap">Theme tone: {theme[1]}. Opening idea: {theme[2]}</p>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <h2>Who gets this campaign?</h2>
            <label className="fl">Audience
              <select className="inp" value={c.audience} onChange={(e) => save({ audience: Number(e.target.value) })}>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </label>
            <div className="psy">
              <div><span>Contacts in this campaign</span><b className="hnum num">{c.counts.total}</b></div>
              <div><span>Due to email</span><b className="hnum num">{c.counts.due}</b></div>
              <div><span>Blocked, left out</span><b className="hnum num">{c.counts.blocked}</b></div>
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h2>Which emails will they get?</h2>
            <div className="carc">
              {[["Email 1", "Awareness and urgent problem", `${theme[2]} Then name the problem: ${c.problem.toLowerCase()}.`], ["Email 2", "Custom offer", `Invite them to try: ${c.offer.toLowerCase()}. Ask for one small yes.`], ["Emails 3–11", "Free value", `Use the “${theme[0]}” tone and give one useful win at a time.`], ["Email 12", "Upgrade", "Offer more PCs and longer history only if they’ve outgrown free."]].map((a) => (
                <div key={a[0]}><span className="k">{a[0]}</span><b>{a[1]}</b><p>{a[2]}</p></div>
              ))}
            </div>
          </>
        ) : null}
        {step === 3 ? (
          <>
            <h2>When should it send?</h2>
            <div className="psy">
              <div><span>Daily limit</span><b className="hnum num">{c.daily_limit}</b></div>
              <div><span>Sent or approved today</span><b className="hnum num">{c.sent_today}</b></div>
              <div><span>From</span><b>{sender.from}</b></div>
            </div>
            <p className="scap">Nothing goes out on a schedule. You approve each day’s batch in Contacts, then emails leave one at a time, about 45 seconds apart.</p>
          </>
        ) : null}
        {step === 4 ? (
          <>
            <h2>Check before launch</h2>
            <Checks c={c} />
            <div className="fr">
              {c.status === "active" ? <button type="button" className="btn sm" onClick={() => void run(() => campaignAction(c.id, "pause"), "Campaign paused. Nothing more will send.")}>Pause campaign</button> : <button type="button" className="btn sm dark" disabled={!ready} onClick={() => setLaunching(true)}>Approve and launch</button>}
            </div>
            <p className="scap">Launching sends nothing by itself. It lets you approve daily batches.</p>
          </>
        ) : null}
      </section>
      <div className="fr between">
        <button type="button" className="btn" disabled={!step} onClick={() => setStep(step - 1)}>Back</button>
        <button type="button" className="btn dark" disabled={step === 4} onClick={() => setStep(step + 1)}>Next</button>
      </div>
      {launching ? (
        <ConfirmDialog title="Launch this campaign?" confirmLabel="Approve and launch" onClose={() => setLaunching(false)} onConfirm={async () => { await campaignAction(c.id, "launch"); await run(async () => undefined, "Campaign launched. No email has gone out yet."); }}>
          You can then approve batches of up to {c.daily_limit} emails a day.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function FlowTab({ c, contacts, go }: Ctx): ReactElement {
  const at = (stage: string) => contacts.filter((x) => x.stage === stage).length;
  const steps: [string, string, string, string, number][] = [
    ["Cold", "First contact", "Emails 1–2", "One problem, one fix, free plan", at("Cold")],
    ["Setup", "Setup", "Emails 3–5", "Install on one PC, try the USB test", at("Setup")],
    ["Tips", "Weekly tips", "Emails 6–11", "One useful tip about once a week", at("Tips")],
    ["Final", "Final check", "Email 12", "Invite to the newsletter", at("Final")],
  ];
  const exits: [ContactStatus, string, string, string][] = [
    ["closed", "No reply after Email 2", "Stop emailing", ""],
    ["snoozed", "Not now", "Pause, ask again only if agreed", "warn"],
    ["paused", "Has a question", "You reply personally", "warn"],
    ["suppressed", "No, bounce or complaint", "Never email again", "bad"],
  ];
  return (
    <>
      <section className="card mcard" aria-label="Marketing flow">
        <div className="fighead"><h2>Marketing flow</h2><span className="k">{c.name}</span></div>
        <div className="mflow">
          {steps.map((s, i) => (
            <span key={s[0]} style={{ display: "contents" }}>
              <button type="button" className="mstep" onClick={() => go("contacts")}>
                <span className="k">{s[2]}</span><b>{s[1]}</b><span className="mdesc">{s[3]}</span><strong className="num">{s[4]}</strong>
              </button>
              <span className="marrow" aria-hidden="true">{i === 0 ? <small>Says yes</small> : null}→</span>
            </span>
          ))}
          <button type="button" className="mstep goal" onClick={() => go("contacts")}>
            <span className="k">Goal</span><b>Using Zinwe</b><span className="mdesc">Installed on a PC, upgrades only if useful</span><strong className="num">{contacts.filter((x) => x.installed).length}</strong>
          </button>
        </div>
        <div className="mexits">
          <span className="k">If they don’t say yes</span>
          {exits.map((e) => (
            <button key={e[0]} type="button" className={"mexit " + e[3]} onClick={() => go("contacts")}>
              <b>{e[1]}</b><span>{e[2]}</span><em className="num">{contacts.filter((x) => x.status === e[0]).length}</em>
            </button>
          ))}
        </div>
      </section>
      <section className="card mcard" aria-label="Marketing steps">
        <div className="fighead"><h2>Marketing steps</h2><span className="k">Box: step · Diamond: decision · Pill: end of the path</span></div>
        <div className="sdfd" dangerouslySetInnerHTML={{ __html: FLOW_DIAGRAM }} />
        <p className="scap">You approve every send. At any step, a “no” or unsubscribe goes to Do not email, and a question pauses the flow until you reply.</p>
      </section>
      <section className="card tablebox">
        <div className="scroll">
          <table className="tbl narrow">
            <caption className="sr">Reply rules</caption>
            <thead><tr><th scope="col">Response</th><th scope="col">Status</th><th scope="col">What happens</th></tr></thead>
            <tbody>{RULES.map((r) => <tr key={r[0]}><th scope="row"><b>{r[0]}</b></th><td><span className={"pill " + r[2]}>{r[1]}</span></td><td>{r[3]}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function EmailsTab({ c, sender, contacts, run }: Ctx): ReactElement {
  const [n, setN] = useState(1);
  const step = c.emails.find((e) => e.n === n) ?? c.emails[0];
  const [subject, setSubject] = useState(step?.subject ?? "");
  const [body, setBody] = useState(step?.body ?? "");
  const [phone, setPhone] = useState(false);
  useEffect(() => { setSubject(step?.subject ?? ""); setBody(step?.body ?? ""); }, [step?.n, step?.subject, step?.body]);
  if (!step) return <section className="card empty">This campaign has no emails yet.</section>;
  const sample = contacts.find((x) => x.status !== "suppressed") ?? { first_name: "Dana", firm: "Mesa Ridge CPAs", email: "dana@example.com" };
  const stages = ["Cold", "Setup", "Tips", "Final"];
  const dirty = subject !== step.subject || body !== step.body;
  return (
    <div className="seq">
      <section className="card">
        <ol>
          {stages.map((s) => (
            <li key={s}>
              <div className="stage">{s.toUpperCase()}</div>
              {c.emails.filter((e) => e.stage === s).map((e) => (
                <button key={e.n} type="button" className={e.n === n ? "on" : ""} onClick={() => setN(e.n)}>
                  <b>{e.n}</b><span>{e.subject}</span><small>{e.when}</small>
                </button>
              ))}
            </li>
          ))}
        </ol>
      </section>
      <div className="edprev">
        <section className="card editor">
          <h2>Email {step.n}</h2>
          <label className="fl">Subject<input className="inp" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="fl">Body<textarea className="txt" rows={14} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <span className="k">Use {"{{FirstName}}"} and {"{{Firm}}"}. Footer and unsubscribe link are added to every email.</span>
          <div className="fr">
            <button type="button" className="btn sm dark" disabled={!dirty} onClick={() => void run(() => saveEmail(c.id, step.n, subject, body), "Email saved.")}>Save email</button>
            <button type="button" className="btn sm" disabled={dirty || !sender.mailbox_ready} title={sender.mailbox_ready ? "" : "Connect the outreach mailbox first"} onClick={() => void run(() => campaignAction(c.id, "test", { n: step.n }), "Test sent to your address.")}>Send test to me</button>
          </div>
        </section>
        <section className="card editor">
          <div className="fr between">
            <h2>Preview</h2>
            <div className="seg" role="group" aria-label="Preview size">
              <button type="button" className={phone ? "" : "on"} onClick={() => setPhone(false)}>Desktop</button>
              <button type="button" className={phone ? "on" : ""} onClick={() => setPhone(true)}>Phone</button>
            </div>
          </div>
          <div className={"pvframe" + (phone ? " phone" : "")}>
            <div className="pvmail">
              <h3>{fill(subject, sample)}</h3>
              <div className="pvfrom"><i>V</i><div><b>{sender.from.split("<")[0].trim()}</b> <span>&lt;{sender.from.split("<")[1]?.replace(">", "")}&gt;</span><span>to {sample.first_name} &lt;{sample.email}&gt;</span></div></div>
              <div className="pvbody">{fill(body, sample).replace(/\[Signed-up contacts only: [\s\S]*?\]\s*/, "").split(/\n{2,}/).map((p, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{p}</p>)}</div>
              <div className="pvfoot">This is a promotional email. To stop hearing from me, reply “no” or <span className="pvlink">unsubscribe</span>.<br />{sender.postal_address}<br />Zinwe · Security, simplified. IT Is OK.</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ContactsTab({ c, contacts, run, openContact }: Ctx): ReactElement {
  const [q, setQ] = useState("");
  const [core, setCore] = useState("all");
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const cores: [string, string, (x: Contact) => boolean][] = [
    ["all", "All", () => true], ["due", "Due now", isDue], ["you", "Needs you", (x) => x.status === "paused" || x.status === "waiting"],
    ["opted", "Opted in", (x) => x.status === "opted" || x.status === "signed"], ["blocked", "Do not email", (x) => x.status === "suppressed"],
  ];
  const test = cores.find((x) => x[0] === core)?.[2] ?? (() => true);
  const list = contacts.filter((x) => test(x) && (!status || x.status === status) && (!q || `${x.first_name} ${x.firm} ${x.email} ${x.city}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      {c.ready_today > 0 && c.status === "active" ? (
        <section className="check">
          <div>
            <h2>{c.ready_today} email{c.ready_today > 1 ? "s" : ""} ready to send</h2>
            <span className="k">Daily limit: {c.daily_limit}. Nothing goes out until you approve.</span>
          </div>
          <div className="fr">
            <button type="button" className="btn sm" onClick={() => setCore("due")}>Show only these</button>
            <button type="button" className="btn sm dark" onClick={() => setSending(true)}>Approve and send</button>
          </div>
        </section>
      ) : null}
      {c.ready_today > 0 && c.status !== "active" ? <p className="mk-note">{c.ready_today} email{c.ready_today > 1 ? "s are" : " is"} due, but this campaign isn’t live. Finish the launch checks first.</p> : null}
      <section className="card finder" aria-label="Find contacts">
        <div className="fr">
          <div className="search"><input type="search" className="inp" aria-label="Search contacts" placeholder="Search name, firm, email or city" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className={"inp" + (status ? " set" : "")} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
          </select>
          <button type="button" className="btn dark" onClick={() => setAdding(true)}>Add contacts</button>
        </div>
        <div className="fr" role="group" aria-label="Show">
          {cores.map(([k, label, f]) => (
            <button key={k} type="button" className={"chip" + (core === k ? " on" : "")} aria-pressed={core === k} onClick={() => setCore(k)}>{label}<span>{contacts.filter(f).length}</span></button>
          ))}
        </div>
      </section>
      <section className="card tablebox" aria-label="Contacts">
        <div className="scroll">
          <table className="tbl">
            <caption className="sr">Contacts</caption>
            <thead><tr><th scope="col">Contact</th><th scope="col">City</th><th scope="col">Stage</th><th scope="col">Status</th><th scope="col">Last email</th><th scope="col">Next email</th><th scope="col">Send on</th><th scope="col">Installed</th></tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id} className="click" onClick={() => openContact(x)}>
                  <th scope="row"><button type="button" className="cobtn">{x.first_name}</button><span className="k">{x.firm}</span></th>
                  <td>{x.city}</td><td>{x.stage}</td><td><Pill s={x.status} /></td>
                  <td className="num">{x.last_email ? `Email ${x.last_email}` : "—"}</td>
                  <td className="num">{x.next_email ? `Email ${x.next_email}` : "—"}</td>
                  <td className="num">{nice(x.next_date)}</td><td>{x.installed ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length ? null : <div className="empty">{contacts.length ? "No contacts match these filters." : "No contacts yet. Add the people you picked by hand."}</div>}
      </section>
      {adding ? <AddContacts id={c.id} onClose={() => { setAdding(false); void run(async () => undefined); }} /> : null}
      {sending ? (
        <ConfirmDialog title={`Send ${c.ready_today} email${c.ready_today > 1 ? "s" : ""} now?`} confirmLabel="Approve and send" onClose={() => setSending(false)} onConfirm={async () => { await campaignAction(c.id, "send", { expected: c.ready_today }); await run(async () => undefined, "Approved. Emails are going out one at a time."); }}>
          These are real emails to real people, sent one at a time from your outreach address.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function AddContacts({ id, onClose }: { id: number; onClose: () => void }): ReactElement {
  const toast = useToast();
  const [text, setText] = useState("");
  const [results, setResults] = useState<ImportResult[]>([]);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      const r = await importContacts(id, text);
      setResults(r.results);
      setText("");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't add those.", "bad");
    }
    setBusy(false);
  };
  return (
    <Modal title="Add contacts" subtitle="One per line: first name, firm, email, city. One contact per firm; blocked addresses are skipped. Add only people you picked by hand, never a bought or scraped list." onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Close</button><button type="button" className="btn dark" disabled={busy || !text.trim()} onClick={() => void check()}>Check and add</button></>}>
      <div className="mk-imp">
        <textarea rows={6} aria-label="Contacts" placeholder="Ella, Prairie Wind CPAs, ella@prairiewind.com, Dallas" value={text} onChange={(e) => setText(e.target.value)} />
        {results.map((r, i) => <div key={i}><span className={"pill " + r.result}>{r.message}</span> {r.line}</div>)}
      </div>
    </Modal>
  );
}

function ContactDrawer({ x, onClose, onActed }: { x: Contact; onClose: () => void; onActed: () => void }): ReactElement {
  const toast = useToast();
  const act = async (action: string, note = "") => {
    try {
      await actOnContact(x.id, action, note);
      toast("Updated.");
      onActed();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't update that.", "bad");
    }
  };
  const locked = x.status === "suppressed";
  return (
    <Modal title={x.first_name} subtitle={x.firm} size="drawer" className="mk-drawer" onClose={onClose}>
      <div className="mk-sec">
        <dl>
          <dt>Email</dt><dd>{x.email}</dd>
          <dt>City</dt><dd>{x.city || "—"}</dd>
          <dt>Status</dt><dd><Pill s={x.status} /></dd>
          <dt>Next email</dt><dd>{x.next_email ? `Email ${x.next_email}, ${nice(x.next_date)}` : "—"}</dd>
          {x.proof ? <><dt>Proof of yes</dt><dd>{x.proof}</dd></> : null}
          {x.reason ? <><dt>Reason</dt><dd>{x.reason}</dd></> : null}
        </dl>
      </div>
      {locked ? <p className="mk-note">This address is on Do not email and stays blocked.</p> : (
        <div className="mk-sec">
          <h3>What did they do?</h3>
          <div className="mk-acts">
            <button type="button" className="btn sm" onClick={() => void act("yes")}>Said yes</button>
            <button type="button" className="btn sm" onClick={() => void act("signed")}>Signed up</button>
            <button type="button" className="btn sm" onClick={() => void act("installed")}>Installed</button>
            <button type="button" className="btn sm" onClick={() => void act("notnow")}>Not now</button>
            {x.status === "paused" ? <button type="button" className="btn sm" onClick={() => void act("resume")}>I replied, resume</button> : <button type="button" className="btn sm" onClick={() => void act("question")}>Has a question</button>}
            <button type="button" className="btn sm" onClick={() => void act("noreply")}>No reply, close</button>
            <button type="button" className="btn sm danger" onClick={() => void act("no")}>No or unsubscribe</button>
            <button type="button" className="btn sm danger" onClick={() => void act("bounce")}>Hard bounce</button>
            <button type="button" className="btn sm danger" onClick={() => void act("complaint")}>Spam complaint</button>
          </div>
        </div>
      )}
      <div className="mk-sec">
        <h3>History</h3>
        <ul className="log">{x.events.map((e, i) => <li key={i}>{nice(e.at)}: {e.text}</li>)}</ul>
      </div>
    </Modal>
  );
}

function RepliesTab({ sender, contacts, openContact }: Ctx): ReactElement {
  const rows = contacts.filter((x) => x.status === "paused" || x.status === "waiting");
  return (
    <>
      <p className="mk-note">Replies arrive in the {sender.reply_to} inbox. Read them there, then record what the person said here so the flow moves on.</p>
      {rows.length ? rows.map((x) => (
        <section key={x.id} className="card editor">
          <div className="fr between">
            <span><b>{x.first_name}</b> <span className="k">{x.firm}</span></span>
            <Pill s={x.status} />
          </div>
          {x.reason ? <p className="scap">{x.reason}</p> : null}
          <div className="fr"><button type="button" className="btn sm" onClick={() => openContact(x)}>Open contact</button></div>
        </section>
      )) : <section className="card empty"><b>All replies handled</b><span>Contacts who need you will appear here.</span></section>}
    </>
  );
}

function ReportsTab({ c }: Ctx): ReactElement {
  const f = c.report.funnel;
  const max = Math.max(1, f[0]?.value ?? 1);
  return (
    <>
      <section className="card editor">
        <h2>Results by funnel step</h2>
        <div className="rbars">
          {f.map((x, i) => (
            <div key={x.label}>
              <span>{x.label}</span><i><em style={{ width: `${Math.max(2, (x.value / max) * 100)}%` }} /></i><b className="num">{x.value}</b>
              <small>{i && f[i - 1].value ? `${Math.round((x.value / f[i - 1].value) * 100)}% of previous` : ""}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="card tablebox">
        <div className="fighead pad"><h2>Results by email</h2></div>
        <div className="scroll">
          <table className="tbl narrow">
            <caption className="sr">Results by email</caption>
            <thead><tr><th scope="col">Email</th><th scope="col">Subject</th><th scope="col">Stage</th><th scope="col">Sent</th></tr></thead>
            <tbody>{c.report.by_email.map((e) => <tr key={e.n}><th scope="row"><b>Email {e.n}</b></th><td>{e.subject}</td><td>{e.stage}</td><td className="num">{e.sent}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <Health c={c} />
      <p className="scap">Judge campaigns by replies, signups and installed PCs. Open rates and clicks are left out because tracking pixels can hurt cold email delivery.</p>
    </>
  );
}

function SettingsTab({ c, sender, run }: Ctx): ReactElement {
  const load = useCallback(() => getBlocked(), []);
  const blocked = useLoad(load);
  const dns: [keyof CampaignDetail["dns_result"], string][] = [["spf", "SPF"], ["dkim", "DKIM"], ["dmarc", "DMARC"]];
  return (
    <>
      <div className="hgrid">
        <section className="card editor">
          <h2>Sender</h2>
          <div className="psy">
            <div><span>Outreach from</span><b>{sender.from}</b></div>
            <div><span>Replies go to</span><b>{sender.reply_to}</b></div>
            <div><span>Newsletter from</span><b>{sender.newsletter_from}</b></div>
          </div>
          <div className="fr">
            <span className={"pill " + (sender.mailbox_ready ? "good" : "warn")}>{sender.mailbox_ready ? "Mailbox connected" : "Mailbox not connected"}</span>
            {sender.mailbox_ready ? <span className="k">{sender.smtp_host}</span> : null}
          </div>
          <span className="k">Outreach sends through its own mailbox, never the product mail account, so it can’t affect sign-in codes or invoices.</span>
        </section>
        <section className="card editor">
          <h2>Domain: {sender.domain}</h2>
          <div className="todo">
            {dns.map(([k, label]) => {
              const ok = c.dns_result?.[k];
              return <div key={k} className={ok ? "done" : ""}><span className={"pill " + (ok ? "good" : "warn")}>{ok ? "Pass" : c.dns_checked_at ? "Missing" : "Not checked"}</span><span>{label}</span></div>;
            })}
          </div>
          <div className="fr">
            <button type="button" className="btn sm" onClick={() => void run(() => campaignAction(c.id, "dns"), "Records checked.")}>Check records</button>
            {c.dns_checked_at ? <span className="k">Checked {nice(c.dns_checked_at)}</span> : null}
          </div>
        </section>
      </div>
      <div className="hgrid">
        <section className="card editor">
          <h2>Sending limits</h2>
          <label className="fl">Daily limit
            <select className="inp" value={c.daily_limit} onChange={(e) => void run(() => patchCampaign(c.id, { daily_limit: Number(e.target.value) }), "Saved.")}>
              {sender.limits.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <span className="k">Start at 10 a day and raise it only if bounces and complaints stay low.</span>
        </section>
        <section className="card editor">
          <h2>Email footer</h2>
          <div className="foot">This is a promotional email. To stop hearing from me, reply “no” or unsubscribe.{"\n"}{sender.postal_address}{"\n"}Zinwe · Security, simplified. IT Is OK.</div>
          <span className="k">Added to every email automatically.</span>
        </section>
      </div>
      <section className="card editor">
        <h2>Cold email rules</h2>
        <ol className="rlist">
          <li>Add only named work addresses you picked by hand. Never buy or scrape a list.</li>
          <li>Send at most 2 cold emails, then stop if there is no reply.</li>
          <li>Keep to the daily limit, and start at 10 a day.</li>
          <li>Send from the separate domain, never zinwe.io.</li>
          <li>Put an unsubscribe link and the postal address in every email.</li>
        </ol>
        <label className="mk-check">
          <input type="checkbox" checked={!!c.rules_checked_at} onChange={(e) => void run(() => campaignAction(c.id, "rules", { checked: e.target.checked }), "Saved.")} />
          We checked the cold email rules for the USA and India
        </label>
        {c.rules_checked_by ? <span className="k">Marked by {c.rules_checked_by}</span> : null}
      </section>
      <section className="card tablebox">
        <div className="fighead pad"><h2>Do not email</h2></div>
        <div className="scroll">
          <table className="tbl narrow">
            <caption className="sr">Do not email</caption>
            <thead><tr><th scope="col">Address</th><th scope="col">Reason</th><th scope="col">Added</th></tr></thead>
            <tbody>{(blocked.data ?? []).map((b) => <tr key={b.email}><th scope="row">{b.email}</th><td>{b.reason}</td><td>{nice(b.created_at)}</td></tr>)}</tbody>
          </table>
        </div>
        {blocked.data?.length ? null : <div className="empty">Nobody is blocked.</div>}
      </section>
    </>
  );
}

export function EmailCampaignPage(): ReactElement {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const list = useLoad(getCampaigns);
  const [id, setId] = useState<number | null>(null);
  const [c, setC] = useState<CampaignDetail | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const tab = TABS.some((t) => t[0] === params.get("tab")) ? (params.get("tab") as string) : "home";
  const campaigns = list.data?.campaigns;
  const current = id ?? campaigns?.find((x) => x.status === "active")?.id ?? campaigns?.[0]?.id ?? null;

  const refresh = useCallback(async (which: number) => {
    const [detail, people] = await Promise.all([getCampaign(which), getContacts(which)]);
    setC(detail);
    setContacts(people);
  }, []);

  useEffect(() => {
    if (current == null) return;
    setError(null);
    refresh(current).catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this campaign."));
  }, [current, refresh]);

  const run = useCallback(async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      if (current != null) await refresh(current);
      if (done) toast(done);
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "That didn't work.", "bad");
      return false;
    }
  }, [current, refresh, toast]);

  const go = useCallback((next: string) => setParams({ tab: next }), [setParams]);
  const opened = useMemo(() => contacts.find((x) => x.id === open) ?? null, [contacts, open]);
  const sender = list.data?.sender;

  const makeCampaign = async () => {
    if (!c) return;
    const made = await createCampaign(name.trim(), c.audience);
    setName("");
    setNaming(false);
    setId(made.id);
    list.reload();
    toast("Draft campaign added, with a copy of the 12 emails.");
  };

  const ctx = c && sender ? { c, sender, contacts, run, go, openContact: (x: Contact) => setOpen(x.id) } : null;
  return (
    <div className="mk">
      <PageHeader title="Email campaign" subtitle="Plan, send and track your email marketing." onReload={() => { list.reload(); if (current != null) void refresh(current); }} pending={list.pending}>
        {(campaigns?.length ?? 0) > 1 ? (
          <select className="inp" aria-label="Campaign" value={current ?? ""} onChange={(e) => setId(Number(e.target.value))}>
            {campaigns?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        ) : null}
        <button type="button" className="btn" onClick={() => setNaming(true)} disabled={!c}>New campaign</button>
      </PageHeader>
      {list.error || error ? <ErrorState message={list.error ?? error ?? ""} onRetry={list.reload} /> : null}
      {c ? (
        <div className="fr">
          <b>{c.name}</b>
          <span className="k">{c.audience_name}</span>
          <span className={"pill " + (c.status === "active" ? "good" : c.status === "paused" ? "warn" : "")}>{c.status === "active" ? "Active" : c.status === "paused" ? "Paused" : "Draft"}</span>
        </div>
      ) : null}
      {c?.status === "paused" && c.pause_reason ? (
        <div className="card alertbar">
          <span><b>Sending paused.</b> {c.pause_reason}</span>
          <button type="button" className="btn sm" onClick={() => void run(() => campaignAction(c.id, "launch"), "Sending resumed.")}>Resume sending</button>
        </div>
      ) : null}
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={"tab" + (tab === k ? " on" : "")} onClick={() => go(k)}>
            {label}
            {k === "replies" && c?.counts.needs_you ? <em>{c.counts.needs_you}</em> : null}
          </button>
        ))}
      </div>
      {!ctx ? (list.error || error ? null : <LoadingState />) : (
        <>
          {tab === "home" ? <HomeTab {...ctx} /> : null}
          {tab === "campaigns" ? <CampaignsTab {...ctx} /> : null}
          {tab === "flow" ? <FlowTab {...ctx} /> : null}
          {tab === "emails" ? <EmailsTab {...ctx} /> : null}
          {tab === "contacts" ? <ContactsTab {...ctx} /> : null}
          {tab === "replies" ? <RepliesTab {...ctx} /> : null}
          {tab === "reports" ? <ReportsTab {...ctx} /> : null}
          {tab === "settings" ? <SettingsTab {...ctx} /> : null}
        </>
      )}
      {opened ? <ContactDrawer x={opened} onClose={() => setOpen(null)} onActed={() => { void run(async () => undefined); }} /> : null}
      {naming ? (
        <Modal title="New campaign" subtitle="Starts as a draft with a copy of the 12 emails, for the same audience." onClose={() => setNaming(false)} size="small" footer={<><button type="button" className="btn" onClick={() => setNaming(false)}>Cancel</button><button type="button" className="btn dark" disabled={!name.trim()} onClick={() => void makeCampaign()}>Add campaign</button></>}>
          <label className="fl">Campaign name<input className="inp" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        </Modal>
      ) : null}
    </div>
  );
}
