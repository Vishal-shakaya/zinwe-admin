/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-43) — Announcements extras the API does not serve yet (AdminAnnouncements board).
 * Real: the list, create / edit, type, where, audience (everyone / free / paid / chosen plans / chosen customers),
 * reach ("Reaches N customers right now"), button + link validation, special price, start–end, can be closed,
 * priority, on/off (End now), delete. Sample here:
 *
 *  - COUNTRIES: "By country" audience (no country targeting in the API; the option is shown but not selectable).
 *  - EMAIL_ANNOUNCEMENTS: "Also email it" (no email sending for announcements; the switch is shown but disabled).
 *  - Views · clicks: not counted by the API (the column says "Not counted yet").
 *  - SYSTEM_BARS / BAR_LADDER: the copy of the automatic plan / payment bars for "Preview as" and "Which bar wins".
 *    These mirror the dashboard's own bars; they are preview copy, not customer data.
 *
 * API day: add `countries`, `send_email`, `views` and `clicks` to the announcement, then trim this file to the
 * preview copy.
 */

export const COUNTRIES: { code: string; label: string; n: number }[] = [
  { code: "in", label: "India", n: 61 },
  { code: "ae", label: "United Arab Emirates", n: 7 },
  { code: "uk", label: "United Kingdom", n: 5 },
  { code: "sg", label: "Singapore", n: 3 },
];

export const EMAIL_ANNOUNCEMENTS_AVAILABLE = false;

export type PreviewAs = "normal" | "ended" | "ending" | "payment" | "full";

export const PREVIEW_AS: { value: PreviewAs; label: string }[] = [
  { value: "normal", label: "A customer with nothing pending" },
  { value: "ended", label: "Plan ended" },
  { value: "ending", label: "Plan ends in 3 days" },
  { value: "payment", label: "Payment being checked" },
  { value: "full", label: "49 of 50 PCs used" },
];

export interface SystemBar {
  bar: string;
  fg: string;
  btnBg: string;
  btnFg: string;
  icon: "warn" | "clock" | "pcs";
  title: string;
  msg: string;
  btn: string;
  name: string;
}

export const SYSTEM_BARS: Record<Exclude<PreviewAs, "normal">, SystemBar> = {
  ended: { bar: "#FBE7E3", fg: "#8A1F0B", btnBg: "#8A1F0B", btnFg: "#fff", icon: "warn", title: "Your Businesses plan ended on 25 Oct.", msg: "Renew to keep alerts and backups running.", btn: "Renew", name: "plan ended" },
  ending: { bar: "#FDF0D5", fg: "#5C3A00", btnBg: "#5C3A00", btnFg: "#fff", icon: "clock", title: "Your Businesses plan ends in 3 days.", msg: "Renew now so nothing stops on Sat 31 Oct.", btn: "Renew", name: "plan ends soon" },
  payment: { bar: "#E6ECF3", fg: "#1F3A5A", btnBg: "", btnFg: "", icon: "clock", title: "We’re checking your payment.", msg: "This usually takes a few hours. Everything keeps working.", btn: "", name: "payment being checked" },
  full: { bar: "#FDF0D5", fg: "#5C3A00", btnBg: "#5C3A00", btnFg: "#fff", icon: "pcs", title: "49 of 50 PCs used.", msg: "Add PCs before you run out.", btn: "Add PCs", name: "PCs nearly full" },
};

export const BAR_LADDER: { key: PreviewAs | "ann"; label: string }[] = [
  { key: "ended", label: "Plan ended" },
  { key: "ending", label: "Plan ends within 7 days" },
  { key: "payment", label: "Payment being checked" },
  { key: "full", label: "PCs nearly full" },
  { key: "ann", label: "Your announcement" },
];

/** Name shown in the dashboard preview greeting. */
export const PREVIEW_OWNER = "Ananya";
