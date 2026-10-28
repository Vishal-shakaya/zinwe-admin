/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-43) — What's new editor options the release-notes API does not store yet.
 * Version, title, date (published_at), the New / Improved / Fixed points (saved as the note body) and
 * publish / unpublish / delete are real (`admin/release-notes/*`). These four are kept in this browser tab only:
 *
 *  - help:   show in the dashboard under Help → What's new
 *  - bell:   show in the dashboard bell
 *  - banner: the thin "Zinwe x is out" strip above the blog
 *  - image:  an optional picture (previewed locally, not uploaded)
 *
 * API day: add `show_in_help`, `show_in_bell`, `blog_banner` and `image` to the release note, then delete this file.
 */
export interface NoteDisplay {
  help: boolean;
  bell: boolean;
  banner: boolean;
  /** Local object URL + file name of a picked image (never uploaded). */
  image: { url: string; name: string; size: number } | null;
}

export const DEFAULT_DISPLAY: NoteDisplay = { help: true, bell: true, banner: false, image: null };

const store = new Map<string, NoteDisplay>();

export function getDisplay(key: string): NoteDisplay {
  return store.get(key) ?? DEFAULT_DISPLAY;
}

export function setDisplay(key: string, value: NoteDisplay): void {
  store.set(key, value);
}

/** The bell preview's second row (a normal alert under the note). */
export const BELL_SAMPLE_ALERT = { title: "Priya Nair took 3 breaks today", meta: "Alerts · 2 h ago" };
