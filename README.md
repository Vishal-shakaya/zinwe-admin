# Zinwe Admin (back office)

The Zinwe team's internal app for running the business: customers, plans, payments and feedback.
React 19 + TypeScript + Vite, talking to the Django API (`zinwe-backend`, `/api/admin/*`, staff only).

## What it does

- **Dashboard**: sign-ups, active plans, revenue, payments waiting, feedback score.
- **Subscribers**: every customer with plan, days left, payment and billing cycles.
  - Filters: All · Waiting for approval · Renewal due · Rejected; search by name, email or company.
  - **Customer modal** (click a name): plan, payment review with proof, account and company details,
    team members the owner added, payment history, emails sent, remark.
  - Actions: approve / reject payments (a paid plan activates only on approval; renewals extend from
    the current end date), change plan, block / unblock, delete, reset password, internal remark.
  - **Send mail**: branded custom email with a rich-text editor and ready-made templates
    (onboarding, payments, renewal, account, engagement), filled from the customer's data.
- **Feedback**: ratings (1–10) and notes customers send from their dashboard.

## Run locally

The whole stack starts from the docs repo: `.cloude\start-local-env.cmd` (backend :8000, website
:5173, admin :5174). To run only this app against a running backend:

```bash
npm install
npm run dev        # http://localhost:5174, proxies /api to http://127.0.0.1:8000
```

Sign in with a **staff** account (local dev: `admin@zinwe.local`, created by the start script).

```bash
npm run build      # type-check + production build into dist/
npm run lint       # oxlint
```

## Layout

```
src/
  App.tsx                 routes + auth guard + error boundary + toasts
  lib/api.ts              typed client for /api/admin/* (and the shared login)
  pages/                  Dashboard, Subscribers (table + customer modal + composer), Feedback, Login
  components/             Modal, ConfirmDialog, Popover, Toast, RichTextEditor (Quill 2), PaymentProof, BrandLogo
  content/emailTemplates.ts   the Send mail templates
public/                   logo files and icons (same artwork as the website)
```

Part of Zinwe by SKYTECHNO. Project overview and conventions: `.cloude/project-context.md` in the
`zinwe` repo.
