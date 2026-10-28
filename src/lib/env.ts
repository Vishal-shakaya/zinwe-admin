import { useEffect, useState } from "react";

/**
 * Which environment this staff session works on (AdminNav "THIS SESSION" box, the orange DEV frame, the
 * dashboard env pill). SAMPLE-DATA SEAM (v1.3 UI day, FR-43): there is no API for it; it is derived here.
 *
 * - On the real hosts the host decides: prod.admin.zinwe.io / admin.zinwe.io = Production, dev.admin.zinwe.io = Dev.
 *   Switching opens the other host (a separate sign-in: tokens are per origin).
 * - Anywhere else (localhost) it is a preview value kept for the browser tab in sessionStorage
 *   (`zinwe-admin-env`, or `#env=dev|prod` in the URL), default Dev — the local stack holds test data only.
 *
 * Auth day (30 Oct): confirm the host names with Pilot and whether the switch should hand the session over.
 */
export type AdminEnv = "prod" | "dev";

export const ENV_KEY = "zinwe-admin-env";
export const ENV_EVENT = "zinwe-admin-env";

export const PROD_HOSTS = ["admin.zinwe.io", "prod.admin.zinwe.io"];
export const DEV_HOSTS = ["dev.admin.zinwe.io"];
const PROD_URL = "https://prod.admin.zinwe.io";
const DEV_URL = "https://dev.admin.zinwe.io";

function fromHost(): AdminEnv | null {
  const host = window.location.hostname;
  if (PROD_HOSTS.includes(host)) return "prod";
  if (DEV_HOSTS.includes(host)) return "dev";
  return null;
}

/** True when the env is fixed by the host (a real deployment), false on a local preview. */
export function envFromHost(): boolean {
  return fromHost() !== null;
}

function readPreview(): AdminEnv {
  try {
    const e = new URLSearchParams(window.location.hash.slice(1)).get("env");
    if (e === "dev" || e === "prod") {
      window.sessionStorage.setItem(ENV_KEY, e);
      return e;
    }
  } catch {
    /* ignore */
  }
  try {
    const v = window.sessionStorage.getItem(ENV_KEY);
    if (v === "dev" || v === "prod") return v;
  } catch {
    /* ignore */
  }
  return "dev";
}

export function currentEnv(): AdminEnv {
  return fromHost() ?? readPreview();
}

/** Switch the session. Real hosts: go to the other host (same page). Local: flip the preview value. */
export function switchEnv(to: AdminEnv): void {
  if (fromHost()) {
    const base = to === "prod" ? PROD_URL : DEV_URL;
    window.location.assign(base + window.location.pathname + window.location.search);
    return;
  }
  try {
    window.sessionStorage.setItem(ENV_KEY, to);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(ENV_EVENT, { detail: to }));
}

export function useAdminEnv(): AdminEnv {
  const [env, setEnv] = useState<AdminEnv>(currentEnv);
  useEffect(() => {
    const on = (ev: Event) => {
      const d = (ev as CustomEvent<unknown>).detail;
      if (d === "dev" || d === "prod") setEnv(d);
    };
    window.addEventListener(ENV_EVENT, on);
    return () => window.removeEventListener(ENV_EVENT, on);
  }, []);
  return env;
}

export function envHost(): string {
  return window.location.host;
}
