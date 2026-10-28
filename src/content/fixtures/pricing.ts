/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-43) for Plans & pricing (AdminPricing board).
 *
 * Prices, PC limits, taglines, paying counts and offers come from the API (`admin/pricing/`, `admin/subscriptions/`,
 * `admin/announcements/`). These board fields have no API yet, so they are shown read-only from here:
 *  - `historyDays`: how many days of alert/activity history a plan keeps (board "History, days").
 *  - `points`: the three bullet points of each plan card in the Plans page preview (copied from the board;
 *    the real website keeps its own list in zinwe-frontend).
 *  - `PREVIEW_VISITOR_PCS`: the preview shows the page "for a visitor with 8 PCs".
 * The board's "Offer label" has no field in the plan model either; it is shown disabled.
 * API day: serve history + label from the plan model and delete this file.
 */
export interface PlanExtra {
  historyDays: number;
  points: string[];
}

export const PLAN_EXTRAS: Record<string, PlanExtra> = {
  free: {
    historyDays: 7,
    points: ["Every protection and team feature", "USB, file-transfer and remote-tool alerts", "Website blocking, work hours and chat"],
  },
  startups: { historyDays: 90, points: ["Everything in Free", "PDF reports by email", "Email support"] },
  teams: { historyDays: 180, points: ["Everything in Startups", "180 days of alert and activity history", "Email support"] },
  businesses: { historyDays: 365, points: ["Everything in Teams", "1 year of history", "Priority support"] },
};

export const CUSTOM_PLAN = {
  name: "Custom",
  tag: "More than 50 PCs",
  points: ["Everything in Businesses", "A price for your number of PCs", "A setup call with us"],
};

export const PREVIEW_VISITOR_PCS = 8;
