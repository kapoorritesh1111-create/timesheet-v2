# Timesheet

# Timesheet SaaS — Baseline v1.2 (DB-first, Next.js 14 + Supabase)

This document captures the **current baseline** (code + database) so we can safely continue work in a new chat without losing context.

---

## 1) Product summary

A multi-tenant timesheet + payroll web app with strict org/project scoping.

### Core features currently implemented
- **Auth**: Supabase Auth (email invite flow, login, reset).
- **Onboarding gate**: users must complete profile before using the app.
- **Roles**:
  - **admin**: full org visibility; can create projects; manage users; manage project access; update hourly rates; approve all.
  - **manager**: can view/approve **direct reports only** (strict team scope).
  - **contractor**: can create/edit own time entries; can only see projects they are assigned to.
- **Projects**:
  - Admin can create projects (UI).
  - Admin can activate/deactivate projects.
  - Project membership enforced for timesheet access + time entry insertion.
  - Project creation supports `week_start` (Sunday default; per-project option exists in DB).
- **Timesheet**:
  - Strict project membership enforced (contractors can only log time against assigned projects).
- **Payroll report**:
  - Uses `hourly_rate_snapshot` on time entries for audit-safe calculation (approved hours × snapshot rate).
- **Invite API**:
  - Admin-only endpoint that invites a user and optionally assigns them to `project_ids`.

---

## 2) Tech stack

- **Frontend**: Next.js 14 (App Router), TypeScript
- **Backend**: Supabase (Postgres + RLS + Auth)
- **Hosting**: Vercel
- **DB-first** approach: permissions are enforced in RLS (UI should mirror DB rules)

---

## 3) Repo structure (high level)

```
src/
  app/
    admin/            # admin screens (invite, etc.)
    api/
      admin/invite/   # server route: POST /api/admin/invite
    approvals/        # approval workflow UI
    dashboard/        # KPI / landing dashboard
    login/            # login page
    onboarding/       # onboarding UI (complete profile)
    profiles/         # user directory + hourly rates/admin tools
    projects/         # projects list + assignment UI
    reports/          # payroll + reporting
    reset/            # password reset UI
    settings/         # settings
    timesheet/        # timesheet UI
  components/
    auth/             # RequireOnboarding, gates
    layout/           # AppShell layout
    theme/            # theme prefs (ui_prefs) work-in-progress
  lib/
    date.ts
    dateRanges.ts
    profileCompletion.ts
    supabaseBrowser.ts
    supabaseServer.ts
    useProfile.ts
```

---

## 4) Environment variables (Vercel)

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`  *(server-side only; used by /api/admin/invite)*
- `NEXT_PUBLIC_SITE_URL` *(used for invite redirect: /auth/callback)*

Notes:
- `src/lib/supabaseServer.ts` uses the Service Role key; **never import into client components**.

---

## 5) Invite flow + project assignment logic

### API
**POST** `/api/admin/invite`  
File: `src/app/api/admin/invite/route.ts`

Request body:
```json
{
  "email": "user@example.com",
  "full_name": "Name",
  "hourly_rate": 50,
  "role": "manager|contractor",
  "manager_id": "uuid-or-null",
  "project_ids": ["uuid1","uuid2"]
}
```

Behavior:
1. Validates Bearer token (Supabase user session token).
2. Checks caller is **admin** via `profiles`.
3. Calls `supabase.auth.admin.inviteUserByEmail(email, { redirectTo })`.
4. Upserts invited user into `public.profiles`.
5. If `project_ids` provided:
   - Validates projects belong to caller’s org.
   - Upserts rows into `public.project_members` (onConflict currently `project_id,user_id` in code; DB uniqueness baseline is org_id+project_id+profile_id).

---

## 6) Database schema (current baseline)

### Tables (RLS enabled)
| table | notes |
|---|---|
| `orgs` | tenant container |
| `profiles` | one row per auth user; role, org_id, onboarding flag, ui_prefs |
| `projects` | org-scoped projects; includes `week_start` |
| `project_members` | membership between profiles/users and projects |
| `time_entries` | timesheet entries; includes `hourly_rate_snapshot` |

### Columns (as reported)
**profiles**
- `id (uuid)` PK (matches auth.uid)
- `org_id (uuid)`
- `full_name (text)`
- `role (text)` — `admin | manager | contractor`
- `hourly_rate (numeric)`
- `manager_id (uuid)` — direct report mapping for manager scope
- `is_active (bool)`
- `phone, address, avatar_url`
- `onboarding_completed_at (timestamptz)`
- `ui_prefs (jsonb)` — theme/UI preferences (present in DB)

**projects**
- `id (uuid)` PK
- `org_id (uuid)`
- `name (text)`
- `is_active (bool)`
- `parent_id (uuid)` (optional hierarchy)
- `week_start (text)` (Sunday default; project-level)

**project_members**
- `id (uuid)` PK
- `org_id (uuid)`
- `project_id (uuid)`
- `profile_id (uuid)`
- `user_id (uuid)` *(legacy/compat column; currently populated same as profile_id)*
- `is_active (bool)`
- `created_at (timestamptz)`

**time_entries**
- `id (uuid)` PK
- `org_id (uuid)`
- `user_id (uuid)`
- `project_id (uuid)`
- `entry_date (date)`
- `time_in (time)`, `time_out (time)`
- `lunch_hours (numeric)`
- `notes (text)`
- `mileage (numeric)`
- `status (text)` (draft/submitted/approved/rejected)
- `approved_by (uuid)`, `approved_at (timestamptz)`
- `hourly_rate_snapshot (numeric)` *(audit-safe payroll)*
- `created_at`, `updated_at`

---

## 7) RLS status

All core tables have RLS enabled and **NOT forced**:
- orgs: enabled ✅ / forced ❌
- profiles: enabled ✅ / forced ❌
- projects: enabled ✅ / forced ❌
- project_members: enabled ✅ / forced ❌
- time_entries: enabled ✅ / forced ❌

---

## 8) Key helper functions (public schema)

These exist and are SECURITY DEFINER (used by policies):
- `current_org_id() returns uuid`
- `current_user_role() returns text`
- `is_admin() returns boolean`

Important:
- Avoid policies that `SELECT` from `profiles` directly inside a `profiles` policy (can cause recursion).
- Current baseline uses helper functions to prevent recursion.

---

## 9) Current RLS policies (as-of snapshot)

### orgs
- `orgs_select_own` — select where `id = current_org_id()`

### profiles
- `profiles_select_own` — user can select self
- `profiles_select_safe` — (id=self) OR (admin & same org)
- `profiles_select_manager_reports` — manager can select direct reports (needs review: current qual includes manager_id = auth.uid())
- Updates:
  - `profiles_update_own`
  - `profiles_update_admin_org`
  - `profiles_update_manager_team` (admin/manager scope)

### projects
- `projects_select_org` — admin/manager sees org; contractor sees only member projects via `project_members`
- write policies for admin/manager insert/update; admin delete

### project_members
- `pm_select` — admin sees org; user sees own membership
- `pm_insert` / `pm_update` — admin only
- legacy policies also exist: `pm_admin_manager_write` / `pm_admin_manager_delete` (needs cleanup later to avoid surprises)

### time_entries
- `te_insert_own` — only own entries, must be member of project (or admin/manager)
- `te_select` — own OR admin OR manager (direct reports)
- `te_manager_approve` — admin approves all; manager approves direct reports
- `te_update_own_draft_rejected` — user can edit own entries in draft/rejected (and must still be project member)

---

## 10) Known issues / cleanup candidates (do not change in v1.2 baseline)

- **Policy duplication**: `project_members` has both `pm_*` and `pm_admin_manager_*` policies — permissive policies can broaden access unintentionally. Later step: consolidate to one clear set.
- **Type mismatch in code vs DB**: `profiles.ui_prefs (jsonb)` exists in DB, but TypeScript `Profile` in `useProfile.ts` does not include `ui_prefs` yet.
- **Invite upsert conflict keys**: invite route upserts `project_members` with `onConflict: "project_id,user_id"`, while DB baseline uniqueness is ideally `(org_id, project_id, profile_id)`. Keep as-is in v1.2; align later.

---

## 11) What “strict team scope” means (current target)

- Manager can **only** see/approve time entries for **direct reports** (`profiles.manager_id = manager auth.uid()`).
- Admin can see/update/approve **all** users in org.

This should be enforced in **RLS first**, and then mirrored in UI.

---

## 12) Roadmap (next SaaS steps after v1.2 baseline)

Recommended order:
1. **Stabilize/Consolidate RLS** (remove duplicates; prove manager scope with test users)
2. **Projects drawer member management** (UI feature) — after RLS is clean
3. **Reporting presets**: Current week / Last week / Current month / Last month + Custom
4. **CSV export**: “current table only” toggle + totals row
5. **Audit log** (enterprise trust)
6. **Notifications** (email + in-app)
7. **Billing & subscriptions** (Stripe) + org limits

---

## 13) Baseline tag

**Baseline label**: `v1.2`  
**Policy snapshot date**: captured in this README.  
When starting a new chat, paste this file first to preserve state.
