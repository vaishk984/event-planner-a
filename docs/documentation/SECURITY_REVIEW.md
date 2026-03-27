# Security Review

Static review date: 2026-03-27

Scope reviewed:
- `app/`
- `actions/`
- `lib/`
- `src/backend/`
- `supabase/migrations/`
- `vercel.json`

This document is based strictly on repository code and migrations. 

## Executive Summary

The repository uses Supabase Auth as its primary identity provider, but security decisions are split across multiple layers:
- `proxy.ts` protects route prefixes and refreshes SSR auth cookies.
- `lib/session.ts` derives the current app role from Supabase auth plus `vendors` and `user_profiles`.
- `src/backend/middleware/auth.middleware.ts` authenticates REST API calls separately and derives role from `user.user_metadata.role`.
- Supabase Row Level Security (RLS) in `supabase/migrations/` is expected to enforce record-level access.

The main security risk is not a single missing check. It is that authentication, role resolution, and authorization are implemented differently in different parts of the codebase.

Highest-risk findings from the code:
- Supabase auth cookies are intentionally readable by browser JavaScript, and `/api/auth/browser-session` returns access and refresh tokens to the browser.
- The `src/backend/*` REST stack authenticates requests, but its repositories create a new anonymous Supabase client instead of using the caller's JWT.
- Portal and intake flows rely on broad anonymous RLS policies such as `USING (true)` and then re-apply access rules in application code.
- Several server actions and some REST endpoints do not enforce ownership in code and therefore depend on current database policies to fail closed.

## Authentication Mechanism

### 1. Browser and dashboard authentication

Primary login flow:
- `app/api/auth/login/route.ts` signs users in with `supabase.auth.signInWithPassword`.
- After login it sets Supabase auth cookies on the response.
- `proxy.ts` protects `"/"`, `"/planner"`, `"/vendor"`, `"/admin"`, and `"/capture"` and redirects unauthenticated users to `/login`.
- `lib/supabase/server.ts` and `lib/session.ts` use `supabase.auth.getUser()` rather than trusting an unverified cookie payload.

Important implementation detail:
- Both `app/api/auth/login/route.ts` and `lib/supabase/server.ts` set Supabase auth cookies with `httpOnly: false`.
- The inline comment in `app/api/auth/login/route.ts` explicitly says this is done so the browser client can read the token from `document.cookie`.

### 2. Browser token bridge

The app also exposes a token bridge for client-side Supabase auth:
- `app/api/auth/browser-session/route.ts` returns `{ accessToken, refreshToken, expiresAt }` as JSON after checking the current SSR session.
- `components/auth/browser-session-bridge.tsx` fetches that route and calls `supabase.auth.setSession(...)` in the browser.

That means browser JavaScript is intentionally given both the access token and refresh token.

### 3. REST API authentication

The `src/backend/*` API stack uses its own middleware:
- `src/backend/middleware/auth.middleware.ts`

It authenticates by:
- reading `Authorization: Bearer <token>`, or
- reconstructing Supabase's chunked `sb-*-auth-token.*` cookies from the request,
- then calling `supabase.auth.getUser(token)`.

Important difference from the app session layer:
- `src/backend/middleware/auth.middleware.ts` sets role from `user.user_metadata.role || 'client'`.
- `lib/session.ts` derives role by checking `vendors.user_id` first, then `user_profiles.role`.

These two layers can disagree on the same user's role.

## Authorization Logic

### Route-level protection

`proxy.ts` is the first gate for page routes:
- Protected prefixes: `/planner`, `/vendor`, `/admin`, `/capture`
- Public prefixes: `/showroom`, `/client`, `/portal`, `/intake`, `/_next`
- Public API exceptions: `/api/auth/login`, `/api/v1/health`

`proxy.ts` only checks whether `supabase.auth.getUser()` returns a user. It does not enforce role-based routing beyond "authenticated vs unauthenticated".

### App session role resolution

`lib/session.ts` resolves app role like this:
1. authenticate with `supabase.auth.getUser()`
2. check whether a `vendors` row exists for `user_id = user.id`
3. otherwise fall back to `user_profiles.role`
4. create or update `user_profiles` and sometimes `planner_profiles`

This is the role source used by most App Router pages and many server actions.

### Admin authorization

`app/admin/layout.tsx` does not use `supabase.auth.getUser()` or `lib/session.ts`.

Instead it:
- reads a custom `session` cookie,
- runs `JSON.parse(session.value)`,
- checks `user.role === 'admin'`.

I did not find code in the current runtime that creates this `session` cookie. The active logout code deletes it in `actions/auth/login.ts` and `actions/auth/logout.ts`, but I did not find a corresponding setter.

This makes admin authorization inconsistent with the rest of the app and dependent on an unsigned cookie format rather than a verified Supabase user lookup.

### REST API authorization

The REST controllers in `src/backend/controllers/` are inconsistent:

Controllers that usually authenticate:
- `EventController`
- `BookingController`
- `TaskController`
- `MessageController`
- `FunctionController`

Controllers or methods that do not consistently authenticate:
- `TimelineController` methods do not call `authenticate()`
- `LeadController.getById/update/updateStatus/delete` do not call `authenticate()`
- `VendorController.list/getById/getVerified` are public by code design

Service-layer ownership checks are also inconsistent:
- `src/backend/services/EventService.ts` updates and deletes by record ID after only loading the event; it does not compare `plannerId` to the caller.
- `src/backend/services/LeadService.ts` updates, deletes, and converts leads by ID without caller ownership checks.
- `src/backend/services/TimelineService.ts` reads and mutates timeline items by ID, event ID, or function ID without caller ownership checks.
- `src/backend/services/VendorService.ts` updates and deletes vendors by ID without checking that the caller owns the vendor record.

### Database authorization (RLS)

The codebase relies heavily on Supabase RLS defined in `supabase/migrations/`.

Examples of planner/vendor scoped RLS:
- `supabase/migrations/002_rls_policies.sql`
- `supabase/migrations/009_rls_core_business_entities.sql`
- `supabase/migrations/021_fix_events_rls.sql`
- `supabase/migrations/064_event_day_updates.sql`

However, several later migrations intentionally widen anonymous access for public-link flows:
- `supabase/migrations/065_client_portal.sql`
- `supabase/migrations/066_fix_intakes_rls.sql`

## Data Validation

### Strong validation in the REST API layer

The `src/backend/*` API stack has a clear validation pattern:
- DTO schemas in `src/backend/dto/request/*.ts`
- Zod-based parsing in `src/backend/middleware/validation.middleware.ts`

Examples:
- `src/backend/dto/request/event.dto.ts`
- `src/backend/dto/request/lead.dto.ts`
- `src/backend/dto/request/task.dto.ts`
- `src/backend/dto/request/timeline.dto.ts`

This is the most structured validation path in the repository.

### Partial validation in server actions

Some server actions also validate input with Zod:
- `actions/leads.ts`
- `actions/tasks.ts`
- `actions/timeline.ts`
- `actions/vendors.ts`
- `actions/budget.ts`
- `actions/guests.ts`

### Weak or missing validation in public and mixed-trust server actions

Several important actions accept raw inputs with little or no schema validation:
- `actions/client-portal.ts`
- `actions/vendor-updates.ts`
- `lib/actions/intake-actions.ts`
- `actions/events/create-event.ts`
- `actions/auth/login.ts`
- `actions/notifications.ts`

Concrete examples:
- `actions/client-portal.ts` public mutation helpers such as `updateProposalStatus(...)` and `updateFinalProposalStatus(...)` accept `status: string` without Zod validation.
- `actions/client-portal.ts` `sendClientMessage(...)` only trims the message before inserting it.
- `actions/vendor-updates.ts` `uploadEventPhoto(...)` does not validate file size, MIME type, or extension allowlist before upload.
- `lib/actions/intake-actions.ts` accepts broad `Partial<Intake>` payloads and in `saveClientSubmission(...)` trusts caller-supplied `plannerId` if present.

### Sanitization

Sanitization helpers exist in `lib/validation.ts`:
- `sanitizeString`
- `sanitizeEmail`
- `sanitizePhone`
- `truncate`

Actual usage is limited. For example:
- `app/api/auth/login/route.ts` uses `sanitizeEmail(...)` and `truncate(...)`
- most server actions and controllers validate structure but do not sanitize free-text fields before storing them

I also searched the repository for `dangerouslySetInnerHTML` and did not find usage in `app/`, `components/`, `lib/`, `src/`, or `actions/` during this review. That reduces immediate reflected/stored XSS risk on the React rendering side, but it does not change the fact that user-provided text is generally stored without sanitization.

## Sensitive Data Handling

### Secrets and environment variables

Server-side secrets are referenced in server code and scripts:
- `RESEND_API_KEY` in `lib/services/email-service.ts`
- `SUPABASE_SERVICE_ROLE_KEY` in `src/backend/config/database.config.ts` and many `scripts/*`
- `JWT_SECRET` in `src/backend/config/auth.config.ts`

I did not find `SUPABASE_SERVICE_ROLE_KEY` being imported into browser/client code. That is good.

### Auth token handling

Sensitive auth data is deliberately exposed to browser JavaScript:
- `app/api/auth/login/route.ts` writes auth cookies with `httpOnly: false`
- `lib/supabase/server.ts` also writes Supabase cookies with `httpOnly: false`
- `app/api/auth/browser-session/route.ts` returns access and refresh tokens in JSON
- `components/auth/browser-session-bridge.tsx` hydrates the browser client with those tokens

This is the single most important sensitive-data decision in the repo.

### File uploads and public URLs

`actions/vendor-updates.ts` uploads event-day photos to Supabase Storage and then returns:
- `supabase.storage.from('event-photos').getPublicUrl(data.path)`

So the current design assumes photo assets are public URLs after upload.

### Logging

Sensitive or identifying data is written to logs in several places:
- `actions/auth/login.ts` logs signup `role`, `email`, `name`, and `categoryId`
- `lib/services/email-service.ts` logs recipient address and subject
- `src/backend/utils/logger.ts` includes error name, message, and stack in structured logs

The app logger in `lib/logger.ts` is more conservative and only includes short stack traces in development, but the backend logger in `src/backend/utils/logger.ts` does not have the same production redaction behavior.

## Security Controls Present

Controls that are visibly implemented in code:
- Authentication is based on verified Supabase users via `supabase.auth.getUser()`, not only on local cookie presence.
- `proxy.ts` adds `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- `vercel.json` also sets the same headers globally and adds `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- `vercel.json` sets `Cache-Control: no-store, must-revalidate` for `/api/*`.
- `app/api/auth/browser-session/route.ts` sets `Cache-Control: no-store, no-cache, must-revalidate` and `Pragma: no-cache`.
- `app/api/auth/login/route.ts` rate-limits login attempts by IP with `lib/rate-limit.ts`.
- `src/backend/middleware/error.middleware.ts` rate-limits wrapped API routes.

Important limitations of those controls:
- rate limiting is in-memory only and therefore approximate on multi-instance/serverless deployments
- I did not find a Content Security Policy (CSP)
- I did not find HSTS configuration
- I did not find a cross-cutting CSRF protection layer; the only explicit same-origin check I found is in `app/api/auth/browser-session/route.ts`

## Risk Register

### High Risk

| Finding | Evidence | Why it matters |
| --- | --- | --- |
| Browser JavaScript can read auth tokens and refresh tokens | `app/api/auth/login/route.ts`, `lib/supabase/server.ts`, `app/api/auth/browser-session/route.ts`, `components/auth/browser-session-bridge.tsx` | Any XSS in the app would be able to steal session credentials, not just act within the current tab. |
| REST API authentication is not bound to database authorization | `src/backend/middleware/auth.middleware.ts` authenticates the caller, but `src/backend/repositories/BaseRepository.ts` creates a new Supabase client with only `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` and does not pass the caller JWT | API auth and DB auth are decoupled. RLS rules based on `auth.uid()` cannot reliably protect these repository calls because the repository is not operating as the authenticated user. |
| Service-layer ownership checks are missing on several mutating REST code paths | `src/backend/services/EventService.ts`, `src/backend/services/LeadService.ts`, `src/backend/services/TimelineService.ts`, `src/backend/services/VendorService.ts` | Even where the controller authenticates, many operations still mutate by raw record ID without verifying that the caller owns the record. The code currently depends on database policy drift not creating an exposure. |
| Anonymous portal/intake RLS is broader than the application-level token checks | `supabase/migrations/065_client_portal.sql`, `supabase/migrations/066_fix_intakes_rls.sql` | Policies such as `USING (true)` on `client_messages`, `booking_requests`, `timeline_items`, `vendors`, and `event_intakes` make those tables readable or writable to anonymous callers. The app then tries to narrow access in code, which is fragile because any new query path can bypass the intended token filter. |
| Intake server actions expose broad read/update behavior on top of broad public RLS | `lib/actions/intake-actions.ts` exports `getIntake(id)`, `updateIntake(id, data)`, `submitIntake(id)`, and `saveClientSubmission(data)` without enforcing planner ownership or a token check; `saveClientSubmission(data)` prefers caller-supplied `plannerId` | Combined with `event_intakes` public `SELECT` and `UPDATE` policies in `supabase/migrations/066_fix_intakes_rls.sql`, this creates a concrete unauthorized read/update risk if an intake ID is known. |
| Vendor update writes do not verify that the vendor is actually assigned to the event | `actions/vendor-updates.ts` accepts caller-supplied `eventId`; `supabase/migrations/064_event_day_updates.sql` only checks that `vendor_id` belongs to `auth.uid()` | An authenticated vendor can submit updates against another event UUID if they can obtain it. The write policy does not require a booking or assignment relationship to that event. |

### Medium Risk

| Finding | Evidence | Why it matters |
| --- | --- | --- |
| Role resolution is inconsistent across app layers | `proxy.ts`, `lib/session.ts`, `src/backend/middleware/auth.middleware.ts`, `lib/actions/admin-actions.ts` | The same user can be treated differently depending on whether the request goes through App Router code, REST API middleware, or admin actions. This increases the chance of privilege drift and hard-to-debug authorization bugs. |
| Admin route protection trusts a custom cookie instead of verified Supabase auth | `app/admin/layout.tsx` | The admin layout reads and parses a `session` cookie directly and checks `user.role`. I did not find a runtime setter for this cookie, so the current admin gate is both inconsistent and brittle. |
| Some REST endpoints are effectively public by route code | `app/api/v1/timeline/route.ts`, `app/api/v1/timeline/[id]/route.ts`, `app/api/v1/timeline/[id]/status/route.ts`, `app/api/v1/timeline/reorder/route.ts`, `src/backend/controllers/TimelineController.ts`; also `src/backend/controllers/LeadController.ts` detail/update/delete/status methods skip `authenticate()` | The route/controller layer does not enforce authentication on these paths. Some of them may still fail closed because of database policy, but that is an implementation accident, not an explicit security design. |
| Validation is uneven in public-link and file-upload flows | `actions/client-portal.ts`, `actions/vendor-updates.ts`, `lib/actions/intake-actions.ts`, `actions/events/create-event.ts` | Integrity and abuse controls are weaker on the flows most likely to be internet-facing. The upload path especially lacks file-type and size checks. |
| Sensitive and identifying data is logged | `actions/auth/login.ts`, `lib/services/email-service.ts`, `src/backend/utils/logger.ts` | Production logs may contain signup PII, email metadata, and full error stacks. That increases blast radius if logs are shared widely or retained long-term. |
| Rate limiting does not cover server actions or public token flows | `lib/rate-limit.ts`, `app/api/auth/login/route.ts`, `src/backend/middleware/error.middleware.ts` | Public server actions such as intake submission, public proposal status updates, and client messages do not appear to have the same IP-based throttling as the REST API. |
| Security header baseline is incomplete | `proxy.ts`, `vercel.json` | Useful headers are present, but CSP and HSTS are absent from the repository configuration reviewed here. |

### Low / Latent Risk

| Finding | Evidence | Why it matters |
| --- | --- | --- |
| `JWT_SECRET` has a hardcoded fallback | `src/backend/config/auth.config.ts` | I did not find active custom JWT signing or verification code using this value, so this is currently a latent misconfiguration risk rather than a confirmed runtime exposure. It should still be removed before any custom JWT path is introduced. |

## Recommended Remediation Order

1. Stop exposing refresh tokens to browser JavaScript if at all possible.
   - Rework the browser auth bridge so tokens stay `httpOnly`.
   - If that is not immediately possible, treat XSS prevention and CSP as urgent follow-up work.

2. Unify authorization around one verified user and one role source.
   - Use the same role derivation path for App Router, admin pages, and REST APIs.
   - Replace `app/admin/layout.tsx` cookie parsing with verified Supabase session lookup.

3. Fix the `src/backend/*` REST stack so repositories operate with the caller's auth context.
   - Either pass the caller JWT into Supabase for repository calls, or move all record-level authorization checks into service code and verify ownership explicitly before every read/write.

4. Remove broad anonymous `USING (true)` RLS where possible.
   - Replace public read/write policies with token-bound SQL policies where feasible.
   - At minimum, tighten `event_intakes` and portal table policies before adding more public-link features.

5. Lock down mixed-trust server actions.
   - `lib/actions/intake-actions.ts` should verify planner ownership or a valid token before reading/updating by ID.
   - Do not trust caller-supplied `plannerId` for public submissions.

6. Add missing abuse controls.
   - Rate limit public server actions.
   - Validate upload MIME types, file size, and extension allowlists.
   - Validate public token mutations with Zod, especially status fields.

7. Reduce sensitive logging.
   - Remove PII from auth and email logs.
   - Standardize on one logger with clear production redaction rules.

## Bottom Line

The repository has real security controls in place, but they are fragmented across page routing, server actions, REST middleware, and database policies.

The most important engineering handover point is this:

Security in this codebase is currently policy-coupled, not architecture-coupled.

In practice that means a route is often safe only because the current Supabase RLS policy happens to reject a query, not because the application layer and data layer enforce the same authorization model. That is the main risk to address before expanding public-link flows, admin features, or the `src/backend/*` REST surface.
