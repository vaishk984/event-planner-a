# Design Decisions

## Scope

This document infers architectural intent from the current repository state. Where a file contains an explicit code comment explaining the reason for a choice, that is called out as explicit. Everything else is labeled as inference from implementation.

## Executive Summary

The codebase is optimized for product delivery on a small team rather than for strict architectural purity. The clearest decisions visible in code are:

- Next.js App Router is the primary application shell for pages, layouts, route handlers, and server actions.
- Supabase is the platform backend for authentication, Postgres, and file storage.
- The system is intentionally hybrid: some flows use server actions, some use `/api/v1/*` HTTP endpoints, and some talk to Supabase directly.
- The backend stack under `src/backend/*` follows a classic controller-service-repository pattern even though it runs inside a Next.js app.
- Request-scoped session caching was added specifically to work around Vercel/Next server rendering behavior.
- Parts of the older localStorage-based prototype were preserved while newer flows migrated to Supabase.

## 1. Next.js Was Chosen As The Application Shell

### Evidence

- `app/(dashboard)/layout.tsx` uses an App Router layout, calls `getSession()`, redirects unauthenticated users, and wraps children in `runWithRequestStore(...)`.
- `proxy.ts` is a Next.js 16 proxy that protects route prefixes, refreshes Supabase auth cookies, and adds security headers.
- `app/api/v1/leads/route.ts` shows the same framework is used for API route handlers as well as UI routes.
- `package.json` uses `next dev --turbopack`, `next build`, and `next start`.

### Inferred Reasoning

Next.js gives the project one framework for:

- SSR-protected dashboards
- server-side redirects
- API endpoints
- server actions tied directly to UI mutations
- deployment to Vercel without extra infrastructure glue

That choice fits the actual shape of the code better than a split frontend/backend repo would.

### Trade-offs

- The framework unifies many concerns, but it also encourages mixed patterns. This repo uses route handlers, server actions, and direct data access side by side.
- `app/(dashboard)/layout.tsx` exports `dynamic = 'force-dynamic'`, which favors correctness for per-user data over aggressive caching.
- The app depends heavily on Next runtime behavior, so portability to another hosting/runtime model would take work.

## 2. Supabase Was Chosen As The Platform Backend

### Evidence

- `lib/supabase/server.ts` and `lib/supabase/client.ts` create SSR and browser Supabase clients.
- `lib/session.ts` uses `supabase.auth.getUser()` as the source of authenticated identity.
- `actions/vendor-updates.ts` uploads event photos through `supabase.storage.from('event-photos')`.
- The repository contains a large `supabase/migrations/` directory, showing the schema is managed in-repo.
- `src/frontend/services/api-client.ts` reads the Supabase browser session and forwards the access token as a Bearer token.

### Inferred Reasoning

Supabase appears to have been chosen because it collapses several backend concerns into one platform:

- auth and session management
- Postgres access
- row-level security
- file storage
- a migration-driven schema

That reduces infrastructure surface area and fits a product team shipping quickly.

### Trade-offs

- The code is tightly coupled to Supabase APIs and auth behavior.
- Browser-side token usage required extra synchronization logic such as `components/auth/browser-session-bridge.tsx` and `app/api/auth/browser-session/route.ts`.
- Centralizing on Supabase simplifies delivery, but it makes the runtime model less cloud-agnostic.

## 3. The Architecture Is Deliberately Hybrid

### Evidence

- REST endpoints exist under `app/api/v1/*` and route into `src/backend/controllers/*`.
- Server actions exist in `actions/*`, for example `actions/dashboard.ts`, `actions/timeline.ts`, and `actions/vendor-updates.ts`.
- `lib/actions/shared-utils.ts` performs internal HTTP calls from server actions to `/api/v1/*`.
- `src/frontend/services/api-client.ts` performs browser-side HTTP calls to `/api/v1/*`.
- Many actions and pages also query Supabase directly through `createClient()`.

### ASCII View

```text
Browser
  |
  +--> App Router pages/layouts
  |       |
  |       +--> Server Components -> Supabase
  |       +--> Server Actions    -> Supabase
  |
  +--> Browser API client -> /api/v1/* -> controller -> service -> repository -> Supabase
```

### Inferred Reasoning

The project did not choose a single access pattern. The code suggests three different needs:

- UI-coupled mutations are easier to write as server actions with `revalidatePath(...)`.
- Some flows need stable HTTP endpoints for browser clients and possibly future integrations.
- Some pages need direct Supabase reads because that is the shortest path in App Router server code.

### Trade-offs

- This is flexible and pragmatic, but it increases duplication risk.
- The same business area can exist in more than one stack, which makes behavior drift more likely.
- Internal HTTP calls in `lib/actions/shared-utils.ts` preserve a clean API boundary, but they add an extra network hop inside the same app.

## 4. A Classical Layered Backend Was Built Inside Next.js

### Evidence

- `src/backend/core/Container.ts` explicitly describes itself as a simple IoC container and says it is similar to Spring's `ApplicationContext`.
- `app/api/v1/leads/route.ts` delegates to `leadController`.
- `src/backend/middleware/validation.middleware.ts` describes itself as similar to Spring's `@Valid` processing.
- The `src/backend/` tree is organized into `controllers`, `services`, `repositories`, `dto`, `middleware`, `exceptions`, and `core`.

### Inferred Reasoning

The team appears to have wanted backend code with explicit layers and testable boundaries rather than placing all logic directly in route files. That choice is consistent with:

- typed DTO validation
- reusable service logic
- data access encapsulation
- framework-like middleware composition

### Trade-offs

- The pattern improves separation of concerns.
- It also adds boilerplate in a codebase that already has server actions as another abstraction layer.
- The result is easier to reason about per layer, but harder to reason about globally because the repo contains both layered backend code and direct action-based logic.

## 5. Session Handling Was Tuned For Vercel And Streaming SSR

### Evidence

- `lib/request-store.ts` explicitly says the request store exists to solve a Vercel serverless issue where React `cache()` did not deduplicate across the layout-to-page streaming boundary.
- `lib/session.ts` explicitly comments that `cache()` is critical because repeated `getSession()` calls can fail after token rotation on Vercel's serverless runtime.
- `app/(dashboard)/layout.tsx` loads the session once, then seeds `runWithRequestStore(...)` for child code.
- `lib/data/queries.ts` and `actions/dashboard.ts` prefer the request-scoped session when present.

### ASCII View

```text
Request
  -> dashboard layout
     -> getSession() once
     -> runWithRequestStore(user context)
        -> child pages/components reuse request session
```

### Explicit Reasoning From Code Comments

This is not just inference. The code comments explicitly say the request store was added to avoid repeated auth calls failing across streamed boundaries on Vercel.

### Trade-offs

- This is a targeted performance and correctness optimization.
- It adds custom infrastructure that future maintainers must understand.
- The solution is tightly coupled to the current SSR/auth execution model.

## 6. The Repository Layer Shows An Incremental Migration Strategy

### Evidence

- `lib/repositories/base-repository.ts` says it "currently uses localStorage" and "will migrate to Supabase in Sprint D."
- `lib/repositories/supabase-base-repository.ts` defines the newer Supabase-backed repository base.
- `components/providers/event-provider.tsx` still keeps active event state in `localStorage`.
- `lib/repositories/supabase-event-repository.ts` is described as a production-ready Supabase replacement for the earlier event repository.

### Inferred Reasoning

The code strongly suggests the product started with faster local-state prototypes and then moved critical domains to Supabase. That would explain why some flows still use:

- localStorage-backed repositories
- client-side providers with optimistic local state
- newer server-backed repositories for more persistent workflows

### Trade-offs

- This approach reduces early delivery cost.
- It also leaves legacy persistence patterns in the codebase, which increases maintenance overhead and behavioral inconsistency.

## 7. UI Tooling Was Chosen For Composability And Planner-Specific Interactions

### Evidence

- `components/ui/dialog.tsx`, `components/ui/select.tsx`, and similar files wrap Radix primitives in local components.
- Those wrappers are styled through utility classes, which aligns with the Tailwind-based dependency setup in `package.json`.
- `components/tasks/kanban-board.tsx` and `app/(dashboard)/planner/events/[id]/timeline/timeline-client.tsx` use `@dnd-kit` sensors and sortable contexts.

### Inferred Reasoning

The UI stack appears to optimize for two things:

- accessible low-level primitives instead of a fully opinionated component library
- rich planner workflows such as drag-and-drop task movement and timeline ordering

Radix gives behaviorally solid primitives, while local wrappers preserve product-specific styling. `dnd-kit` is a strong fit for planner surfaces because those screens need pointer and keyboard drag interactions, not just static forms.

### Trade-offs

- This keeps the UI flexible, but the team owns more component composition code.
- Drag-and-drop improves usability, but it increases state-management complexity and failure handling requirements.
- In `actions/timeline.ts`, `reorderTimelineItems(...)` persists item order by looping through updates one row at a time, which is simple but not ideal for large lists or concurrent edits.

## 8. Validation Was Standardized More In The REST Stack Than In The Action Layer

### Evidence

- `src/backend/middleware/validation.middleware.ts` centralizes request parsing and Zod validation for route handlers.
- `actions/timeline.ts` also uses Zod, but validation is action-local rather than shared middleware.
- `src/backend/dto/request/lead.dto.ts`, `src/backend/dto/request/event.dto.ts`, and the rest of `src/backend/dto/request/*` show that the REST stack was built around typed request DTOs.

### Inferred Reasoning

The backend HTTP stack was designed for consistent validation contracts. Server actions were added later or more pragmatically, so they validate per workflow rather than through a shared action framework.

### Trade-offs

- The REST stack is more uniform.
- The server-action layer is faster to build but more likely to drift because validation patterns vary by file.

## 9. The Deployment Model Is Optimized For Vercel

### Evidence

- `vercel.json` declares `"framework": "nextjs"` and deploy region `bom1`.
- `vercel.json` sets security headers globally and `Cache-Control: no-store, must-revalidate` on `/api/*`.
- `proxy.ts` and `lib/request-store.ts` both contain logic tuned to Vercel/Next runtime behavior.
- `lib/actions/shared-utils.ts` explicitly handles host/protocol detection for both local development and Vercel.

### Inferred Reasoning

The project is not just compatible with Vercel; it is shaped around it. The runtime helpers show that deployment environment behavior influenced application design directly.

### Trade-offs

- This improves operational simplicity.
- It also means some runtime assumptions are platform-specific.

## Scalability Considerations

### What Already Scales Reasonably

- Supabase/Postgres is a better long-term base than the earlier localStorage repositories.
- The layered backend structure makes it possible to replace repository implementations without rewriting controllers.
- `actions/dashboard.ts` uses `Promise.all(...)` to parallelize several dashboard queries, which helps request latency.
- Request-scoped auth reuse avoids repeated session lookups on server-rendered dashboard requests.

### Current Scalability Limits Visible In Code

- `src/backend/middleware/rate-limit.middleware.ts` uses an in-memory `Map` and explicitly says Redis should replace it in production. That does not scale across multiple instances.
- `actions/timeline.ts` updates timeline order row by row in a loop. That is acceptable for MVP volume but inefficient for large timelines.
- The hybrid architecture means some domains have more than one write path. That is an organizational scalability issue as much as a runtime issue.
- LocalStorage-backed provider/repository code does not scale across devices or users and should be treated as legacy or draft-state behavior.

## Performance Optimizations Present In Code

### Request And Auth Path

- `lib/session.ts` wraps session retrieval in React `cache(...)`.
- `lib/request-store.ts` stores the resolved session once per request using `AsyncLocalStorage`.
- `proxy.ts` intentionally avoids constructing the Supabase SSR client on public routes to prevent unnecessary refresh work and accidental logout behavior.

### Data Fetching

- `actions/dashboard.ts` batches independent reads with `Promise.all(...)`.
- `getDashboardData()` only requests the columns it needs in several queries rather than selecting full rows everywhere.

### Rendering And Cache Correctness

- `app/(dashboard)/layout.tsx` forces dynamic rendering for authenticated dashboard content.
- `vercel.json` disables caching for `/api/*`, which favors freshness and auth correctness for mutable API responses.

### Client And Asset Behavior

- `package.json` uses `next dev --turbopack`, which improves local development iteration speed.
- `next.config.ts` restricts remote images to `images.unsplash.com`, reducing arbitrary remote image sources and keeping asset behavior predictable.
- `actions/vendor-updates.ts` uploads files with `cacheControl: '3600'` for stored event photos.

## Bottom Line

The dominant design choice in this repository is pragmatism: the team chose a stack that let it ship quickly with one deployable app, one backend platform, and a mix of interaction patterns suited to different workflows. The strongest implementation decisions are not abstract architectural ideals; they are concrete optimizations for authenticated dashboards, Vercel hosting, and iterative migration from prototype-state code to persistent Supabase-backed features.

The cost of those choices is visible too. The system is productive and adaptable, but it is not yet fully consolidated. Future engineering work should treat that hybridism as the main trade-off to either preserve intentionally or simplify over time.
