# PlannerOS Database Schema

Last reviewed: 2026-03-27

## 1. Scope

This document is based strictly on:

- `supabase/migrations/*.sql`
- repository/model code that directly maps to those tables, where it exposes schema drift

This repository defines PostgreSQL tables only. It does not define any document collections.

### 1.1 Source-of-truth rules used in this document

- `Guaranteed columns` means columns created by a table's first `CREATE TABLE` plus explicit later `ALTER TABLE` statements.
- `Intended newer shape` means a later `CREATE TABLE IF NOT EXISTS` tried to redefine a table that had already been created earlier. Those later definitions do not deterministically alter an existing table, so they are not treated as guaranteed.
- `Inferred relationship` means the repo clearly models a relationship by column name and code usage, but a later migration sequence may have invalidated the physical foreign key.

### 1.2 Code references used to verify live table usage

- `src/backend/config/database.config.ts`
- `src/backend/repositories/TaskRepository.ts`
- `src/backend/repositories/PaymentRepository.ts`
- `src/backend/repositories/VendorRepository.ts`
- `actions/tasks.ts`
- `actions/invoices-tasks.ts`
- `actions/dashboard.ts`
- `actions/notifications.ts`
- `lib/repositories/supabase-event-repository.ts`
- `lib/repositories/supabase-intake-repository.ts`

## 2. Important Schema Divergences

These are the highest-impact database inconsistencies present in the repo.

| Area | Schema in migrations | Model/repository expectation | Impact |
| --- | --- | --- | --- |
| Tasks | `event_tasks` from `001_initial_schema.sql`; `tasks` from `014_add_leads_and_tasks.sql` | `src/backend/repositories/TaskRepository.ts` uses `event_tasks`; `actions/tasks.ts` and `actions/invoices-tasks.ts` use `tasks` | Two parallel task tables are active in code |
| Payments | `payments` from `001_initial_schema.sql`; `financial_payments` from `008_core_business_entities.sql` | `src/backend/repositories/PaymentRepository.ts` uses `payments`; `actions/dashboard.ts` uses `financial_payments` | Two parallel payment ledgers are active in code |
| Intakes | `intakes` from `011_booking_requests_intakes.sql`; `event_intakes` from `019_event_intakes_table.sql` | `app/portal/[token]/requirements/page.tsx` reads `intakes`; `lib/repositories/supabase-intake-repository.ts` targets `event_intakes` | Two intake tables exist for similar product flows |
| Booking requests | `024_force_fix_vendor_schema.sql` drops and recreates `booking_requests` with a simplified shape | `src/backend/entities/BookingRequest.ts` still expects `function_id`, `currency`, `requested_date`, `response_date`, `confirmation_date`, `internal_notes` | Model and table are no longer aligned |
| User profiles | `001_initial_schema.sql` created `user_profiles(role_id, company_name, image_url, ...)` | `010_user_profiles.sql` and app code expect `role`, `display_name`, `avatar_url`, onboarding fields | Repo does not contain a clean `ALTER` path from old shape to new shape |
| Notifications | `001_initial_schema.sql` created `notifications(user_id, message, status, sent_at)` | `056_create_notifications.sql` and `actions/notifications.ts` expect `event_id`, `type`, `title`, `is_read`, `link`, `created_at` | Table has conflicting definitions with no deterministic migration path |
| Checklists | `001_initial_schema.sql` created `checklists(name)` plus child `checklist_items` | `015_multi_event_type_support.sql` tries to redefine `checklists` as flattened checklist items with `title`, `priority`, `due_date`, `is_completed` | Repo does not guarantee a single checklist design |
| Event tokens | `018_client_portal.sql` creates `events.public_token UUID` | `029_add_client_portal_columns.sql` tries to create `events.public_token TEXT UNIQUE` | Token type is ambiguous in the repo |
| Vendor verification | `010_user_profiles.sql` adds `vendors.verified` | `016_vendor_crm_updates.sql` adds `vendors.is_verified`; repository code uses `is_verified` | Two verification flags exist on the same table |
| Event intake linkage | `019_event_intakes_table.sql` defines `converted_event_id` | `lib/repositories/supabase-intake-repository.ts` reads and writes `event_id` | Repository mapping does not match table column name |
| Planner-owned tasks | `tasks` migration does not add `planner_id`, `assigned_to`, or `category` | `actions/tasks.ts` and `actions/invoices-tasks.ts` try to insert/query those columns and fall back when missing | Runtime code has compatibility branches for missing columns |

## 3. Inferred ER Overview

### 3.1 Identity and ownership

```text
auth.users
   |-- 1:1? user_profiles
   |       |-- 1:1 planner_profiles
   |       |-- 1:1 admin_profiles
   |
   |-- 1:n events (planner_id)
   |-- 1:n events (client_id)
   |-- 0:n vendors (user_id, nullable)
   |-- 0:n revision_requests (client_id)
```

### 3.2 Core event planning

```text
events
  |--< event_requirements
  |--< event_concepts
  |--< event_functions
  |     |--< timeline_items
  |     |--< budget_items
  |     \--< vendor_assignments
  |
  |--< guests
  |--< checklists
  |     \--< checklist_items
  |--< booking_requests >-- vendors
  |     |--< booking_messages
  |     |--< vendor_updates
  |     \--< financial_payments
  |
  |--< budget_items
  |--< vendor_assignments >-- vendors
  |--< vendor_updates >-- vendors
  |--< event_specs
  |--< invoices --< invoice_items
  |--< proposal_snapshots
  |--< client_messages
  |--< event_tasks
  \--< tasks
```

### 3.3 Intake and conversion

```text
intakes ---------> events (converted_event_id)
event_intakes ---> events (converted_event_id in schema)
events.submission_id ---> event_intakes.id

Note:
- code also reads/writes event_intakes.event_id via lib/repositories/supabase-intake-repository.ts
- that relationship is model-level, not migration-level
```

## 4. Table-wise Documentation

## 4.1 Identity and Access

### `roles`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `name VARCHAR(50)` unique, required
- `permissions_json JSONB`
- `created_at TIMESTAMPTZ`

Relationships:
- `user_profiles.role_id -> roles.id`

Indexes:
- implicit unique index on `name`

### `user_profiles`

Status: `active`, `ambiguous`

Source migrations: `001_initial_schema.sql`, `010_user_profiles.sql`, `034_fix_vendor_signup.sql`, `038_ensure_user_profiles_exists.sql`

Guaranteed fields:
- `id UUID` primary key, FK -> `auth.users.id`
- `role_id UUID` FK -> `roles.id`
- `phone VARCHAR(20)`
- `address TEXT`
- `company_name VARCHAR(255)`
- `image_url TEXT`
- `role TEXT` check `('planner','vendor','admin')`, default `'planner'`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Intended newer shape, not guaranteed by a clean `ALTER`:
- `display_name TEXT`
- `avatar_url TEXT`
- `email_verified BOOLEAN`
- `onboarding_completed BOOLEAN`
- `last_active_at TIMESTAMPTZ`

Relationships:
- `id -> auth.users.id`
- `planner_profiles.id -> user_profiles.id`
- `admin_profiles.id -> user_profiles.id`
- `vendors.verified_by -> user_profiles.id`

Indexes:
- `idx_user_profiles_role (role)`

Notes:
- `001_initial_schema.sql` and `010_user_profiles.sql` define materially different table shapes.
- The repo does not contain a full migration that deterministically backfills the newer columns onto the older table.

### `planner_profiles`

Status: `active`

Source migrations: `010_user_profiles.sql`, `038_ensure_user_profiles_exists.sql`

Fields:
- `id UUID` primary key, FK -> `user_profiles.id`
- `company_name TEXT` required
- `company_logo TEXT`
- `phone TEXT`
- `alternate_phone TEXT`
- `city TEXT`
- `state TEXT`
- `address TEXT`
- `experience_years INTEGER` default `0`
- `bio TEXT`
- `website TEXT`
- `instagram_handle TEXT`
- `gst_number TEXT`
- `pan_number TEXT`
- `subscription_plan TEXT` default `'free'`
- `subscription_start_date TIMESTAMPTZ`
- `subscription_end_date TIMESTAMPTZ`
- `total_events INTEGER` default `0`
- `active_events INTEGER` default `0`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `id -> user_profiles.id`

Indexes:
- `idx_planner_profiles_city (city)`
- `idx_planner_profiles_subscription (subscription_plan)`

### `admin_profiles`

Status: `active`

Source migrations: `010_user_profiles.sql`

Fields:
- `id UUID` primary key, FK -> `user_profiles.id`
- `department TEXT`
- `permissions JSONB` default `["read"]`
- `created_by UUID` FK -> `user_profiles.id`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `id -> user_profiles.id`
- `created_by -> user_profiles.id`

Indexes:
- none declared

## 4.2 CRM and Intake

### `leads`

Status: `active`, `parallel`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `planner_id UUID`
- `name VARCHAR(255)` required
- `email VARCHAR(255)` required
- `phone VARCHAR(20)`
- `event_type VARCHAR(50)` required
- `budget_range VARCHAR(50)`
- `event_date DATE`
- `source VARCHAR(50)` required
- `score INTEGER` default `0`
- `status VARCHAR(20)` default `'new'`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `lead_activities.lead_id -> leads.id`
- `planner_id` is ownership-like, but `001_initial_schema.sql` does not declare an FK

Indexes:
- `idx_leads_planner (planner_id)`
- `idx_leads_status (status)`
- `idx_leads_score (score DESC)`

### `lead_activities`

Status: `active`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `lead_id UUID` FK -> `leads.id`
- `activity_type VARCHAR(50)` required
- `notes TEXT`
- `created_at TIMESTAMPTZ`

Relationships:
- `lead_id -> leads.id`

Indexes:
- none declared

### `clients`

Status: `active`, `parallel`

Source migrations: `008_core_business_entities.sql`, `012_complete_mvp_schema.sql`, `014_add_leads_and_tasks.sql`, `015_multi_event_type_support.sql`, `022_complete_missing_schema.sql`

Guaranteed fields from the first create plus explicit alters:
- `id UUID` primary key
- `planner_id UUID` FK -> `auth.users.id`
- `name VARCHAR(200)` required
- `email VARCHAR(255)`
- `phone VARCHAR(20)`
- `alternate_phone VARCHAR(20)`
- `status VARCHAR(20)` default `'prospect'`
- `address TEXT`
- `city VARCHAR(100)`
- `state VARCHAR(100)`
- `preferences JSONB` default `'{}'`
- `total_events INTEGER` default `0`
- `total_spend DECIMAL(14,2)` default `0`
- `currency VARCHAR(3)` default `'INR'`
- `referral_source VARCHAR(100)`
- `notes TEXT`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`
- `event_type TEXT`
- `event_date DATE`
- `score INTEGER`
- `budget_range TEXT`
- `source TEXT`

Intended newer shape, not guaranteed:
- `referred_by TEXT`
- `tags TEXT[]`
- `last_event_date DATE`
- planner ownership via `user_profiles.id` instead of `auth.users.id`

Relationships:
- `planner_id -> auth.users.id` in the guaranteed schema

Indexes:
- `idx_clients_planner (planner_id)`
- `idx_clients_status (status)`
- `idx_clients_email (email)`
- `idx_clients_name (name)`
- `idx_clients_event_type (event_type)`
- `idx_clients_score (score)`
- `idx_clients_phone (phone)` is only declared in a later create-only migration, so treat as intended, not guaranteed

### `intakes`

Status: `active`, `parallel`

Source migrations: `011_booking_requests_intakes.sql`

Fields:
- `id UUID` primary key
- `access_token TEXT` unique, required
- `created_by TEXT` default `'planner'`
- `planner_id UUID` FK -> `user_profiles.id`
- `status TEXT` default `'draft'`
- `converted_event_id UUID` FK -> `events.id`
- `current_tab INTEGER` default `0`
- `client_name TEXT` required
- `phone TEXT` required
- `email TEXT`
- `source TEXT`
- `event_type TEXT`
- `event_date DATE`
- `event_end_date DATE`
- `is_date_flexible BOOLEAN` default `false`
- `guest_count INTEGER` default `100`
- `budget_min DECIMAL(15,2)` default `0`
- `budget_max DECIMAL(15,2)` default `0`
- `city TEXT`
- `venue_type TEXT`
- `personal_venue JSONB` default `'{}'`
- `food_preferences JSONB` default `'{}'`
- `decor_preferences JSONB` default `'{}'`
- `entertainment_preferences JSONB` default `'{}'`
- `photography_preferences JSONB` default `'{}'`
- `services_preferences JSONB` default `'{}'`
- `liked_vendors TEXT[]` default `'{}'`
- `special_requests TEXT`
- `signature JSONB`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`
- `submitted_at TIMESTAMPTZ`

Relationships:
- `planner_id -> user_profiles.id`
- `converted_event_id -> events.id`

Indexes:
- `idx_intakes_planner (planner_id)`
- `idx_intakes_status (status)`
- `idx_intakes_token (access_token)`

### `event_intakes`

Status: `active`, `parallel`

Source migrations: `019_event_intakes_table.sql`

Fields:
- `id UUID` primary key
- `planner_id UUID` FK -> `user_profiles.id`
- `status TEXT` default `'draft'`
- `converted_event_id UUID` FK -> `events.id`
- `client_name TEXT` required
- `client_email TEXT`
- `client_phone TEXT` required
- `requirements JSONB` default `'{}'`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `planner_id -> user_profiles.id`
- `converted_event_id -> events.id`
- `events.submission_id -> event_intakes.id`

Indexes:
- `idx_event_intakes_planner (planner_id)`
- `idx_event_intakes_status (status)`
- `idx_event_intakes_created (created_at DESC)`

Notes:
- `lib/repositories/supabase-intake-repository.ts` reads and writes `event_id`, not `converted_event_id`.
- The same repository also stores the public intake token in `requirements->>token` instead of a top-level column.

## 4.3 Events and Planning

### `events`

Status: `active`

Source migrations: `001_initial_schema.sql`, `015_multi_event_type_support.sql`, `018_client_portal.sql`, `020_fix_events_schema.sql`, `029_add_client_portal_columns.sql`, `055_add_client_feedback.sql`, `057_proposal_snapshots.sql`, `065_client_portal.sql`

Guaranteed fields:
- `id UUID` primary key
- `planner_id UUID` FK -> `auth.users.id`
- `client_id UUID` FK -> `auth.users.id`
- `venue_id UUID`
- `type VARCHAR(50)` required
- `date DATE`
- `guest_count INTEGER`
- `budget DECIMAL(12,2)`
- `status VARCHAR(20)` default `'draft'`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`
- `event_category TEXT`
- `event_subcategory TEXT`
- `theme TEXT`
- `expected_attendees INTEGER`
- `name VARCHAR(255)`
- `client_name VARCHAR(255)`
- `client_phone VARCHAR(20)`
- `client_email VARCHAR(255)`
- `venue_name VARCHAR(255)`
- `venue_address TEXT`
- `budget_min DECIMAL(12,2)`
- `budget_max DECIMAL(12,2)`
- `city VARCHAR(100)`
- `venue_type VARCHAR(50)`
- `is_date_flexible BOOLEAN`
- `end_date DATE`
- `notes TEXT`
- `source VARCHAR(50)`
- `submission_id UUID` FK -> `event_intakes.id`
- `public_token` declared twice with conflicting types: `UUID` in `018_client_portal.sql`, `TEXT` in `029_add_client_portal_columns.sql`
- `proposal_status TEXT/VARCHAR(50)` default `'draft'`
- `proposal_version INTEGER` default `1`
- `proposal_locked BOOLEAN` default `false`
- `client_feedback TEXT`
- `final_proposal_token TEXT`
- `client_token UUID` unique

Relationships:
- `planner_id -> auth.users.id`
- `client_id -> auth.users.id`
- `submission_id -> event_intakes.id`
- parent table for most planning, booking, finance, and portal tables

Indexes:
- `idx_events_planner (planner_id)`
- `idx_events_client (client_id)`
- `idx_events_date (date)`
- `idx_events_status (status)`
- `idx_events_category (event_category)`
- `events_public_token_idx` unique on `public_token`
- `idx_events_public_token (public_token)`
- unique constraint on `client_token`
- `idx_events_client_token (client_token)`

Notes:
- `lib/repositories/supabase-event-repository.ts` queries `event_date`; the migrations guarantee `date`, not `event_date`.

### `event_requirements`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `type VARCHAR(50)` required
- `description TEXT`
- `priority VARCHAR(20)` default `'medium'`
- `created_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`

Indexes:
- none declared

### `event_concepts`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `theme VARCHAR(255)`
- `vision_desc TEXT`
- `moodboard_url TEXT`
- `created_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`

Indexes:
- none declared

### `event_functions`

Status: `active`, `ambiguous`

Source migrations: `008_core_business_entities.sql`, `012_complete_mvp_schema.sql`, `017_timeline_schema.sql`

Guaranteed fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `name VARCHAR(100)` required
- `type VARCHAR(50)` required
- `date DATE`
- `start_time TIME`
- `end_time TIME`
- `venue_name VARCHAR(200)`
- `venue_address TEXT`
- `guest_count INTEGER`
- `budget DECIMAL(14,2)`
- `notes TEXT`
- `sort_order INTEGER` default `0`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Intended newer shape, not guaranteed:
- `day INTEGER`
- `venue_type TEXT`
- `status TEXT`

Relationships:
- `event_id -> events.id`
- `timeline_items.function_id -> event_functions.id`
- `vendor_assignments.function_id -> event_functions.id`
- early `booking_requests.function_id -> event_functions.id` existed before `booking_requests` was dropped/recreated

Indexes:
- `idx_event_functions_event (event_id)`
- `idx_event_functions_date (date)`
- `idx_event_functions_sort (event_id, sort_order)`

### `guests`

Status: `active`

Source migrations: `015_multi_event_type_support.sql`, `026_fix_guest_schema.sql`, `028_master_fix_guest_budget.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `name TEXT` required
- `email TEXT`
- `phone TEXT`
- `rsvp_status TEXT` default `'pending'`
- `rsvp_date TIMESTAMPTZ`
- `plus_one BOOLEAN` default `false`
- `plus_one_name TEXT`
- `dietary_preferences TEXT`
- `special_requirements TEXT`
- `category TEXT`
- `table_number INTEGER`
- `seat_number TEXT`
- `address TEXT`
- `notes TEXT`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`

Indexes:
- `idx_guests_event (event_id)`
- `idx_guests_rsvp_status (rsvp_status)`
- `idx_guests_category (category)`

### `checklists`

Status: `ambiguous`

Source migrations: `001_initial_schema.sql`, `015_multi_event_type_support.sql`

Guaranteed fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `name VARCHAR(255)` required
- `created_at TIMESTAMPTZ`

Intended newer shape, not guaranteed:
- `title TEXT`
- `description TEXT`
- `category TEXT`
- `is_completed BOOLEAN`
- `completed_at TIMESTAMPTZ`
- `completed_by UUID` FK -> `auth.users.id`
- `priority TEXT`
- `due_date DATE`
- `sort_order INTEGER`
- `updated_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`
- `checklist_items.checklist_id -> checklists.id`

Indexes:
- `idx_checklists_event (event_id)` is declared later and compatible with both shapes
- `idx_checklists_completed (is_completed)` is only valid for the intended newer shape
- `idx_checklists_due_date (due_date)` is only valid for the intended newer shape

Notes:
- The repo does not provide a deterministic migration from the original parent-checklist design to the later flattened checklist-item design.

### `checklist_items`

Status: `legacy`, `paired with ambiguous parent`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `checklist_id UUID` FK -> `checklists.id`
- `description TEXT` required
- `category VARCHAR(100)`
- `is_completed BOOLEAN` default `false`
- `assigned_to UUID` FK -> `auth.users.id`
- `due_date DATE`
- `created_at TIMESTAMPTZ`
- `completed_at TIMESTAMPTZ`

Relationships:
- `checklist_id -> checklists.id`
- `assigned_to -> auth.users.id`

Indexes:
- `idx_checklist_items_assigned (assigned_to)`

### `timeline_items`

Status: `active`

Source migrations: `012_complete_mvp_schema.sql`, `017_timeline_schema.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `function_id UUID` FK -> `event_functions.id`
- `start_time TIME` required
- `end_time TIME`
- `duration INTEGER`
- `title TEXT` required
- `description TEXT`
- `location TEXT`
- `owner TEXT`
- `owner_phone TEXT`
- `vendor_id UUID` FK -> `vendors.id`
- `status TEXT` default `'pending'`
- `actual_start_time TIME`
- `actual_end_time TIME`
- `notes TEXT`
- `depends_on UUID[]`
- `sort_order INTEGER` default `0`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`
- `function_id -> event_functions.id`
- `vendor_id -> vendors.id`

Indexes:
- `idx_timeline_items_event (event_id)`
- `idx_timeline_items_function (function_id)`
- `idx_timeline_items_start_time (start_time)`

### `event_specs`

Status: `active`

Source migrations: `063_create_event_specs.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `category_id TEXT` required
- `category_name TEXT` required
- `category_color TEXT` default `'blue'`
- `vendor_name TEXT` default `'To be selected'`
- `items JSONB` default `'[]'`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`

Indexes:
- unique constraint on `(event_id, category_id)`

### `revision_requests`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `client_id UUID` FK -> `auth.users.id`
- `request_text TEXT` required
- `status VARCHAR(20)` default `'pending'`
- `created_at TIMESTAMPTZ`
- `resolved_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`
- `client_id -> auth.users.id`

Indexes:
- none declared

## 4.4 Vendors, Catalog, and Packages

### `vendors`

Status: `active`

Source migrations: `001_initial_schema.sql`, `010_user_profiles.sql`, `016_vendor_crm_updates.sql`, `043_add_vendor_socials_payments.sql`

Fields:
- `id UUID` primary key
- `user_id UUID` FK -> `auth.users.id`, nullable after `016_vendor_crm_updates.sql`
- `company_name VARCHAR(255)` required
- `quality_score DECIMAL(3,2)` default `0.00`
- `payout_details JSONB`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`
- `verified BOOLEAN` default `false`
- `verification_date TIMESTAMPTZ`
- `verified_by UUID` FK -> `user_profiles.id`
- `verification_documents JSONB` default `'[]'`
- `onboarding_completed BOOLEAN` default `false`
- `planner_id UUID` FK -> `auth.users.id`
- `email VARCHAR(255)`
- `phone VARCHAR(50)`
- `contact_name VARCHAR(200)`
- `website VARCHAR(255)`
- `category VARCHAR(100)`
- `description TEXT`
- `location VARCHAR(255)`
- `start_price DECIMAL(10,2)`
- `end_price DECIMAL(10,2)`
- `is_verified BOOLEAN` default `false`
- `image_url TEXT`
- `portfolio_urls JSONB` default `'[]'`
- `rating DECIMAL(3,2)` default `0.00`
- `review_count INTEGER` default `0`
- `status VARCHAR(50)` default `'active'`
- `instagram VARCHAR(255)`
- `payment_details JSONB` default `'{}'`

Relationships:
- `user_id -> auth.users.id`
- `planner_id -> auth.users.id`
- `verified_by -> user_profiles.id`
- parent for bookings, assignments, updates, availability, services, packages, payouts, and performance rows

Indexes:
- `idx_vendors_user_id (user_id)`
- `idx_vendors_verified (verified)`
- `idx_vendors_planner (planner_id)`
- `idx_vendors_category (category)`
- `idx_vendors_location (location)`
- `idx_vendors_instagram (instagram)`

Notes:
- The table has both `verified` and `is_verified`.
- `src/backend/repositories/VendorRepository.ts` and `src/backend/entities/Vendor.ts` use `is_verified`.
- `034_fix_vendor_signup.sql` inserts into a `name` column that is not created by any migration in this repo.

### `services`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `name VARCHAR(255)` required
- `category VARCHAR(100)` required
- `base_price DECIMAL(12,2)`
- `created_at TIMESTAMPTZ`

Relationships:
- `template_items.service_id -> services.id`
- `vendor_services.service_id -> services.id`
- `event_tasks.service_id -> services.id`
- original `package_items.service_id -> services.id` existed before `package_items` was replaced in `024_force_fix_vendor_schema.sql`

Indexes:
- none declared

### `vendor_services`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `vendor_id UUID` FK -> `vendors.id`
- `service_id UUID` FK -> `services.id`
- `price DECIMAL(12,2)`
- `created_at TIMESTAMPTZ`

Relationships:
- `vendor_id -> vendors.id`
- `service_id -> services.id`

Indexes:
- none declared

### `vendor_availability`

Status: `active`, `ambiguous`

Source migrations: `001_initial_schema.sql`, `044_create_vendor_availability.sql`

Guaranteed fields:
- `id UUID` primary key
- `vendor_id UUID` FK -> `vendors.id`
- `date DATE` required
- `status VARCHAR(20)` / `TEXT`
- `created_at TIMESTAMPTZ`
- unique constraint on `(vendor_id, date)`

Intended newer shape, not guaranteed by a clean `ALTER`:
- `event_id UUID` FK -> `events.id`
- `notes TEXT`
- `updated_at TIMESTAMPTZ`
- status check `('available','busy','tentative')`

Relationships:
- `vendor_id -> vendors.id`
- `event_id -> events.id` is intended by the newer create-only migration

Indexes:
- `idx_vendor_availability_date (date)`
- `idx_vendor_availability_vendor_id (vendor_id)`

### `vendor_packages`

Status: `active`

Source migrations: `033_add_venue_diversity_packages.sql`

Fields:
- `id UUID` primary key
- `vendor_id UUID` FK -> `vendors.id`
- `name TEXT` required
- `description TEXT`
- `price NUMERIC` required
- `duration TEXT`
- `inclusions TEXT[]`
- `is_popular BOOLEAN` default `false`
- `is_active BOOLEAN` default `true`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `vendor_id -> vendors.id`

Indexes:
- none declared

### `package_templates`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `name VARCHAR(255)` required
- `event_type VARCHAR(50)` required
- `description TEXT`
- `base_price DECIMAL(12,2)`
- `is_active BOOLEAN` default `true`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `template_items.template_id -> package_templates.id`
- original `packages.template_id -> package_templates.id` existed before `packages` was replaced in `024_force_fix_vendor_schema.sql`

Indexes:
- none declared

### `template_items`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `template_id UUID` FK -> `package_templates.id`
- `service_id UUID` FK -> `services.id`
- `quantity INTEGER` default `1`
- `is_optional BOOLEAN` default `false`
- `created_at TIMESTAMPTZ`

Relationships:
- `template_id -> package_templates.id`
- `service_id -> services.id`

Indexes:
- none declared

### `packages`

Status: `active`, `replaced`

Source migrations: `001_initial_schema.sql`, `023_add_booking_requests.sql`, `024_force_fix_vendor_schema.sql`

Guaranteed final fields after the drop/recreate:
- `id UUID` primary key
- `vendor_id UUID` FK -> `vendors.id`
- `name TEXT` required
- `description TEXT`
- `price DECIMAL(15,2)` required
- `price_unit TEXT` default `'per_event'`
- `includes TEXT[]`
- `is_customizable BOOLEAN` default `true`
- `is_active BOOLEAN` default `true`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `vendor_id -> vendors.id`
- `package_items.package_id -> packages.id`

Indexes:
- none declared after the `024_force_fix_vendor_schema.sql` recreate

Notes:
- `001_initial_schema.sql` defined `packages` as an event-linked planner proposal table.
- `024_force_fix_vendor_schema.sql` replaced it with a vendor catalog table.

### `package_items`

Status: `active`, `replaced`

Source migrations: `001_initial_schema.sql`, `023_add_booking_requests.sql`, `024_force_fix_vendor_schema.sql`

Guaranteed final fields after the drop/recreate:
- `id UUID` primary key
- `package_id UUID` FK -> `packages.id`
- `name TEXT` required
- `description TEXT`
- `quantity INTEGER` default `1`
- `unit_price DECIMAL(15,2)`
- `is_optional BOOLEAN` default `false`
- `created_at TIMESTAMPTZ`

Relationships:
- `package_id -> packages.id`

Indexes:
- none declared after the `024_force_fix_vendor_schema.sql` recreate

Notes:
- The original `service_id`, `vendor_id`, and `cost` fields from `001_initial_schema.sql` were removed when the table was recreated.

## 4.5 Booking, Assignments, and Execution

### `booking_requests`

Status: `active`, `replaced`

Source migrations: `008_core_business_entities.sql`, `011_booking_requests_intakes.sql`, `023_add_booking_requests.sql`, `024_force_fix_vendor_schema.sql`, `039_add_draft_status.sql`, `052_fix_booking_status_check.sql`, `053_add_booking_missing_columns.sql`, `054_booking_nullable_columns.sql`

Guaranteed final fields after the drop/recreate:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `vendor_id UUID` FK -> `vendors.id`
- `planner_id UUID` FK -> `user_profiles.id`
- `event_name TEXT` nullable after `054_booking_nullable_columns.sql`
- `event_date DATE` nullable after `054_booking_nullable_columns.sql`
- `city TEXT`
- `venue TEXT`
- `guest_count INTEGER`
- `service TEXT` required
- `requirements TEXT`
- `budget DECIMAL(15,2)`
- `quoted_amount DECIMAL(15,2)`
- `status TEXT` with final check values:
  - `draft`
  - `pending`
  - `quote_requested`
  - `quote_received`
  - `quoted`
  - `negotiating`
  - `accepted`
  - `confirmed`
  - `deposit_paid`
  - `completed`
  - `declined`
  - `cancelled`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`
- `quoted_at TIMESTAMPTZ`
- `responded_at TIMESTAMPTZ`
- `notes TEXT`
- `service_details TEXT`
- `agreed_amount DECIMAL(15,2)`
- `payment_schedule TEXT` default `'[]'`

Relationships:
- `event_id -> events.id`
- `vendor_id -> vendors.id`
- `planner_id -> user_profiles.id`

Indexes:
- none are recreated after `024_force_fix_vendor_schema.sql`

Notes:
- The earlier richer workflow columns (`function_id`, `currency`, `requested_date`, `response_date`, `confirmation_date`, `internal_notes`) were removed when the table was recreated.
- `src/backend/entities/BookingRequest.ts` still expects those removed columns.

### `booking_messages`

Status: `active`, `inferred relationship`

Source migrations: `008_core_business_entities.sql`

Fields:
- `id UUID` primary key
- `booking_request_id UUID`
- `sender_type VARCHAR(20)` required
- `sender_id VARCHAR(100)` required
- `type VARCHAR(30)` default `'text'`
- `content TEXT` required
- `attachments JSONB` default `'[]'`
- `is_read BOOLEAN` default `false`
- `read_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- inferred `booking_request_id -> booking_requests.id`

Indexes:
- `idx_booking_messages_booking (booking_request_id)`
- `idx_booking_messages_unread (booking_request_id, is_read)` partial where `is_read = false`
- `idx_booking_messages_created (booking_request_id, created_at DESC)`

Notes:
- `024_force_fix_vendor_schema.sql` drops and recreates `booking_requests` with `CASCADE`.
- The repo does not contain a later migration that explicitly re-adds the `booking_messages.booking_request_id` FK to the recreated table.

### `vendor_assignments`

Status: `active`

Source migrations: `012_complete_mvp_schema.sql`, `022_complete_missing_schema.sql`, `064_event_day_updates.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `function_id UUID` FK -> `event_functions.id`
- `vendor_id UUID` FK -> `vendors.id`
- `vendor_name TEXT` required
- `vendor_category TEXT` required
- `vendor_phone TEXT`
- `budget_category TEXT`
- `agreed_amount DECIMAL(15,2)` default `0`
- `paid_amount DECIMAL(15,2)` default `0`
- `status TEXT` default `'requested'`
- `arrival_time TIME`
- `arrived_at TIMESTAMPTZ`
- `departed_at TIMESTAMPTZ`
- `notes TEXT`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`
- `arrival_status TEXT` default `'pending'`

Relationships:
- `event_id -> events.id`
- `function_id -> event_functions.id`
- `vendor_id -> vendors.id`

Indexes:
- `idx_vendor_assignments_event (event_id)`
- `idx_vendor_assignments_vendor (vendor_id)`

### `vendor_updates`

Status: `active`

Source migrations: `064_event_day_updates.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `vendor_id UUID` FK -> `vendors.id`
- `booking_request_id UUID` FK -> `booking_requests.id`
- `update_type TEXT` required
- `message TEXT`
- `photo_url TEXT`
- `status_tag TEXT`
- `created_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`
- `vendor_id -> vendors.id`
- `booking_request_id -> booking_requests.id`

Indexes:
- `idx_vendor_updates_event (event_id)`
- `idx_vendor_updates_vendor (vendor_id)`
- `idx_vendor_updates_created (created_at DESC)`

### `tasks`

Status: `active`, `parallel`

Source migrations: `014_add_leads_and_tasks.sql`, `062_create_invoices_tasks.sql`

Guaranteed fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `vendor_id UUID` FK -> `vendors.id`
- `title TEXT` required
- `description TEXT`
- `status TEXT` default `'pending'`
- `priority TEXT` default `'medium'`
- `start_time TIMESTAMPTZ`
- `end_time TIMESTAMPTZ`
- `due_date TIMESTAMPTZ`
- `completed_at TIMESTAMPTZ`
- `proof_urls TEXT[]` default `'{}'`
- `notes TEXT`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`
- `vendor_id -> vendors.id`

Indexes:
- `idx_tasks_event (event_id)`
- `idx_tasks_vendor (vendor_id)`
- `idx_tasks_status (status)`

Notes:
- `actions/tasks.ts` and `actions/invoices-tasks.ts` also try to use `planner_id`, `assigned_to`, and `category`.
- No migration in this repo adds those columns to `tasks`.

### `event_tasks`

Status: `active`, `parallel`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `vendor_id UUID` FK -> `vendors.id`
- `service_id UUID` FK -> `services.id`
- `start_time TIMESTAMPTZ`
- `end_time TIMESTAMPTZ`
- `status VARCHAR(20)` default `'pending'`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`
- `vendor_id -> vendors.id`
- `service_id -> services.id`
- `proof_of_work.task_id -> event_tasks.id`

Indexes:
- `idx_tasks_event (event_id)`
- `idx_tasks_vendor (vendor_id)`
- `idx_tasks_status (status)`

Notes:
- `src/backend/repositories/TaskRepository.ts` still uses this table as the canonical task store.

### `proof_of_work`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `task_id UUID` FK -> `event_tasks.id`
- `file_url TEXT` required
- `uploaded_at TIMESTAMPTZ`

Relationships:
- `task_id -> event_tasks.id`

Indexes:
- none declared

## 4.6 Finance

### `budget_items`

Status: `active`

Source migrations: `008_core_business_entities.sql`, `012_complete_mvp_schema.sql`, `022_complete_missing_schema.sql`, `027_fix_budget_schema.sql`, `028_master_fix_guest_budget.sql`, `051_fix_budget_category_check.sql`

Guaranteed fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `function_id UUID` FK -> `event_functions.id`
- `category VARCHAR(50)` / `TEXT`
- `description VARCHAR(200)` / `TEXT`
- `vendor_id UUID`
- `booking_request_id UUID`
- `estimated_amount DECIMAL(14,2)`
- `actual_amount DECIMAL(14,2)`
- `paid_amount DECIMAL(14,2)` default `0`
- `currency VARCHAR(3)` default `'INR'`
- `notes TEXT`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`
- `function_id -> event_functions.id`
- inferred `vendor_id -> vendors.id`
- inferred `booking_request_id -> booking_requests.id`

Indexes:
- `idx_budget_items_event (event_id)`
- `idx_budget_items_function (function_id)`
- `idx_budget_items_category (category)`
- `idx_budget_items_vendor (vendor_id)`

Notes:
- `012_complete_mvp_schema.sql` and `022_complete_missing_schema.sql` intend a unique `(event_id, category)` constraint, but they do so via later `CREATE TABLE IF NOT EXISTS`. That uniqueness is not guaranteed if `008_core_business_entities.sql` created the table first.
- `024_force_fix_vendor_schema.sql` recreates `booking_requests`, so the `booking_request_id` relationship should be treated as inferred unless revalidated in a live database.

### `financial_payments`

Status: `active`, `parallel`

Source migrations: `008_core_business_entities.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `booking_request_id UUID`
- `budget_item_id UUID` FK -> `budget_items.id`
- `type VARCHAR(30)` required
- `status VARCHAR(20)` default `'pending'`
- `method VARCHAR(30)`
- `amount DECIMAL(14,2)` required
- `currency VARCHAR(3)` default `'INR'`
- `paid_by VARCHAR(100)`
- `paid_to VARCHAR(100)`
- `due_date DATE`
- `paid_date DATE`
- `reference VARCHAR(100)`
- `receipt_url TEXT`
- `description VARCHAR(500)`
- `notes TEXT`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`
- `budget_item_id -> budget_items.id`
- inferred `booking_request_id -> booking_requests.id`

Indexes:
- `idx_financial_payments_event (event_id)`
- `idx_financial_payments_booking (booking_request_id)`
- `idx_financial_payments_status (status)`
- `idx_financial_payments_due_date (due_date)`
- `idx_financial_payments_type (type)`

Notes:
- `src/backend/repositories/PaymentRepository.ts` does not use this table; it uses legacy `payments`.

### `invoices`

Status: `active`

Source migrations: `001_initial_schema.sql`, `062_create_invoices_tasks.sql`, `068_fix_invoices_schema_compat.sql`

Guaranteed fields after compatibility migration:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- legacy compatibility columns:
  - `amount DECIMAL(12,2)`
  - `type VARCHAR(20)`
- `planner_id UUID` FK -> `auth.users.id`
- `invoice_number TEXT` required
- `client_name TEXT` required
- `client_email TEXT` default `''`
- `client_phone TEXT` default `''`
- `status TEXT` default `'draft'`
- `subtotal NUMERIC` default `0`
- `platform_fee NUMERIC` default `0`
- `total NUMERIC` default `0`
- `paid_amount NUMERIC` default `0`
- `due_date DATE`
- `paid_at TIMESTAMPTZ`
- `notes TEXT` default `''`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`
- `planner_id -> auth.users.id`
- `invoice_items.invoice_id -> invoices.id`
- `payments.invoice_id -> invoices.id`

Indexes:
- none declared

Notes:
- `068_fix_invoices_schema_compat.sql` intentionally keeps legacy `amount` and `type` instead of dropping them.

### `invoice_items`

Status: `active`

Source migrations: `062_create_invoices_tasks.sql`, `068_fix_invoices_schema_compat.sql`

Fields:
- `id UUID` primary key
- `invoice_id UUID` FK -> `invoices.id`
- `description TEXT` required
- `quantity INTEGER` default `1`
- `rate NUMERIC` default `0`
- `amount NUMERIC` default `0`
- `created_at TIMESTAMPTZ`

Relationships:
- `invoice_id -> invoices.id`

Indexes:
- none declared

### `payments`

Status: `active`, `parallel`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `invoice_id UUID` FK -> `invoices.id`
- `method VARCHAR(50)`
- `status VARCHAR(20)` default `'pending'`
- `transaction_ref VARCHAR(255)`
- `created_at TIMESTAMPTZ`

Relationships:
- `invoice_id -> invoices.id`

Indexes:
- none declared

Notes:
- `src/backend/repositories/PaymentRepository.ts` treats this as the canonical payment table.
- Newer planner dashboard code uses `financial_payments` instead.

### `vendor_payouts`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `vendor_id UUID` FK -> `vendors.id`
- `event_id UUID` FK -> `events.id`
- `amount DECIMAL(12,2)` required
- `status VARCHAR(20)` default `'pending'`
- `created_at TIMESTAMPTZ`
- `paid_at TIMESTAMPTZ`

Relationships:
- `vendor_id -> vendors.id`
- `event_id -> events.id`

Indexes:
- none declared

## 4.7 Portal, Messaging, Audit, and Quality

### `proposal_snapshots`

Status: `active`

Source migrations: `057_proposal_snapshots.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `version INTEGER` default `1`
- `snapshot_data JSONB` required
- `token TEXT` unique, required
- `status TEXT` default `'sent'`
- `client_feedback TEXT`
- `sent_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`

Indexes:
- `idx_proposal_snapshots_event (event_id)`
- `idx_proposal_snapshots_token (token)`

### `client_messages`

Status: `active`

Source migrations: `065_client_portal.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `sender_type TEXT` required
- `message TEXT` required
- `is_read BOOLEAN` default `false`
- `created_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`

Indexes:
- `idx_client_messages_event (event_id)`
- `idx_client_messages_created (created_at DESC)`

### `notifications`

Status: `active`, `ambiguous`

Source migrations: `001_initial_schema.sql`, `056_create_notifications.sql`

Guaranteed fields from the first create:
- `id UUID` primary key
- `user_id UUID` FK -> `auth.users.id`
- `message TEXT` required
- `status VARCHAR(20)` default `'unread'`
- `sent_at TIMESTAMPTZ`

Intended newer shape, not guaranteed by a clean `ALTER`:
- `event_id UUID` FK -> `events.id`
- `type TEXT`
- `title TEXT`
- `is_read BOOLEAN`
- `link TEXT`
- `created_at TIMESTAMPTZ`

Relationships:
- `user_id -> auth.users.id`
- `event_id -> events.id` is intended by the newer create-only migration

Indexes:
- guaranteed `idx_notifications_user (user_id, status)`
- intended `idx_notifications_unread (user_id, is_read)` partial

Notes:
- `actions/notifications.ts` reads and writes the newer shape (`created_at`, `is_read`, `title`, `type`, `event_id`, `link`).
- The repo does not contain an `ALTER TABLE notifications ...` migration that guarantees those columns on top of the original table.

### `feedback`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `event_id UUID` FK -> `events.id`
- `user_id UUID` FK -> `auth.users.id`
- `rating INTEGER` check `1..5`
- `comments TEXT`
- `created_at TIMESTAMPTZ`

Relationships:
- `event_id -> events.id`
- `user_id -> auth.users.id`

Indexes:
- none declared

### `vendor_performance`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `vendor_id UUID` FK -> `vendors.id`
- `event_id UUID` FK -> `events.id`
- `on_time BOOLEAN`
- `score DECIMAL(3,2)`
- `created_at TIMESTAMPTZ`

Relationships:
- `vendor_id -> vendors.id`
- `event_id -> events.id`

Indexes:
- none declared

### `audit_logs`

Status: `legacy`

Source migrations: `001_initial_schema.sql`

Fields:
- `id UUID` primary key
- `user_id UUID` FK -> `auth.users.id`
- `action VARCHAR(255)` required
- `timestamp TIMESTAMPTZ`

Relationships:
- `user_id -> auth.users.id`

Indexes:
- none declared

## 5. Practical Relationship Summary

The dominant business relationships in the current repo are:

- `auth.users -> user_profiles / planner_profiles / admin_profiles`
- `auth.users -> events` through `planner_id` and `client_id`
- `events -> event_functions -> timeline_items`
- `events -> booking_requests -> vendors`
- `events -> budget_items -> financial_payments`
- `events -> vendor_assignments -> vendor_updates`
- `events -> invoices -> invoice_items`
- `events -> proposal_snapshots`
- `events -> client_messages`
- `events -> event_specs`
- `events -> tasks` and separately `events -> event_tasks`
- `intakes` and `event_intakes` both convert into `events`

## 6. Bottom Line

The repo contains 47 PostgreSQL tables, but the database layer is not a single clean schema generation.

The most important handover fact is that several domains are represented by parallel or conflicting tables:

- `tasks` and `event_tasks`
- `payments` and `financial_payments`
- `intakes` and `event_intakes`
- old and new `user_profiles`
- old and new `notifications`
- old and new `checklists`

Any database change in this codebase should start by checking both:

1. the migration history in `supabase/migrations`
2. the live repository/action code that currently reads and writes the table

because those two layers are not fully aligned in this snapshot.
