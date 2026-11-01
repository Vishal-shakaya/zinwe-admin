import type { ReactElement } from "react";
import { PageHeader } from "../../components/PageHeader";
import { SEGMENTS } from "./data";
import "../../styles/marketing.css";

const STAGES: [string, string, string, string, string][] = [
  ["1", "Awareness", "Show up where owners already read, and name a problem they recognise.", "#141210", "#fff"],
  ["2", "Find one urgent problem", "Pick one segment and the one problem it worries about most.", "#2b2b2a", "#fff"],
  ["3", "Build a custom offer", "Turn that problem into an offer made for that segment.", "#404040", "#fff"],
  ["4", "Offer it for free", "Give real value at no cost and become part of the client’s day.", "#6b6b6b", "#fff"],
  ["5", "Offer an upgrade", "Give more value for a low amount once they rely on it.", "#f26a0a", "#141210"],
];
const COLUMNS = ["Blogs", "Newsletters", "Resources", "Email campaigns", "Ads"];
const MATRIX = [
  ["Awareness", "Articles on everyday problems", "Story series", "Guides and e-books", "First cold email", "Problem-first ads"],
  ["Urgent problem", "Posts for one segment", "Issues built on one problem", "Segment checklists", "Subject line for one segment", "One segment, one problem"],
  ["Custom offer", "Segment call to action", "Offer for that segment", "Segment setup guide", "Emails 1–2", "Segment landing page"],
  ["Free", "How-to tutorials", "Practical tips", "Step-by-step resources", "Emails 3–11", "Free plan signup"],
  ["Upgrade", "What more PCs and history give", "Stories of growing teams", "Plan comparison", "Only people outgrowing free", "Reach active free users"],
];
const EMAIL_STEPS = [
  ["1–2. Awareness and urgent problem", "Email 1", "“That could happen here.”", "Name one real problem for their segment"],
  ["3. Custom offer", "Email 2", "“A quick test is easy.”", "Ask for one small yes"],
  ["4. Free value", "Emails 3–11", "“This helps us every week.”", "Give one useful win at a time"],
  ["5. Upgrade", "Email 12", "“More of this is worth it.”", "Offer more PCs and history only when it fits"],
];

export function FunnelPage(): ReactElement {
  return (
    <div className="mk">
      <PageHeader title="Funnel" subtitle="The 5 steps behind all Zinwe marketing." />
      <section className="card mcard" aria-label="Marketing funnel">
        <div className="fighead">
          <h2>Marketing funnel</h2>
          <span className="k">The core of all Zinwe marketing</span>
        </div>
        <div className="fun">
          {STAGES.map(([n, title, text, bg, fg], i) => (
            <div key={n} className="fstage" style={{ marginInline: `${i * 4}%`, background: bg, color: fg }}>
              <span className="fnum">{n}</span>
              <div>
                <b>{title}</b>
                <span>{text}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="card tablebox">
        <div className="fighead pad">
          <h2>Every channel follows the same 5 steps</h2>
        </div>
        <div className="scroll">
          <table className="tbl">
            <caption className="sr">What each channel does at each step</caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                {COLUMNS.map((c) => (
                  <th key={c} scope="col">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((r, i) => (
                <tr key={r[0]}>
                  <th scope="row"><b>{i + 1}. {r[0]}</b></th>
                  {r.slice(1).map((c) => (
                    <td key={c}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card tablebox">
        <div className="fighead pad">
          <h2>Step 2 and 3 by segment</h2>
          <span className="k">Draft ideas to test</span>
        </div>
        <div className="scroll">
          <table className="tbl narrow">
            <caption className="sr">Urgent problem and custom offer by segment</caption>
            <thead>
              <tr>
                <th scope="col">Segment</th>
                <th scope="col">One urgent problem</th>
                <th scope="col">Custom offer</th>
              </tr>
            </thead>
            <tbody>
              {SEGMENTS.map((r) => (
                <tr key={r[0]}>
                  <th scope="row"><b>{r[0]}</b></th>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card tablebox">
        <div className="fighead pad">
          <h2>How emails follow the funnel</h2>
        </div>
        <div className="scroll">
          <table className="tbl narrow">
            <caption className="sr">Email psychology by funnel step</caption>
            <thead>
              <tr>
                <th scope="col">Funnel step</th>
                <th scope="col">Emails</th>
                <th scope="col">What the reader feels</th>
                <th scope="col">What we do</th>
              </tr>
            </thead>
            <tbody>
              {EMAIL_STEPS.map((r) => (
                <tr key={r[0]}>
                  <th scope="row"><b>{r[0]}</b></th>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                  <td>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="scap">Every plan has every feature, so an upgrade adds more PCs and longer history. Prices always come from the Plans page.</p>
    </div>
  );
}
