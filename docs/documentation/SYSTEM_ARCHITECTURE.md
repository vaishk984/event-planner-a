# PlannerOS System Architecture

Last reviewed: 2026-03-27

## 1. Scope

This document describes the system architecture implemented in the current repository snapshot.

It is based on actual code in:

- `app/`
- `actions/`
- `lib/`
- `src/`
- `supabase/`
- `.github/workflows/`

## 2. Architecture Summary

PlannerOS is a Next.js 16 App Router application backed by Supabase. The important architectural fact is that the runtime is hybrid:

1. App Router pages and layouts in `app/`
2. Server Actions in `actions/*` and `lib/actions/*`
3. REST API routes in `app/api/v1/*`
4. Two backend/service stacks:
   - `src/backend/*` for REST endpoints
   - `lib/*` for server actions and direct app usage
5. Direct Supabase queries in some pages/actions that bypass shared service layers

This means the system is not a single layered backend. Different product areas use different execution paths.

## 3. High-Level Architecture

### 3.1 Runtime Components

```
                              Planner / Vendor / Client Browser
                                           |
                                           v
                                  Next.js App Router
                                           |
                +--------------------------+--------------------------+
                |                                                     |
                v                                                     v
             proxy.ts                                        Public token routes
      auth/session gate for protected paths                  /portal/[token]
                |                                            /proposal/[token]
                |                                            /intake/[token]
                v
     +---------------------------+----------------------------+
     |                           |                            |
     v                           v                            v
 Server Components         Server Actions               REST API routes
 app/* pages/layouts       actions/*, lib/actions/*     app/api/v1/*
     |                           |                            |
     |                           |                            v
     |                           |                  src/backend middleware
     |                           |                  -> controllers
     |                           |                  -> services
     |                           |                  -> repositories
     |                           |
     +-------------+-------------+
                   |
                   v
      lib/services/*, lib/repositories/*, direct Supabase queries
                   |
                   v
       Supabase Auth / Postgres / Storage / Realtime / RLS
```

### 3.2 Major Application Surfaces

The main route groups are:

- Planner workspace: `app/(dashboard)/planner/*`
- Vendor portal: `app/vendor/*`
- Admin area: `app/admin/*`
- Showroom: `app/(showroom)/showroom/*`
- Capture flow: `app/(capture)/capture/*`
- Intake flow: `app/(intake)/intake/[token]`
- Client event portal: `app/portal/[token]/*`
- Proposal review: `app/(client)/proposal/[token]`, `app/(client)/review/[token]`
- REST API: `app/api/v1/*`

### 3.3 Actual Component Map

```
Planner UI
  -> app/(dashboard)/layout.tsx
  -> app/(dashboard)/planner/*
  -> actions/* and lib/actions/*
  -> lib/services/* and lib/repositories/*
  -> Supabase

Vendor UI
  -> app/vendor/layout.tsx
  -> app/vendor/*
  -> lib/actions/vendor-actions.ts
  -> actions/vendor-updates.ts
  -> lib/repositories/supabase-booking-repository.ts
  -> Supabase

Client Portal / Proposal UI
  -> app/portal/[token]/layout.tsx
  -> app/(client)/*
  -> actions/client-portal.ts
  -> Supabase (token lookups on events + related tables)

REST API
  -> app/api/v1/*
  -> src/backend/middleware/*
  -> src/backend/controllers/*
  -> src/backend/services/*
  -> src/backend/repositories/*
  -> Supabase
```

## 4. Core Components And Interactions

### 4.1 Request Entry And Route Protection

All requests first pass through `proxy.ts`.

Observed behavior:

- protected prefixes are defined in `proxy.ts:16`
  - `/planner`
  - `/vendor`
  - `/admin`
  - `/capture`
- public prefixes are defined in `proxy.ts:28`
  - `/showroom`
  - `/client`
  - `/portal`
  - `/intake`
- public routes intentionally skip Supabase client creation to avoid clearing auth cookies on refresh failure (`proxy.ts:70`)
- protected routes create a Supabase SSR client and call `supabase.auth.getUser()` (`proxy.ts:112`)

That makes `proxy.ts` the first authentication boundary for the browser-driven application.

### 4.2 Server-Side Session Resolution

The main session utility is `lib/session.ts`.

Actual behaviors:

- validates the current user with `supabase.auth.getUser()` instead of trusting cookies blindly (`lib/session.ts:10`)
- caches `getSession()` using React `cache()` (`lib/session.ts:128`)
- lazily creates or updates `user_profiles` through `ensureUserProfile(...)` (`lib/session.ts:65`, `lib/session.ts:151`)
- infers vendor role by checking the `vendors` table before defaulting to planner

Planner pages also set request-scoped user context through AsyncLocalStorage:

- `runWithRequestStore(...)` in `app/(dashboard)/layout.tsx:19`
- implementation in `lib/request-store.ts:21`, `:27`, `:41`, `:55`

This lets child server components reuse the same session context without repeatedly hitting Supabase auth.

### 4.3 Browser Session Hydration

The planner dashboard layout mounts `BrowserSessionBridge` (`app/(dashboard)/layout.tsx:26`).

`components/auth/browser-session-bridge.tsx:6`:

- checks whether the browser Supabase client already has a session
- if not, fetches `/api/auth/browser-session`
- calls `supabase.auth.setSession(...)`

This bridges SSR-authenticated requests into client-side Supabase usage.

### 4.4 REST API Stack

The REST API surface is implemented under `app/api/v1/*`.

Representative route:

- `app/api/v1/events/route.ts`

Actual composition:

- `withRateLimit(...)`
- `withLogging(...)`
- `withErrorHandler(...)`

from:

- `src/backend/middleware/rate-limit.middleware.ts`
- `src/backend/middleware/logging.middleware.ts`
- `src/backend/middleware/error.middleware.ts`

The events API then delegates to `eventController`:

- `EventController` in `src/backend/controllers/EventController.ts:19`
- `EventService` in `src/backend/services/EventService.ts:17`
- `EventRepository` in `src/backend/repositories/EventRepository.ts:33`
- `Event` entity in `src/backend/entities/Event.ts:34`

This is the cleanest controller-service-repository flow in the repository.

### 4.5 Server Action Stack

A separate execution path exists outside the REST API.

Examples:

- planner dashboard data: `actions/dashboard.ts:50`
- planner event creation: `actions/events/create-event.ts:10`
- intake conversion: `lib/actions/intake-actions.ts:111`
- vendor bookings: `lib/actions/vendor-actions.ts:89`
- client portal reads: `actions/client-portal.ts:23`
- event-day vendor updates: `actions/vendor-updates.ts:15`

These actions usually call:

- `lib/services/*`
- `lib/repositories/*`

or query Supabase directly.

### 4.6 Local Client-State Subsystem

The root layout mounts two client-only providers:

- `EventProvider` in `app/layout.tsx:25`
- `QuoteProvider` in `app/layout.tsx:26`

These are not the primary backend system of record.

Observed behaviors:

- `EventProvider` stores active-event state in localStorage (`components/providers/event-provider.tsx:79`, `:89`)
- `QuoteProvider` stores a quote cart in localStorage (`components/providers/quote-provider.tsx:18`, `:34`, `:46`)

This subsystem supports showroom / quote-builder UX, separate from persisted Supabase event records.

## 5. Data Flow And Request Lifecycle

### 5.1 Protected Planner Page Render

Observed path for the planner events page:

- page file: `app/(dashboard)/planner/events/page.tsx`
- request gating: `proxy.ts`
- session context: `app/(dashboard)/layout.tsx`
- page data load:
  - `getRequestUserId()` or `getUserId()` (`app/(dashboard)/planner/events/page.tsx:10`)
  - `eventService.getEvents(plannerId)` (`app/(dashboard)/planner/events/page.tsx:22`)
  - `supabaseIntakeRepository.findPending(plannerId)` (`app/(dashboard)/planner/events/page.tsx:23`)

ASCII lifecycle:

```
Browser
  -> GET /planner/events
  -> proxy.ts
       -> createServerClient(...)
       -> supabase.auth.getUser()
  -> app/(dashboard)/layout.tsx
       -> getSession()
       -> runWithRequestStore(...)
       -> BrowserSessionBridge
  -> app/(dashboard)/planner/events/page.tsx
       -> eventService.getEvents(...)
       -> supabaseIntakeRepository.findPending(...)
  -> Supabase
  -> HTML response
```

### 5.2 REST API Request Lifecycle

Observed path for `GET /api/v1/events`:

- route entry: `app/api/v1/events/route.ts`
- logging wrapper: `src/backend/middleware/logging.middleware.ts`
- error wrapper: `src/backend/middleware/error.middleware.ts`
- rate limiting: both `src/backend/middleware/rate-limit.middleware.ts` and `lib/rate-limit.ts` are involved, because `withErrorHandler` uses `lib/rate-limit.ts` for a standard API limit while `withRateLimit` adds the backend middleware’s own in-memory limiter
- auth + validation: `src/backend/controllers/EventController.ts:26`, `:27`
- service: `src/backend/services/EventService.ts`
- repository: `src/backend/repositories/EventRepository.ts`

ASCII lifecycle:

```
Client
  -> GET /api/v1/events
  -> withRateLimit(...)
  -> withLogging(...)
  -> withErrorHandler(...)
  -> EventController.list(...)
       -> authenticate(request)
       -> validateQuery(...)
  -> EventService.getByPlanner(...)
  -> EventRepository.findByPlannerId(...)
  -> Supabase
  -> standardized JSON response
```

### 5.3 Server Action Mutation Lifecycle

Observed path for converting an intake into an event:

- entry: `lib/actions/intake-actions.ts:111`
- lookup: `supabaseIntakeRepository.findById(...)`
- event creation: `supabaseEventRepository.create(...)`
- intake status update: `supabaseIntakeRepository.markConverted(...)` (`lib/repositories/supabase-intake-repository.ts:191`)
- invoice side effect: `createInitialInvoiceForEvent(...)`
- cache invalidation via `revalidatePath(...)`

ASCII lifecycle:

```
Planner UI
  -> server action convertIntakeToEvent(intakeId)
  -> supabaseIntakeRepository.findById(...)
  -> map intake fields -> event fields
  -> supabaseEventRepository.create(...)
  -> createInitialInvoiceForEvent(...)
  -> supabaseIntakeRepository.markConverted(...)
  -> revalidatePath(...)
  -> UI refreshes with new event
```

### 5.4 Token-Based Client Portal Read Lifecycle

Observed path for client event portal page load:

- layout: `app/portal/[token]/layout.tsx:20`
- token lookup action: `actions/client-portal.ts:23`
- DB lookup: `events.client_token`

ASCII lifecycle:

```
Client Browser
  -> GET /portal/{token}
  -> app/portal/[token]/layout.tsx
       -> getEventByClientToken(token)
  -> actions/client-portal.ts
       -> select from events where client_token = token
  -> if found:
       -> PortalLayoutWrapper
     else:
       -> notFound()
```

Related token-based reads in the same action file:

- anonymized services from `booking_requests`
- client-visible updates from `vendor_updates`
- client messages from `client_messages`
- proposal reads via `public_token`, `final_proposal_token`, and `proposal_snapshots`

### 5.5 Vendor Event-Day Upload Lifecycle

Observed path for event photo uploads:

- action entry: `actions/vendor-updates.ts:105`
- storage bucket: `event-photos` (`actions/vendor-updates.ts:120`, `:132`)
- public URL generation: `getPublicUrl(...)` (`actions/vendor-updates.ts:133`)

Observed path for vendor status/photo updates:

- action entry: `actions/vendor-updates.ts:15`
- writes to `vendor_updates` (`actions/vendor-updates.ts:44`)
- mirrors arrival state into `vendor_assignments`
- planner/client views later read `vendor_updates`

ASCII lifecycle:

```
Vendor UI
  -> uploadEventPhoto(formData)
  -> supabase.storage.from('event-photos').upload(...)
  -> getPublicUrl(...)
  -> submitVendorUpdate(...)
  -> insert into vendor_updates
  -> optional update vendor_assignments arrival fields
  -> revalidatePath('/vendor/event-day')
```

## 6. Data Layer

### 6.1 Primary Data Platform

The system uses Supabase as the primary backend platform:

- Auth: `lib/supabase/server.ts`, `lib/supabase/client.ts`
- Database: direct `.from(...)` queries throughout `actions/*`, `lib/repositories/*`, and `src/backend/repositories/*`
- Storage: `actions/vendor-updates.ts`
- Realtime: enabled for `vendor_updates` in `supabase/migrations/064_event_day_updates.sql:73`

### 6.2 Active Database Tables In Current Runtime Paths

Frequently accessed tables in the implementation include:

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
- `notifications`
- `clients`
- `leads`
- `tasks`
- `user_profiles`
- `planner_profiles`

### 6.3 Notable Schema Behaviors

#### Event intake token storage

`lib/repositories/supabase-intake-repository.ts:167` looks up intakes by:

- `requirements->>token`

This means the public intake token is stored inside the JSONB `requirements` payload, not just as a first-class scalar column.

#### Client portal token model

`actions/client-portal.ts` uses:

- `client_token` for the client portal (`actions/client-portal.ts:34`)
- `public_token` for proposal links
- `final_proposal_token` for frozen final proposals
- `proposal_snapshots` as a fallback/archival read model

#### Mixed event date field usage

The codebase does not use a single event date mapping everywhere:

- `src/backend/repositories/EventRepository.ts` queries `events.date`
- `lib/repositories/supabase-event-repository.ts` uses `event_date` for upcoming/today queries

That is an implementation detail the receiving team should treat as current architectural reality, not as a documentation mistake.

## 7. External Services Used

### 7.1 Supabase

Supabase is the dominant external system.

Actual usage in code:

- SSR auth client: `lib/supabase/server.ts:10`
- browser auth client: `lib/supabase/client.ts:7`
- route protection/session verification: `proxy.ts`, `lib/session.ts`
- database queries: across `actions/*`, `lib/repositories/*`, `src/backend/repositories/*`
- storage bucket `event-photos`: `actions/vendor-updates.ts:120`, `:132`
- realtime publication on `vendor_updates`: `supabase/migrations/064_event_day_updates.sql:73`

### 7.2 Resend

Email sending is implemented through direct HTTP requests to Resend:

- API key usage: `lib/services/email-service.ts:22`
- outbound request: `lib/services/email-service.ts:48`

I did not find imports of `lib/services/email-service.ts` elsewhere during this review, so the integration exists in code but is not obviously wired into a major runtime path in this snapshot.

### 7.3 Vercel

Vercel is the deployment target.

Evidence:

- platform config in `vercel.json`
- deployment region `bom1` in `vercel.json:4`
- CI/CD deploy workflows in:
  - `.github/workflows/deploy-staging.yml`
  - `.github/workflows/deploy-production.yml`

### 7.4 Unsplash

Remote image loading is enabled for Unsplash in `next.config.ts:9` and `:12`.

This is a frontend content dependency rather than a system-of-record service.

## 8. Design Patterns Used In Actual Code

### 8.1 App Router Route Group Pattern

Used in:

- `app/(dashboard)`
- `app/(auth)`
- `app/(showroom)`
- `app/(capture)`
- `app/(intake)`
- `app/(client)`

Purpose:

- separate planner, vendor, client, showroom, and auth shells without changing public URL structure

### 8.2 Proxy-Based Authentication Gate

Implemented in `proxy.ts`.

Pattern:

- central pre-routing auth/session filter
- protected/public path classification
- conditional Supabase SSR client construction

### 8.3 Middleware Composition / Decorator Pattern

Implemented in the REST API routes.

Example:

- `app/api/v1/events/route.ts`

Composition:

- `withRateLimit(...)`
- `withLogging(...)`
- `withErrorHandler(...)`

This is a wrapper/decorator style around route handlers rather than inline logic inside each route file.

### 8.4 Controller-Service-Repository Pattern

Used in `src/backend/*`.

Example chain:

- `src/backend/controllers/EventController.ts`
- `src/backend/services/EventService.ts`
- `src/backend/repositories/EventRepository.ts`
- `src/backend/entities/Event.ts`

This stack is the most formal DDD-style structure in the repo.

### 8.5 Abstract Repository + Mapping Pattern

Used in `lib/repositories/*`.

Base class:

- `lib/repositories/supabase-base-repository.ts:12`

Shared behaviors:

- snake_case -> camelCase transformation via `toCamelCaseKeys(...)` (`lib/repositories/supabase-base-repository.ts:28`)
- camelCase -> snake_case transformation via `toSnakeCaseKeys(...)` (`lib/repositories/supabase-base-repository.ts:44`)
- shared CRUD methods for Supabase-backed repositories

Concrete repositories using this pattern:

- `lib/repositories/supabase-event-repository.ts`
- `lib/repositories/supabase-booking-repository.ts`
- `lib/repositories/supabase-intake-repository.ts`

### 8.6 Domain Entity + State Machine Pattern

Used most clearly in `src/backend/entities/Event.ts`.

Observed behaviors:

- event state transitions are encoded in the entity
- methods such as `canTransitionTo`, `canSendProposal`, and `canApprove` are part of the domain object

A parallel domain-rule implementation also exists in `lib/domain/event.ts`, so the repo currently has two event-domain rule locations.

### 8.7 Server Action Facade Pattern

Used widely in `actions/*` and `lib/actions/*`.

Examples:

- `actions/events/create-event.ts`
- `lib/actions/intake-actions.ts`
- `lib/actions/vendor-actions.ts`

Pattern:

- UI calls a server action
- action performs auth lookup and orchestration
- action delegates to a repository/service or directly queries Supabase
- action ends with `revalidatePath(...)` and/or redirect

### 8.8 AsyncLocalStorage Request Context Pattern

Implemented in `lib/request-store.ts`.

Pattern:

- layout resolves auth once
- request-scoped context is stored with `AsyncLocalStorage`
- downstream server components consume `getRequestUserId()` or `getRequestSession()`

This is used to reduce repeated auth calls across streaming server-component boundaries.

### 8.9 Provider Pattern For Client-Side State

Used in:

- `components/providers/event-provider.tsx`
- `components/providers/quote-provider.tsx`

Pattern:

- React Context providers wrap the app
- state is persisted to localStorage
- components consume context via custom hooks

This is a UI-state pattern, not the main persistence pattern for business data.

### 8.10 Token-Gated Public Read Pattern

Used for client portal and proposal flows.

Observed design:

- public route receives a token in the URL
- action validates token against `events.client_token`, `events.public_token`, or `events.final_proposal_token`
- related data is fetched after the token lookup

Main implementation:

- `actions/client-portal.ts`

This pattern is combined with permissive RLS policies in some tables, so the token-validation code is a real part of the security model.

## 9. Architectural Observations

### 9.1 The System Has Two Active Backend Stacks

`src/backend/*` is the formal REST stack.

`lib/*` is the server-action/app stack.

Both are in production code paths. They are not just scaffolding.

### 9.2 Some Domain Areas Are Duplicated

Examples:

- event services in both `src/backend/services/EventService.ts` and `lib/services/event-service.ts`
- event repositories in both `src/backend/repositories/EventRepository.ts` and `lib/repositories/supabase-event-repository.ts`
- lead handling split between `leads` and `clients`
- rate limiting implemented in both `src/backend/middleware/rate-limit.middleware.ts` and `lib/rate-limit.ts`

This duplication is part of the actual architecture and affects ownership boundaries.

### 9.3 Some Scaffolding Exists But Is Not Clearly Active

Examples from this review:

- `src/frontend/*` contains API client/hooks, but I did not find current app imports into that layer
- `src/shared/*` exists as a shared re-export layer, but I did not find current app imports into it
- `src/backend/core/Container.ts` defines a DI container, but I did not find runtime resolution of services through it during this review

Those folders are part of the repository structure, but they are not major active runtime components based on the current import graph I observed.

## 10. Key Files To Read First

If a new engineer needs to understand the architecture quickly, these are the most useful files:

- `proxy.ts`
- `lib/session.ts`
- `lib/request-store.ts`
- `app/(dashboard)/layout.tsx`
- `app/api/v1/events/route.ts`
- `src/backend/controllers/EventController.ts`
- `src/backend/services/EventService.ts`
- `src/backend/repositories/EventRepository.ts`
- `src/backend/entities/Event.ts`
- `actions/dashboard.ts`
- `actions/client-portal.ts`
- `actions/vendor-updates.ts`
- `lib/actions/intake-actions.ts`
- `lib/actions/vendor-actions.ts`
- `lib/repositories/supabase-base-repository.ts`
- `lib/repositories/supabase-event-repository.ts`
- `lib/repositories/supabase-booking-repository.ts`
- `lib/repositories/supabase-intake-repository.ts`
- `supabase/migrations/057_proposal_snapshots.sql`
- `supabase/migrations/064_event_day_updates.sql`
- `supabase/migrations/065_client_portal.sql`
- `supabase/migrations/066_fix_intakes_rls.sql`

## 11. Bottom Line

The implemented system architecture is:

- Next.js App Router at the top
- `proxy.ts` and `lib/session.ts` as the main auth/session boundary
- a hybrid backend with both REST controllers in `src/backend/*` and server-action/service code in `lib/*`
- direct Supabase access in several business-critical flows
- Supabase as the real platform layer for auth, database, storage, and realtime

Any architecture work on this codebase should start by deciding whether future changes belong in:

- the REST stack (`src/backend/*`)
- the server-action stack (`actions/*`, `lib/*`)
- or both

because the repository currently uses all three execution styles in parallel.
