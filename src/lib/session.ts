/** The staff token for the internal admin app (its own localStorage key). */
const KEY = "zinwe.admin.token";

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // Private mode / blocked storage: the session just won't persist across reloads.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
