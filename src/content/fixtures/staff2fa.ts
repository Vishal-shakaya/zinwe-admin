/**
 * SAMPLE-DATA SEAM (v1.3 UI day). Staff 2FA is a "Proposal — decide for v1.3" on the AdminLogin board; the
 * backend has no 2FA endpoint. The real sign-in (POST /api/auth/login/ + GET /api/admin/me/) is unchanged.
 *
 * The code step can be previewed in the local dev server only: open /?twofa=preview (or set this flag).
 * Any 6 digits pass in the preview, except 000000, which shows the board's "wrong code" error.
 * Auth day: replace `verifyStaffCode` with the real endpoint, or delete this file if 2FA is dropped.
 */
export const STAFF_2FA_PREVIEW_DEFAULT = false;

export function staff2faPreview(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return STAFF_2FA_PREVIEW_DEFAULT || new URLSearchParams(window.location.search).get("twofa") === "preview";
  } catch {
    return false;
  }
}

export async function verifyStaffCode(code: string): Promise<boolean> {
  await new Promise((r) => window.setTimeout(r, 500));
  return code !== "000000";
}
