# PlannerOS Developer Setup and Deployment Guide

Last reviewed: 2026-03-27

## 1. Prerequisites

You need the following before you start:

1. Node.js `20.x`
   This is the version used in `.github/workflows/ci.yml`, `.github/workflows/deploy-staging.yml`, and `.github/workflows/deploy-production.yml`.

2. `npm`
   This repository uses `package-lock.json`, and all automation uses `npm`.

3. A Supabase project
   The app depends on Supabase for:
   - auth
   - database
   - storage
   - row-level security

4. A Vercel account if you plan to deploy
   Deployment automation in this repo targets Vercel via `vercel.json` and GitHub Actions.

5. Outbound internet access for builds
   `app/(intake)/layout.tsx` imports `Inter` from `next/font/google`, so `next build` needs to fetch the font unless you replace that font setup.

6. Optional tools
   - Supabase Dashboard access for manual SQL migration runs
   - Vercel CLI for manual deployments
   - GitHub repository admin access if you want to use the configured deployment workflows

## 2. Installation Steps

### 2.1 Clone the repository

```bash
git clone <your-repo-url>
cd event-planner-a-main
```

### 2.2 Install dependencies

Local development:

```bash
npm install
```

CI and deployment workflows use:

```bash
npm ci
```

### 2.3 Create the local environment file

The repo includes `.env.local.example`.

macOS/Linux:

```bash
cp .env.local.example .env.local
```

PowerShell:

```powershell
Copy-Item .env.local.example .env.local
```

### 2.4 Create or choose a Supabase project

In Supabase:

1. Create a new project or choose an existing dev project.
2. Copy the project URL.
3. Copy the anon key.
4. Copy the service role key.

You will need all three in `.env.local`.

### 2.5 Apply database migrations

Important repo-specific fact:

- this repo does **not** include `supabase/config.toml`
- this repo does **not** include a checked-in automated database deployment step
- the guaranteed migration path in this snapshot is running SQL files from `supabase/migrations/` in filename order

Current migration count:

- `64` files under `supabase/migrations/`

Recommended process for a fresh development database:

1. Open Supabase Dashboard.
2. Open **SQL Editor**.
3. Run each file in `supabase/migrations/` in filename order.
4. Stop and fix any SQL error before moving to the next file.

Important caution before you run every file:

The migrations folder mixes schema changes and seed data. These files insert sample or test data:

- `005_seed_test_accounts.sql`
- `025_seed_vendors.sql`
- `050_seed_more_vendors.sql`
- `058_seed_transport_vendors.sql`
- `059_seed_new_category_vendors.sql`

Use this rule:

- local dev database: run seed files if you want sample data
- staging or production database: review those files before running them

Do not rely on `docs/setup/MIGRATION_INSTRUCTIONS.md` as the primary source for current setup. It only mentions the first two migrations and is out of date relative to the current repository.

### 2.6 Configure Supabase Auth for local development

If you want quick local signups without email verification friction, the practical dev setup is:

1. Open Supabase Dashboard.
2. Go to **Authentication**.
3. Open the **Email** provider settings.
4. Either:
   - disable email confirmation for your dev project, or
   - configure a real email flow

If you skip this step, new user signup may work but login can be blocked by unconfirmed-email behavior, depending on your Supabase Auth configuration.

### 2.7 Verify the database and auth wiring

After migrations and env setup, verify:

1. `events`, `user_profiles`, `vendors`, and `event_intakes` exist in Supabase.
2. Your `.env.local` contains real values.
3. You can sign up or log in through the app.

Optional working DB connection check:

```bash
npx tsx scripts/check-connection.ts
```

Note:

- `npm run test:db` is broken in the current repo because `package.json` points to `scripts/test-db-connection.ts`, which does not exist.

## 3. Environment Variable Setup

## 3.1 Required local runtime variables

Add these to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

Important:

- include `https://` in `NEXT_PUBLIC_SUPABASE_URL`
- if you run the app on a different port, update `NEXT_PUBLIC_APP_URL` to match it

## 3.2 Optional variables

These are referenced in code but are not required for the app to boot locally:

| Variable | Purpose | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | Enables email sending in `lib/services/email-service.ts` | If missing, emails are not sent; in development the app logs instead |
| `FROM_EMAIL` | Sender address for email | Defaults to `noreply@planneros.com` |
| `JWT_SECRET` | Used by `src/backend/config/auth.config.ts` | Code has a fallback, but set a real value for non-throwaway environments |
| `ALLOW_INSECURE_TLS_DEV` | Opt-in TLS relaxation in `instrumentation.ts` | Use only for local development behind a proxy |
| `DATABASE_URL` | Used by selected maintenance scripts | Not required for normal app runtime |
| `VENDOR_DEFAULT_PASSWORD` | Used by some vendor account scripts | Script-only |

## 3.3 Vercel-managed variables

These are not normal local variables:

| Variable | Source | Notes |
| --- | --- | --- |
| `VERCEL` | Set by Vercel | Used in `instrumentation.ts` |
| `VERCEL_URL` | Set by Vercel | Used in `config/site.ts` as a fallback URL |

## 3.4 GitHub Actions deployment secrets

If you want to use the configured deployment workflows, set these repository secrets:

| Secret | Used by |
| --- | --- |
| `VERCEL_TOKEN` | staging and production deploy workflows |
| `VERCEL_ORG_ID` | staging and production deploy workflows |
| `VERCEL_PROJECT_ID` | staging and production deploy workflows |

Also set the runtime app variables in the Vercel project itself for Preview and Production.

## 4. Running Locally

### 4.1 Start the dev server

Default port:

```bash
npm run dev
```

Alternate ports:

```bash
npm run dev:3000
npm run dev:3001
```

### 4.2 Open the app

Default local URL:

```text
http://localhost:3000
```

Useful first checks:

1. Open `http://localhost:3000/api/v1/health`
2. Open `http://localhost:3000/login`
3. Open `http://localhost:3000/signup`

Expected health response shape:

```json
{
  "status": "healthy",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "environment": "development"
}
```

### 4.3 Recommended local verification commands

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

### 4.4 Run the production server locally

After a successful build:

```bash
npm start
```

## 5. Build Process

## 5.1 Local production build

The app build command is:

```bash
npm run build
```

This runs:

- `next build`

In this repository snapshot, `next.config.ts` keeps TypeScript build errors enabled:

- `typescript.ignoreBuildErrors = false`

That means type errors fail the build.

## 5.2 What CI verifies

The configured CI and deployment verify jobs run:

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run build
```

Important details:

- lint is marked `continue-on-error: true`
- tests are **not** run in CI
- tests are **not** run in staging or production deployment workflows

## 5.3 Local build result verified during this review

I verified that:

- `npm run build` succeeds when normal network access is available

One build-specific caveat:

- restricted or offline environments can fail while fetching `Inter` from Google Fonts because `app/(intake)/layout.tsx` uses `next/font/google`

## 6. Deployment Steps

## 6.1 Before any deployment

Do these first for both staging and production:

1. Make sure the target Supabase database is at the required migration level.
2. Review seed migrations before applying them to shared environments.
3. Set runtime environment variables in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL`
   - optional values such as `RESEND_API_KEY`, `FROM_EMAIL`, and `JWT_SECRET`
4. Confirm the Vercel project is linked to the correct repository.

## 6.2 Staging deployment via GitHub Actions

This path is configured in `.github/workflows/deploy-staging.yml`.

Branch triggers:

- `develop`
- `staging`

Setup steps:

1. Create or choose a Vercel project.
2. Add the project runtime env vars in Vercel Preview environment.
3. Add these GitHub repository secrets:
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`
4. Push your branch to `develop` or `staging`.

What the workflow does:

1. `npm ci`
2. `npm run lint`
3. `npx tsc --noEmit`
4. `npm run build`
5. `vercel pull --yes --environment=preview`
6. `vercel build`
7. `vercel deploy --prebuilt`

Output:

- a Preview deployment URL is written to the workflow summary

## 6.3 Production deployment via GitHub Actions

This path is configured in `.github/workflows/deploy-production.yml`.

Branch trigger:

- `main`

Setup steps:

1. Make sure the production Supabase database is migrated and reviewed.
2. Add the production runtime env vars in Vercel Production environment.
3. Ensure the same GitHub secrets exist:
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`
4. Push to `main`.

What the workflow does:

1. `npm ci`
2. `npm run lint`
3. `npx tsc --noEmit`
4. `npm run build`
5. `vercel pull --yes --environment=production`
6. `vercel build --prod`
7. `vercel deploy --prebuilt --prod`

Output:

- a Production deployment URL is written to the workflow summary

## 6.4 Manual Vercel CLI deployment

Use this if you want to deploy without GitHub Actions.

Install the CLI:

```bash
npm install --global vercel@latest
```

Then:

1. Log in:

```bash
vercel login
```

2. Link the local repo to the Vercel project:

```bash
vercel link
```

3. Pull preview environment config:

```bash
vercel pull --yes --environment=preview
```

4. Build preview artifacts:

```bash
vercel build
```

5. Deploy preview:

```bash
vercel deploy --prebuilt
```

For production:

```bash
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

## 6.5 Deployment behavior from repo config

`vercel.json` currently configures:

- framework: `nextjs`
- deployment region: `bom1`
- global security headers
- `Cache-Control: no-store, must-revalidate` for `/api/*`

There is no checked-in custom rewrite or redirect deployment behavior in `vercel.json`.

## 7. Common Errors and Fixes

### 7.1 App fails to start or auth routes break immediately

Common cause:

- missing `NEXT_PUBLIC_SUPABASE_URL`
- missing `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- invalid Supabase URL format

Why:

- `proxy.ts`, `lib/supabase/server.ts`, and `lib/supabase/client.ts` all require those values

Fix:

1. Open `.env.local`
2. Make sure the URL includes `https://`
3. Restart the dev server

### 7.2 Tables or columns are missing after setup

Common cause:

- only early migrations were applied
- older docs were followed instead of the current migration folder

Fix:

1. Run all current migration files in `supabase/migrations/` in filename order
2. Do not stop after `001` and `002`
3. Re-check core tables like `events`, `vendors`, `user_profiles`, `event_intakes`, and `booking_requests`

### 7.3 Test or vendor seed data appears in staging or production

Common cause:

- seed SQL files live inside `supabase/migrations/`

Affected files include:

- `005_seed_test_accounts.sql`
- `025_seed_vendors.sql`
- `050_seed_more_vendors.sql`
- `058_seed_transport_vendors.sql`
- `059_seed_new_category_vendors.sql`

Fix:

1. Review those files before applying migrations to shared environments
2. Skip or edit them if sample data is not acceptable

### 7.4 Signup works poorly or users cannot log in after signup

Common cause:

- email confirmation is enabled in Supabase Auth, but your dev project has no usable email flow

Fix:

1. Open Supabase Auth email settings
2. For local development, either disable email confirmation or configure email delivery correctly

### 7.5 `npm run build` fails while fetching Google Fonts

Common cause:

- restricted internet access
- corporate proxy
- offline build environment

Why:

- `app/(intake)/layout.tsx` uses `next/font/google` with `Inter`

Fix:

1. Allow outbound access to Google Fonts
2. If that is not possible, replace the Google font usage with a local/self-hosted font

### 7.6 TLS errors in local development behind a proxy

Common cause:

- local certificate interception

Fix:

1. Set `ALLOW_INSECURE_TLS_DEV=true` in `.env.local`
2. Restart the app

Important:

- this is local-only
- `instrumentation.ts` only applies it in development when not running on Vercel

### 7.7 GitHub deployment workflow fails before deploy starts

Common cause:

- missing `VERCEL_TOKEN`
- missing `VERCEL_ORG_ID`
- missing `VERCEL_PROJECT_ID`

Fix:

1. Add those three GitHub repository secrets
2. Re-run the workflow

### 7.8 Deployment succeeds but runtime auth/data access fails

Common cause:

- Vercel project is missing runtime env vars

Fix:

1. Open the Vercel project
2. Set env vars for Preview and Production
3. Redeploy

### 7.9 `npm run test:coverage` fails

Current repo state:

- `vitest.config.ts` configures coverage
- the dependency `@vitest/coverage-v8` is missing

Fix:

```bash
npm install -D @vitest/coverage-v8
```

Then rerun:

```bash
npm run test:coverage
```

### 7.10 `npm run test:db` fails

Current repo state:

- `package.json` points to `scripts/test-db-connection.ts`
- that file does not exist

Fix:

Use the working script instead:

```bash
npx tsx scripts/check-connection.ts
```

Or update `package.json` to point `test:db` at a real script.
