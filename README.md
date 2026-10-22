# AI JOB HUNTER — Cloud AI Job-Hunting Automation SaaS

Live Production Deployment: **`https://jobhunterai-five.vercel.app`**  
Cloud Database & Auth: **Supabase Cloud (`eu-west-1`, PostgreSQL + Auth + Private Storage + RLS)**  
Hosting & Scheduled Automation: **Vercel Serverless + Vercel Cron (`0 7 * * *` UTC)**

**AI JOB HUNTER** is a production-deployable, cloud-only SaaS application that automates job discovery, CV intelligence, multi-factor compatibility scoring (`0–100%`), bilingual French/English application email & A4 PDF cover letter generation, and CRM tracking — governed by a **strict cryptographic human-in-the-loop approval gate** so no email is ever sent without explicit user authorization.

---

## 1. Cloud-Only Architecture Overview

Zero local daemons, Ollama, Docker, local Python, local PostgreSQL, or local GPUs are required. Every subsystem runs natively in the cloud:

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                   Next.js 16 App Router (Vercel Cloud)                    │
│  ┌──────────────────────────────┐    ┌─────────────────────────────────┐  │
│  │ 13 Responsive SaaS UI Pages  │───▶│ 28 Protected Server API Routes  │  │
│  │ Dark/Light • Blue/Violet UI  │    │ Rate-Limited • Zod Validated    │  │
│  └──────────────────────────────┘    └───────┬─────────────┬───────────┘  │
└──────────────────────────────────────────────┼─────────────┼──────────────┘
                                               │             │
        ┌──────────────────────────────────────┘             └───────────────────────────┐
        ▼                                                                                ▼
┌──────────────────────────────────────────┐    ┌────────────────────────────────────────────┐
│      Supabase Cloud (eu-west-1)          │    │     External Authorized Cloud Services     │
│ • Auth (Email/Password, Verification,    │    │ • AI Layer: Groq (Primary), Google Gemini  │
│   Password Reset, Cookie SSR Sessions)   │    │   (Secondary), xAI Grok (Optional)         │
│ • PostgreSQL (14 RLS-Isolated Tables)    │    │ • Job Feeds: Remotive, Arbeitnow, Adzuna,  │
│ • Private Storage Buckets (`resumes`,    │    │   SmartRecruiters, Greenhouse, Lever, Ashby│
│   `application-documents`, 10 MB PDFs)   │    │ • Email: Gmail OAuth 2.0 (`gmail.send`)    │
└──────────────────────────────────────────┘    │   + Optional Authenticated Server SMTP     │
                                                └────────────────────────────────────────────┘
```

### Mandatory Security & Ethical Invariants
1. **Cryptographic Approval Gate (`SHA-256`)**: Approving an application computes a canonical SHA-256 signature over `(recipientEmail, subject, body, cvStoragePath, cvSha256, coverLetterStoragePath, coverLetterSha256)`. Editing **any** character in the recipient, subject, email body, or cover letter immediately invalidates approval (`approval_status -> awaiting_approval`) and regenerates the Cover Letter PDF.
2. **Zero Unapproved or Scheduled Auto-Sends**: `POST /api/applications/[id]/send` verifies both `approval_status === 'approved'` and constant-time (`crypto.timingSafeEqual`) hash integrity before transmitting. Cloud Cron (`/api/cron/discover`) only creates `awaiting_approval` drafts — it has no code path capable of sending emails.
3. **Zero Fabricated Qualifications or Guessed Emails**: AI prompts wrap CVs and job descriptions in sanitized untrusted blocks (`sanitizeUntrustedText`) and strictly forbid inventing degrees, employers, skills, or certifications. Recruitment emails are extracted strictly verbatim from published text (`extractPublishedRecruitmentEmail`); when none exists, the UI links directly to the official application portal.
4. **Encrypted Credentials at Rest (`AES-256-GCM`)**: OAuth access/refresh tokens in `public.email_connections` are encrypted with `TOKEN_ENCRYPTION_KEY`, and PostgreSQL `SELECT` privileges on `email_connections` are revoked from `anon` and `authenticated` roles.
5. **No Silent Paid AI Fallback**: `executeAiTask` never switches providers unless `fallback_ai_provider` is explicitly configured by the user, and blocks paid xAI fallback unless `allow_paid_fallback` is explicitly checked.

---

## 2. Complete 13-Page Workspace & Public Routes

- **Public & Auth Routes**: `/` (Landing Page), `/login`, `/register` (with email verification flow), `/forgot-password`, `/reset-password`, `/privacy` (Privacy & Data Governance Policy).
- **13 Protected Workspace Pages**:
  1. `/dashboard` — Executive KPIs, onboarding checklist, 8-week Recharts activity graph, top matches, and recent activity feed.
  2. `/profile` — Structured candidate profile editor (skills, technologies, languages, experience, education, certifications, projects, job preferences).
  3. `/cv` — Private PDF CV upload (`<=10 MB`, `%PDF-` magic-byte check), `unpdf` text extraction, AI structured profile extraction (FR/EN), review & 1-click apply to profile.
  4. `/jobs` — Live multi-source job discovery targeting **Morocco, France, Europe, International, and Remote**, with deduplication and search/location/remote/score filters.
  5. `/matching` — `0–100%` multi-factor compatibility scoring (Skills, Experience, Sector, Language, Location, Education), matching/missing skills, strengths/weaknesses, transparent compatibility disclaimer, and on-demand Hybrid AI Deep Analysis.
  6. `/companies` — Company Discovery Engine distinguishing **Published Vacancies**, **Spontaneous Applications**, and **Unverified Channels**, plus live ATS board probing (`SmartRecruiters`, `Greenhouse`, `Lever`, `Ashby`).
  7. `/generator` — Bilingual (auto-detected French/English) AI Application Email & formatted A4 Cover Letter PDF generator (`pdf-lib`) stored in private Supabase Storage.
  8. `/approvals` — Human-in-the-loop Approval Queue with **Preview**, **Edit** (auto-invalidating prior approval), **Regenerate**, **Approve**, **Reject**, and **Send**.
  9. `/tracker` — Full Application CRM (`Draft`, `Pending Approval`, `Sent`, `Applied Externally`, `Interview`, `Offer`, `Rejected`, `Withdrawn`), search/filter/sort, follow-up reminders, notes, external portal logging, and **CSV Export**.
  10. `/emails` — Gmail OAuth 2.0 connect/disconnect (`gmail.send` minimal scope), optional server SMTP relay, daily send quota counter, and immutable delivery audit logs (`email_logs`).
  11. `/automation` — Cloud scheduled automation controls (`0 7 * * *` UTC), threshold & draft caps, manual trigger (`Run Pipeline Now`), distributed lock protection, and run history logs.
  12. `/analytics` — 100% PostgreSQL-backed Recharts conversion funnel, match score distribution, 8-week activity timeline, and 6-month trend charts.
  13. `/settings` — Modular AI Provider configuration (`Groq`, `Gemini`, `xAI`), live connection tester, GDPR full-account JSON export, and irreversible cascade account deletion.

---

## 3. Step-by-Step Setup Guide

### 3.1 Local Development Setup
1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/sahelbogy/jobhunter.ai.git
   cd jobhunter.ai
   npm install
   ```
2. Copy `.env.example` to `.env.local` and populate your keys:
   ```bash
   cp .env.example .env.local
   ```
3. Generate 32-byte random secrets for `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET`:
   ```bash
   openssl rand -hex 32
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

### 3.2 Supabase Cloud Setup
1. Create a Supabase Cloud project at [supabase.com](https://supabase.com).
2. Apply both SQL migrations in order via the Supabase SQL Editor or Supabase CLI:
   - `supabase/migrations/20261022000001_initial_schema.sql` (creates all 14 tables, indexes, triggers, RLS policies, and private `resumes` & `application-documents` PDF buckets).
   - `supabase/migrations/20261022000002_role_grants_and_rls_hardening.sql` (grants exact PostgREST privileges to `authenticated` & `service_role` while revoking client `SELECT` on `email_connections`).
3. In **Authentication -> URL Configuration**:
   - Set **Site URL** to your production URL (e.g. `https://jobhunterai-five.vercel.app`).
   - Add Redirect URLs:
     - `https://jobhunterai-five.vercel.app/**`
     - `http://localhost:3000/**`
4. Copy `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), and `SUPABASE_SERVICE_ROLE_KEY` into Vercel / `.env.local`.

### 3.3 AI Provider Keys (Groq, Google Gemini, Optional xAI)
- **Primary — Groq Cloud**: Create an API key at [console.groq.com/keys](https://console.groq.com/keys) and set `GROQ_API_KEY`.
  - `GROQ_MODEL=llama-3.3-70b-versatile` is configured by default; if your Groq account tier reports `model_decommissioned` (following Groq's late-2026 model transition), the adapter automatically retries with `openai/gpt-oss-120b`, and you can select `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, or `qwen/qwen3.6-27b` in **Account Settings**.
- **Secondary — Google Gemini**: Create an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and set `GEMINI_API_KEY` (`GEMINI_MODEL=gemini-3.5-flash-lite` default).
- **Optional — xAI Grok**: Create a key at [console.x.ai](https://console.x.ai) and set `XAI_API_KEY` (`XAI_MODEL=grok-4.7`).

### 3.4 Job Discovery APIs
- **Zero-Key Authorized Public Feeds (Enabled Out of the Box)**: Remotive API (`remotive.com/api/remote-jobs`), Arbeitnow API, and public ATS career boards (`SmartRecruiters` including SQLI Morocco/France, Ubisoft, Devoteam; `Greenhouse`; `Lever`; `Ashby`).
- **Adzuna API (Optional Regional Expansion)**: Register at [developer.adzuna.com](https://developer.adzuna.com) and set `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`.

### 3.5 Gmail OAuth 2.0 & Optional SMTP Setup
1. Open [Google Cloud Console](https://console.cloud.google.com/), create an OAuth 2.0 Web Client, and enable the **Gmail API**.
2. Add the Authorized Redirect URI:
   - Production: `https://jobhunterai-five.vercel.app/api/email/gmail/callback`
   - Local: `http://localhost:3000/api/email/gmail/callback`
3. Configure minimal scopes on the OAuth Consent Screen:
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/userinfo.email`
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel environment variables.
5. *(Optional)* To use an authenticated SMTP server instead of Gmail OAuth, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`.

### 3.6 Vercel Cloud & Cron Deployment
1. Import the GitHub repository into Vercel (`Framework Preset: Next.js`).
2. Add the environment variables from `.env.example` in **Vercel -> Project Settings -> Environment Variables**.
3. `vercel.json` automatically configures the daily cloud schedule (`0 7 * * *` UTC -> `GET /api/cron/discover`), which Vercel authenticates using `Authorization: Bearer ${CRON_SECRET}`.

---

## 4. Verification, Automated Tests & Safe Integration Procedure

### Automated Test Suite (`npm test`)
Run all 5 automated test suites (21 tests mocking external HTTP APIs so no unsolicited emails are ever transmitted):
```bash
npm test
npm run typecheck
npm run build
```
Verified test suites:
- `tests/security-and-approval.test.ts` — AES-256-GCM encryption & tamper detection, HMAC state signing, prompt-injection stripping, PDF magic-byte validation, verbatim email extraction (blocking `noreply@` and personal domains), SHA-256 approval binding & edit invalidation, rate limiting.
- `tests/cv-and-pdf-documents.test.ts` — Real in-memory PDF CV generation & `unpdf` extraction, deterministic + mocked Groq CV structured parsing, FR/EN job language detection, bilingual application generation, A4 Cover Letter PDF creation & verification.
- `tests/jobs-companies-matching.test.ts` — URL normalization & cross-source deduplication, mocked Remotive/Arbeitnow/SmartRecruiters feeds, verified company channel handling, 0–100 multi-factor compatibility scoring & skill gap explanations.
- `tests/ai-providers-and-email-delivery.test.ts` — AI fallback rules (blocking silent or unauthorized paid fallback), Gmail OAuth 2.0 state/URL/token encryption, RFC 2822 multipart MIME attachment encoding, blocking unapproved & duplicate sends.
- `tests/auth-rls-tracker-analytics.test.ts` — Protected route middleware redirects, RLS & private storage bucket policy verification, RFC 4180 CSV export, real database-backed analytics aggregation.
- `tests/morocco-linkedin-email-approval.test.ts` — Strict Morocco-only (`Maroc`) geographic boundary filtering (excluding France/EU/Worldwide when only Morocco is selected), LinkedIn profile-matched search URLs & offer import, and HMAC-SHA256 Email Approval token verification + edit tamper invalidation + immediate employer email dispatch.

### Cryptographic Email Approval Loop Setup (100% Free)
1. In **Email Center (`/emails`)**, connect your Gmail in 10 seconds using a free 16-character [Gmail App Password](https://myaccount.google.com/apppasswords) (encrypted AES-256-GCM at rest) or Gmail OAuth 2.0.
2. In **Account Settings (`/settings`)**, paste your free [Groq Cloud API key](https://console.groq.com/keys) and/or free [Google Gemini AI Studio key](https://aistudio.google.com/apikey) (encrypted AES-256-GCM at rest).
3. In `/jobs` or `/automation`, select up to 10 offers (e.g., 5 offers) and choose **Immédiat**, **Chaque jour**, or **Un jour précis**: AI generates the tailored email + Cover Letter PDF, sends a signed HTML Approval Email (with the Cover Letter PDF attached) to your inbox, and dispatches the application directly to the employer from your connected inbox as soon as you confirm **Approuver & Envoyer**.

### Safe End-to-End Integration Testing Procedure
To test live email sending safely without ever emailing a real employer:
1. Set `SAFE_EMAIL_ALLOWLIST=your-own-test-inbox@gmail.com` in your environment variables. Any attempt to send to an address outside `SAFE_EMAIL_ALLOWLIST` is blocked at the server gate.
2. Register an account, upload a PDF CV on `/cv`, discover real jobs on `/jobs`, generate an application on `/generator`, change the recipient in `/approvals` to `your-own-test-inbox@gmail.com`, click **Approve**, and click **Send** after connecting Gmail in `/emails`.

---

## 5. Troubleshooting & Known Limitations

- **`AI Provider Configuration Needed` banner**: Appears when `GROQ_API_KEY` / `GEMINI_API_KEY` / `XAI_API_KEY` have not yet been added to Vercel Environment Variables. Deterministic CV baseline parsing, job discovery, compatibility scoring, Cover Letter PDF building, Approval Queue, Tracker, and Analytics work immediately even before AI keys are added; add `GROQ_API_KEY` in Vercel and redeploy (or test in `/settings`) to unlock full LLM generation.
- **`Google OAuth is not configured on the server` in Email Center**: Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel Environment Variables and register `/api/email/gmail/callback` in Google Cloud Console.
- **Email Delivery Status Boundaries**: Standard email protocols (`Gmail API` / `SMTP`) confirm submission acceptance (`Sent` with provider `messageId`) or rejection (`Failed`), not recipient inbox open/read status; the UI intentionally reports honest provider confirmation only.
- **Vercel Hobby Plan Cron Cadence**: Vercel Hobby supports once-daily cron schedules (`0 7 * * *` UTC). Users can also trigger immediate cloud runs anytime via **Run Pipeline Now** in `/automation`.
