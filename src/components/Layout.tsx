import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { getBadges, type AdminMe } from "../lib/api";
import { BADGES_EVENT } from "../lib/badges";
import { useAdminEnv } from "../lib/env";
import { LOGS_NEED_ATTENTION } from "../content/fixtures/nav";
import { SAMPLES_ON } from "../lib/samples";
import { BrandLogo, DevPill } from "./BrandLogo";
import { Icon, type IconName } from "./icons";

type BadgeKey = "payments_waiting" | "support_waiting" | "forms_new" | "feedback_unread";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  badge?: BadgeKey;
  /** Read after the count by screen readers: "2 payments to check". */
  badgeLabel?: string;
  /** Yellow badge (money waiting) instead of the light one. */
  warn?: boolean;
  /** A red "needs attention" dot instead of a count. */
  dot?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  { label: "OVERVIEW", items: [{ to: "/", label: "Dashboard", icon: "dashboard", end: true }] },
  {
    label: "CUSTOMERS",
    items: [
      { to: "/subscribers", label: "Subscribers", icon: "subscribers", badge: "payments_waiting", badgeLabel: "payments to check", warn: true },
      { to: "/subscriptions", label: "Subscriptions", icon: "subscriptions" },
      { to: "/pricing", label: "Plans & pricing", icon: "pricing" },
    ],
  },
  {
    label: "INBOX",
    items: [
      { to: "/support", label: "Support", icon: "support", badge: "support_waiting", badgeLabel: "waiting for an answer" },
      { to: "/feedback", label: "Feedback", icon: "feedback", badge: "feedback_unread", badgeLabel: "unread" },
      { to: "/forms", label: "Forms", icon: "forms", badge: "forms_new", badgeLabel: "new" },
    ],
  },
  {
    label: "PUBLISH",
    items: [
      { to: "/announcements", label: "Announcements", icon: "announcements" },
      { to: "/whats-new", label: "What’s new", icon: "whatsnew" },
      { to: "/releases", label: "Releases", icon: "releases" },
      { to: "/blog", label: "Blog", icon: "blog" },
    ],
  },
  { label: "SYSTEM", items: [{ to: "/logs", label: "Logs", icon: "logs", dot: true }] },
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

function initials(name: string): string {
  const parts = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const two = (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ""));
  return two.toUpperCase() || "?";
}

/** "Vishal Shakaya" -> "Vishal S" (the board's short form). */
function shortName(me: AdminMe): string {
  const full = (me.full_name || "").trim();
  if (!full) return me.email.replace(/@.*/, "");
  const parts = full.split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}` : parts[0];
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
  const dev = useAdminEnv() === "dev";
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const menuRef = useRef<HTMLButtonElement>(null);

  // Phones: the menu closes after you pick a page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // SYSTEM: Logs is sample data (dev server only), Documentation is local only; with neither, the group goes.
  const groups: NavGroup[] = GROUPS.map((g) => {
    if (g.label !== "SYSTEM") return g;
    const items = [
      ...(SAMPLES_ON ? g.items : g.items.filter((i) => i.to !== "/logs")),
      ...(docs ? [{ to: "/docs", label: "Documentation", icon: "docs" as const }] : []),
    ];
    return { ...g, items };
  }).filter((g) => g.items.length > 0);

  return (
    <div className="zshell">
      <div className="zshell__nav">
        <nav className={"zan" + (open ? " is-open" : "")} aria-label="Back office">
          <div className="zan__sticky">
            <div className="zan__top">
              <div className="zan__brandrow">
                <Link to="/" className="zan__brand">
                  <BrandLogo height={24} extra={dev ? <DevPill /> : null} />
                </Link>
                <button
                  ref={menuRef}
                  type="button"
                  className="zan__menu-btn"
                  aria-expanded={open}
                  onClick={() => setOpen((v) => !v)}
                >
                  <Icon name={open ? "close" : "menu"} />
                  {open ? "Close" : "Menu"}
                </button>
              </div>
            </div>

            <div className="zan__groups">
              {groups.map((g) => (
                <div key={g.label} className="zan__group">
                  <span className="zan__glabel">{g.label}</span>
                  {g.items.map((item) => {
                    const count = item.badge ? (badges[item.badge] ?? 0) : 0;
                    const showDot = item.dot && SAMPLES_ON && LOGS_NEED_ATTENTION;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) => "zan-link" + (isActive ? " is-active" : "")}
                      >
                        <Icon name={item.icon} size={18} />
                        <span className="zan-link__label">{item.label}</span>
                        {count > 0 ? (
                          <span className={"zan__badge" + (item.warn ? " warn" : "")}>
                            {count}
                            <span className="sr"> {item.badgeLabel}</span>
                          </span>
                        ) : null}
                        {showDot ? (
                          <span style={{ display: "inline-flex", alignItems: "center" }}>
                            <span aria-hidden="true" className="zan__dot" />
                            <span className="sr">, needs attention</span>
                          </span>
                        ) : null}
                      </NavLink>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="zan__foot">
              <div className="zan__who">
                <span aria-hidden="true" className="zan__avatar">
                  {initials(me.full_name || me.email)}
                </span>
                <span className="zan__whotext">
                  <span className="zan__whoname">
                    <b>{shortName(me)}</b>
                    <span className="zan__role">Staff</span>
                  </span>
                  <span className="zan__email">{me.email}</span>
                </span>
              </div>
              <button type="button" className="zan-out" onClick={onSignOut}>
                <Icon name="signOut" />
                Sign out
              </button>
            </div>
          </div>
        </nav>
      </div>

      <main className="zmain">{children}</main>
    </div>
  );
}
