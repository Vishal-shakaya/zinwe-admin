/**
 * Where on the customer dashboard something was sent from, in the words the customer sees in its menu
 * ("/app/team" -> "Team & devices"). Feedback and support store the path; "modal:" means the pop-up form.
 */
const DASHBOARD_PAGES: [string, string][] = [
  ["/app/settings/billing", "Settings → Billing"],
  ["/app/settings/company", "Settings → Company"],
  ["/app/settings/password", "Settings → Password"],
  ["/app/help/feedback", "Help → Feedback"],
  ["/app/help/guide", "Help → Guide"],
  ["/app/help/policies", "Help → Policies"],
  ["/app/internet", "Online protection"],
  ["/app/data", "Data safety"],
  ["/app/remote", "App monitoring"],
  ["/app/team", "Team & devices"],
  ["/app/chat", "Chat"],
  ["/app/activity", "Activity"],
  ["/app/alerts", "Alerts"],
  ["/app/setup", "Setup"],
  ["/app/upgrade", "Upgrade"],
  ["/app/invoice", "Invoice"],
  ["/app/feedback", "Feedback"],
  ["/app", "Overview"],
];

export function pageName(raw: string): string {
  const popup = raw.startsWith("modal:");
  const path = (popup ? raw.slice("modal:".length) : raw).split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const hit = DASHBOARD_PAGES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  const where = hit ? `Dashboard → ${hit[1]}` : path.startsWith("/app") ? "Dashboard" : `Website (${path})`;
  return popup ? `${where}, feedback pop-up` : where;
}
