# Issues And Limitations

Static review date: 2026-03-27

Scope reviewed:
- `app/`
- `actions/`
- `lib/`
- `src/backend/`
- `supabase/migrations/`

This is a static code review. Items below are either:
- concrete logic issues visible in code, or
- realistic failure modes implied directly by current implementation.

## Executive Summary

The repository does not behave like a single coherent stack. The same business area is often implemented more than once:
- App Router + server actions in `actions/*` and `lib/*`
- REST-style backend in `src/backend/*`
- direct Supabase queries from pages and repositories

That split is the main source of defects. Validation, ownership checks, schema assumptions, and performance behavior are not consistent across those paths.

Most important themes:
- several mutating actions rely on current RLS behavior instead of explicit ownership checks
- schema compatibility fallbacks are spread through business logic, especially invoices and portals
- some high-traffic operations use per-row update loops and repeated queries that will not scale well
- there are multiple paths for the same feature using different tables or different validation rules

## Highest-Impact Findings

| Severity | Issue | Evidence | Impact |
| --- | --- | --- | --- |
| High | REST backend repositories do not execute as the authenticated caller | `src/backend/middleware/auth.middleware.ts`, `src/backend/repositories/BaseRepository.ts` | The API authenticates the caller, but repository reads/writes use a fresh Supabase client created with anon credentials and no propagated JWT. Record-level behavior depends on current database policy and can drift unexpectedly. |
| High | Timeline actions and routes are under-guarded | `actions/timeline.ts`, `app/api/v1/timeline/route.ts`, `app/api/v1/timeline/[id]/route.ts`, `src/backend/controllers/TimelineController.ts` | Timeline create/update/delete/reorder paths do not consistently authenticate or verify ownership. Some rely on database policy to fail closed; others do not validate inputs at all. |
| High | Invoice creation is not transactional and invoice numbering is race-prone | `actions/invoices-tasks.ts` | Invoice number is derived from `count + 1`, which can collide under concurrent requests. Invoice row and invoice items are inserted separately, so item failure can leave a partial invoice behind. |
| Medium | Lead creation exists in two incompatible implementations | `actions/leads.ts`, `actions/leads/create-lead.ts` | One path writes to `clients` with Zod validation; another writes to `leads` without Zod validation. That split can produce inconsistent behavior, data location, and feature coverage. |
| Medium | Boolean query parsing can misread `"false"` as truthy | `src/backend/middleware/validation.middleware.ts`, `src/backend/dto/request/vendor.dto.ts`, `src/backend/dto/request/budget.dto.ts` | Query filters using `z.coerce.boolean()` receive strings from `searchParams`. In JavaScript boolean coercion, `"false"` is truthy, so some filters can behave opposite to caller intent. |

## Edge Cases Not Handled

### 1. Malformed admin session cookie can break the admin shell

Evidence:
- `app/admin/layout.tsx`

What happens:
- The code reads `cookieStore.get('session')`
- It immediately executes `JSON.parse(session.value)`
- There is no `try/catch`

Why this matters:
- A malformed or stale cookie can throw during layout render instead of redirecting cleanly.
- Admin access depends on a custom cookie format that is not verified in the same way as the main Supabase session flow.

### 2. Guest CSV import can partially succeed and stop midway

Evidence:
- `actions/guests.ts` -> `createGuestsBulk(...)`

What happens:
- Guests are inserted in batches of 50.
- If batch 3 fails, batches 1 and 2 remain committed.
- There is no rollback or compensation step.

Why this matters:
- Retrying the same import can create duplicates.
- The user gets a partial dataset but no atomic success/failure behavior.

### 3. Event creation through server actions does not require a valid date

Evidence:
- `actions/events/create-event.ts`
- `lib/domain/event.ts` -> `EventValidation.validate(...)`

What happens:
- The server action accepts `eventDate` as a raw string.
- `EventValidation.validate(...)` checks client name, phone, type, city, guest count, and budget range.
- It does not require `name` or `date`.

Why this matters:
- Missing or malformed dates are not rejected at validation time in this path.
- Failure is deferred to downstream database or UI behavior.
- This also differs from `src/backend/services/EventService.ts`, which rejects past dates explicitly.

### 4. Public proposal and portal flows repeat token lookups instead of sharing state

Evidence:
- `actions/client-portal.ts`

What happens:
- `getClientServices(...)`, `getClientUpdates(...)`, `getClientDayProgress(...)`, `getClientMessages(...)`, and related helpers all re-query `events` by token separately.

Why this matters:
- Pages that compose multiple helpers pay repeated database lookups for the same token.
- This is not a correctness bug by itself, but it becomes wasteful under traffic and makes edge-case behavior less predictable when data changes mid-request.

### 5. Query filters using boolean flags are fragile at the string boundary

Evidence:
- `src/backend/middleware/validation.middleware.ts`
- `src/backend/dto/request/vendor.dto.ts`
- `src/backend/dto/request/budget.dto.ts`
- similar usage in `message.dto.ts`, `payment.dto.ts`, `client.dto.ts`

What happens:
- Query params arrive as strings.
- Schemas use `z.coerce.boolean()`.

Why this matters:
- `?isVerified=false` or `?overBudgetOnly=false` can be parsed incorrectly depending on coercion behavior.
- This is a classic edge case that will surface as "filters seem wrong" rather than a hard error.

## Possible Bugs

### 1. Notification read path does not check the current user before update

Evidence:
- `actions/notifications.ts` -> `markNotificationRead(notificationId)`

What happens:
- The action updates `notifications` by `id` only.
- It does not load the current session or add `.eq('user_id', session.userId)` like `markAllNotificationsRead()` does.

Why this matters:
- It depends entirely on current RLS to prevent cross-user mutation.
- The action implementation is inconsistent with its own adjacent code.

### 2. Task completion path skips ownership verification

Evidence:
- `actions/tasks.ts` -> `completeTask(id)`

What happens:
- The code updates `tasks` by `id` immediately.
- Unlike `deleteTask(...)`, it does not fetch the task and verify `events.planner_id`.

Why this matters:
- If RLS or schema drift weakens the query path, the action can mutate the wrong task.
- This also makes the behavior inconsistent with other task actions.

### 3. Task update checks ownership after the update

Evidence:
- `actions/tasks.ts` -> `updateTask(formData)`

What happens:
- The action performs the update first.
- It then checks `taskWithEvent.events.planner_id !== session.userId`.

Why this matters:
- The authorization check is late.
- In a looser policy configuration, the mutation could already have happened before the action returns `Unauthorized`.

### 4. Guest update and delete paths do not verify event ownership

Evidence:
- `actions/guests.ts` -> `updateGuest(formData)`, `deleteGuest(id, eventId)`

What happens:
- `getGuests(...)` and `createGuest(...)` verify event ownership.
- `updateGuest(...)` and `deleteGuest(...)` do not.

Why this matters:
- Behavior is inconsistent inside the same module.
- These paths again depend on RLS rather than explicit code checks.

### 5. Timeline reorder paths ignore per-row update failures

Evidence:
- `actions/timeline.ts` -> `reorderTimelineItems(...)`
- `src/backend/repositories/TimelineRepository.ts` -> `updateSortOrders(...)`
- `src/backend/repositories/FunctionRepository.ts` -> `reorder(...)`

What happens:
- Updates are executed one by one.
- In `actions/timeline.ts`, the result of each update is not checked at all.

Why this matters:
- The action can return success even when one or more rows fail to update.
- Reorder operations can leave the list partially updated.

### 6. Timeline create/update/delete functions are not consistently authenticated

Evidence:
- `actions/timeline.ts`
- `app/api/v1/timeline/route.ts`
- `app/api/v1/timeline/[id]/route.ts`
- `app/api/v1/timeline/[id]/status/route.ts`
- `src/backend/controllers/TimelineController.ts`

What happens:
- `getTimelineData(...)` and `createTimelineItem(...)` require a session.
- `deleteTimelineItem(...)`, `deleteEventFunction(...)`, `updateTimelineItem(...)`, and `createEventFunction(...)` do not check session at all.
- The REST controller methods also omit `authenticate()`.

Why this matters:
- Same feature area behaves differently depending on which entry point is used.
- Bugs here are easy to introduce because the code gives the impression of being protected while only some paths are.

### 7. Invoice item insert failures are ignored

Evidence:
- `actions/invoices-tasks.ts` -> `createInvoice(...)`

What happens:
- The invoice row is inserted first.
- `invoice_items` are inserted afterwards.
- The result of `await supabase.from('invoice_items').insert(itemRows)` is not checked.

Why this matters:
- A request can create an invoice with no line items and still return success.
- This is a concrete partial-write bug, not just a theoretical limitation.

### 8. REST lead operations authenticate only some code paths

Evidence:
- `src/backend/controllers/LeadController.ts`

What happens:
- `list(...)`, `create(...)`, and `getHotLeads(...)` authenticate.
- `getById(...)`, `update(...)`, `updateStatus(...)`, `delete(...)`, and `convertToEvent(...)` do not.

Why this matters:
- Security behavior is method-dependent within one controller.
- Future refactors can easily assume protection that is not actually present.

### 9. Alternate lead creation path lacks basic validation

Evidence:
- `actions/leads/create-lead.ts`

What happens:
- Raw `FormData` is cast into `CreateLeadInput`.
- There is no Zod schema for required fields, email format, or budget/guest numeric sanity.

Why this matters:
- Invalid lead records can be created through one path while another path rejects the same payload.

## Performance Bottlenecks

### 1. Reorder operations use N individual updates

Evidence:
- `actions/timeline.ts` -> `reorderTimelineItems(...)`
- `src/backend/repositories/TimelineRepository.ts` -> `updateSortOrders(...)`
- `src/backend/repositories/FunctionRepository.ts` -> `reorder(...)`

Why this matters:
- Reordering 100 rows results in 100 update round-trips.
- This is slow on high-latency connections and leaves room for partial writes.

### 2. Event status counts run multiple separate count queries

Evidence:
- `src/backend/repositories/EventRepository.ts` -> `getStatusCounts(...)`

What happens:
- The repository loops through every status and issues a separate count query.

Why this matters:
- Dashboard-style pages pay repeated database round-trips for a small summary.
- This will scale poorly as the dashboard is refreshed more frequently.

### 3. Event approval does sequential task creation

Evidence:
- `src/backend/services/EventService.ts` -> `approve(...)`

What happens:
- Confirmed bookings are iterated one at a time.
- Each task is created in sequence inside the loop.

Why this matters:
- Large events with many vendors will have slower approval latency.
- Failure in the middle can leave a partially generated task set.

### 4. Invoice reads are fallback-heavy and query-heavy

Evidence:
- `actions/invoices-tasks.ts` -> `getInvoices(...)`, `getInvoicesByEvent(...)`

What happens:
- The code fetches invoices with joins.
- Then fetches events again for fallback ownership.
- Then fetches bookings for subtotal repair.
- Then merges and normalizes rows in memory.

Why this matters:
- The code is resilient to schema drift, but expensive.
- Invoice list performance will degrade as row counts increase.

### 5. Session reads can trigger write amplification

Evidence:
- `lib/session.ts` -> `ensureUserProfile(...)`

What happens:
- Session resolution may insert or update `user_profiles` and `planner_profiles` while determining display name and role.

Why this matters:
- Reads that perform writes are harder to reason about and cache.
- This increases database traffic on high-frequency session lookups.

## Missing Validations

### 1. File uploads have no file-type, size, or extension policy

Evidence:
- `actions/vendor-updates.ts` -> `uploadEventPhoto(formData)`

What is missing:
- MIME allowlist
- size limit
- extension allowlist
- image verification before upload

Why this matters:
- Bad uploads fail late or become storage abuse.
- The returned file is then exposed via a public URL.

### 2. Public proposal status updates accept arbitrary status strings

Evidence:
- `actions/client-portal.ts` -> `updateProposalStatus(...)`
- `actions/client-portal.ts` -> `updateFinalProposalStatus(...)`

What is missing:
- enum validation for `status`
- normalization of `feedback`
- abuse controls on repeated updates

Why this matters:
- The code trusts caller input more than other parts of the repo.
- This also makes behavior dependent on current database column constraints.

### 3. Invoice creation has no schema validation

Evidence:
- `actions/invoices-tasks.ts` -> `createInvoice(...)`

What is missing:
- validation for `eventId`
- validation for `dueDate`
- validation that `items` is non-empty
- validation that `quantity` and `rate` are positive finite numbers

Why this matters:
- Negative totals, invalid dates, or malformed line items are not rejected early.
- Failures are pushed into DB constraints or downstream calculations.

### 4. Timeline update path bypasses its own Zod schemas

Evidence:
- `actions/timeline.ts`

What happens:
- `createTimelineItem(...)` validates with Zod.
- `updateTimelineItem(...)` builds a raw update object with no schema parse.

Why this matters:
- Invalid status values, invalid times, and inconsistent field combinations can be written through the update path even though the create path is stricter.

### 5. Event validation does not require name or date in the app service path

Evidence:
- `actions/events/create-event.ts`
- `lib/domain/event.ts` -> `EventValidation.validate(...)`

Why this matters:
- Missing core event fields are not rejected in the server-action path.
- This is also inconsistent with the REST backend path in `src/backend/services/EventService.ts`.

### 6. Bulk guest creation explicitly skips per-row validation

Evidence:
- `actions/guests.ts` -> `createGuestsBulk(...)`

Comment in code:
- "let's assume client validated basic structure"

Why this matters:
- CSV imports are exactly the place where malformed rows are common.
- The code optimizes for speed by trusting the client.

## Structural Limitations

### 1. Feature duplication increases defect surface

Examples:
- lead creation in `actions/leads.ts` and `actions/leads/create-lead.ts`
- event creation in `actions/events/create-event.ts`, `lib/services/event-service.ts`, and `src/backend/services/EventService.ts`
- event repositories in `lib/repositories/supabase-event-repository.ts` and `src/backend/repositories/EventRepository.ts`

Why this matters:
- The same feature has different validation rules, different tables, and different error behavior depending on call path.
- Fixes in one stack do not automatically fix the others.

### 2. Legacy-schema compatibility logic is now part of business logic

Evidence:
- `actions/invoices-tasks.ts`
- `actions/client-portal.ts`

Why this matters:
- Compatibility fallbacks keep the app working, but they make the runtime harder to reason about.
- They also hide whether the real problem is bad data, missing columns, or an outdated table contract.

### 3. Authorization often depends on database policy instead of explicit code

Evidence:
- `actions/tasks.ts`
- `actions/guests.ts`
- `actions/timeline.ts`
- `actions/notifications.ts`
- `src/backend/controllers/TimelineController.ts`

Why this matters:
- The application layer does not consistently state who is allowed to do what.
- Safety depends on current RLS, current schema, and current client path lining up correctly.

## Bottom Line

The repo is functional, but it is not "done" in the sense of being uniformly hardened or internally consistent.

The biggest engineering limitation is not a single broken function. It is that correctness, validation, and ownership checks are distributed across multiple parallel implementations. That makes bugs more likely, makes regressions harder to predict, and forces the code to carry expensive fallback logic in hot paths.

If this were being stabilized for a product engineering handover, the most valuable next steps would be:
- collapse duplicate implementations per domain area
- make authorization explicit before every mutation
- replace per-row update loops with bulk operations or RPCs
- add Zod validation to every public or mixed-trust mutation path
- reduce legacy schema fallbacks by choosing one canonical table contract per feature
