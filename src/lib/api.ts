/** Typed client for the staff-only admin API (/api/admin/*) + the shared login. */
import { clearToken, getToken } from "./session";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const { auth = true, headers, ...rest } = init;
  const h = new Headers(headers);
  if (rest.body && !h.has("Content-Type")) h.set("Content-Type", "application/json");
  if (auth) {
    const token = getToken();
    if (token) h.set("Authorization", `Token ${token}`);
  }
  const res = await fetch(path, { ...rest, headers: h });
  if (res.status === 401) {
    clearToken();
    throw new ApiError("Your session has ended. Please sign in again.", 401);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail =
      (data && (data.detail || firstFieldError(data))) || `Something went wrong (${res.status}).`;
    throw new ApiError(detail, res.status);
  }
  return data as T;
}

function firstFieldError(data: unknown): string | null {
  if (data && typeof data === "object") {
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length && typeof value[0] === "string") return value[0];
      if (typeof value === "string") return value;
    }
  }
  return null;
}

// --- Types -----------------------------------------------------------------

export interface AdminMe {
  id: number;
  email: string;
  full_name: string;
  is_staff: boolean;
}

export interface PlanSummary {
  code: string;
  name: string;
  price_inr_monthly: string;
  max_devices: number;
}

export type PaymentStatus = "submitted" | "verified" | "rejected";
export type SubscriptionStatus = "pending_payment" | "active" | "expired" | "cancelled";

/** A payment the customer reported (UPI, bank transfer, PayPal...), checked by staff. */
export interface Payment {
  id: number;
  method: string;
  amount_inr: string;
  /** What the plan costs: compare with amount_inr before approving. */
  expected_inr: string;
  reference: string;
  payer_name: string;
  paid_on: string;
  status: PaymentStatus;
  has_proof: boolean;
  rejection_reason: string;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  plan: { code: string; name: string };
  /** Billing cycle: verified payments are 1..n; a submitted one shows the cycle it would start; rejected = null. */
  cycle: number | null;
  /** Paid while the plan was active, to extend it. */
  is_renewal: boolean;
  /** The period an approved payment paid for. */
  covers_from: string | null;
  covers_until: string | null;
  /** Waiting payments: the period approving it now would cover. */
  would_cover: { from: string; until: string } | null;
}

/** A payment in the plan-activation queue, with who sent it. */
export interface QueuedPayment extends Payment {
  customer: { id: number; email: string; full_name: string; is_active: boolean; company: string | null };
  subscription_status: SubscriptionStatus;
}

export interface Subscriber {
  id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  email_verified: boolean;
  date_joined: string;
  last_login: string | null;
  company: { name: string; industry: string; team_size: string; city: string; state: string } | null;
  plan: { code: string; name: string; max_devices: number } | null;
  subscription: {
    status: SubscriptionStatus;
    is_trial: boolean;
    amount_inr: string;
    starts_at: string | null;
    ends_at: string | null;
    /** Whole days until an active plan ends (0 = today); null when open-ended. */
    days_left: number | null;
    /** An active paid plan (can be renewed early). */
    renewable: boolean;
  } | null;
  /** The current subscription's latest payment. */
  payment: Payment | null;
  billing: { cycles_paid: number; total_paid_inr: string };
  /** Every payment the customer reported, newest first. */
  payments: Payment[];
  /** The team's internal note (never shown to the customer). */
  remark: { text: string; updated_at: string; updated_by: string | null } | null;
  /** Custom emails the team sent this customer. */
  emails: { sent: number; last_sent_at: string | null };
  /** Members the owner added on their dashboard, and PCs enrolled on the account. */
  team: { devices: number; members: TeamMember[] };
}

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  member_code: string;
  is_active: boolean;
  /** PCs enrolled for this member. */
  devices: number;
  created_at: string;
}

/** A custom email the team sent (body is the plain-text version). */
export interface SentEmail {
  id: number;
  subject: string;
  body: string;
  status: "pending" | "sent" | "failed";
  error: string;
  created_at: string;
  sent_at: string | null;
  template: string;
  /** Sent by Zinwe itself (a renewal reminder or expiry notice), not written by the team. */
  automatic: boolean;
}

export interface FeedbackRow {
  id: number;
  rating: number;
  message: string;
  page: string;
  created_at: string;
  customer: { id: number; email: string; full_name: string; company: string | null };
}

export interface FeedbackSummary {
  count: number;
  average: number | null;
  distribution: { rating: number; count: number }[];
}

export interface Metrics {
  totals: {
    users: number;
    verified_users: number;
    active_subscriptions: number;
    trials: number;
    paying: number;
    pending_payments: number;
    revenue_inr: string;
    feedback: { count: number; average: number | null };
  };
  signups: { date: string; count: number }[];
  revenue: { month: string; revenue_inr: string }[];
}

// --- Calls -----------------------------------------------------------------

export async function login(email: string, password: string): Promise<string> {
  const data = await request<{ token: string }>("/api/auth/login/", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email, password }),
  });
  return data.token;
}

export const getMe = () => request<AdminMe>("/api/admin/me/");
export const getMetrics = () => request<Metrics>("/api/admin/metrics/");
export const getPlans = () => request<PlanSummary[]>("/api/admin/plans/");
export const getSubscribers = async () =>
  (await request<Subscriber[]>("/api/admin/subscribers/")).map(withSubscriberDefaults);
export const getSubscriber = async (id: number) =>
  withSubscriberDefaults(await request<Subscriber>(`/api/admin/subscribers/${id}/`));

/**
 * Fill fields an older backend doesn't send yet (billing/payments arrived later), so a
 * backend that wasn't restarted after an update shows "0 cycles" instead of crashing the page.
 */
function withSubscriberDefaults(row: Subscriber): Subscriber {
  return {
    ...row,
    billing: row.billing ?? { cycles_paid: 0, total_paid_inr: "0" },
    payments: row.payments ?? [],
    remark: row.remark ?? null,
    emails: row.emails ?? { sent: 0, last_sent_at: null },
    team: row.team ?? { devices: 0, members: [] },
    payment: row.payment ? { ...row.payment, cycle: row.payment.cycle ?? null } : null,
  };
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
/** A POST that returns a customer row: normalised like the list, so a missing field can't crash the page. */
const postSubscriber = async (path: string, body?: unknown) => withSubscriberDefaults(await post<Subscriber>(path, body));

export const blockSubscriber = (id: number) => postSubscriber(`/api/admin/subscribers/${id}/block/`);
export const unblockSubscriber = (id: number) => postSubscriber(`/api/admin/subscribers/${id}/unblock/`);
export const changePlan = (id: number, plan: string) =>
  postSubscriber(`/api/admin/subscribers/${id}/change-plan/`, { plan });
/** Passwords are stored hashed and can't be read back; staff can only set a new one. */
export const setPassword = (id: number, password: string) =>
  postSubscriber(`/api/admin/subscribers/${id}/set-password/`, { password });
export const deleteSubscriber = (id: number) =>
  request<null>(`/api/admin/subscribers/${id}/`, { method: "DELETE" });
/** Empty text clears the remark. */
export const setRemark = (id: number, text: string) =>
  postSubscriber(`/api/admin/subscribers/${id}/remark/`, { text });
export const getCustomerEmails = (id: number) => request<SentEmail[]>(`/api/admin/subscribers/${id}/emails/`);
/** `html` is cleaned on the server to a safe allow-list before it's sent. */
export const sendCustomerEmail = (id: number, subject: string, html: string) =>
  post<SentEmail>(`/api/admin/subscribers/${id}/emails/`, { subject, html });

// Plan activation: a paid plan turns on only when its payment is approved (by payment id).
export const approvePayment = (paymentId: number) =>
  post<QueuedPayment>(`/api/admin/payments/${paymentId}/approve/`);
export const rejectPayment = (paymentId: number, reason: string) =>
  post<QueuedPayment>(`/api/admin/payments/${paymentId}/reject/`, { reason });

/** The uploaded receipt/screenshot, fetched with the staff token (it's never public). */
export async function fetchProof(paymentId: number): Promise<Blob> {
  const h = new Headers();
  const token = getToken();
  if (token) h.set("Authorization", `Token ${token}`);
  const res = await fetch(`/api/auth/subscription/payment/${paymentId}/proof/`, { headers: h });
  if (res.status === 401) {
    clearToken();
    throw new ApiError("Your session has ended. Please sign in again.", 401);
  }
  if (!res.ok) throw new ApiError("The proof file couldn't be loaded.", res.status);
  return res.blob();
}

export const getFeedback = () =>
  request<{ summary: FeedbackSummary; rows: FeedbackRow[] }>("/api/admin/feedback/");
