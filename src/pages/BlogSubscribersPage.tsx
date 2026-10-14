import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { deleteSubscriber, listSubscribers, type Subscriber, type SubscriberStatus } from "../lib/blogApi";
import { date } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import "../blog.css";

const STATUS: Record<SubscriberStatus, { label: string; tone: string; hint: string }> = {
  active: { label: "Subscribed", tone: "pill--good", hint: "Confirmed: gets the emails" },
  pending: { label: "Not confirmed", tone: "pill--warn", hint: "Signed up, hasn't clicked the confirmation link" },
  unsubscribed: { label: "Unsubscribed", tone: "pill--muted", hint: "Gets nothing" },
};
const TABS: ("all" | SubscriberStatus)[] = ["all", "active", "pending", "unsubscribed"];

/** Who signed up for the blog newsletter on the website (double opt-in), and where. */
export function BlogSubscribersPage(): ReactElement {
  const toast = useToast();
  const load = useCallback(() => listSubscribers(), []);
  const list = useLoad(load);
  const [tab, setTab] = useState<"all" | SubscriberStatus>("all");
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<Subscriber | null>(null);

  const rows = list.data?.rows ?? [];
  const counts = list.data?.counts;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((s) => (tab === "all" || s.status === tab) && (!q || s.email.includes(q) || s.source.includes(q)));
  }, [rows, tab, query]);

  return (
    <>
      <PageHeader
        title="Newsletter subscribers"
        subtitle="People who signed up on the website's blog. Only confirmed ones get emails; every email has an unsubscribe link."
        onReload={list.reload}
        pending={list.pending}
      >
        <input
          type="search"
          className="search"
          placeholder="Search email or page"
          aria-label="Search subscribers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Link className="btn btn--ghost" to="/blog">
          ← Blog
        </Link>
      </PageHeader>

      {counts ? (
        <div className="subs-stats">
          {(["active", "pending", "unsubscribed"] as SubscriberStatus[]).map((k) => (
            <div key={k} className="card subs-stat" title={STATUS[k].hint}>
              <b>{counts[k]}</b>
              <span>{STATUS[k].label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Status">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={"tab" + (tab === k ? " is-active" : "")}
            onClick={() => setTab(k)}
          >
            {k === "all" ? "All" : STATUS[k].label}
            {counts ? <span className="tab__count">{k === "all" ? rows.length : counts[k]}</span> : null}
          </button>
        ))}
      </div>

      {list.error ? (
        <p className="alert alert--bad">{list.error}</p>
      ) : !list.data ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card empty">
          <b>No subscribers yet</b>
          <span className="muted">
            The sign-up box is on the website's blog and under every article. New sign-ups get a confirmation email first.
          </span>
        </div>
      ) : (
        <div className="card table-card">
          <table className="sheet">
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Signed up on</th>
                <th>Joined</th>
                <th>Confirmed</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.email}</b>
                  </td>
                  <td>
                    <span className={"pill " + STATUS[s.status].tone} title={STATUS[s.status].hint}>
                      {STATUS[s.status].label}
                    </span>
                  </td>
                  <td className="mono">{s.source || <span className="muted">—</span>}</td>
                  <td className="nowrap">{date(s.created_at)}</td>
                  <td className="nowrap">
                    {s.status === "unsubscribed" && s.unsubscribed_at ? (
                      <span className="muted">Left {date(s.unsubscribed_at)}</span>
                    ) : s.confirmed_at ? (
                      date(s.confirmed_at)
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="nowrap">
                    <button type="button" className="link-btn link-btn--danger" onClick={() => setRemoving(s)}>
                      Erase
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="sheet__empty">
                    No subscriber matches these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {removing ? (
        <ConfirmDialog
          title="Erase this subscriber?"
          confirmLabel="Erase"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await deleteSubscriber(removing.id);
            toast("Erased.");
            list.reload();
          }}
        >
          <p>
            <b>{removing.email}</b> and their sign-up record are deleted for good (use this for a data-deletion request).
            They can sign up again later. To just stop emails, they use the unsubscribe link.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
