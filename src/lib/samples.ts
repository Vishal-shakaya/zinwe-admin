/**
 * THE switch for sample data (v1.3 release gate). Board blocks the API does not serve yet live in
 * `src/content/fixtures/*.ts` and carry a dashed "Sample data" tag. Staff on the real hosts must never see
 * invented events or act on them, so:
 *
 *  - `npm run dev` (Vite dev server): ON — every sample block shows, as on the boards.
 *  - `npm run build` (dev.admin / prod.admin bundles): OFF — purely-sample pages, blocks and tags are hidden,
 *    browser-only helpers start empty. Build with `VITE_SAMPLE_DATA=1` to turn them back on (demos only).
 *
 * Every screen that reads a fixture checks this one constant; nothing else decides it.
 */
export const SAMPLES_ON: boolean = import.meta.env.DEV || import.meta.env.VITE_SAMPLE_DATA === "1";
