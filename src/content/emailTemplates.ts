/**
 * Ready-made emails for the Send mail composer. Each template is filled from the customer's own
 * data (name, company, plan, dates, payment), then stays fully editable before sending.
 *
 * The HTML uses only what the server keeps (p, strong, em, ul/ol/li, a, h2/h3): anything else is
 * stripped by `z_adminapi.services.clean_email_html`. The branded header, logo and the
 * "The Zinwe team" signature are added by the server, so templates don't repeat them.
 */
import type { Subscriber } from "../lib/api";

export type TemplateGroup = "Onboarding" | "Payments" | "Plan & renewal" | "Account" | "Engagement";

export interface EmailTemplate {
  id: string;
  group: TemplateGroup;
  label: string;
  /** One line shown under the dropdown so the operator knows when to use it. */
  when: string;
  build: (c: TemplateContext) => { subject: string; html: string };
  /** True when this template fits the customer's current state (shown under "Suggested"). */
  suggest?: (row: Subscriber) => boolean;
}

export interface TemplateContext {
  firstName: string;
  company: string;
  planName: string;
  planPrice: string;
  planDevices: string;
  endsOn: string;
  amount: string;
  reference: string;
  links: { dashboard: string; billing: string; devices: string; setup: string; feedback: string; plans: string };
  /** Unescaped values, for the (plain-text) subject line. */
  plain: { company: string; planName: string };
}

/** Where customer links point: the local website in dev, zinwe.io everywhere else. */
export function portalUrl(): string {
  const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return local ? "http://localhost:5173" : "https://zinwe.io";
}

const DAY = 86_400_000;

function longDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function rupees(amount: string | undefined): string {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 ? "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "";
}

/** Escape customer-provided text before it goes into template HTML. */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export function contextFor(row: Subscriber): TemplateContext {
  const base = portalUrl();
  const sub = row.subscription;
  const pay = row.payment;
  return {
    firstName: esc((row.full_name || "").trim().split(/\s+/)[0] || "there"),
    company: esc(row.company?.name ?? "your team"),
    planName: esc(row.plan?.name ?? "your plan"),
    planPrice: sub && Number(sub.amount_inr) > 0 ? `${rupees(sub.amount_inr)} a month` : "free",
    planDevices: row.plan ? `${row.plan.max_devices} PCs` : "",
    endsOn: longDate(sub?.ends_at),
    amount: rupees(pay?.amount_inr ?? sub?.amount_inr),
    reference: esc(pay?.reference ?? ""),
    plain: { company: row.company?.name ?? "your team", planName: row.plan?.name ?? "your plan" },
    links: {
      dashboard: `${base}/app`,
      billing: `${base}/app/billing`,
      devices: `${base}/app/devices`,
      setup: `${base}/app/setup`,
      feedback: `${base}/app/feedback`,
      plans: `${base}/plans`,
    },
  };
}

const a = (href: string, text: string) => `<a href="${href}">${text}</a>`;
const p = (...lines: string[]) => lines.map((l) => `<p>${l}</p>`).join("");
const ul = (...items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;

const daysLeft = (row: Subscriber): number | null => {
  const end = row.subscription?.ends_at;
  return end ? Math.ceil((new Date(end).getTime() - Date.now()) / DAY) : null;
};
const isPaid = (row: Subscriber) => Number(row.subscription?.amount_inr ?? 0) > 0;

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  // --- Onboarding -------------------------------------------------------------------------
  {
    id: "welcome",
    group: "Onboarding",
    label: "Welcome and getting started",
    when: "Right after sign-up, to get them to their first protected PC.",
    suggest: (r) => !r.plan,
    build: (c) => ({
      subject: "Welcome to Zinwe: let's protect your first PC",
      html:
        p(`Hi ${c.firstName},`, `Thanks for choosing Zinwe for ${c.company}. Getting set up takes about 10 minutes:`) +
        ul(
          `<strong>Pick a plan</strong>: Free forever covers up to 3 PCs at no cost.`,
          `<strong>Install the agent</strong> on each PC with your enrollment key from ${a(c.links.devices, "Devices")}.`,
          `<strong>Set your rules</strong> for USB, remote access and software installs on ${a(c.links.setup, "Setup")}.`,
        ) +
        p(`Alerts start arriving in plain English as soon as a PC checks in. Reply to this email if anything is unclear; a real person reads it.`),
    }),
  },
  {
    id: "setup_help",
    group: "Onboarding",
    label: "Help installing the agent",
    when: "They have a plan but haven't connected any PCs yet.",
    build: (c) => ({
      subject: "Need a hand installing Zinwe on your PCs?",
      html:
        p(`Hi ${c.firstName},`, `We noticed ${c.company} hasn't connected a PC to Zinwe yet. Here's the quickest way:`) +
        `<ol><li>Open ${a(c.links.devices, "Devices")} in your dashboard and copy your enrollment key.</li>` +
        `<li>Run the Zinwe installer on the PC and paste the key when asked.</li>` +
        `<li>The PC shows up in your dashboard within a minute.</li></ol>` +
        p(`Prefer we do it with you? Reply with a time that suits you and we'll set up a 20-minute call.`),
    }),
  },
  {
    id: "demo_call",
    group: "Onboarding",
    label: "Book a setup or demo call",
    when: "They asked for a demo, or a bigger team is evaluating.",
    build: (c) => ({
      subject: `A 20-minute Zinwe walkthrough for ${c.plain.company}`,
      html:
        p(
          `Hi ${c.firstName},`,
          `Happy to walk you through Zinwe. In 20 minutes we'll install the agent on one PC together, set your first rules and show you what the alerts look like.`,
          `Reply with two or three times that work for you this week, and the number of PCs you'd like to cover.`,
        ),
    }),
  },

  // --- Payments ---------------------------------------------------------------------------
  {
    id: "payment_reminder",
    group: "Payments",
    label: "Reminder: complete your payment",
    when: "They chose a paid plan but haven't sent a payment.",
    suggest: (r) => r.subscription?.status === "pending_payment" && !r.payment,
    build: (c) => ({
      subject: `Finish activating your ${c.plain.planName} plan`,
      html:
        p(
          `Hi ${c.firstName},`,
          `You chose the <strong>${c.planName}</strong> plan (${c.planPrice}${c.planDevices ? `, up to ${c.planDevices}` : ""}), but we haven't received a payment yet, so the plan isn't active.`,
          `To activate it, pay by UPI, bank transfer or PayPal and send us the reference from ${a(c.links.billing, "Billing")} in your dashboard. We usually confirm within a few hours on working days.`,
          `Rather start free? Free forever covers up to 3 PCs and needs no payment.`,
        ),
    }),
  },
  {
    id: "payment_received",
    group: "Payments",
    label: "Payment received: checking it",
    when: "They reported a payment you haven't approved yet.",
    suggest: (r) => r.payment?.status === "submitted",
    build: (c) => ({
      subject: "We've received your payment details",
      html:
        p(
          `Hi ${c.firstName},`,
          `Thanks! We've received your payment details${c.amount ? ` for <strong>${c.amount}</strong>` : ""}${c.reference ? ` (reference <strong>${c.reference}</strong>)` : ""} and we're matching them with our bank now.`,
          `Your <strong>${c.planName}</strong> plan turns on as soon as it's confirmed, usually within a few hours on working days. You'll get an email the moment it's active.`,
        ),
    }),
  },
  {
    id: "payment_details_needed",
    group: "Payments",
    label: "Payment issue: details needed",
    when: "You can't match their payment and need more information.",
    suggest: (r) => r.payment?.status === "rejected",
    build: (c) => ({
      subject: "We couldn't match your payment",
      html:
        p(
          `Hi ${c.firstName},`,
          `We checked the payment you reported${c.reference ? ` (reference <strong>${c.reference}</strong>)` : ""} but couldn't find it in our account yet.`,
          `Could you reply with one of these?`,
        ) +
        ul("A screenshot of the successful payment", "The UTR or transaction ID exactly as your bank shows it", "The date and the amount you paid") +
        p(`If you paid less than the plan price${c.amount ? ` (${c.amount})` : ""}, you can send the difference and share both references. Your details stay saved in ${a(c.links.billing, "Billing")}.`),
    }),
  },
  {
    id: "payment_approved",
    group: "Payments",
    label: "Payment confirmed: plan is active",
    when: "A personal thank-you after you approve their payment.",
    suggest: (r) => r.payment?.status === "verified" && r.subscription?.status === "active",
    build: (c) => ({
      subject: `Your ${c.plain.planName} plan is active`,
      html:
        p(
          `Hi ${c.firstName},`,
          `Your payment is confirmed and <strong>${c.planName}</strong> is now active for ${c.company}${c.endsOn ? ` until <strong>${c.endsOn}</strong>` : ""}.`,
          `Next steps: install the agent on the rest of your PCs from ${a(c.links.devices, "Devices")}, and turn on the alerts you need on ${a(c.links.setup, "Setup")}.`,
          `Thank you for trusting Zinwe.`,
        ),
    }),
  },

  // --- Plan & renewal ---------------------------------------------------------------------
  {
    id: "renewal_reminder",
    group: "Plan & renewal",
    label: "Renewal reminder: plan ends soon",
    when: "A paid plan ends within the next 7 days.",
    suggest: (r) => r.subscription?.status === "active" && isPaid(r) && (daysLeft(r) ?? 99) <= 7,
    build: (c) => ({
      subject: `Your Zinwe plan ends ${c.endsOn ? "on " + c.endsOn : "soon"}`,
      html:
        p(
          `Hi ${c.firstName},`,
          `Your <strong>${c.planName}</strong> plan for ${c.company} ends${c.endsOn ? ` on <strong>${c.endsOn}</strong>` : " soon"}. To keep your PCs protected without a gap, renew from ${a(c.links.billing, "Billing")} and send the payment reference (${c.planPrice}).`,
          `After it ends, monitoring and alerts pause until the plan is renewed. Your settings and history are kept.`,
        ),
    }),
  },
  {
    id: "plan_expired",
    group: "Plan & renewal",
    label: "Plan expired: renew to resume",
    when: "Their paid plan has expired.",
    suggest: (r) => r.subscription?.status === "expired",
    build: (c) => ({
      subject: "Your Zinwe plan has expired",
      html:
        p(
          `Hi ${c.firstName},`,
          `Your <strong>${c.planName}</strong> plan has expired, so alerts for ${c.company} are paused. Your devices, rules and history are all still saved.`,
          `Renew from ${a(c.links.billing, "Billing")} to switch everything back on, or move to Free forever (up to 3 PCs) at no cost.`,
        ),
    }),
  },
  {
    id: "upgrade",
    group: "Plan & renewal",
    label: "Upgrade suggestion",
    when: "They're growing or asked about more PCs or compliance records.",
    build: (c) => ({
      subject: `More PCs and compliance records for ${c.plain.company}`,
      html:
        p(`Hi ${c.firstName},`, `As ${c.company} grows, here's what each plan covers:`) +
        ul(
          `<strong>Startups</strong>: up to 10 PCs, every monitoring module (USB, remote access, software installs, LAN, email), ₹999 a month.`,
          `<strong>Businesses</strong>: up to 50 PCs, DPDP-ready consent and activity logs, and priority support, ₹2,999 a month.`,
        ) +
        p(`You're on <strong>${c.planName}</strong> today. Compare and switch on ${a(c.links.plans, "the plans page")}, or reply and we'll recommend the right one.`),
    }),
  },

  // --- Account ----------------------------------------------------------------------------
  {
    id: "account_blocked",
    group: "Account",
    label: "Account suspended",
    when: "You blocked their account and want to tell them why.",
    suggest: (r) => !r.is_active,
    build: (c) => ({
      subject: "Your Zinwe account has been suspended",
      html:
        p(
          `Hi ${c.firstName},`,
          `We've suspended the Zinwe account for ${c.company}, so signing in is turned off for now.`,
          `<strong>Reason:</strong> [add the reason here]`,
          `If you think this is a mistake or want to sort it out, just reply to this email.`,
        ),
    }),
  },
  {
    id: "account_reactivated",
    group: "Account",
    label: "Account reactivated",
    when: "You unblocked their account.",
    build: (c) => ({
      subject: "Your Zinwe account is active again",
      html: p(
        `Hi ${c.firstName},`,
        `Good news: your Zinwe account for ${c.company} is active again. You can ${a(c.links.dashboard, "sign in to your dashboard")} as usual.`,
        `Thanks for your patience.`,
      ),
    }),
  },
  {
    id: "password_reset",
    group: "Account",
    label: "Your password was reset",
    when: "After you set a new password for them (share the password itself privately).",
    build: (c) => ({
      subject: "Your Zinwe password was reset",
      html: p(
        `Hi ${c.firstName},`,
        `As requested, we've reset the password for your Zinwe account and signed you out of all devices. We'll share the new password with you separately.`,
        `Once you're in, you can choose your own password at any time with <strong>Forgot password</strong> on the ${a(c.links.dashboard, "sign-in page")}.`,
        `Didn't ask for this? Reply right away and we'll secure your account.`,
      ),
    }),
  },

  // --- Engagement -------------------------------------------------------------------------
  {
    id: "feedback_request",
    group: "Engagement",
    label: "Ask for feedback",
    when: "After a few weeks of use, to learn what to improve.",
    suggest: (r) => r.subscription?.status === "active",
    build: (c) => ({
      subject: "How is Zinwe working for you?",
      html: p(
        `Hi ${c.firstName},`,
        `You've been using Zinwe at ${c.company} for a while, and we'd love to know how it's going. It takes 30 seconds: rate us from 1 to 10 and tell us one thing to improve on ${a(c.links.feedback, "the Feedback page")}.`,
        `Every response is read by the team and shapes what we build next.`,
      ),
    }),
  },
  {
    id: "product_update",
    group: "Engagement",
    label: "Product update / announcement",
    when: "Telling a customer about a new feature or change.",
    build: (c) => ({
      subject: "What's new in Zinwe",
      html:
        p(`Hi ${c.firstName},`, `Here's what's new for ${c.company}:`) +
        ul("[New feature or change, in one line]", "[What it means for them]") +
        p(`It's already switched on in ${a(c.links.dashboard, "your dashboard")}. Reply if you have questions.`),
    }),
  },
];

export const TEMPLATE_GROUPS: TemplateGroup[] = ["Onboarding", "Payments", "Plan & renewal", "Account", "Engagement"];
