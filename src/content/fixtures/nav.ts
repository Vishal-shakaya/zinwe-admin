/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-43). The menu's red dot on Logs: the logs feed (FR-37) has no API yet,
 * so the dot follows the sample Logs data (src/content/fixtures/logs.ts). Auth/API day: read it from
 * `admin/badges/` (e.g. `logs_attention`) and delete this file.
 */
import { LOG_EVENTS } from "./logs";

export const LOGS_NEED_ATTENTION: boolean = LOG_EVENTS.some((e) => e.level === "error" && !e.resolved);
