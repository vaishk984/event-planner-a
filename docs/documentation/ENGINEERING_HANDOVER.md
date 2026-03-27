# PlannerOS Engineering Handover

Last reviewed: 2026-03-27

## 1. Scope And Verification Boundary

This document is based on a static review of the repository snapshot in this workspace. It is intended to be the onboarding and handover reference for engineering teams working on the code as it exists today.

What was verified directly from the repository:

- Folder structure and file inventory
- Runtime code paths in `app/`, `actions/`, `lib/`, and `src/`
- Package dependencies and build/test configuration
- Supabase migrations and RLS policies
- CI/CD workflow definitions

What was not verified at runtime:

- `npm test`
- `npm run build`
- `npm run lint`
- Database connectivity

Reason: `node_modules` is not present in this workspace snapshot, so the toolchain could not be executed without first installing dependencies.

Repository metadata boundary:

- `.git` is not present in this workspace snapshot
- Commit history, branches, and uncommitted diff state were not available for review

This document should be treated as more accurate than the existing `README.md`, `ARCHITECTURE.md`, and `supabase/README.md` where those documents conflict with the implementation.

## 2. Executive Summary

PlannerOS is a Next.js 16 App Router application for three primary personas:

- Planners
- Vendors
- Clients

The system uses Supabase for:

- Auth
- PostgreSQL data storage
- RLS authorization
- Storage uploads
- Realtime on selected tables

The most important architectural fact is that the repository is not implemented as one single backend stack. It currently has three active execution styles:

1. REST API handlers under `app/api/v1/*` backed by the layered `src/backend/*` controller-service-repository stack.
2. Server actions under `actions/*` and `lib/actions/*` backed by `lib/services/*` and `lib/repositories/*`.
3. Direct Supabase queries inside pages and actions, bypassing shared service layers entirely in some flows.

That hybrid architecture is the main source of coupling, duplication, and handover risk in this codebase.

## 3. Repository Inventory

### 3.1 Top-Level Structure

File counts below come from the current snapshot.

| Path | Files | Purpose |
| --- | ---: | --- |
| `app/` | 179 | Next.js App Router pages, layouts, loading states, API routes |
| `components/` | 101 | Shared UI and feature components |
| `actions/` | 21 | Top-level server actions |
| `lib/` | 83 | Shared business logic, repositories, stores, utilities |
| `src/` | 107 | Layered backend, frontend API client/hooks, shared re-exports |
| `supabase/` | 66 | Migrations and database docs |
| `scripts/` | 82 | Operational diagnostics, data repair, schema inspection, seeding |
| `tests/` | 5 | Unit tests and test setup |
| `docs/` | 17 | Product, setup, and architecture notes |
| `config/` | 3 | Site, role, and navigation config |
| `types/` | 3 | Shared TypeScript domain/type exports |

### 3.2 App Router Shape

Current route inventory:

- 61 `page.tsx` files
- 12 `layout.tsx` files
- 58 `route.ts` handlers
- 11 `loading.tsx` files

Primary route groups and portals:

- `app/(auth)/...`: login, signup, forgot-password
- `app/(dashboard)/planner/...`: planner dashboard and event workspace
- `app/vendor/...`: vendor dashboard, bookings, calendar, earnings, profile, event-day
- `app/admin/...`: admin views
- `app/(showroom)/showroom/...`: public/vendor marketplace presentation
- `app/(capture)/capture/...`: planner-operated capture flow
- `app/(intake)/intake/[token]`: public intake form
- `app/(client)/client/[token]`, `app/(client)/proposal/[token]`, `app/(client)/review/[token]`: tokenized client review/proposal views
- `app/portal/[token]/...`: tokenized client event portal
- `app/api/v1/...`: REST API surface
- `app/api/auth/...`: auth-adjacent endpoints

### 3.3 Backend Directory Roles

`src/backend/` is a conventional layered backend:

- `controllers/`
- `services/`
- `repositories/`
- `entities/`
- `dto/`
- `middleware/`
- `exceptions/`
- `config/`
- `utils/`

`lib/` is a second business-logic stack used by the App Router directly:

- `lib/actions/`
- `lib/services/`
- `lib/repositories/`
- `lib/domain/`
- `lib/supabase/`
- `lib/stores/`
- `lib/templates/`

`src/frontend/` contains an API client and hooks for the REST API, but I did not find imports from `app/`, `components/`, or `lib/` into this layer during this review. It appears present but not integrated into the current UI runtime.

`src/shared/` re-exports shared types, but I did not find imports to it from the current app runtime during this review.

## 4. Runtime Architecture

### 4.1 Route Protection And Session Flow

Protected-route handling is implemented in `proxy.ts`. The file explicitly avoids creating a Supabase SSR client on public routes to prevent auth cookie clearing during token refresh attempts on public navigation (`proxy.ts:70`). Protected prefixes are:

- `/planner`
- `/vendor`
- `/admin`
- `/capture`

Public prefixes include:

- `/showroom`
- `/client`
- `/portal`
- `/intake`

Server-side session resolution is centralized in `lib/session.ts`. Important behaviors:

- `getAuthenticatedUser` is cached with React `cache()` (`lib/session.ts:26`)
- `getSession` is also cached (`lib/session.ts:128`)
- missing `user_profiles` rows are created lazily by `ensureUserProfile()` (`lib/session.ts:65`)
- vendor role detection prefers existence of a `vendors` row over profile role (`lib/session.ts`)

The planner dashboard layout wraps children in an AsyncLocalStorage request store and injects a browser auth bridge:

- `runWithRequestStore(...)` in `app/(dashboard)/layout.tsx:19`
- `<BrowserSessionBridge />` in `app/(dashboard)/layout.tsx:26`

The browser bridge fetches `/api/auth/browser-session` and hydrates the Supabase browser client if the client-side session is missing.

### 4.2 Role Enforcement

Planner and vendor layouts use `getSession()` and Next.js redirects.

- `app/(dashboard)/layout.tsx`
- `app/vendor/layout.tsx`

The admin layout is inconsistent with the rest of the auth stack. It reads a custom `session` cookie directly (`app/admin/layout.tsx:11`). I did not find code in this repository snapshot that sets that cookie. The main auth flow sets Supabase auth cookies via `@supabase/ssr` in `app/api/auth/login/route.ts`, not a serialized `session` cookie.

Implication:

- planner and vendor areas align with the current Supabase SSR flow
- admin access depends on a cookie mechanism that is not obviously produced in this snapshot

### 4.3 Three Active Backend Execution Paths

#### Path A: REST API via `src/backend`

Representative flow:

- `app/api/v1/events/route.ts:16` calls `eventController.list(request)`
- `src/backend/controllers/EventController.ts` authenticates and validates input
- `src/backend/services/EventService.ts` applies domain rules
- `src/backend/repositories/EventRepository.ts` executes Supabase queries
- `src/backend/entities/Event.ts` owns the event state machine and entity behavior

This stack is the cleanest layered implementation in the repository.

#### Path B: Server Actions via `lib/*`

Representative flow:

- `lib/actions/event-actions.ts:191` calls `eventService.createEvent(...)`
- `lib/services/event-service.ts:20` implements a second `EventService`
- `lib/repositories/supabase-event-repository.ts:11` implements a second event repository

This path is used heavily by planner and vendor UI code.

#### Path C: Direct Supabase Queries

Representative examples:

- `actions/dashboard.ts:50` builds planner dashboard data directly
- `actions/dashboard.ts:80` and `actions/dashboard.ts:86` query `financial_payments`
- `actions/client-portal.ts` reads `events`, `booking_requests`, `vendor_updates`, `timeline_items`, and `proposal_snapshots` directly
- `actions/vendor-updates.ts` reads and writes `vendor_updates`, `vendor_assignments`, and `booking_requests` directly
- `actions/leads.ts` operates directly on `clients`

This means no single service layer is authoritative across the full product surface.

## 5. Data Layer And Schema

### 5.1 Supabase Is The Primary System Of Record

The application uses Supabase across:

- auth
- database
- storage
- realtime

The workspace contains 63 SQL migrations.

Key schema milestones from migrations:

- `supabase/migrations/001_initial_schema.sql:68` creates `events`
- `supabase/migrations/019_event_intakes_table.sql:12` creates `event_intakes`
- `supabase/migrations/020_fix_events_schema.sql:5` adds `date` to `events`
- `supabase/migrations/020_fix_events_schema.sql:36` adds `submission_id` to `events`
- `supabase/migrations/057_proposal_snapshots.sql:4` creates `proposal_snapshots`
- `supabase/migrations/057_proposal_snapshots.sql:17` adds `final_proposal_token`
- `supabase/migrations/064_event_day_updates.sql:8` creates `vendor_updates`
- `supabase/migrations/065_client_portal.sql:9` adds `client_token`

### 5.2 Important Business Tables

Tables directly used in current runtime code include:

- `events`
- `event_intakes`
- `booking_requests`
- `vendors`
- `vendor_assignments`
- `vendor_updates`
- `timeline_items`
- `event_functions`
- `event_specs`
- `client_messages`
- `proposal_snapshots`
- `financial_payments`
- `invoices`
- `invoice_items`
- `notifications`
- `clients`
- `leads`
- `tasks`
- `user_profiles`
- `planner_profiles`

### 5.3 Event Schema Drift

The event domain has clear schema drift across implementations.

The `src/backend` repository stack uses `date`:

- `src/backend/repositories/EventRepository.ts:82`
- `src/backend/repositories/EventRepository.ts:126`
- `src/backend/repositories/EventRepository.ts:156`

The `lib` event repository stack uses `event_date` for upcoming/today queries:

- `lib/repositories/supabase-event-repository.ts:80`
- `lib/repositories/supabase-event-repository.ts:111`

At the same time, the current migrations show `events.date` exists and was explicitly added in `020_fix_events_schema.sql`, while `event_date` remains common on `booking_requests` and other legacy tables.

Handover implication:

- event reads and writes are not uniformly aligned to one canonical event date field
- any event-related refactor must verify actual database columns before reuse of either repository stack

### 5.4 Intake Storage Model

`event_intakes` is not stored as fully flattened columns. `lib/repositories/supabase-intake-repository.ts` maps:

- top-level columns such as `planner_id`, `client_name`, `status`, `event_id`
- a JSONB `requirements` blob containing most intake form state

This repository is the effective mapper between the intake UI state and the database row shape.

### 5.5 Public Token And Portal Model

There are two separate public-access token families on `events`:

- `public_token` for proposal links
- `client_token` for the client portal

Frozen final proposals are additionally backed by `proposal_snapshots` and `final_proposal_token`.

Current implementation:

- proposal rendering and status updates: `actions/client-portal.ts`
- client portal layout and retrieval: `app/portal/[token]/layout.tsx`, `actions/client-portal.ts`

## 6. Security And RLS

### 6.1 API Authentication

`src/backend/middleware/auth.middleware.ts` authenticates requests by:

- checking `Authorization: Bearer ...`
- reconstructing chunked Supabase auth cookies when the header is missing

Role resolution in that middleware defaults to `user.user_metadata.role` or `'client'` (`src/backend/middleware/auth.middleware.ts:75`).

This differs from `lib/session.ts`, which infers vendor status from the `vendors` table and lazily ensures `user_profiles`.

Implication:

- the REST API and the App Router server-action stack do not derive role from exactly the same source

### 6.2 Public RLS Policies

Client portal and intake functionality intentionally loosen RLS in some areas.

Examples:

- `supabase/migrations/065_client_portal.sql:57` allows `client_messages` reads with `USING (true)`
- `supabase/migrations/065_client_portal.sql:68` allows `booking_requests` reads with `USING (true)`
- `supabase/migrations/065_client_portal.sql:74`, `:82`, `:90`, `:98`, `:106` create additional broad anonymous read policies
- `supabase/migrations/066_fix_intakes_rls.sql:24` allows intake insert with `WITH CHECK (true)`
- `supabase/migrations/066_fix_intakes_rls.sql:32` and `:38` allow intake read and update with `USING (true)`

Application logic then relies on token checks in server actions such as `actions/client-portal.ts`.

Handover implication:

- access control is split between database policy and application token validation
- token validation errors or accidental broad queries would expose more data than a strictly row-scoped policy model

This is not a theoretical concern. It is explicitly how the portal/intake flows were implemented.

## 7. Major Product Flows

### 7.1 Planner Dashboard

Planner landing page:

- `app/(dashboard)/planner/page.tsx`
- data assembly in `actions/dashboard.ts`

The dashboard currently reads:

- active event count from `events`
- lead count and recent leads from `clients`
- payments from `financial_payments`
- urgent tasks from `tasks`
- same-day functions from `event_functions`

This dashboard does not go through `src/backend` controllers or the `lib/services/event-service` abstraction.

### 7.2 Intake And Capture

Planner-operated capture entry:

- `app/(capture)/capture/page.tsx`

Public/client intake entry:

- `app/(intake)/intake/[token]/page.tsx`

Intake state is held in `components/providers/client-intake-provider.tsx` and submitted through `lib/actions/intake-actions.ts`.

Conversion path from intake to event:

- `lib/actions/intake-actions.ts:111` `convertIntakeToEvent(...)`
- creates an event
- marks the intake converted
- creates an initial invoice

### 7.3 Planner Event Management

Planner event listing:

- `app/(dashboard)/planner/events/page.tsx`

This page fetches:

- events through `lib/services/event-service.ts`
- pending intakes through `lib/repositories/supabase-intake-repository.ts`

Planner event detail pages mix patterns:

- server components for some data loading
- client components calling server actions such as `getEvent()` from `lib/actions/event-actions.ts`
- direct Supabase reads in feature pages such as invoices, tasks, and client views

### 7.4 Proposal And Client Portal

Proposal and client-facing surfaces are heavily implemented in `actions/client-portal.ts`.

This action file currently handles:

- event lookup by `client_token`
- service anonymization for client portal views
- day-of updates for clients
- client-planner messaging
- portal token generation
- public proposal token generation
- final proposal token generation
- snapshot fallback logic
- approval / changes-request status updates

This file is one of the highest-value files for product understanding because it centralizes proposal and client-facing read models.

### 7.5 Vendor Portal

Vendor portal pages live under `app/vendor/*`.

Primary runtime path:

- UI pages in `app/vendor/*`
- server actions in `lib/actions/vendor-actions.ts`
- booking reads/writes through `lib/repositories/supabase-booking-repository.ts`

Vendor event-day flow is separate:

- `actions/vendor-updates.ts`
- writes to `vendor_updates`
- mirrors arrival state into `vendor_assignments`
- merges `vendor_assignments` and `booking_requests` when building planner/vendor event-day views

## 8. Frontend State And Client-Side Providers

`app/layout.tsx` mounts:

- `EventProvider` (`app/layout.tsx:25`)
- `QuoteProvider` (`app/layout.tsx:26`)

Both providers are localStorage-backed:

- `components/providers/event-provider.tsx:79`, `:89`
- `components/providers/quote-provider.tsx:34`, `:46`

These providers are still used by showroom / quote-builder style UI flows. They are not the same thing as the Supabase-backed event and proposal records.

Handover implication:

- some UX state is persisted in the browser only
- some domain state is persisted in Supabase
- those are separate mechanisms and should not be conflated during refactors

## 9. Dependencies And Configuration

### 9.1 Core Runtime Dependencies

From `package.json`:

- `next@16.1.0`
- `react@19.2.3`
- `react-dom@19.2.3`
- `@supabase/ssr`
- `@supabase/supabase-js`
- `@supabase/auth-helpers-nextjs`
- `zod`
- `react-hook-form`
- Radix UI packages
- `lucide-react`
- `date-fns`
- drag-and-drop kit packages

### 9.2 Build And Tooling

- TypeScript is strict and `noEmit` is enabled in `tsconfig.json`
- JavaScript files are allowed via `allowJs: true`
- ESLint uses Next.js core-web-vitals + TypeScript config in `eslint.config.mjs`
- Vitest is configured in `vitest.config.ts`

### 9.3 Next/Vercel Configuration

`next.config.ts`:

- does not ignore TypeScript build errors
- allows remote images from `images.unsplash.com`

`vercel.json`:

- deploy region is `bom1`
- global security headers are set
- `/api/*` responses receive `Cache-Control: no-store, must-revalidate`

`instrumentation.ts`:

- allows opt-in insecure TLS only in local development via `ALLOW_INSECURE_TLS_DEV=true`

### 9.4 Environment Variables Observed In Code

Required or actively referenced:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `NODE_ENV`
- `VERCEL`
- `VERCEL_URL`
- `ALLOW_INSECURE_TLS_DEV`
- `RESEND_API_KEY`

Email integration exists in `lib/services/email-service.ts` and uses `RESEND_API_KEY`.

## 10. Testing, CI, And Operational Tooling

### 10.1 Tests

Current automated test coverage is small and unit-focused. The repository contains four test files:

- `tests/unit/domain/event.test.ts`
- `tests/unit/middleware/rate-limit.test.ts`
- `tests/unit/logger.test.ts`
- `tests/unit/utils/response.test.ts`

Coverage characteristics:

- covers backend entity logic and utility helpers
- does not cover server actions
- does not cover app-router pages
- does not cover Supabase repositories against a live database
- does not provide end-to-end coverage for planner, vendor, or client flows

### 10.2 CI/CD

GitHub Actions workflows exist for:

- CI: `.github/workflows/ci.yml`
- staging deploy: `.github/workflows/deploy-staging.yml`
- production deploy: `.github/workflows/deploy-production.yml`

Current enforcement behavior:

- Node 20
- `npm ci`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`

Important nuance:

- lint is non-blocking in CI and deploy workflows because `continue-on-error: true` is set

### 10.3 Scripts Folder

`scripts/` contains 82 files. This is operational tooling, not a cohesive application subsystem.

Observed script categories:

- schema inspection
- RLS diagnostics
- booking debugging
- vendor/user deduplication
- account creation and seeding
- data restoration
- ad-hoc SQL repair scripts

This folder is important for operators but should not be mistaken for formal application runtime code.

## 11. Documentation Drift

The repository contains useful documents, but several are no longer accurate enough to serve as sole onboarding references.

### 11.1 `README.md`

Concrete mismatches:

- `README.md:50` tells users to copy `.env.example`, but the repository contains `.env.local.example`
- `README.md:96` references `test-e2e.js`, which is not present in this snapshot
- `README.md:102` references `demo-workflow.js`, which is not present in this snapshot

### 11.2 `ARCHITECTURE.md`

Concrete mismatches:

- it declares itself the "single source of truth" (`ARCHITECTURE.md:7`)
- it documents `components/features` (`ARCHITECTURE.md:80`), but that directory does not exist
- it documents a root `hooks/` directory (`ARCHITECTURE.md:107`), but that directory does not exist
- it does not describe the current dual-stack `src/backend/*` plus `lib/*` implementation split

### 11.3 `supabase/README.md`

This document focuses on initial setup through migrations `001` and `002`, while the repository now contains 63 migrations. It is not sufficient as a representation of the current database state.

## 12. Current Engineering Risks

### 12.1 Duplicate Domain Implementations

Observed duplicates include:

- `src/backend/services/EventService.ts`
- `lib/services/event-service.ts`
- `src/backend/repositories/EventRepository.ts`
- `lib/repositories/supabase-event-repository.ts`
- `actions/leads.ts`
- `actions/leads/create-lead.ts`
- `src/backend` rate limiting vs `lib/rate-limit.ts`
- `src/backend` logger vs `lib/logger.ts`

Impact:

- feature work can accidentally update only one runtime path
- bug fixes can regress the other stack
- handover cost is higher because names are similar but behavior is not identical

### 12.2 Lead Model Split

Lead handling is not implemented through one table.

- `actions/leads/create-lead.ts:53` inserts into `leads`
- `actions/leads.ts:70` and related functions use `clients` with `status = 'prospect'`

Impact:

- "lead" may mean different tables depending on the feature entry point
- analytics, migrations, and future API consolidation must account for both

### 12.3 Auth Role Resolution Split

Observed role sources:

- `lib/session.ts` uses vendor-record existence and `user_profiles`
- `src/backend/middleware/auth.middleware.ts:75` uses `user.user_metadata.role` and defaults to `client`
- `app/admin/layout.tsx:11` relies on a custom `session` cookie

Impact:

- role interpretation is not globally uniform
- admin behavior should be revalidated before production changes

### 12.4 Unused Or Partially Integrated Scaffolding

Observed examples:

- `src/frontend/` API client and hooks exist, but I did not find current app imports into that layer
- `src/shared/` exists, but I did not find current app imports into that layer
- `src/backend/core/Container.ts` defines a DI container, but I did not find runtime resolution usage in the application code

Impact:

- some folders read as planned architecture rather than active runtime architecture
- new contributors can easily optimize the wrong layer

### 12.5 Public Data Access Depends On Application Logic

Broad `USING (true)` RLS rules exist for parts of the portal and intake surfaces. The intended protection boundary is token validation in application code.

Impact:

- token-handling code is security-critical
- accidental broad query changes can produce unintended exposure

## 13. Recommended Immediate Next Steps

These are the highest-value follow-ups for the receiving engineering team.

1. Choose a single authoritative backend path for new work.
   Suggested direction: keep `src/backend/*` as the formal API layer and decide whether `lib/*` will be migrated toward it or remain a separate App Router service layer.

2. Normalize the event schema contract.
   Specifically reconcile `date` vs `event_date` usage across repositories, dashboard queries, and booking joins.

3. Consolidate lead handling.
   Decide whether `leads` or `clients(status='prospect')` is canonical and plan a migration path.

4. Revalidate admin authentication.
   Confirm whether `app/admin/layout.tsx` still works in deployed environments and replace the custom `session` cookie dependency if not.

5. Audit public-token flows and RLS.
   Verify that every broad-read table is protected by strict token checks in application code and that no UI route performs broader reads than intended.

6. Replace or retire stale documentation.
   At minimum, update `README.md`, `ARCHITECTURE.md`, and `supabase/README.md` to point contributors at the real runtime architecture.

7. Restore executable verification in local development.
   Install dependencies, run the test/build/lint suite, and record current pass/fail status as part of the handover package.

## 14. File-Level Starting Points For New Engineers

These are the most useful files to read first.

- `proxy.ts`
- `lib/session.ts`
- `app/(dashboard)/layout.tsx`
- `app/api/v1/events/route.ts`
- `src/backend/controllers/EventController.ts`
- `src/backend/services/EventService.ts`
- `src/backend/repositories/EventRepository.ts`
- `lib/actions/event-actions.ts`
- `lib/services/event-service.ts`
- `lib/repositories/supabase-event-repository.ts`
- `actions/dashboard.ts`
- `actions/client-portal.ts`
- `actions/vendor-updates.ts`
- `lib/actions/intake-actions.ts`
- `lib/repositories/supabase-intake-repository.ts`
- `lib/actions/vendor-actions.ts`
- `supabase/migrations/020_fix_events_schema.sql`
- `supabase/migrations/057_proposal_snapshots.sql`
- `supabase/migrations/064_event_day_updates.sql`
- `supabase/migrations/065_client_portal.sql`
- `supabase/migrations/066_fix_intakes_rls.sql`

This document should be updated when the team consolidates backend paths, normalizes event and lead schema ownership, or tightens portal/intake security boundaries.
