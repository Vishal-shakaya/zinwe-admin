/** Small helpers shared by the inbox pages (Support, Feedback, Forms). Times are shown in IST, as on the boards. */

const IST = "Asia/Kolkata";

/** "28 Oct, 12:31" */
export function dayTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${dayOnly(iso)}, ${timeOnly(iso)}`;
}

/** "28 Oct" */
export function dayOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: IST });
}

/** "12:31" */
export function timeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: IST });
}

/** "25 min", "2 h", "1 day", "5 days" since `iso`. */
export function age(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** Whole days between `iso` and now. */
export function daysAgo(iso: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

/** First name for a friendly line ("Dr. Meera Iyer" -> "Meera"); falls back to the email's local part. */
export function firstName(fullName: string, email = ""): string {
  const name = fullName.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").trim();
  if (name) return name.split(/\s+/)[0];
  const local = email.replace(/@.*/, "");
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "there";
}

/** Today as 2026-10-28 (IST) for export file names. */
export function isoToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: IST });
}

/** Download rows as a CSV file (Excel-friendly: BOM + quoted cells). */
export function downloadCsv(fileName: string, header: string[], rows: (string | number)[][]): void {
  const cell = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const text = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read/write a small JSON value in localStorage; never throws (private mode, blocked storage). */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* the change just won't survive a reload */
  }
}
