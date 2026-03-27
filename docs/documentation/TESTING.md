# PlannerOS Testing Guide

Last reviewed: 2026-03-27

## 1. Scope

This document is based on the current repository snapshot, including:

- `package.json`
- `vitest.config.ts`
- `tests/`
- `scripts/test_*.ts`
- `.github/workflows/*.yml`

## 2. Testing Stack

## 2.1 Primary framework

The checked-in automated test framework is:

- `Vitest` via `package.json` and `vitest.config.ts`

Supporting test libraries:

- `@testing-library/react`
- `@testing-library/jest-dom`
- `jsdom`
- `@vitejs/plugin-react`

Configured test environment from `vitest.config.ts`:

- environment: `jsdom`
- globals: `true`
- setup file: `tests/setup.ts`
- include pattern: `tests/**/*.test.ts`, `tests/**/*.test.tsx`

`tests/setup.ts` currently contains only:

- `import '@testing-library/jest-dom'`

That means DOM matchers are available, but the current checked-in tests do not actually exercise React components.

## 2.2 What is not configured

- Playwright
- Cypress
- Jest
- Storybook visual tests
- contract testing
- database migration test runner

There are no checked-in browser E2E tests or formal integration test harnesses.

## 3. How to Run Tests

From `package.json`:

```bash
npm test
npm run test:watch
npm run test:coverage
```

Current meanings:

- `npm test` runs `vitest run`
- `npm run test:watch` runs Vitest in watch mode
- `npm run test:coverage` runs `vitest run --coverage`

Additional script present:

```bash
npm run test:db
```

Important limitation:

- `test:db` points to `scripts/test-db-connection.ts`
- that file does not exist in the current repository snapshot
- so `npm run test:db` is broken as committed

## 4. Current Automated Test Inventory

The repository currently contains four automated test files under `tests/`:

- `tests/unit/domain/event.test.ts`
- `tests/unit/middleware/rate-limit.test.ts`
- `tests/unit/logger.test.ts`
- `tests/unit/utils/response.test.ts`

Observed automated test types:

- Unit tests: yes
- Integration tests: none under `tests/`
- End-to-end tests: none
- Component tests: none

## 5. Current Test Results

I ran the Vitest suite in this workspace.

Result:

- Test files: `4 passed`
- Individual tests: `42 passed`

Observed runtime summary:

- duration: about `5.77s`

## 6. Coverage Status

## 6.1 Configured coverage

`vitest.config.ts` configures coverage as:

- provider: `v8`
- reporters: `text`, `json`, `html`
- include globs:
  - `src/**`
  - `lib/**`
  - `actions/**`

## 6.2 Actual coverage availability

I also ran `npm run test:coverage`.

Current status:

- the command fails
- error: missing dependency `@vitest/coverage-v8`

Implication:

- coverage is configured in principle
- coverage is not currently runnable in the committed repository without adding the missing package
- there is no checked-in coverage report to use as a fallback

## 6.3 Effective tested surface

Even without a numeric coverage report, the tested surface is small and directly inferable from the test files.

Currently covered areas:

- `src/backend/entities/Event`
- `src/backend/middleware/rate-limit.middleware`
- `lib/logger`
- `src/backend/utils/response`

Currently uncovered or effectively unverified by automated tests:

- App Router pages and layouts in `app/`
- API routes in `app/api/*`
- server actions in `actions/*`
- server actions in `lib/actions/*`
- repositories in `src/backend/repositories/*`
- repositories in `lib/repositories/*`
- Supabase integrations
- auth/session flow in `proxy.ts` and `lib/session.ts`
- client portal token flows
- vendor portal workflows
- planner dashboard data aggregation
- database migrations and schema compatibility
- RLS-dependent behavior

## 7. Test Types Present

## 7.1 Unit tests

The current suite is entirely unit-level.

What is covered:

- domain logic and state transitions for the `Event` entity
- in-memory rate limiting behavior
- logger output behavior
- response helper formatting

These tests are fast and isolated. They do not require a live database.

## 7.2 Manual diagnostic scripts

The repository also contains several `scripts/test_*.ts` files, including:

- `scripts/test_rpc.ts`
- `scripts/test_rls_fix.ts`
- `scripts/test_minimal_save.ts`
- `scripts/test_minimal_event.ts`
- `scripts/test_intake_flow.ts`
- `scripts/test_event_creation.ts`
- `scripts/test_event_after_rls.ts`

These are not part of the automated test suite.

They behave more like manual verification scripts because they:

- load `.env.local`
- create direct Supabase clients
- hit live tables or RPCs
- log to the console
- are not included by Vitest
- are not run by CI

They are useful for debugging, but they should not be treated as repeatable CI-grade integration tests.

## 8. CI and Deployment Verification

The current GitHub Actions workflows do not run tests.

Observed workflows:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-staging.yml`
- `.github/workflows/deploy-production.yml`

All three verify:

- dependency install
- lint
- type check
- production build

None of them run:

- `npm test`
- `npm run test:coverage`

Important detail:

- lint is marked `continue-on-error: true`

So the deployment pipeline currently treats buildability as more important than either lint cleanliness or automated test execution.

## 9. Gaps

The main testing gaps in the current repository are:

- no automated integration tests for API routes, server actions, or repositories
- no end-to-end coverage for planner, vendor, admin, or client flows
- no component tests for critical UI forms and dashboards
- no test coverage for Supabase auth, RLS assumptions, or tokenized public routes
- no migration/schema compatibility tests despite clear schema drift in the repo
- no CI enforcement of `npm test`
- broken coverage command because `@vitest/coverage-v8` is missing
- broken `test:db` script because its target file is missing

## 10. What Should Be Tested Next

Highest-priority additions:

1. API route integration tests
   Cover `app/api/v1/*` handlers for events, leads, vendors, tasks, bookings, timeline, and payments.

2. Server action integration tests
   Cover `actions/*` and `lib/actions/*`, especially planner event creation, intake conversion, booking workflows, invoice creation, task creation, and client portal reads.

3. Auth and access-control tests
   Cover `proxy.ts`, `lib/session.ts`, and role-specific route protection for planner, vendor, admin, and token-based public routes.

4. Repository and schema-contract tests
   Cover the Supabase repositories against a controlled test database, especially the known drift areas:
   `tasks` vs `event_tasks`, `payments` vs `financial_payments`, `intakes` vs `event_intakes`, and `booking_requests` field mismatches.

5. Portal and proposal flow tests
   Cover client token resolution, proposal approval/change requests, client messages, and vendor updates shown in the client portal.

6. End-to-end smoke tests
   Add browser-level flows for:
   - planner login -> create event -> add function -> add budget -> create booking
   - vendor login -> view booking -> submit update
   - client token route -> read portal -> send message

7. Coverage and CI fixes
   - add `@vitest/coverage-v8`
   - make `npm run test:coverage` pass
   - run `npm test` in CI before staging and production deploys
   - either add `scripts/test-db-connection.ts` or remove `test:db`

## 11. Bottom Line

The repository has a real but narrow automated test setup:

- one framework: Vitest
- one automated test tier: unit tests
- four checked-in test files
- forty-two passing unit tests

The biggest risk is not that testing is absent, but that it is too shallow for the current system complexity. The product has multiple runtime paths, Supabase-backed auth/data flows, and schema drift across business domains, while the automated suite currently verifies only a small utility/domain slice.
