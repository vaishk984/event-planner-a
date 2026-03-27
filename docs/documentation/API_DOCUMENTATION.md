# API Documentation

This document is generated from the route files under `app/api/auth` and `app/api/v1`, plus the controller, middleware, service, DTO, and entity code in `src/backend`.

## Scope

- Only endpoints with an actual route file under `app/api` are documented here.
- Controller methods with no route binding are intentionally excluded, even if they exist in `src/backend/controllers/*`.
- This is an implementation document, not an aspirational contract.

## Shared Conventions

- Authenticated endpoints use `authenticate()` in `src/backend/middleware/auth.middleware.ts`.
- `authenticate()` accepts either:
  - `Authorization: Bearer <token>`
  - Supabase auth cookies named like `sb-*-auth-token*`
- Most `app/api/v1/*` routes are wrapped with `withErrorHandler()` from `src/backend/middleware/error.middleware.ts`.
- `withErrorHandler()` applies the standard API rate limit from `RATE_LIMITS.api` and returns `429 RATE_LIMITED` when exceeded.
- Most non-timeline `v1` routes also use `withLogging()`, which adds `x-correlation-id` to the response.
- `app/api/auth/login/route.ts`, `app/api/auth/browser-session/route.ts`, and `app/api/v1/health/route.ts` do not use the standard API response helpers.

### Standard success envelope

```json
{
  "success": true,
  "data": {},
  "message": "optional"
}
```

### Standard paginated envelope

```json
{
  "success": true,
  "data": {
    "items": [],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "totalPages": 0
    }
  }
}
```

Some controllers pass `createPaginatedResponse()` output through the success wrapper, so `meta` may also include `hasNext` and `hasPrev`.

### Standard error envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": {}
  }
}
```

### Common error codes

- `400 VALIDATION_ERROR`: Zod body/query validation or explicit route/controller validation failure.
- `401 UNAUTHORIZED`: `authenticate()` could not resolve a valid user.
- `403 FORBIDDEN`: used by `browser-session` same-origin guard and by permission helpers when invoked.
- `404 NOT_FOUND`: entity lookup failed in the service/repository layer.
- `409 CONFLICT`: duplicate resource conflicts, currently used by vendor profile creation.
- `422 <business code>`: business-rule failure from `BusinessException`.
- `429 RATE_LIMITED`: standard API rate limit from `withErrorHandler()`.
- `500 INTERNAL_ERROR`: unhandled errors. A few endpoints currently fall into this path because they throw plain `Error` rather than `AppException`.

### Public vs authenticated routes

- `Required` means the route/controller calls `authenticate()`.
- `Public` means the current implementation does not call `authenticate()` for that endpoint.

### Routed vs non-routed backend methods

The following controller methods exist but do not have a matching `app/api` route file, so they are not part of the live API surface documented below:

- `EventController.sendProposal()`
- `EventController.approve()`
- `FunctionController.list()`
- `FunctionController.getById()`
- `FunctionController.create()`
- `FunctionController.update()`
- `FunctionController.delete()`
- `FunctionController.reorder()`
- `FunctionController.getTypes()`
- `LeadController.convertToEvent()`
- `MessageController.getUnread()`
- `MessageController.getUnreadCount()`
- `ClientController.recordEvent()`
- `BudgetController.getOverBudget()`
- `BudgetController.getRecommendedSplit()`
- `PaymentController.cancel()`
- `PaymentController.getTotals()`
- `PaymentController.getUpcoming()`
- `TaskController.getPending()`
- `BookingController.markMilestonePaid()`
- `BookingController.getPendingForVendor()`

## Authentication

### `POST /api/auth/login`

- Code references: `app/api/auth/login/route.ts`
- Description: Signs a user in with Supabase password auth, sets Supabase auth cookies, and either returns JSON or redirects based on the `Accept` header.
- Request body: `multipart/form-data`
  - `email` required
  - `password` required
- Response format:
  - JSON mode: `200 { "success": true, "redirectUrl": "/<role>" }`
  - Browser mode: `303` redirect to `/<role>`
  - Side effect: Supabase auth cookies are written to the response.
- Error responses:
  - `400` missing `email` or `password`
  - `400` invalid/sanitized-away email
  - `401` Supabase `signInWithPassword()` failure
  - `429` auth rate limit, with message including retry seconds
  - `500` missing Supabase env vars or unexpected login failure
- Authentication requirements: Public.

### `GET /api/auth/browser-session`

- Code references: `app/api/auth/browser-session/route.ts`, `lib/supabase/server.ts`
- Description: Returns the current Supabase browser session tokens so the client can bridge an existing cookie-backed session into token-based requests.
- Request body: None.
- Response format:

```json
{
  "accessToken": "string",
  "refreshToken": "string",
  "expiresAt": 0
}
```

- Error responses:
  - `403` if the `referer` host does not match the request `host`
  - `401` if there is no authenticated Supabase user or no active session
  - `500` unexpected failure
- Authentication requirements: Requires an existing Supabase session cookie. It does not use `authenticate()`, but it does require a valid server-side Supabase user session.

## System

### `GET /api/v1/health`

- Code references: `app/api/v1/health/route.ts`, `src/backend/config`
- Description: Returns a process-level health payload using backend config values.
- Request body: None.
- Response format:

```json
{
  "status": "healthy",
  "timestamp": "ISO-8601 datetime",
  "version": "string",
  "environment": "string"
}
```

- Error responses:
  - `500 { "status": "unhealthy", "error": "..." }`
- Authentication requirements: Public.

## Events

Implementation references:

- Routes: `app/api/v1/events/route.ts`, `app/api/v1/events/stats/route.ts`, `app/api/v1/events/today/route.ts`, `app/api/v1/events/upcoming/route.ts`, `app/api/v1/events/[id]/route.ts`, `app/api/v1/events/[id]/status/route.ts`
- Controller/service: `src/backend/controllers/EventController.ts`, `src/backend/services/EventService.ts`
- Validation/response DTOs: `src/backend/dto/request/event.dto.ts`, `src/backend/dto/response/event.response.ts`

### Event response shapes

- `EventResponseDto`: `id`, `plannerId`, `clientId?`, `name`, `type`, `status`, `date`, `endDate?`, `guestCount`, `budget { min, max, average }`, `city`, `venueType`, `venueId?`, `notes?`, `isLocked`, `isEditable`, `daysUntilEvent`, `createdAt`, `updatedAt`
- `EventListResponseDto`: `id`, `name`, `type`, `status`, `date`, `city`, `guestCount`, `budgetAverage`, `daysUntilEvent`
- `EventStatsResponseDto`: `total`, `byStatus`, `upcomingCount`, `todayCount`

### `GET /api/v1/events`

- Description: Lists events for the authenticated planner via `EventService.getByPlanner()`.
- Query params:
  - `status?`
  - `type?`
  - `dateFrom?`
  - `dateTo?`
  - `city?`
  - `page?=1`
  - `limit?=20`
  - `sortBy?=date|createdAt|name|status`
  - `sortOrder?=asc|desc`
- Request body: None.
- Response format: `200 { success: true, data: { items: EventListResponseDto[], meta: { page, limit, total, totalPages, hasNext, hasPrev } } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.
- Implementation note: `QueryEventsSchema` accepts `status`, `type`, `dateFrom`, `dateTo`, and `city`, but `EventService.getByPlanner()` currently only forwards pagination/sort data to the repository.

### `POST /api/v1/events`

- Description: Creates a new draft event for the authenticated planner.
- Request body: `CreateEventSchema`
  - `name` required
  - `type` required: `wedding | corporate | birthday | social | other`
  - `date` required: ISO-8601 datetime
  - `endDate?`: ISO-8601 datetime
  - `guestCount` required
  - `budgetMin` required
  - `budgetMax` required
  - `city` required
  - `venueType?`: `personal | showroom`, default `personal`
  - `venueId?`: UUID
  - `notes?`
  - Validation rule: `budgetMax >= budgetMin`
- Response format: `201 { success: true, data: EventResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `422 INVALID_DATE` if the event date is in the past
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/events/stats`

- Description: Returns event dashboard counts for the authenticated planner.
- Request body: None.
- Response format: `200 { success: true, data: EventStatsResponseDto }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/events/upcoming`

- Description: Returns upcoming events for the authenticated planner.
- Request body: None.
- Response format: `200 { success: true, data: EventListResponseDto[] }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/events/today`

- Description: Returns events occurring today for the authenticated planner.
- Request body: None.
- Response format: `200 { success: true, data: EventListResponseDto[] }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/events/{id}`

- Description: Returns one event by UUID.
- Request body: None.
- Response format: `200 { success: true, data: EventResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR` for non-UUID `id`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `PUT /api/v1/events/{id}`

- Description: Updates mutable event fields.
- Request body: `UpdateEventSchema`
  - Any subset of `name`, `type`, `date`, `endDate`, `guestCount`, `budgetMin`, `budgetMax`, `city`, `venueType`, `venueId`, `notes`
- Response format: `200 { success: true, data: EventResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `422 EVENT_LOCKED` if the current event status makes the event non-editable
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `DELETE /api/v1/events/{id}`

- Description: Deletes an event.
- Request body: None.
- Response format: `200 { success: true, data: { deleted: true, id: "uuid" } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `422 CANNOT_DELETE` unless the event is still in `draft`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `PATCH /api/v1/events/{id}/status`

- Description: Transitions an event to a new status.
- Request body: `{ "status": "draft|planning|proposed|approved|live|completed|archived|cancelled" }`
- Response format: `200 { success: true, data: EventResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `422 INVALID_STATUS_TRANSITION`
  - `429 RATE_LIMITED`
- `500 INTERNAL_ERROR`
- Authentication requirements: Required.

## Budget

Implementation references:

- Routes: `app/api/v1/budget/route.ts`, `app/api/v1/budget/categories/route.ts`, `app/api/v1/budget/[id]/route.ts`, `app/api/v1/budget/[id]/payment/route.ts`, `app/api/v1/events/[id]/budget/route.ts`, `app/api/v1/events/[id]/budget/summary/route.ts`
- Controller/service: `src/backend/controllers/BudgetController.ts`, `src/backend/services/BudgetService.ts`
- Validation/entity types: `src/backend/dto/request/budget.dto.ts`, `src/backend/entities/BudgetItem.ts`

### Budget response shapes

- `BudgetItem`: `id`, `eventId`, `functionId`, `category`, `description`, `vendorId`, `bookingRequestId`, `estimatedAmount`, `actualAmount`, `paidAmount`, `currency`, `notes`, `createdAt`, `updatedAt`
- `BudgetSummary`: `totalEstimated`, `totalActual`, `totalPaid`, `remaining`, `byCategory`, `overBudgetItems`

### `GET /api/v1/events/{id}/budget`

- Description: Lists all budget items for an event.
- Request body: None.
- Response format: `200 { success: true, data: BudgetItem[] }`
- Error responses:
  - `400 VALIDATION_ERROR` for non-UUID event ID
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/events/{id}/budget/summary`

- Description: Returns aggregate budget totals and category breakdowns for an event.
- Request body: None.
- Response format: `200 { success: true, data: BudgetSummary }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `POST /api/v1/budget`

- Description: Creates a budget item.
- Request body: `CreateBudgetItemSchema`
  - `eventId` required
  - `functionId?`
  - `category` required
  - `description` required
  - `vendorId?`
  - `bookingRequestId?`
  - `estimatedAmount` required
  - `actualAmount?`
  - `currency?`, default `INR`
  - `notes?`
- Response format: `201 { success: true, data: BudgetItem }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/budget/categories`

- Description: Returns the static budget category list defined in `BudgetService.getCategories()`.
- Request body: None.
- Response format: `200 { success: true, data: Array<{ value, label }> }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/budget/{id}`

- Description: Returns one budget item by UUID.
- Request body: None.
- Response format: `200 { success: true, data: BudgetItem }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `PUT /api/v1/budget/{id}`

- Description: Updates a budget item.
- Request body: `UpdateBudgetItemSchema`
  - Any subset of `description`, `estimatedAmount`, `actualAmount`, `paidAmount`, `vendorId`, `bookingRequestId`, `notes`
- Response format: `200 { success: true, data: BudgetItem }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `DELETE /api/v1/budget/{id}`

- Description: Deletes a budget item.
- Request body: None.
- Response format: `200 { success: true, data: { deleted: true, id: "uuid" } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `POST /api/v1/budget/{id}/payment`

- Description: Adds a payment amount to a budget item’s running `paidAmount`.
- Request body: `{ "amount": number, "notes?": string }`
- Response format: `200 { success: true, data: BudgetItem }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

## Vendors

Implementation references:

- Routes: `app/api/v1/vendors/route.ts`, `app/api/v1/vendors/verified/route.ts`, `app/api/v1/vendors/me/route.ts`, `app/api/v1/vendors/[id]/route.ts`
- Controller/service: `src/backend/controllers/VendorController.ts`, `src/backend/services/VendorService.ts`
- Validation: `src/backend/dto/request/vendor.dto.ts`

### Vendor response shape

- `VendorResponseDto`: `id`, `userId?`, `companyName`, `category`, `description?`, `location`, `priceRange { min, max }`, `rating`, `reviewCount`, `isVerified`, `imageUrl?`, `portfolioUrls`, `priceLevel`, `createdAt`, `updatedAt`

### `GET /api/v1/vendors`

- Description: Public vendor search/list endpoint.
- Query params:
  - `category?`
  - `location?`
  - `maxPrice?`
  - `minRating?`
  - `isVerified?`
  - `search?`
  - `page?=1`
  - `limit?=20`
  - `sortBy?=rating|priceMin|createdAt|companyName`
  - `sortOrder?=asc|desc`
- Request body: None.
- Response format: `200 { success: true, data: { items: VendorResponseDto[], meta: { page, limit, total, totalPages, hasNext, hasPrev } } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.
- Implementation note: `QueryVendorsSchema` accepts `search`, but `VendorService.search()` currently does not pass a text-search term to the repository.

### `POST /api/v1/vendors`

- Description: Creates a vendor profile for the authenticated user.
- Request body: `CreateVendorSchema`
  - `companyName` required
  - `category` required
  - `description?`
  - `location` required
  - `priceMin` required
  - `priceMax` required
  - `imageUrl?`
  - `portfolioUrls?`
  - Validation rule: `priceMax >= priceMin`
- Response format: `201 { success: true, data: VendorResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `409 CONFLICT` if the user already has a vendor profile
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/vendors/verified`

- Description: Returns all verified vendors.
- Request body: None.
- Response format: `200 { success: true, data: VendorResponseDto[] }`
- Error responses:
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `GET /api/v1/vendors/me`

- Description: Returns the current authenticated user’s vendor profile.
- Request body: None.
- Response format:
  - `200 { success: true, data: VendorResponseDto }`
  - `200 { success: true, data: null, message: "No vendor profile found" }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/vendors/{id}`

- Description: Returns one vendor by UUID.
- Request body: None.
- Response format: `200 { success: true, data: VendorResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `PUT /api/v1/vendors/{id}`

- Description: Updates a vendor profile.
- Request body: `UpdateVendorSchema`
  - Any subset of `companyName`, `category`, `description`, `location`, `priceMin`, `priceMax`, `imageUrl`, `portfolioUrls`
- Response format: `200 { success: true, data: VendorResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `DELETE /api/v1/vendors/{id}`

- Description: Deletes a vendor profile.
- Request body: None.
- Response format: `200 { success: true, data: { deleted: true, id: "uuid" } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

## Leads

Implementation references:

- Routes: `app/api/v1/leads/route.ts`, `app/api/v1/leads/hot/route.ts`, `app/api/v1/leads/[id]/route.ts`, `app/api/v1/leads/[id]/status/route.ts`
- Controller/service: `src/backend/controllers/LeadController.ts`, `src/backend/services/LeadService.ts`
- Validation: `src/backend/dto/request/lead.dto.ts`

### Lead response shape

- `LeadResponseDto`: `id`, `plannerId`, `name`, `email`, `phone?`, `eventType`, `budgetRange?`, `eventDate?`, `source`, `score`, `status`, `notes?`, `isHotLead`, `priorityLevel`, `createdAt`, `updatedAt`

### `GET /api/v1/leads`

- Description: Lists leads for the authenticated planner.
- Query params:
  - `status?`
  - `source?`
  - `minScore?`
  - `search?`
  - `page?=1`
  - `limit?=20`
  - `sortBy?=createdAt|score|name|status`
  - `sortOrder?=asc|desc`
- Request body: None.
- Response format: `200 { success: true, data: { items: LeadResponseDto[], meta: { page, limit, total, totalPages, hasNext, hasPrev } } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.
- Implementation note: the schema accepts `status`, `source`, `minScore`, and `search`, but `LeadService.getByPlanner()` currently only forwards pagination and sort settings to the repository.

### `POST /api/v1/leads`

- Description: Creates a new lead for the authenticated planner.
- Request body: `CreateLeadSchema`
  - `name` required
  - `email` required
  - `phone?`
  - `eventType` required
  - `budgetRange?`
  - `eventDate?`: ISO-8601 datetime
  - `source` required
  - `notes?`
- Response format: `201 { success: true, data: LeadResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/leads/hot`

- Description: Returns hot leads for the authenticated planner.
- Request body: None.
- Response format: `200 { success: true, data: LeadResponseDto[] }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/leads/{id}`

- Description: Returns one lead by UUID.
- Request body: None.
- Response format: `200 { success: true, data: LeadResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public. The current implementation does not call `authenticate()` for this route.

### `PUT /api/v1/leads/{id}`

- Description: Updates a lead.
- Request body: `UpdateLeadSchema`
  - Any subset of `name`, `email`, `phone`, `eventType`, `budgetRange`, `eventDate`, `source`, `status`, `score`, `notes`
- Response format: `200 { success: true, data: LeadResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public. The current implementation does not call `authenticate()` for this route.

### `DELETE /api/v1/leads/{id}`

- Description: Deletes a lead.
- Request body: None.
- Response format: `200 { success: true, data: { deleted: true, id: "uuid" } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public. The current implementation does not call `authenticate()` for this route.

### `PATCH /api/v1/leads/{id}/status`

- Description: Transitions a lead to a new status.
- Request body: `{ "status": "new|contacted|qualified|proposal_sent|converted|lost" }`
- Response format: `200 { success: true, data: LeadResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
  - `422 INVALID_TRANSITION`
  - `429 RATE_LIMITED`
- `500 INTERNAL_ERROR`
- Authentication requirements: Public. The current implementation does not call `authenticate()` for this route.

## Clients

Implementation references:

- Routes: `app/api/v1/clients/route.ts`, `app/api/v1/clients/high-value/route.ts`, `app/api/v1/clients/stats/route.ts`, `app/api/v1/clients/[id]/route.ts`
- Controller/service: `src/backend/controllers/ClientController.ts`, `src/backend/services/ClientService.ts`
- Validation/entity types: `src/backend/dto/request/client.dto.ts`, `src/backend/entities/Client.ts`

### Client response shape

- `Client`: `id`, `plannerId`, `name`, `email`, `phone`, `alternatePhone`, `status`, `address`, `city`, `state`, `preferences`, `totalEvents`, `totalSpend`, `currency`, `referralSource`, `notes`, `createdAt`, `updatedAt`

### `GET /api/v1/clients`

- Description: Lists clients for the authenticated planner.
- Query params:
  - `status?`
  - `city?`
  - `search?`
  - `highValueOnly?`
  - `page?=1`
  - `limit?=20`
- Request body: None.
- Response format: `200 { success: true, data: Client[] }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.
- Implementation note: the controller only branches on `search`, `status`, and `highValueOnly`. `city`, `page`, and `limit` are accepted by the schema but not used in the current implementation.

### `POST /api/v1/clients`

- Description: Creates a new client.
- Request body: `CreateClientSchema`
  - `name` required
  - `email?`
  - `phone?`
  - `alternatePhone?`
  - `address?`
  - `city?`
  - `state?`
  - `preferences?`
  - `referralSource?`
  - `notes?`
- Response format: `201 { success: true, data: Client }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.
- Implementation note: duplicate-email detection currently throws a plain `Error` in `ClientService.create()`, so a duplicate email surfaces as `500 INTERNAL_ERROR`, not `409 CONFLICT`.

### `GET /api/v1/clients/high-value`

- Description: Returns high-value clients for the authenticated planner.
- Request body: None.
- Response format: `200 { success: true, data: Client[] }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/clients/stats`

- Description: Returns CRM counts and revenue totals for the authenticated planner.
- Request body: None.
- Response format: `200 { success: true, data: { total, active, prospects, totalRevenue } }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/clients/{id}`

- Description: Returns one client by UUID.
- Request body: None.
- Response format: `200 { success: true, data: Client }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `PUT /api/v1/clients/{id}`

- Description: Updates a client record.
- Request body: `UpdateClientSchema`
  - Any subset of `name`, `email`, `phone`, `alternatePhone`, `address`, `city`, `state`, `status`, `preferences`, `notes`
- Response format: `200 { success: true, data: Client }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `DELETE /api/v1/clients/{id}`

- Description: Deletes a client record.
- Request body: None.
- Response format: `200 { success: true, data: { deleted: true, id: "uuid" } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

## Bookings

Implementation references:

- Routes: `app/api/v1/bookings/route.ts`, `app/api/v1/bookings/stats/route.ts`, `app/api/v1/bookings/[id]/route.ts`, `app/api/v1/bookings/[id]/accept/route.ts`, `app/api/v1/bookings/[id]/cancel/route.ts`, `app/api/v1/bookings/[id]/decline/route.ts`, `app/api/v1/bookings/[id]/submit-quote/route.ts`
- Controller/service/entity: `src/backend/controllers/BookingController.ts`, `src/backend/services/BookingService.ts`, `src/backend/entities/BookingRequest.ts`
- Validation: `src/backend/dto/request/booking.dto.ts`

### Booking response shape

- `BookingRequest`: `id`, `eventId`, `functionId`, `vendorId`, `plannerId`, `status`, `service`, `serviceDetails`, `quotedAmount`, `agreedAmount`, `currency`, `paymentSchedule`, `requestedDate`, `responseDate`, `confirmationDate`, `notes`, `internalNotes`, `createdAt`, `updatedAt`
- `paymentSchedule[]` items: `id`, `name`, `amount`, `dueDate`, `paidDate`, `status`

### `GET /api/v1/bookings`

- Description: Lists bookings for the authenticated user.
- Query params:
  - `eventId?`
  - `vendorId?`
  - `plannerId?`
  - `status?`
  - `page?=1`
  - `limit?=20`
- Request body: None.
- Response format: `200 { success: true, data: BookingRequest[] }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.
- Implementation note: only `eventId` changes behavior. If `eventId` is absent, the controller always returns `getActiveForPlanner(auth.user.id)`. `vendorId`, `plannerId`, `status`, `page`, and `limit` are validated but currently ignored.

### `POST /api/v1/bookings`

- Description: Creates a booking request from planner to vendor.
- Request body: `CreateBookingRequestSchema`
  - `eventId` required
  - `functionId?`
  - `vendorId` required
  - `serviceCategory` required
  - `serviceDetails?`
  - `notes?`
- Response format: `201 { success: true, data: BookingRequest }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/bookings/stats`

- Description: Returns booking counts by booking status for the authenticated planner.
- Request body: None.
- Response format: `200 { success: true, data: Record<BookingStatus, number> }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/bookings/{id}`

- Description: Returns one booking by UUID.
- Request body: None.
- Response format: `200 { success: true, data: BookingRequest }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `PUT /api/v1/bookings/{id}`

- Description: Updates planner notes/details on a booking request.
- Request body: `UpdateBookingRequestSchema`
  - Any subset of `serviceDetails`, `notes`, `internalNotes`
- Response format: `200 { success: true, data: BookingRequest }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `POST /api/v1/bookings/{id}/submit-quote`

- Description: Vendor-side quote submission for a booking request.
- Request body: `SubmitQuoteSchema`
  - `amount` required
  - `notes?`
  - `paymentSchedule?`
- Response format: `200 { success: true, data: BookingRequest }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `422 BUSINESS_ERROR` if the booking is not in `quote_requested`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `POST /api/v1/bookings/{id}/accept`

- Description: Planner-side quote acceptance.
- Request body: `AcceptQuoteSchema`
  - `agreedAmount?`
  - `paymentSchedule?`
- Response format: `200 { success: true, data: BookingRequest }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.
- Implementation note: invalid state transitions currently throw a plain `Error` from `BookingRequest.acceptQuote()`, so they surface as `500 INTERNAL_ERROR` rather than `422`.

### `POST /api/v1/bookings/{id}/decline`

- Description: Declines a booking/quote.
- Request body: optional JSON body with `{ "reason?": "string" }`
- Response format: `200 { success: true, data: BookingRequest }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `400 VALIDATION_ERROR` for non-UUID `id`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.
- Implementation note: invalid state transitions currently throw a plain `Error` from `BookingRequest.transitionTo()`, so they surface as `500 INTERNAL_ERROR`.

### `POST /api/v1/bookings/{id}/cancel`

- Description: Cancels a booking.
- Request body: optional JSON body with `{ "reason?": "string" }`
- Response format: `200 { success: true, data: BookingRequest }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
  - `422 BUSINESS_ERROR` if `BookingService.cancel()` decides the current state cannot be cancelled
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

## Messages

Implementation references:

- Routes: `app/api/v1/messages/route.ts`, `app/api/v1/messages/mark-read/route.ts`, `app/api/v1/bookings/[id]/messages/route.ts`, `app/api/v1/bookings/[id]/messages/mark-all-read/route.ts`
- Controller/service/entity: `src/backend/controllers/MessageController.ts`, `src/backend/services/MessageService.ts`, `src/backend/entities/Message.ts`
- Validation: `src/backend/dto/request/message.dto.ts`

### Message response shape

- `Message`: `id`, `bookingRequestId`, `senderType`, `senderId`, `type`, `content`, `attachments`, `isRead`, `readAt`, `createdAt`, `updatedAt`
- `attachments[]`: `id`, `name`, `url`, `type`, `size`

### `GET /api/v1/bookings/{id}/messages`

- Description: Returns the message thread for a booking request.
- Query params:
  - `limit?=50`
- Request body: None.
- Response format: `200 { success: true, data: Message[] }`
- Error responses:
  - `400 VALIDATION_ERROR` for non-UUID booking ID
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `POST /api/v1/bookings/{id}/messages/mark-all-read`

- Description: Marks all unread messages as read for the current user perspective. The service derives `planner` vs `vendor` from `auth.user.role`.
- Request body: None.
- Response format: `200 { success: true, data: { markedAllRead: true } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `POST /api/v1/messages`

- Description: Sends a message in a booking thread. `senderType` is derived from `auth.user.role` and is `vendor` only when the role is exactly `vendor`; all other roles send as `planner`.
- Request body: `SendMessageSchema`
  - `bookingRequestId` required
  - `type?`: `text | file | quote | status_update`
  - `content` required
  - `attachments?`
- Response format: `201 { success: true, data: Message }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `POST /api/v1/messages/mark-read`

- Description: Marks specific message IDs as read.
- Request body: `{ "messageIds": ["uuid", "..."] }`
- Response format: `200 { success: true, data: { marked: <count> } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
- `500 INTERNAL_ERROR`
- Authentication requirements: Required.

## Tasks

Implementation references:

- Routes: `app/api/v1/tasks/route.ts`, `app/api/v1/tasks/overdue/route.ts`, `app/api/v1/tasks/[id]/route.ts`, `app/api/v1/tasks/[id]/complete/route.ts`, `app/api/v1/tasks/[id]/status/route.ts`, `app/api/v1/tasks/[id]/verify/route.ts`
- Controller/service: `src/backend/controllers/TaskController.ts`, `src/backend/services/TaskService.ts`
- Validation: `src/backend/dto/request/task.dto.ts`

### Task response shape

- `TaskResponseDto`: `id`, `eventId`, `vendorId`, `serviceId?`, `title`, `description?`, `status`, `priority`, `startTime?`, `endTime?`, `dueDate?`, `completedAt?`, `proofUrls`, `notes?`, `isCompleted`, `isOverdue`, `createdAt`, `updatedAt`

### `GET /api/v1/tasks`

- Description: Lists tasks filtered either by event or by vendor.
- Query params:
  - `eventId?`
  - `vendorId?`
  - `status?`
  - `priority?`
  - `page?=1`
  - `limit?=20`
  - `sortBy?=createdAt|dueDate|priority|status`
  - `sortOrder?=asc|desc`
- Request body: None.
- Response format:
  - If `eventId` or `vendorId` is present: `200 { success: true, data: { items: TaskResponseDto[], meta: { page, limit, total, totalPages, hasNext, hasPrev } } }`
  - If neither is present: `200 { success: true, data: [] }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.
- Implementation note: `status` and `priority` are accepted by the schema but are not forwarded to `TaskService.getByEvent()` or `TaskService.getByVendor()`.

### `POST /api/v1/tasks`

- Description: Creates a task.
- Request body: `CreateTaskSchema`
  - `eventId` required
  - `vendorId` required
  - `serviceId?`
  - `title` required
  - `description?`
  - `priority?`, default `medium`
  - `startTime?`
  - `endTime?`
  - `dueDate?`
- Response format: `201 { success: true, data: TaskResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/tasks/overdue`

- Description: Returns overdue tasks.
- Request body: None.
- Response format: `200 { success: true, data: TaskResponseDto[] }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/tasks/{id}`

- Description: Returns one task by UUID.
- Request body: None.
- Response format: `200 { success: true, data: TaskResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `PUT /api/v1/tasks/{id}`

- Description: Updates a task.
- Request body: `UpdateTaskSchema`
  - Any subset of `title`, `description`, `priority`, `startTime`, `endTime`, `dueDate`, `notes`
- Response format: `200 { success: true, data: TaskResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `422 TASK_COMPLETED` if the task is already completed
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `PATCH /api/v1/tasks/{id}/status`

- Description: Changes task status.
- Request body: `{ "status": "pending|accepted|rejected|in_progress|completed|verified", "reason?": "string" }`
- Response format: `200 { success: true, data: TaskResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `422 INVALID_TRANSITION`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `POST /api/v1/tasks/{id}/complete`

- Description: Marks a task as completed and stores proof URLs.
- Request body: `{ "proofUrls": ["url", "..."], "notes?": "string" }`
- Response format: `200 { success: true, data: TaskResponseDto, message: "Task completed" }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `422 INVALID_STATE` unless the current status is `in_progress`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `POST /api/v1/tasks/{id}/verify`

- Description: Verifies a completed task.
- Request body: None.
- Response format: `200 { success: true, data: TaskResponseDto, message: "Task verified" }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `422 INVALID_STATE` unless the current status is `completed`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `DELETE /api/v1/tasks/{id}`

- Description: Deletes a task.
- Request body: None.
- Response format: `200 { success: true, data: { deleted: true, id: "uuid" } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `422 CANNOT_DELETE` unless the current status is `pending` or `rejected`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

## Payments

Implementation references:

- Routes: `app/api/v1/payments/route.ts`, `app/api/v1/payments/alerts/route.ts`, `app/api/v1/payments/overdue/route.ts`, `app/api/v1/payments/[id]/route.ts`, `app/api/v1/payments/[id]/complete/route.ts`
- Controller/service/entity: `src/backend/controllers/PaymentController.ts`, `src/backend/services/PaymentService.ts`, `src/backend/entities/Payment.ts`
- Validation: `src/backend/dto/request/payment.dto.ts`

### Payment response shape

- `Payment`: `id`, `eventId`, `bookingRequestId`, `budgetItemId`, `type`, `status`, `method`, `amount`, `currency`, `paidBy`, `paidTo`, `dueDate`, `paidDate`, `reference`, `receiptUrl`, `description`, `notes`, `createdAt`, `updatedAt`

### `GET /api/v1/payments`

- Description: Lists payments. The controller supports either event-scoped listing, overdue listing, or a default pending-payment listing.
- Query params:
  - `eventId?`
  - `bookingRequestId?`
  - `type?`
  - `status?`
  - `overdueOnly?`
  - `page?=1`
  - `limit?=20`
- Request body: None.
- Response format: `200 { success: true, data: Payment[] }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.
- Implementation note: only `eventId` and `overdueOnly` are used by the controller. `bookingRequestId`, `type`, `status`, `page`, and `limit` are validated but ignored.

### `POST /api/v1/payments`

- Description: Creates a payment record.
- Request body: `CreatePaymentSchema`
  - `eventId` required
  - `bookingRequestId?`
  - `budgetItemId?`
  - `type` required
  - `method` required
  - `amount` required
  - `currency?`, default `INR`
  - `paidBy?`
  - `paidTo?`
  - `dueDate?`
  - `description?`
  - `notes?`
- Response format: `201 { success: true, data: Payment }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/payments/overdue`

- Description: Returns overdue payments.
- Request body: None.
- Response format: `200 { success: true, data: Payment[] }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/payments/alerts`

- Description: Returns two payment alert buckets: overdue payments and payments due within seven days.
- Request body: None.
- Response format: `200 { success: true, data: { overdue: Payment[], dueThisWeek: Payment[] } }`
- Error responses:
  - `401 UNAUTHORIZED`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `GET /api/v1/payments/{id}`

- Description: Returns one payment by UUID.
- Request body: None.
- Response format: `200 { success: true, data: Payment }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

### `PUT /api/v1/payments/{id}`

- Description: Updates mutable payment fields.
- Request body: `UpdatePaymentSchema`
  - Any subset of `method`, `dueDate`, `reference`, `receiptUrl`, `notes`
- Response format: `200 { success: true, data: Payment }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.
- Implementation note: `UpdatePaymentSchema` accepts `dueDate`, but `PaymentService.update()` currently ignores it and does not persist a due-date change.

### `POST /api/v1/payments/{id}/complete`

- Description: Marks a payment as completed and optionally stores a reference/receipt URL.
- Request body: `CompletePaymentSchema`
  - `reference?`
  - `receiptUrl?`
  - `notes?`
- Response format: `200 { success: true, data: Payment }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `401 UNAUTHORIZED`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Required.

## Timeline

Implementation references:

- Routes: `app/api/v1/timeline/route.ts`, `app/api/v1/timeline/reorder/route.ts`, `app/api/v1/timeline/templates/route.ts`, `app/api/v1/timeline/[id]/route.ts`, `app/api/v1/timeline/[id]/status/route.ts`, `app/api/v1/functions/[id]/timeline/route.ts`, `app/api/v1/functions/[id]/timeline/overview/route.ts`, `app/api/v1/functions/[id]/timeline/template/route.ts`
- Controller/service: `src/backend/controllers/TimelineController.ts`, `src/backend/services/TimelineService.ts`
- Validation/response DTOs: `src/backend/dto/request/timeline.dto.ts`, `src/backend/dto/response/timeline.response.ts`

### Timeline response shapes

- `TimelineItemResponseDto`: `id`, `eventId`, `functionId`, `startTime`, `endTime`, `duration`, `calculatedEndTime`, `title`, `description`, `location`, `owner`, `vendorId`, `status`, `notes`, `dependsOn`, `sortOrder`, `createdAt`, `updatedAt`
- Timeline overview response: `functionId`, `totalItems`, `pending`, `inProgress`, `completed`, `delayed`, `nextItem`, `completionPercent`

### `GET /api/v1/timeline`

- Description: Lists timeline items either by `functionId` or by `eventId`.
- Query params:
  - `eventId?`
  - `functionId?`
  - `status?`
  - `page?=1`
  - `limit?=50`
  - `sortBy?=startTime|sortOrder|status|createdAt`
  - `sortOrder?=asc|desc`
- Request body: None.
- Response format:
  - If `functionId` is present: `200 { success: true, data: TimelineItemResponseDto[] }`
  - If `eventId` is present: `200 { success: true, data: TimelineItemResponseDto[] }`
  - If neither is present: `400 { success: false, error: { code: "VALIDATION_ERROR", message: "Either functionId or eventId required" } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public. The current timeline controller does not call `authenticate()`.
- Implementation note: `status`, `page`, `limit`, `sortBy`, and `sortOrder` are accepted by `QueryTimelineSchema`, but the controller only uses `functionId` or `eventId` and does not apply the other filters/pagination settings.

### `POST /api/v1/timeline`

- Description: Creates a timeline item.
- Request body: `CreateTimelineItemSchema`
  - `eventId` required
  - `functionId` required
  - `startTime` required in `HH:MM`
  - `endTime?` in `HH:MM`
  - `duration?`
  - `title` required
  - `description?`
  - `location?`
  - `owner` required
  - `vendorId?`
  - `notes?`
  - `dependsOn?`
- Response format: `201 { success: true, data: TimelineItemResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `GET /api/v1/timeline/templates`

- Description: Returns the available built-in timeline template names.
- Request body: None.
- Response format: `200 { success: true, data: { templates: string[] } }`
- Error responses:
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `POST /api/v1/timeline/reorder`

- Description: Reorders timeline items.
- Request body: `{ "items": [{ "id": "uuid", "sortOrder": 0 }] }`
- Response format: `200 { success: true, data: { reordered: true, count: number } }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `GET /api/v1/timeline/{id}`

- Description: Returns one timeline item by ID.
- Request body: None.
- Response format: `200 { success: true, data: TimelineItemResponseDto }`
- Error responses:
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `PUT /api/v1/timeline/{id}`

- Description: Updates timeline item details, timing, and dependencies.
- Request body: `UpdateTimelineItemSchema`
  - Any subset of `startTime`, `endTime`, `duration`, `title`, `description`, `location`, `owner`, `vendorId`, `notes`, `dependsOn`
- Response format: `200 { success: true, data: TimelineItemResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `DELETE /api/v1/timeline/{id}`

- Description: Deletes a timeline item.
- Request body: None.
- Response format: `200 { success: true, data: { deleted: true, id: "uuid" } }`
- Error responses:
  - `404 NOT_FOUND`
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `PATCH /api/v1/timeline/{id}/status`

- Description: Changes a timeline item status.
- Request body: `{ "status": "pending|in_progress|completed|delayed", "notes?": "string" }`
- Response format: `200 { success: true, data: TimelineItemResponseDto }`
- Error responses:
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
  - `422 BUSINESS_ERROR` for invalid state transitions
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `GET /api/v1/functions/{id}/timeline`

- Description: Returns timeline items for a function ID.
- Request body: None.
- Response format: `200 { success: true, data: TimelineItemResponseDto[] }`
- Error responses:
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `GET /api/v1/functions/{id}/timeline/overview`

- Description: Returns timeline overview stats for a function ID.
- Request body: None.
- Response format: `200 { success: true, data: { functionId, totalItems, pending, inProgress, completed, delayed, nextItem, completionPercent } }`
- Error responses:
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.

### `POST /api/v1/functions/{id}/timeline/template`

- Description: Applies a built-in template to a function’s timeline.
- Query params:
  - `eventId` required
- Request body: `{ "template": "wedding_ceremony|reception|sangeet|mehendi|haldi", "clearExisting?": boolean }`
- Response format: `201 { success: true, data: { applied: true, template: string, items: TimelineItemResponseDto[] } }`
- Error responses:
  - `400 VALIDATION_ERROR` for missing `eventId` query param or invalid request body
  - `422 BUSINESS_ERROR` if a template lookup fails in the service layer
  - `429 RATE_LIMITED`
  - `500 INTERNAL_ERROR`
- Authentication requirements: Public.
