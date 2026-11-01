/** Typed client for /api/admin/marketing/*: audiences and outreach campaigns. */
import { request } from "./api";

const BASE = "/api/admin/marketing";

export type Confidence = "Guess" | "Heard once" | "Confirmed";

export interface Audience {
  id?: number;
  name: string;
  country: string;
  decider: string;
  setup: string;
  today: string;
  confidence: Confidence;
  segments: string[];
  triggers: string[];
  words: string[];
  objections: string[];
  not_for: string[];
  problems: string[];
  solutions: string[];
  offers: string[];
  channels: string[];
  summary: string;
}

export type ChipKey = "segments" | "triggers" | "words" | "objections" | "not_for" | "problems" | "solutions" | "offers" | "channels";

export interface Sender {
  from: string;
  reply_to: string;
  domain: string;
  mailbox_ready: boolean;
  smtp_host: string;
  newsletter_from: string;
  postal_address: string;
  limits: number[];
}

export interface CampaignCounts {
  total: number;
  due: number;
  waiting: number;
  paused: number;
  cold: number;
  opted: number;
  blocked: number;
  failed: number;
  needs_you: number;
}

export interface CampaignSummary {
  id: number;
  name: string;
  audience: number;
  audience_name: string;
  goal: string;
  theme: string;
  status: "draft" | "active" | "paused";
  counts: CampaignCounts;
}

export interface EmailStep {
  n: number;
  stage: string;
  when: string;
  week: number;
  subject: string;
  body: string;
}

export interface LaunchCheck {
  key: string;
  label: string;
  done: boolean;
}

export interface CampaignReport {
  funnel: { label: string; value: number }[];
  by_email: { n: number; subject: string; stage: string; sent: number }[];
  health: { bounce_rate: number; unsubscribe_rate: number; complaints: number };
}

export interface CampaignDetail extends CampaignSummary {
  problem: string;
  offer: string;
  pause_reason: string;
  daily_limit: number;
  sent_today: number;
  ready_today: number;
  dns_result: { spf?: boolean; dkim?: boolean; dmarc?: boolean };
  dns_checked_at: string | null;
  rules_checked_at: string | null;
  rules_checked_by: string;
  test_sent_at: string | null;
  checks: LaunchCheck[];
  report: CampaignReport;
  emails: EmailStep[];
}

export type ContactStatus = "new" | "cold" | "waiting" | "opted" | "signed" | "paused" | "snoozed" | "closed" | "finished" | "suppressed";

export interface Contact {
  id: number;
  first_name: string;
  firm: string;
  email: string;
  city: string;
  status: ContactStatus;
  stage: string;
  next_email: number;
  next_date: string | null;
  last_email: number;
  opted_in_at: string | null;
  proof: string;
  installed: boolean;
  reason: string;
  events: { at: string; text: string }[];
}

export interface ImportResult {
  line: string;
  result: "good" | "warn" | "bad";
  message: string;
}

export interface Blocked {
  email: string;
  reason: string;
  created_at: string;
}

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

export const getAudiences = () => request<Audience[]>(`${BASE}/audiences/`);
export const saveAudience = (a: Audience) =>
  a.id
    ? request<Audience>(`${BASE}/audiences/${a.id}/`, { method: "PUT", body: JSON.stringify(a) })
    : request<Audience>(`${BASE}/audiences/`, json(a));

export const getCampaigns = () => request<{ sender: Sender; campaigns: CampaignSummary[] }>(`${BASE}/campaigns/`);
export const getCampaign = (id: number) => request<CampaignDetail>(`${BASE}/campaigns/${id}/`);
export const createCampaign = (name: string, audience: number) => request<CampaignDetail>(`${BASE}/campaigns/`, json({ name, audience }));
export const patchCampaign = (id: number, patch: Partial<Pick<CampaignDetail, "name" | "goal" | "theme" | "problem" | "offer" | "daily_limit"> & { audience: number }>) =>
  request<CampaignDetail>(`${BASE}/campaigns/${id}/`, { method: "PATCH", body: JSON.stringify(patch) });
export const campaignAction = (id: number, action: "launch" | "pause" | "test" | "dns" | "rules" | "send", body: object = {}) =>
  request<CampaignDetail>(`${BASE}/campaigns/${id}/${action}/`, json(body));
export const saveEmail = (id: number, n: number, subject: string, body: string) =>
  request<EmailStep>(`${BASE}/campaigns/${id}/emails/${n}/`, { method: "PUT", body: JSON.stringify({ subject, body }) });

export const getContacts = (id: number) => request<Contact[]>(`${BASE}/campaigns/${id}/contacts/`);
export const importContacts = (id: number, text: string) => request<{ results: ImportResult[] }>(`${BASE}/campaigns/${id}/contacts/import/`, json({ text }));
export const actOnContact = (id: number, action: string, note = "") => request<Contact>(`${BASE}/contacts/${id}/act/`, json({ action, note }));
export const getBlocked = () => request<Blocked[]>(`${BASE}/blocked/`);
