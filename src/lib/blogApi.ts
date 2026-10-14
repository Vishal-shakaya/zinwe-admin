/**
 * Blog client for the admin app (staff side: /api/admin/blog/*). Kept apart from api.ts so the
 * blog can evolve on its own; it shares the session token and ApiError.
 */
import { ApiError } from "./api";
import { clearToken, getToken } from "./session";

export type ArticleType = "press_release" | "tutorial" | "newsletter" | "new_release" | "informative";
export type ArticleStatus = "draft" | "published";
/** draft | scheduled (published, goes live at published_at) | published (live). */
export type ArticleState = "draft" | "scheduled" | "published";

/** Order + labels shown everywhere (the backend's Article.Type choices). */
export const ARTICLE_TYPES: { key: ArticleType; label: string; hint: string }[] = [
  { key: "press_release", label: "Press release", hint: "Company news for press and partners" },
  { key: "tutorial", label: "Tutorial", hint: "Step-by-step how-to for customers" },
  { key: "newsletter", label: "Newsletter", hint: "Periodic roundup for subscribers" },
  { key: "new_release", label: "New release", hint: "What's new in a Zinwe version" },
  { key: "informative", label: "Informative", hint: "Insights on data security and reality on the ground" },
];

/** Label + pill tone for an article's state. */
export const STATE_PILL: Record<ArticleState, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "pill--muted" },
  scheduled: { label: "Scheduled", tone: "pill--info" },
  published: { label: "Published", tone: "pill--good" },
};

export interface BlogImageRef {
  id: number;
  /** Relative to the API origin, e.g. /api/blog/images/<key>/ */
  url: string;
}

export interface Article {
  id: number;
  title: string;
  slug: string;
  type: ArticleType;
  type_label: string;
  status: ArticleStatus;
  state: ArticleState;
  summary: string;
  body_html: string;
  cover: BlogImageRef | null;
  cover_alt: string;
  tags: string;
  seo_title: string;
  meta_description: string;
  author_name: string;
  author_email: string | null;
  reading_minutes: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticleInput {
  title: string;
  slug?: string;
  type: ArticleType;
  summary?: string;
  body_html?: string;
  cover_image?: number | null;
  cover_alt?: string;
  tags?: string;
  seo_title?: string;
  meta_description?: string;
  author_name?: string;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Token ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    throw new ApiError("Your session has ended. Please sign in again.", 401);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const first =
      data && typeof data === "object"
        ? (data.detail as string | undefined) ??
          Object.values(data as Record<string, unknown>)
            .flat()
            .find((v): v is string => typeof v === "string")
        : undefined;
    throw new ApiError(first || `Something went wrong (${res.status}).`, res.status);
  }
  return data as T;
}

const BASE = "/api/admin/blog";

export const listArticles = (filters: { status?: string; type?: string; q?: string } = {}) => {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  return call<Article[]>(`${BASE}/articles/${qs ? `?${qs}` : ""}`);
};
export const getArticle = (id: number) => call<Article>(`${BASE}/articles/${id}/`);
export const createArticle = (input: ArticleInput) =>
  call<Article>(`${BASE}/articles/`, { method: "POST", body: JSON.stringify(input) });
export const updateArticle = (id: number, input: Partial<ArticleInput>) =>
  call<Article>(`${BASE}/articles/${id}/`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteArticle = (id: number) => call<null>(`${BASE}/articles/${id}/`, { method: "DELETE" });
/** Publish now, or schedule: a future `at` (ISO) keeps it off the website until then. */
export const publishArticle = (id: number, at?: string) =>
  call<Article>(`${BASE}/articles/${id}/publish/`, { method: "POST", body: JSON.stringify(at ? { at } : {}) });
export const unpublishArticle = (id: number) =>
  call<Article>(`${BASE}/articles/${id}/unpublish/`, { method: "POST" });

/** PNG / JPG / WebP / GIF up to 5 MB -> {id, url}. */
export function uploadBlogImage(file: File): Promise<BlogImageRef> {
  const form = new FormData();
  form.append("file", file);
  return call<BlogImageRef>(`${BASE}/images/`, { method: "POST", body: form });
}

// --- Newsletter -------------------------------------------------------------------

export interface NewsletterProgress {
  subject: string;
  status: "queued" | "sending" | "sent";
  /** Queued for a scheduled article: goes out when it's live. */
  waiting_for_publish: boolean;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  queued_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface NewsletterState {
  /** Confirmed subscribers right now. */
  audience: number;
  default_subject: string;
  /** Newsletter-type articles go out in full; other types as a teaser with a link. */
  full_article: boolean;
  issue: NewsletterProgress | null;
}

export const getNewsletter = (id: number) => call<NewsletterState>(`${BASE}/articles/${id}/newsletter/`);
export const sendNewsletter = (id: number, subject: string) =>
  call<NewsletterState>(`${BASE}/articles/${id}/newsletter/`, { method: "POST", body: JSON.stringify({ subject }) });
export const sendNewsletterTest = (id: number) =>
  call<{ sent_to: string }>(`${BASE}/articles/${id}/newsletter/test/`, { method: "POST" });
export const retryNewsletter = (id: number) =>
  call<NewsletterState>(`${BASE}/articles/${id}/newsletter/retry/`, { method: "POST" });

export type SubscriberStatus = "pending" | "active" | "unsubscribed";

export interface Subscriber {
  id: number;
  email: string;
  status: SubscriberStatus;
  source: string;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

export const listSubscribers = () =>
  call<{ counts: Record<SubscriberStatus, number>; rows: Subscriber[] }>(`${BASE}/subscribers/`);
export const deleteSubscriber = (id: number) => call<null>(`${BASE}/subscribers/${id}/`, { method: "DELETE" });
