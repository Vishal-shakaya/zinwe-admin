import type { ReactElement, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { AdminMe } from "../lib/api";
import { BrandLogo } from "./BrandLogo";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/subscribers", label: "Subscribers" },
  { to: "/feedback", label: "Feedback" },
  { to: "/support", label: "Support" },
  { to: "/releases", label: "Releases" },
  { to: "/blog", label: "Blog" },
];

export function Layout({
  me,
  onSignOut,
  children,
}: {
  me: AdminMe;
  onSignOut: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="shell">
      <aside className="side">
        <BrandLogo />
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => "nav__link" + (isActive ? " is-active" : "")}
            >
              {item.label}
            </NavLink>
          ))}
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
