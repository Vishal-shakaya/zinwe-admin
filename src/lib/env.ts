/**
 * Which environment this admin runs on. Read-only (v1.3.1, owner review 30 Oct): the Prod/Dev session switch,
 * its dialog and the orange DEV frame are gone. The host decides, nothing in the browser can change it:
 *
 * - dev.admin.zinwe.io (ADMIN_DOMAIN in ops/deploy/flavours/dev.conf), any local host (localhost, 127.0.0.1, ::1,
 *   *.local, *.localhost) and the Vite dev server = Dev. The menu shows a small "Dev" pill there.
 * - Everything else (prod.admin.zinwe.io, admin.zinwe.io, an unlisted alias) = Production: no pill at all.
 *
 * Releases and Logs use it to name where a publish lands ("Publish to Prod").
 */
export type AdminEnv = "prod" | "dev";

export const DEV_HOSTS = ["dev.admin.zinwe.io"];

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"];

function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.includes(host) || host.endsWith(".localhost") || host.endsWith(".local");
}

export function currentEnv(): AdminEnv {
  // Lower-case, without a trailing dot ("dev.admin.zinwe.io." is the same host).
  const host = window.location.hostname.toLowerCase().replace(/\.$/, "");
  if (DEV_HOSTS.includes(host) || isLocalHost(host) || import.meta.env.DEV) return "dev";
  return "prod";
}

/** The environment never changes during a page's life, so this is a plain read (kept as a hook-style name). */
export function useAdminEnv(): AdminEnv {
  return currentEnv();
}
