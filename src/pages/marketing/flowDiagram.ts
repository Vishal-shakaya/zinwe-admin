/** The marketing steps diagram as an SVG string. Static text only, nothing from the API goes in. */
const INK = "#141210";

type TextOpts = { s?: number; w?: number; f?: string };

const t = (x: number, y: number, l: string, o: TextOpts = {}) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-size="${o.s ?? 13}" font-weight="${o.w ?? 600}" fill="${o.f ?? INK}">${l}</text>`;
const box = (x: number, y: number, n: string, a: string, b: string) =>
  `<rect x="${x - 78}" y="${y - 32}" width="156" height="64" rx="10" fill="#fff" stroke="currentColor" stroke-width="1.4"/><circle cx="${x - 58}" cy="${y - 12}" r="10" fill="${INK}"/>${t(x - 58, y - 8, n, { s: 11, f: "#fff" })}${t(x + 8, y - 4, a)}${t(x, y + 18, b, { s: 12, w: 400, f: "#404040" })}`;
const dia = (x: number, y: number, a: string, b?: string) =>
  `<polygon points="${x - 72},${y} ${x},${y - 46} ${x + 72},${y} ${x},${y + 46}" fill="#fdebdc" stroke="#f26a0a" stroke-width="1.6"/>${t(x, b ? y - 3 : y + 4, a)}${b ? t(x, y + 14, b) : ""}`;
const end = (x: number, y: number, w: number, a: string, b: string, c = INK) =>
  `<rect x="${x - w / 2}" y="${y - 26}" width="${w}" height="52" rx="26" fill="${c}"/>${t(x, y - 3, a, { f: "#fff", s: 12 })}${t(x, y + 13, b, { f: "#e5e5e5", s: 11, w: 400 })}`;
const ln = (d: string) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#stp)"/>`;
const lab = (x: number, y: number, l: string, a = "middle") =>
  `<text x="${x}" y="${y}" text-anchor="${a}" font-size="12" font-weight="600" fill="#404040" stroke="#fff" stroke-width="4" paint-order="stroke">${l}</text>`;

export const FLOW_DIAGRAM =
  '<svg viewBox="0 0 1120 550" role="img" aria-label="Marketing steps from finding firms through two cold emails, a yes decision, setup, tips, the final check, the newsletter and a paid plan.">' +
  '<defs><marker id="stp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>' +
  ln("M166 80H190") + ln("M346 80H370") + ln("M526 80H550") + ln("M706 80H758") +
  ln("M902 80H936V40H970") + ln("M936 80V120H970") +
  ln("M830 126V184") + lab(842, 160, "Yes", "start") +
  ln("M758 230H706") + lab(732, 222, "No") + ln("M550 230H526") + ln("M370 230H346") +
  ln("M830 276V312H448V262") + lab(640, 304, "Yes, skip setup") +
  ln("M268 262V354") +
  ln("M340 400H392") + lab(366, 392, "Yes") + ln("M196 400H158") + lab(177, 392, "No") +
  ln("M548 400H618") + ln("M762 400H852") + lab(807, 392, "Yes") + ln("M690 446V484") + lab(702, 470, "No", "start") +
  box(88, 80, "1", "Find firms", "5–50 people") + box(268, 80, "2", "Clean list", "One per firm") + box(448, 80, "3", "Email 1", "Problem, free plan") + box(628, 80, "4", "Email 2", "Test, ask for yes") +
  dia(830, 80, "Said yes?") + end(1040, 40, 140, "No reply", "Stop emailing", "#6b6b6b") + end(1040, 120, 140, "No or bounce", "Never email again", "#c0331c") +
  dia(830, 230, "Already", "installed?") + box(628, 230, "5", "Setup", "Emails 3–5") + box(448, 230, "6", "Weekly tips", "Emails 6–11") + box(268, 230, "7", "Final check", "Email 12") +
  dia(268, 400, "Joins", "newsletter?") + end(88, 400, 140, "No", "Stop emailing", "#6b6b6b") + box(470, 400, "8", "Newsletter", "Occasional articles") + dia(690, 400, "Outgrows", "free plan?") + end(930, 400, 156, "Paid plan", "Goal", "#17663f") + end(690, 510, 170, "Free forever", "Keeps using Zinwe", "#6b6b6b") +
  "</svg>";
