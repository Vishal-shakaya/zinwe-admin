import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { ApiError } from "../../lib/api";
import { getAudiences, saveAudience, type Audience, type ChipKey, type Confidence } from "../../lib/marketingApi";
import { useLoad } from "../../lib/useLoad";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";
import { ErrorState, LoadingState } from "../../components/States";
import { useToast } from "../../components/Toast";
import { audienceBrief, audienceSummary, blankAudience, CHANNEL_GUIDE, CHANNELS, CONFIDENCE, COUNTRIES, suggestions } from "./data";
import "../../styles/marketing.css";

const FIELD: Record<ChipKey, { label: string; placeholder: string; hint: string; comma?: boolean }> = {
  segments: { label: "Segments", placeholder: "Pick a segment or type your own", hint: "Press Enter to add. Use commas or new lines to add several at once.", comma: true },
  triggers: { label: "Trigger moments", placeholder: "Pick a moment or type your own", hint: "What just happened that makes them act now?" },
  words: { label: "Words they use", placeholder: "Pick a word or type your own", hint: "Their exact words, so your copy sounds like them.", comma: true },
  objections: { label: "Objections", placeholder: "Pick an objection or type your own", hint: "What they say before they say yes." },
  not_for: { label: "Not for", placeholder: "Pick who to leave out or type your own", hint: "Who you should not target with this audience." },
  problems: { label: "Problems", placeholder: "Pick a problem or type your own", hint: "Press Enter to add. Paste a list, one per line, to add several at once." },
  solutions: { label: "Solutions", placeholder: "Pick a solution or type your own", hint: "Press Enter to add. Paste a list, one per line, to add several at once." },
  offers: { label: "Offers", placeholder: "Pick an offer or type your own", hint: "Press Enter to add. Put the offer you would lead with first." },
  channels: { label: "Channels", placeholder: "Pick a channel or type your own", hint: "The first channel is your best channel. Use the arrow on a chip to move it to first.", comma: true },
};

function splitItems(key: ChipKey, value: string): string[] {
  return value
    .split(FIELD[key].comma ? /[\n,;]+/ : /\n+/)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

/** Chips plus a text area with a suggestion dropdown. The dropdown closes after every add so it never covers the next field. */
function ChipField({
  field,
  draft,
  error,
  pending,
  onPending,
  onChange,
  duplicate,
}: {
  field: ChipKey;
  draft: Audience;
  error?: string;
  pending: string;
  onPending: (v: string) => void;
  onChange: (list: string[]) => void;
  duplicate: (n: number) => void;
}): ReactElement {
  const f = FIELD[field];
  const items = draft[field];
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [pending]);

  const token = (pending.split(f.comma ? /[\n,;]/ : /\n/).pop() ?? "").trim().toLowerCase();
  const groups = useMemo(() => {
    const seen = new Set(items.map((v) => v.toLowerCase()));
    return suggestions(field, draft)
      .map(([label, list]): [string, string[]] => [
        label,
        list.filter((v) => {
          const s = v.toLowerCase();
          if (seen.has(s) || (token && !s.includes(token))) return false;
          seen.add(s);
          return true;
        }),
      ])
      .filter(([, list]) => list.length);
  }, [field, draft, items, token]);
  const options = groups.flatMap(([, list]) => list);

  const add = (list: string[]) => {
    const next = [...items];
    let dup = 0;
    for (const v of list) {
      if (next.some((x) => x.toLowerCase() === v.toLowerCase())) dup += 1;
      else next.push(v);
    }
    if (dup) duplicate(dup);
    onChange(next);
  };
  const commit = () => {
    const list = splitItems(field, pending);
    onPending("");
    if (list.length) add(list);
    setOpen(false);
    setCursor(-1);
  };
  const pick = (v: string) => {
    const kept = pending.match(f.comma ? /^[\s\S]*[\n,;]/ : /^[\s\S]*\n/);
    onPending(kept ? kept[0] : "");
    add([v]);
    setOpen(false);
    setCursor(-1);
    box.current?.focus();
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (options.length) {
        const dir = e.key === "ArrowDown" ? 1 : -1;
        setCursor((c) => (c < 0 ? (dir > 0 ? 0 : options.length - 1) : (c + dir + options.length) % options.length));
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (open && options[cursor]) pick(options[cursor]);
      else commit();
    }
  };

  let index = -1;
  return (
    <div className="afcf">
      <label className="sr" htmlFor={id}>Add to {f.label}</label>
      <ul className="acs" aria-label={`${f.label} added`}>
        {items.map((v, i) => (
          <li key={v} className="ac">
            {field === "channels" && i === 0 ? <b>Best</b> : null}
            <span>{v}</span>
            {field === "channels" && i > 0 ? (
              <button type="button" className="acx" aria-label={`Make ${v} the best channel`} title="Make this the best channel" onClick={() => onChange([v, ...items.filter((x) => x !== v)])}>↑</button>
            ) : null}
            <button type="button" className="acx" aria-label={`Remove ${v}`} onClick={() => onChange(items.filter((x) => x !== v))}>×</button>
          </li>
        ))}
      </ul>
      <div className="afrow">
        <div className="afcombo" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
          <textarea
            ref={box}
            id={id}
            className="txt afin"
            rows={1}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder={f.placeholder}
            value={pending}
            onChange={(e) => { onPending(e.target.value); setOpen(true); setCursor(-1); }}
            onClick={() => setOpen(true)}
            onKeyDown={keys}
          />
          <button type="button" className="afchev" tabIndex={-1} aria-label="Show suggestions" onMouseDown={(e) => { e.preventDefault(); box.current?.focus(); setOpen((o) => !o); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <div className="afsug" id={`${id}-list`} role="listbox" aria-label={`${f.label} suggestions`} hidden={!open}>
            {groups.map(([label, list]) => (
              <div key={label}>
                <div className="afg">{label}</div>
                {list.map((v) => {
                  index += 1;
                  return (
                    <button key={v} type="button" tabIndex={-1} role="option" aria-selected={index === cursor} className={"afopt" + (index === cursor ? " on" : "")} onMouseDown={(e) => { e.preventDefault(); pick(v); }}>
                      {v}
                    </button>
                  );
                })}
              </div>
            ))}
            {options.length ? null : <div className="afnone">{token ? "No suggestion matches. Press Enter to add it." : "Everything here is already added."}</div>}
          </div>
        </div>
        <button type="button" className="btn" onClick={() => { commit(); box.current?.focus(); }}>Add</button>
      </div>
      <span className="k">{f.hint}</span>
      {error ? <span className="aferr" role="alert">{error}</span> : null}
    </div>
  );
}

function Section({ n, title, help, required, done, children }: { n: number; title: string; help: string; required?: boolean; done: boolean; children: ReactNode }): ReactElement {
  return (
    <section className={"card afsec" + (done ? " done" : "")} aria-labelledby={`fh${n}`}>
      <header className="afh">
        <span className="afn" aria-hidden="true">{done ? "✓" : n}</span>
        <div>
          <h2 id={`fh${n}`}>{title}</h2>
          <p className="k">{help}</p>
        </div>
        {required ? <span className="afreq">Required</span> : null}
      </header>
      {children}
    </section>
  );
}

async function copyBrief(text: string, toast: (m: string, tone?: "bad") => void, blocked: (t: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast("Brief copied. Paste it into your AI tool.");
  } catch {
    blocked(text);
  }
}

function AudienceForm({ start, onDone }: { start: Audience; onDone: (saved: boolean) => void }): ReactElement {
  const toast = useToast();
  const [d, setD] = useState<Audience>(start);
  const [pending, setPending] = useState<Partial<Record<ChipKey, string>>>({});
  const [auto, setAuto] = useState(!start.id || start.summary === audienceSummary(start));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const initial = useRef(JSON.stringify(start));

  const view = auto ? { ...d, summary: audienceSummary(d) } : d;
  const patch = (p: Partial<Audience>) => {
    setD((cur) => ({ ...cur, ...p }));
    setErrors({});
  };
  const steps = [
    Boolean(view.name.trim() && view.segments.length),
    Boolean(view.decider.trim() && view.triggers.length),
    view.problems.length > 0,
    view.solutions.length > 0,
    view.offers.length > 0,
    view.channels.length > 0,
    Boolean(view.summary.trim()),
  ];
  const doneCount = steps.filter(Boolean).length;

  /** Text typed but not yet added still counts: nothing is lost on Save or Copy. */
  const committed = (): Audience => {
    const out = { ...view };
    for (const [key, value] of Object.entries(pending) as [ChipKey, string][]) {
      const merged = [...out[key]];
      for (const v of splitItems(key, value)) if (!merged.some((x) => x.toLowerCase() === v.toLowerCase())) merged.push(v);
      out[key] = merged;
    }
    if (auto) out.summary = audienceSummary(out);
    return out;
  };

  const chip = (key: ChipKey) => (
    <ChipField
      field={key}
      draft={view}
      error={errors[key]}
      pending={pending[key] ?? ""}
      onPending={(v) => setPending((p) => ({ ...p, [key]: v }))}
      onChange={(list) => patch({ [key]: list })}
      duplicate={(n) => toast(n === 1 ? "That one is already added." : `${n} items were already added.`)}
    />
  );
  const labelled = (label: string, key: ChipKey) => (
    <div className="fl mk-chipfl">
      <span>{label}</span>
      {chip(key)}
    </div>
  );

  const save = async () => {
    const final = committed();
    const bad: Record<string, string> = {};
    if (!final.name.trim()) bad.name = "Add an audience name.";
    if (!final.segments.length) bad.segments = "Add at least one segment.";
    if (!final.problems.length) bad.problems = "Add at least one problem.";
    if (!final.channels.length) bad.channels = "Add at least one channel.";
    setD(final);
    setPending({});
    if (Object.keys(bad).length) {
      setErrors(bad);
      toast("Fill in the required sections first.", "bad");
      return;
    }
    setBusy(true);
    try {
      await saveAudience({ ...final, name: final.name.trim() });
      toast("Audience saved.");
      onDone(true);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save that.", "bad");
      setBusy(false);
    }
  };
  const leave = () => {
    const snap = (x: Audience, isAuto: boolean) => JSON.stringify({ ...x, summary: isAuto ? "" : x.summary });
    const dirty = snap(d, auto) !== snap(JSON.parse(initial.current) as Audience, !start.id || start.summary === audienceSummary(start)) || Object.values(pending).some(Boolean);
    if (dirty) setDiscard(true);
    else onDone(false);
  };

  return (
    <div className="mk">
      <PageHeader title={start.id ? "Edit audience" : "Add audience"} subtitle="Fill in the seven sections, then save the audience or copy its brief into an AI tool." />
      <button type="button" className="lnk afback" onClick={leave}>Back to audiences</button>
      <div className="afgrid">
        <form className="afmain" noValidate onSubmit={(e) => e.preventDefault()}>
          <Section n={1} title="Who they are" help="Name this audience and pick the segments it covers." required done={steps[0]}>
            <div className="two">
              <label className="fl">Audience name
                <input className="inp" type="text" value={d.name} placeholder="Example: Texas CPA firms" onChange={(e) => patch({ name: e.target.value })} />
                {errors.name ? <span className="aferr" role="alert">{errors.name}</span> : null}
              </label>
              <label className="fl">Country
                <select className="inp" value={d.country} onChange={(e) => patch({ country: e.target.value })}>
                  {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
            {labelled("Segments", "segments")}
          </Section>
          <Section n={2} title="Main persona" help="Describe the one person you are writing to. Mark how sure you are, and update it after real conversations." done={steps[1]}>
            <div className="two">
              <label className="fl">Who decides
                <input className="inp" type="text" value={d.decider} placeholder="Example: Managing partner" onChange={(e) => patch({ decider: e.target.value })} />
              </label>
              <label className="fl">Who sets it up
                <input className="inp" type="text" value={d.setup} placeholder="Example: Office manager" onChange={(e) => patch({ setup: e.target.value })} />
              </label>
              <label className="fl">What they do today
                <input className="inp" type="text" value={d.today} placeholder="Example: Trusts staff, shared drive" onChange={(e) => patch({ today: e.target.value })} />
              </label>
              <label className="fl">How sure are you?
                <select className="inp" value={d.confidence} onChange={(e) => patch({ confidence: e.target.value as Confidence })}>
                  {Object.keys(CONFIDENCE).map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
            {labelled("Trigger moments", "triggers")}
            {labelled("Words they use", "words")}
            {labelled("Objections", "objections")}
            {labelled("Not for", "not_for")}
          </Section>
          <Section n={3} title="Problems they face" help="Add each problem in the words the owner would use." required done={steps[2]}>{chip("problems")}</Section>
          <Section n={4} title="Solutions we offer" help="Add what Zinwe does today for these problems." done={steps[3]}>{chip("solutions")}</Section>
          <Section n={5} title="Best offer for this segment" help="Add the first step you want them to take." done={steps[4]}>{chip("offers")}</Section>
          <Section n={6} title="Best channels" help="Add every channel that reaches them, best one first." required done={steps[5]}>{chip("channels")}</Section>
          <Section n={7} title="Audience summary" help="This text describes the audience everywhere it is used. It fills in from the sections above, and you can edit it." done={steps[6]}>
            <label className="sr" htmlFor="asum">Audience summary</label>
            <textarea id="asum" className="txt" rows={6} value={view.summary} onChange={(e) => { setAuto(false); patch({ summary: e.target.value }); }} />
            <div className="fr between">
              <span className="k">{auto ? "Filled in from the form" : "Edited by you, the form no longer changes it"}</span>
              <button type="button" className="btn sm" onClick={() => setAuto(true)}>Rebuild from the form</button>
            </div>
          </Section>
          <div className="card affoot">
            <button type="button" className="btn" disabled={busy} onClick={leave}>Cancel</button>
            <button type="button" className="btn dark" disabled={busy} onClick={() => void save()}>Save audience</button>
          </div>
        </form>
        <aside className="card afrail" aria-label="Audience brief">
          <div className="fighead">
            <h2>Audience brief</h2>
            <span className="k">{doneCount} of {steps.length} sections done</span>
          </div>
          <div className="afbar" aria-hidden="true"><i style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
          <button type="button" className="btn dark" onClick={() => void copyBrief(audienceBrief(committed()), toast, setBlocked)}>Copy for AI</button>
          <span className="k">Paste it into Claude or ChatGPT, then type your question at the end.</span>
          <pre className="afbrief" tabIndex={0}>{audienceBrief(committed())}</pre>
        </aside>
      </div>
      {discard ? (
        <ConfirmDialog title="Discard your changes?" confirmLabel="Discard changes" danger onClose={() => setDiscard(false)} onConfirm={async () => onDone(false)}>
          What you entered in this form will be lost.
        </ConfirmDialog>
      ) : null}
      {blocked ? <BlockedCopy text={blocked} onClose={() => setBlocked(null)} /> : null}
    </div>
  );
}

function BlockedCopy({ text, onClose }: { text: string; onClose: () => void }): ReactElement {
  return (
    <Modal title="Copy the brief" subtitle="Your browser blocked the copy. Press Ctrl+C to copy the selected text." onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      <textarea className="mk-copy" readOnly value={text} ref={(el) => el?.select()} aria-label="Audience brief" />
    </Modal>
  );
}

export function AudiencePage(): ReactElement {
  const toast = useToast();
  const { data, error, pending, reload } = useLoad(getAudiences);
  const [editing, setEditing] = useState<Audience | null>(null);
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [channel, setChannel] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);

  if (editing) {
    return <AudienceForm key={editing.id ?? "new"} start={editing} onDone={(saved) => { setEditing(null); if (saved) reload(); }} />;
  }

  const rows = (data ?? []).filter((a) => {
    const text = [a.name, a.summary, a.decider, a.setup, a.today, ...a.segments, ...a.triggers, ...a.words, ...a.objections, ...a.problems, ...a.solutions, ...a.offers].join(" ").toLowerCase();
    return (!country || a.country === country) && (!channel || a.channels.includes(channel)) && (!q || text.includes(q.toLowerCase()));
  });
  const channels = [...new Set([...CHANNELS, ...(data ?? []).flatMap((a) => a.channels)])];
  const more = (a: string[]) => (a.length ? <>{a[0]}{a.length > 1 ? <span className="k"> +{a.length - 1}</span> : null}</> : <span className="k">None yet</span>);

  return (
    <div className="mk">
      <PageHeader title="Audience" subtitle="Who we target, what they need and the best channel to reach them." onReload={reload} pending={pending} />
      <section className="card finder" aria-label="Find audiences">
        <div className="fr">
          <div className="search">
            <input type="search" className="inp" aria-label="Search audiences" placeholder="Search name, segment, problem or offer" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className={"inp" + (country ? " set" : "")} aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Any country</option>
            {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className={"inp" + (channel ? " set" : "")} aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">Any channel</option>
            {channels.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button type="button" className="btn dark" onClick={() => setEditing(blankAudience())}>Add audience</button>
        </div>
      </section>
      {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <LoadingState /> : (
        <section className="card tablebox">
          <div className="scroll">
            <table className="tbl">
              <caption className="sr">Target audiences</caption>
              <thead>
                <tr>
                  <th scope="col">Audience</th>
                  <th scope="col">Main persona</th>
                  <th scope="col">Segments</th>
                  <th scope="col">Problems</th>
                  <th scope="col">Best offer</th>
                  <th scope="col">Channels</th>
                  <th scope="col">AI brief</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="click" onClick={() => setEditing(a)}>
                    <th scope="row">
                      <button type="button" className="cobtn">{a.name}</button>
                      <span className="k">{a.country}</span>
                    </th>
                    <td>
                      <span className="apers">
                        {a.decider || <span className="k">None yet</span>}
                        <span className={"pill " + CONFIDENCE[a.confidence][0]}>{a.confidence}</span>
                      </span>
                    </td>
                    <td>{more(a.segments)}</td>
                    <td>{more(a.problems)}</td>
                    <td>{more(a.offers)}</td>
                    <td>
                      <span className="achs">
                        <span className="pill good">{a.channels[0]}</span>
                        {a.channels.length > 1 ? <span>{a.channels.slice(1).join(", ")}</span> : null}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); void copyBrief(audienceBrief(a), toast, setBlocked); }}>Copy for AI</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length ? null : <div className="empty">No audiences match these filters.</div>}
        </section>
      )}
      <section className="card tablebox">
        <div className="fighead pad">
          <h2>How to choose a channel</h2>
          <span className="k">Starting guide, confirm with results</span>
        </div>
        <div className="scroll">
          <table className="tbl narrow">
            <caption className="sr">Channel guide</caption>
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">Best for</th>
                <th scope="col">Use it for</th>
                <th scope="col">Rule</th>
              </tr>
            </thead>
            <tbody>
              {CHANNEL_GUIDE.map((c) => (
                <tr key={c[0]}>
                  <th scope="row"><b>{c[0]}</b></th>
                  <td>{c[1]}</td>
                  <td>{c[2]}</td>
                  <td>{c[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {blocked ? <BlockedCopy text={blocked} onClose={() => setBlocked(null)} /> : null}
    </div>
  );
}
