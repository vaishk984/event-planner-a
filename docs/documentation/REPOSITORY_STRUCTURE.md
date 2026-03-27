# Repository Structure

## How To Read This Repo

This repository is easiest to understand from the outside in:

1. Start with `app/` to see user-facing routes and API route handlers.
2. Follow `actions/` and `lib/` to understand server actions, shared app logic, auth, and Supabase access.
3. Follow `src/backend/` to understand the layered REST backend used by `app/api/v1/*`.
4. Use `components/`, `config/`, `types/`, and `src/shared/` as supporting layers.
5. Use `supabase/`, `tests/`, `.github/`, and root config files to understand data, testing, and deployment.

## Top-Level Map

```text
app/         Next.js App Router pages, layouts, and route handlers
actions/     Server actions used directly by UI workflows
components/  Shared UI, layout wrappers, and client-side providers
config/      Navigation and app-level static config
docs/        Handover, architecture, setup, and product docs
lib/         Shared runtime logic, repositories, services, auth, and utilities
public/      Static assets
scripts/     One-off diagnostics, data fixes, and investigation scripts
src/         Layered backend plus thin frontend/shared modules
supabase/    Database migrations and Supabase-specific notes
tests/       Vitest setup and unit tests
types/       Shared TypeScript types used outside `src/`
```

## `app/`

### Purpose

`app/` is the primary runtime entry point. It contains:

- page routes
- shared layouts
- public and protected route groups
- API route handlers under `app/api/*`

This is where Next.js App Router organizes the product surface.

### Key Files

- `app/layout.tsx`: root HTML shell; mounts `EventProvider`, `QuoteProvider`, and the global toaster.
- `app/page.tsx`: root redirect that sends authenticated users to `/${session.role}`.
- `app/globals.css`: global styling.
- `app/api/`: route handlers for auth and `/api/v1/*`.
- `app/(dashboard)/layout.tsx`: protected dashboard shell that loads the session once and seeds the request store.
- `app/(auth)/layout.tsx`: shared auth-page wrapper.

### How It Connects

- Calls into `components/` for UI and layout wrappers.
- Calls into `actions/` for server-side mutations and data loading.
- Calls into `lib/session.ts`, `lib/request-store.ts`, and `lib/supabase/*` for auth and data access.
- `app/api/v1/*` routes delegate into `src/backend/controllers/*`.

### Important Subfolders

#### `app/(auth)/`

Purpose: login, signup, and password-reset routes.

Key files:

- `app/(auth)/layout.tsx`
- `app/(auth)/login/`
- `app/(auth)/signup/`
- `app/(auth)/forgot-password/`

Connects to:

- `actions/auth/*`
- `app/api/auth/login/route.ts`
- `lib/session.ts`

#### `app/(dashboard)/`

Purpose: authenticated application shell for planner and client dashboard experiences.

Key files:

- `app/(dashboard)/layout.tsx`
- `app/(dashboard)/planner/page.tsx`
- `app/(dashboard)/planner/events/`
- `app/(dashboard)/planner/leads/`
- `app/(dashboard)/planner/tasks/`
- `app/(dashboard)/client/page.tsx`

Connects to:

- `components/layout/dashboard-wrapper.tsx`
- `actions/dashboard.ts`, `actions/leads.ts`, `actions/tasks.ts`, `actions/timeline.ts`
- `lib/request-store.ts`

#### `app/(showroom)/`

Purpose: public showroom browsing flow.

Key files:

- `app/(showroom)/layout.tsx`
- `app/(showroom)/showroom/`

Connects to:

- `components/showroom/*`
- `lib/services/vendor-service.ts`
- public-route handling in `proxy.ts`

#### `app/(intake)/`

Purpose: public intake/capture flows.

Key files:

- `app/(intake)/layout.tsx`
- `app/(intake)/intake/`

Connects to:

- `actions/*` and `lib/actions/intake-actions.ts`
- Supabase-backed intake repositories in `lib/repositories/*`
- public-route handling in `proxy.ts`

#### `app/(client)/`

Purpose: public or semi-public client-facing proposal/review routes outside the main dashboard shell.

Key files:

- `app/(client)/layout.tsx`
- `app/(client)/proposal/`
- `app/(client)/review/`
- `app/(client)/client/`

Connects to:

- `components/client-portal/*`
- `actions/client-portal.ts` and proposal-related logic in `lib/actions/*`

#### `app/vendor/`

Purpose: vendor-facing portal routes.

Key files:

- `app/vendor/layout.tsx`
- `app/vendor/page.tsx`
- `app/vendor/bookings/`
- `app/vendor/event-day/`
- `app/vendor/messages/`
- `app/vendor/profile/`

Connects to:

- `actions/vendor-updates.ts`
- vendor auth/session logic in `lib/session.ts`
- `components/layout/vendor-layout-wrapper.tsx`

#### `app/admin/`

Purpose: admin-specific routes and shells.

Key files:

- `app/admin/layout.tsx`
- `app/admin/page.tsx`
- `app/admin/planners/`
- `app/admin/vendors/`

Connects to:

- admin actions in `lib/actions/admin-actions.ts`
- auth gating in `proxy.ts`

#### `app/api/`

Purpose: all HTTP route handlers.

Key files:

- `app/api/auth/login/route.ts`
- `app/api/auth/browser-session/route.ts`
- `app/api/v1/health/route.ts`
- `app/api/v1/events/route.ts`
- `app/api/v1/leads/route.ts`
- `app/api/v1/timeline/route.ts`

Connects to:

- `src/backend/controllers/*` for `/api/v1/*`
- `lib/supabase/*` and `lib/session.ts` for auth/session routes
- `src/frontend/services/api-client.ts` and `lib/actions/shared-utils.ts`, which both consume `/api/v1/*`

## `actions/`

### Purpose

`actions/` contains Next.js server actions tied closely to product workflows. These are the functions most App Router pages call directly for form submissions, optimistic mutations, and `revalidatePath(...)`-driven refreshes.

### Key Files

- `actions/dashboard.ts`: dashboard aggregation and summary queries.
- `actions/timeline.ts`: timeline CRUD and reorder actions.
- `actions/vendor-updates.ts`: vendor event-day updates and photo uploads.
- `actions/leads.ts`: lead CRUD-style actions.
- `actions/tasks.ts`: task workflow operations.
- `actions/auth/login.ts`, `actions/auth/logout.ts`, `actions/auth/signup.ts`
- `actions/leads/create-lead.ts`: alternate lead creation path.

### How It Connects

- Used directly by `app/*` pages and `components/*`.
- Usually depends on `lib/session.ts` and `lib/supabase/server.ts`.
- Sometimes overlaps with `/api/v1/*`, which means some business areas exist both as server actions and as REST endpoints.

## `components/`

### Purpose

`components/` holds reusable UI, layout wrappers, client-side providers, and feature-specific components used across route groups.

### Key Files

- `components/layout/dashboard-wrapper.tsx`: main protected shell.
- `components/layout/sidebar.tsx`: navigation UI wired to role-based config.
- `components/providers/event-provider.tsx`: event state provider using local client storage.
- `components/providers/quote-provider.tsx`: quote/cart-like selection state.
- `components/auth/browser-session-bridge.tsx`: syncs SSR auth into the browser Supabase client.
- `components/ui/*`: design-system-style primitives such as `button.tsx`, `dialog.tsx`, `select.tsx`, `toast.tsx`.
- `components/tasks/kanban-board.tsx`: planner task drag-and-drop UI.

### How It Connects

- Rendered by `app/*` routes and layouts.
- Reads static metadata from `config/*`.
- Uses `actions/*` for mutations and `lib/*` utilities for formatting, session-aware hooks, and repositories.
- Providers mounted in `app/layout.tsx` influence state across the whole app.

### Important Subfolders

#### `components/ui/`

Purpose: shared low-level primitives and interaction components.

Key files:

- `components/ui/button.tsx`
- `components/ui/dialog.tsx`
- `components/ui/select.tsx`
- `components/ui/toaster.tsx`

Connects to:

- every route group through shared UI composition
- Tailwind-based styling in `app/globals.css`

#### `components/layout/`

Purpose: page shells and navigation wrappers.

Key files:

- `components/layout/dashboard-wrapper.tsx`
- `components/layout/vendor-layout-wrapper.tsx`
- `components/layout/admin-layout-wrapper.tsx`
- `components/layout/sidebar.tsx`

Connects to:

- `app/(dashboard)/layout.tsx`
- `app/vendor/layout.tsx`
- `app/admin/layout.tsx`
- `config/navigation.ts`

#### `components/providers/`

Purpose: client-side shared state providers.

Key files:

- `components/providers/event-provider.tsx`
- `components/providers/quote-provider.tsx`
- `components/providers/client-intake-provider.tsx`

Connects to:

- mounted from `app/layout.tsx`
- localStorage-backed repository/provider behavior in `lib/repositories/*`

## `config/`

### Purpose

`config/` stores static app metadata that should not live inside UI components.

### Key Files

- `config/navigation.ts`: planner, client, and vendor sidebar definitions.
- `config/roles.ts`: role constants and access metadata.
- `config/site.ts`: app/site metadata.

### How It Connects

- Consumed by `components/layout/sidebar.tsx` and layout wrappers.
- Helps keep role and navigation structure separate from rendering logic.

## `docs/`

### Purpose

`docs/` is the handover and planning area. It includes generated technical documentation, setup notes, architecture writeups, and product/planning material.

### Key Files

- `docs/ENGINEERING_HANDOVER.md`
- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/API_DOCUMENTATION.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/TESTING.md`
- `docs/SECURITY_REVIEW.md`
- `docs/ISSUES_AND_LIMITATIONS.md`

### How It Connects

- It does not drive runtime behavior.
- It is the reference layer for onboarding, investigation, and engineering handoff.
- `docs/planning/` and `docs/setup/` support broader project/process context.

## `lib/`

### Purpose

`lib/` is the shared application logic layer used across pages, server actions, and sometimes client components. It is the most important support folder outside `app/`.

### Key Files

- `lib/session.ts`: canonical server-side session lookup and role resolution.
- `lib/request-store.ts`: request-scoped auth/session cache for dashboard rendering.
- `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/auth.ts`: Supabase client creation.
- `lib/actions/shared-utils.ts`: internal HTTP helper for calling `/api/v1/*` from server actions.
- `lib/repositories/base-repository.ts`: older localStorage-backed repository base.
- `lib/repositories/supabase-base-repository.ts`: newer Supabase-backed repository base.
- `lib/services/event-service.ts`, `lib/services/vendor-service.ts`: app-side domain services.
- `lib/data/queries.ts`: shared read queries for pages and dashboard surfaces.

### How It Connects

- Used by `app/*`, `actions/*`, `components/*`, and `config/*`.
- Bridges the UI layer to Supabase and to the repository/service layer.
- Contains both legacy localStorage patterns and newer Supabase patterns, so it is a major source of cross-cutting architectural drift.

### Important Subfolders

#### `lib/supabase/`

Purpose: central Supabase client creation for browser and server contexts.

Key files:

- `lib/supabase/server.ts`
- `lib/supabase/client.ts`
- `lib/supabase/auth.ts`

Connects to:

- `lib/session.ts`
- `actions/*`
- `components/auth/browser-session-bridge.tsx`

#### `lib/repositories/`

Purpose: app-side data access abstractions.

Key files:

- `lib/repositories/base-repository.ts`
- `lib/repositories/event-repository.ts`
- `lib/repositories/supabase-event-repository.ts`
- `lib/repositories/supabase-vendor-repository.ts`
- `lib/repositories/intake-repository.ts`

Connects to:

- `lib/services/*`
- `components/providers/*`
- server actions and page data loaders

#### `lib/actions/`

Purpose: a second action/helper layer used by some app modules, distinct from the top-level `actions/` folder.

Key files:

- `lib/actions/event-actions.ts`
- `lib/actions/booking-actions.ts`
- `lib/actions/payment-actions.ts`
- `lib/actions/shared-utils.ts`

Connects to:

- `app/*` pages
- `/api/v1/*` via `shared-utils.ts`
- `lib/repositories/*` and `lib/supabase/*`

## `public/`

### Purpose

`public/` contains static assets served directly by Next.js.

### Key Files

- `public/next.svg`
- `public/vercel.svg`
- `public/globe.svg`

### How It Connects

- Referenced by UI components or pages when static assets are needed.
- This folder is currently small and not central to business logic.

## `scripts/`

### Purpose

`scripts/` is a toolbox of one-off operational, debugging, repair, and investigation scripts. It is not a clean application layer; it is an engineering support area.

### Key Files

- `scripts/check-connection.ts`
- `scripts/check-rls.mjs`
- `scripts/deduplicate_vendors.ts`
- `scripts/create_vendor_accounts.ts`
- `scripts/fix-getuser-timeouts.ts`
- `scripts/seed-vendors.ts`

### How It Connects

- Used manually by developers to inspect or patch Supabase data and auth state.
- Often targets tables defined in `supabase/migrations/*`.
- Some package scripts reference this folder, although not every helper here is wired into `package.json`.

## `src/`

### Purpose

`src/` holds the explicit layered architecture modules. In practice, `src/backend/` is the important part: it backs the `/api/v1/*` REST API.

### Key Files

- `src/backend/index.ts`: central export surface.
- `src/frontend/index.ts`: exports frontend service/hook modules.
- `src/shared/index.ts`: exports shared `src`-local types.

### How It Connects

- `app/api/v1/*` depends on `src/backend/*`.
- `src/frontend/services/*` can be used by browser-facing code that wants a typed HTTP client.
- `src/shared/*` provides types shared inside the `src` subtree.

### Important Subfolders

#### `src/backend/`

Purpose: layered backend implementation for the REST API.

Key files:

- `src/backend/controllers/EventController.ts`
- `src/backend/services/EventService.ts`
- `src/backend/repositories/EventRepository.ts`
- `src/backend/core/Container.ts`
- `src/backend/middleware/validation.middleware.ts`
- `src/backend/middleware/rate-limit.middleware.ts`

Connects to:

- `app/api/v1/*` route handlers
- Supabase and data access through repository classes
- DTOs in `src/backend/dto/*`

Substructure:

- `controllers/`: API-layer request handlers
- `services/`: business logic
- `repositories/`: data access layer
- `dto/`: request/response contracts
- `middleware/`: logging, validation, rate limiting, auth wrappers
- `core/`: container and infrastructure
- `config/`, `entities/`, `exceptions/`, `utils/`: supporting backend types and utilities

#### `src/frontend/`

Purpose: thin browser-oriented abstraction layer around the REST API.

Key files:

- `src/frontend/services/api-client.ts`
- `src/frontend/services/event-api.ts`
- `src/frontend/services/lead-api.ts`
- `src/frontend/services/task-api.ts`

Connects to:

- `/api/v1/*`
- browser Supabase session retrieval in `lib/supabase/client.ts`
- client-facing pages/components that prefer an HTTP client over direct server actions

#### `src/shared/`

Purpose: shared `src`-local types.

Key files:

- `src/shared/index.ts`
- `src/shared/types/*`

Connects to:

- backend and frontend modules inside `src/`

## `supabase/`

### Purpose

`supabase/` is the database and platform schema area. It defines the data model the rest of the application relies on.

### Key Files

- `supabase/migrations/*`: SQL migrations for schema, policies, indexes, and seed-like data.
- `supabase/README.md`: setup notes.
- `supabase/RLS_FIX_INSTRUCTIONS.md`: row-level security repair notes.

### How It Connects

- Queried by `lib/supabase/*`, `actions/*`, `lib/repositories/*`, and `src/backend/repositories/*`.
- The tables defined here are the source of truth for the data access code across the repo.

## `tests/`

### Purpose

`tests/` contains the automated test setup and current unit-test suite.

### Key Files

- `tests/setup.ts`: loads Testing Library DOM matchers.
- `tests/unit/logger.test.ts`
- `tests/unit/domain/event.test.ts`
- `tests/unit/middleware/rate-limit.test.ts`
- `tests/unit/utils/response.test.ts`

### How It Connects

- Configured by `vitest.config.ts`.
- Primarily targets code in `src/`, `lib/`, and `actions/`.
- This folder is small compared with the runtime code, so it is a good map of what is tested today and what is not.

## `types/`

### Purpose

`types/` contains shared TypeScript types used outside the `src/` module tree.

### Key Files

- `types/index.ts`
- `types/domain.ts`
- `types/dashboard.ts`

### How It Connects

- Imported by `config/*`, `lib/*`, `actions/*`, and components.
- Acts as a lighter-weight shared type layer parallel to `src/shared/*`.

## `.github/`

### Purpose

`.github/` contains CI/CD workflow definitions.

### Key Files

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-staging.yml`
- `.github/workflows/deploy-production.yml`

### How It Connects

- Executes linting, testing, or deployment automation outside the application runtime.
- Works alongside `vercel.json`, `package.json`, and the documented deployment setup.

## Generated And Dependency Folders

### `.next/`

Purpose: Next.js build output for the local workspace.

How it connects:

- Generated by `next dev` and `next build`.
- Not source code and should not be used as the authoritative implementation reference.

### `node_modules/`

Purpose: installed dependencies.

How it connects:

- Populated by `npm install`.
- Runtime behavior depends on it, but it is external dependency code, not project-authored code.

## Important Root Files

These files are not folders, but they are part of the repository structure and matter during onboarding:

- `package.json`: dependency list and npm scripts.
- `next.config.ts`: Next.js configuration.
- `proxy.ts`: auth-aware route protection and security headers.
- `instrumentation.ts`: runtime instrumentation hook.
- `vercel.json`: deployment headers and region config.
- `vitest.config.ts`: test runner configuration.
- `tsconfig.json`: TypeScript project configuration.
- `README.md`: primary onboarding entry point.

## Practical Reading Order For A New Developer

If you are new to the repo, the shortest useful path is:

1. Read `README.md`.
2. Read `app/layout.tsx`, `app/page.tsx`, and `proxy.ts`.
3. Read `app/(dashboard)/layout.tsx` and one planner feature route such as `app/(dashboard)/planner/events/`.
4. Read `actions/dashboard.ts` and one feature action such as `actions/timeline.ts`.
5. Read `lib/session.ts`, `lib/request-store.ts`, and `lib/supabase/server.ts`.
6. Read `app/api/v1/leads/route.ts`, then follow into `src/backend/controllers/`, `services/`, and `repositories/`.
7. Read `supabase/migrations/` only after you understand which runtime paths actually hit the database.

That sequence matches how the application executes in practice: routes first, then actions/shared logic, then the layered backend and database definitions underneath.
