import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { getBadges, type AdminMe } from "../lib/api";
import { BADGES_EVENT } from "../lib/badges";
import { BrandLogo } from "./BrandLogo";

type BadgeKey = "payments_waiting" | "support_waiting" | "forms_new";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  badge?: BadgeKey;
  /** Read after the count by screen readers: "2 payments to check". */
  badgeLabel?: string;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/subscribers", label: "Subscribers", badge: "payments_waiting", badgeLabel: "payments to check" },
  { to: "/subscriptions", label: "Subscriptions" },
  { to: "/feedback", label: "Feedback" },
  { to: "/support", label: "Support", badge: "support_waiting", badgeLabel: "waiting for an answer" },
  { to: "/forms", label: "Forms", badge: "forms_new", badgeLabel: "new form submissions" },
  { to: "/announcements", label: "Announcements" },
  { to: "/whats-new", label: "What's new" },
  { to: "/releases", label: "Releases" },
  { to: "/blog", label: "Blog" },
];

const BADGE_REFRESH_MS = 60_000;

/** Sidebar counts of what needs the team now; refreshed on every page change and once a minute. */
function useBadges(): Partial<Record<BadgeKey, number>> {
  const { pathname, search } = useLocation();
  const [badges, setBadges] = useState<Partial<Record<BadgeKey, number>>>({});
  useEffect(() => {
    let alive = true;
    const load = () => {
      getBadges()
        .then((b) => {
          if (alive) setBadges(b);
        })
        .catch(() => {
          /* an older backend has no badges: just show none */
        });
    };
    load();
    const timer = window.setInterval(load, BADGE_REFRESH_MS);
    window.addEventListener(BADGES_EVENT, load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(BADGES_EVENT, load);
    };
  }, [pathname, search]);
  return badges;
}

/**
 * Documentation: only when the admin runs locally (`npm run dev`) AND the docs server answers, so staff
 * never get a menu item that opens an error (J8-20). Never in dev/prod builds.
 */
function useDocsAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let alive = true;
    fetch("/__zinwe_docs/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((index: { pages?: unknown[] }) => {
        if (alive) setOk(Array.isArray(index.pages) && index.pages.length > 0);
      })
      .catch(() => {
        if (alive) setOk(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}

export function Layout({
  me,
  onSignOut,
  children,
}: {
  me: AdminMe;
  onSignOut: () => void;
  children: ReactNode;
}): ReactElement {
  const badges = useBadges();
  const docs = useDocsAvailable();
  const items: NavItem[] = docs ? [...NAV, { to: "/docs", label: "Documentation" }] : NAV;

  return (
    <div className="shell">
      <aside className="side">
        <BrandLogo />
        <nav className="nav" aria-label="Back office">
          {items.map((item) => {
            const count = item.badge ? (badges[item.badge] ?? 0) : 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav__link${isActive ? " is-active" : ""}`}
              >
                <span>{item.label}</span>
                {count > 0 ? (
                  <span className="nav__badge">
                    {count}
                    <span className="sr-only"> {item.badgeLabel}</span>
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="side__foot">
          <div className="who">
            <b>{me.full_name || me.email}</b>
            <small>{me.email}</small>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="main__inner">{children}</div>
      </main>
    </div>
  );
}
