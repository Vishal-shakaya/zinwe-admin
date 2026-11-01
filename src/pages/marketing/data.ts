/** Marketing reference content: segments, suggestions and the copy brief. Only features that ship today. */
import type { Audience, ChipKey, Confidence } from "../../lib/marketingApi";

const S_USB = "Alerts when files are copied to a USB drive";
const S_RULE = "Allow, read-only or block for USB drives";
const S_BIG = "Large transfer alerts for USB, shared folders and email attachments";
const S_REMOTE = "Alerts when remote tools like AnyDesk or TeamViewer are in use";
const S_SOFT = "Alerts when new software appears on a PC";
const S_DAY = "Log in, break and log out from the PC widget";
const S_APPS = "See which apps were used and for how long";
const S_CHAT = "Owner-to-employee chat on the PC widget";
const S_SEEN = "Ready-made notes with sent, delivered and seen status";

export const COUNTRIES = ["USA", "India"];
export const CHANNELS = ["LinkedIn", "Email", "WhatsApp", "Facebook", "Instagram", "YouTube", "Google search"];
export const GOALS = ["Get free plan signups", "Get first PC installed", "Move free users to paid"];
export const THEMES: [string, string, string][] = [
  ["IT Is OK", "Calm, no blame", "You don’t have to know everything to take a first step."],
  ["The Last File", "One file, one story", "What was the last file to leave your firm?"],
  ["Identity Under Attack", "Who is really asking", "Would your team spot a stranger asking for access?"],
  ["Safe by Design", "Simple rules first", "One small rule can prevent a big problem."],
];

export const SEGMENTS: [string, string, string][] = [
  ["CPA and accounting firms", "Client files leaving with staff", "One-PC USB test for client files"],
  ["Digital agencies", "Client work leaving when people move on", "Check what leaves on your busiest PC"],
  ["Clinics", "A stranger asking for remote access", "Remote-access alerts on the front-desk PC"],
  ["Small IT and BPO shops", "Remote tools running without anyone knowing", "See which remote tools are in use"],
  ["Traders and export houses", "Customer lists copied to USB drives", "USB allow, read-only and block setup"],
  ["Design studios", "Instructions lost in calls and group chats", "Team chat on one PC widget"],
];

type Library = Partial<Record<ChipKey, string[]>>;

const LIBRARY: Library[] = [
  {
    problems: ["Client files leaving with staff", "Client files copied to USB drives", "Client files copied to pen drives", "No rule for which USB drives are allowed"],
    solutions: [S_USB, S_RULE, S_BIG, S_SOFT],
    offers: ["One-PC USB test for client files", "2-minute USB test"],
    triggers: ["A senior accountant just resigned", "A client asked how their files are protected"],
    words: ["Client files", "Tax season", "Audit season"],
    objections: ["We have no time during tax season", "We already have antivirus"],
  },
  {
    problems: ["Client work leaving when people move on", "Large project files moved out without anyone knowing", "Remote tools on PCs nobody approved", "Hard to see who is working on what day"],
    solutions: [S_BIG, S_USB, S_REMOTE, S_DAY, S_APPS],
    offers: ["Check what leaves on your busiest PC"],
    triggers: ["A designer or account lead just gave notice", "The agency just won a bigger client"],
    words: ["Client work", "Deliverables", "Offboarding"],
    objections: ["We already keep everything in the cloud", "Most of our team is on Macs"],
  },
  {
    problems: ["A stranger asking for remote access", "Fake support calls to the front desk", "Patient files copied to pen drives", "Unknown software on the front-desk PC"],
    solutions: [S_REMOTE, S_USB, S_SOFT],
    offers: ["Remote-access alerts on the front-desk PC"],
    triggers: ["Someone called asking to install AnyDesk", "A nearby clinic had a scam call"],
    words: ["AnyDesk scam", "Front desk", "Patient files"],
    objections: ["Will it slow the front-desk PC?", "Nobody here can install software"],
  },
  {
    problems: ["Remote tools running without anyone knowing", "Unknown software on team PCs", "Shifts and breaks hard to follow"],
    solutions: [S_REMOTE, S_SOFT, S_DAY, S_APPS],
    offers: ["See which remote tools are in use"],
    triggers: ["A client asked who can reach their systems", "A shift lead just left"],
    words: ["Remote tools", "Shifts", "Client systems"],
    objections: ["We already manage our own PCs", "Our team needs remote tools for work"],
  },
  {
    problems: ["Customer lists copied to USB drives", "Price lists leaving in large email attachments", "No rule for which pen drives are allowed"],
    solutions: [S_RULE, S_USB, S_BIG],
    offers: ["USB allow, read-only and block setup"],
    triggers: ["A sales person left for a rival", "A customer list turned up with a competitor"],
    words: ["Pen drive", "Customer list", "Data chori"],
    objections: ["I trust my old staff", "USB drives are how we share files"],
  },
  {
    problems: ["Instructions lost in calls and group chats", "Large design files moved without anyone knowing", "Hard to see the working day"],
    solutions: [S_CHAT, S_SEEN, S_BIG, S_DAY],
    offers: ["Team chat on one PC widget"],
    triggers: ["A client deadline was missed over a lost message", "The team grew past a few people"],
    words: ["Brief", "Revisions", "Group chat"],
    objections: ["We already use WhatsApp or Slack", "We work on Macs"],
  },
];

const COMMON: Library = {
  problems: ["No IT person to set rules", "Not knowing what software is on each PC", "Not knowing what left the company"],
  solutions: [S_USB, S_REMOTE, S_SOFT, S_DAY, S_CHAT],
  offers: ["Free forever plan", "Install on one PC first"],
  triggers: ["Someone senior just resigned", "The team just grew", "A nearby business had a data scare"],
  words: ["Office", "Team", "No IT person"],
  objections: ["Is this spying on my staff?", "My team will feel watched", "We are too small to need this", "Who will install it for us?"],
  not_for: ["Firms with their own IT team", "Anyone who wants to watch staff without telling them", "Offices that only use Mac or Linux"],
};

function suggestChannels(seg: number, country: string): string[] {
  const us = country === "USA";
  return [
    ["LinkedIn", us ? "Email" : "WhatsApp"],
    ["LinkedIn", "Instagram"],
    [us ? "Email" : "WhatsApp", "Facebook"],
    ["LinkedIn", "Email"],
    [us ? "LinkedIn" : "WhatsApp", us ? "Email" : "Facebook"],
    ["Instagram", "LinkedIn"],
  ][seg];
}

export const lc1 = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Suggestion groups for a chip field, matched to the segments already picked. */
export function suggestions(key: ChipKey, d: Audience): [string, string[]][] {
  const known = d.segments.map((s) => SEGMENTS.findIndex((x) => x[0] === s)).filter((i) => i >= 0);
  if (key === "segments") return [["Segments", SEGMENTS.map((s) => s[0])]];
  if (key === "channels") {
    const rec = known.flatMap((i) => suggestChannels(i, d.country));
    return [...(rec.length ? ([["Suggested for this audience", rec]] as [string, string[]][]) : []), ["All channels", CHANNELS]];
  }
  const groups: [string, string[]][] = [];
  for (const i of known) {
    const list = LIBRARY[i][key];
    if (list) groups.push([`For ${lc1(SEGMENTS[i][0])}`, list]);
  }
  groups.push(["For any small business", COMMON[key] ?? []]);
  return groups;
}

export const CONFIDENCE: Record<Confidence, [string, string]> = {
  Guess: ["", "Guess, not yet checked with real people"],
  "Heard once": ["warn", "Heard once, from one real person"],
  Confirmed: ["good", "Confirmed by several real people"],
};

export const blankAudience = (): Audience => ({
  name: "", country: "USA", decider: "", setup: "", today: "", confidence: "Guess", segments: [], triggers: [], words: [],
  objections: [], not_for: [], problems: [], solutions: [], offers: [], channels: [], summary: "",
});

const joinAnd = (a: string[]) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

export function audienceSummary(d: Audience): string {
  const s: string[] = [];
  const place = d.country === "USA" ? "the USA" : d.country;
  if (d.segments.length) s.push(`This audience covers ${joinAnd(d.segments.map(lc1))} in ${place}.`);
  if (d.decider.trim()) s.push(`The person who decides is ${lc1(d.decider.trim())}${d.setup.trim() ? `, and ${lc1(d.setup.trim())} sets it up` : ""}.`);
  if (d.triggers.length) s.push(`Best moments to reach them: ${joinAnd(d.triggers.map(lc1))}.`);
  if (d.problems.length) s.push(`${d.problems.length > 1 ? "Their main problems are" : "Their main problem is"} ${joinAnd(d.problems.map(lc1))}.`);
  if (d.solutions.length) s.push(`Zinwe offers ${joinAnd(d.solutions.map(lc1))}.`);
  if (d.offers.length) s.push(`${d.offers.length > 1 ? "Best offers" : "Best offer"}: ${joinAnd(d.offers)}.`);
  if (d.channels.length) s.push(`Reach them first on ${d.channels[0]}${d.channels.length > 1 ? `, then on ${joinAnd(d.channels.slice(1))}` : ""}.`);
  return s.join(" ");
}

export function audienceBrief(d: Audience): string {
  const L = [`Audience brief: ${d.name || "New audience"}`, "", `Country: ${d.country}`];
  if (d.segments.length) L.push(`Segments: ${d.segments.join(", ")}`);
  const list = (t: string, a: string[]) => {
    if (a.length) L.push("", t, ...a.map((v) => `- ${v}`));
  };
  if (d.decider.trim() || d.setup.trim() || d.today.trim() || d.triggers.length || d.words.length || d.objections.length || d.not_for.length) {
    L.push("", `Main persona (${CONFIDENCE[d.confidence][1]}):`);
    if (d.decider.trim()) L.push(`Who decides: ${d.decider.trim()}`);
    if (d.setup.trim()) L.push(`Who sets it up: ${d.setup.trim()}`);
    if (d.today.trim()) L.push(`What they do today: ${d.today.trim()}`);
    list("Trigger moments:", d.triggers);
    list("Words they use:", d.words);
    list("Objections:", d.objections);
    list("Not for:", d.not_for);
  }
  list("Problems they face:", d.problems);
  list("Solutions we offer:", d.solutions);
  list("Best offers for this segment:", d.offers);
  if (d.channels.length) L.push("", "Best channels, in order:", ...d.channels.map((v, i) => `${i + 1}. ${v}`));
  if (d.summary.trim()) L.push("", "Summary:", d.summary.trim());
  L.push(
    "", "About Zinwe:",
    "Zinwe by SKYTECHNO is data protection and activity monitoring for small businesses of 5–50 people with no IT department. A small agent on each employee's Windows PC gives the owner plain-English alerts. It is consent-first: employees see the Zinwe widget and agree to a notice on their own PC.",
    "", "When you answer:",
    "- Write for a busy owner who is not technical, in short plain sentences.",
    "- Use the words the persona uses, and open on a trigger moment where it fits.",
    '- Say "protect company data" and "know what left". Never use spying or catching language.',
    "- Zinwe runs on Windows only today. It does not read messages, record screens or log keystrokes.",
    "- Do not invent numbers, reviews or customer names.",
    "- Do not quote prices or PC limits. Point to zinwe.io/plans.",
    "- No legal or compliance claims.",
    "", "My question:", "",
  );
  return L.join("\n");
}

export const CHANNEL_GUIDE = [
  ["LinkedIn", "Owners and partners of B2B firms", "Personal messages and helpful posts", "You send every message yourself"],
  ["Email", "Firms with a verified work email", "Step-by-step campaigns", "Unsubscribe and postal address in every email"],
  ["WhatsApp", "Indian owners who already know you", "Short updates and setup help", "Only with their permission, no bulk cold messages"],
  ["Facebook", "Local small business owners", "Posts, groups and ads", "Be useful first, avoid spamming groups"],
  ["Instagram", "Visual businesses and studios", "Reels, stories and brand trust", "Use it for trust, not cold selling"],
];
