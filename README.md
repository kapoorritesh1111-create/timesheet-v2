# Timesheet SaaS — Current Baseline (Next.js 14 + Supabase, DB-first)

This README is the **working baseline** for the repo + DB so we can keep iterating without losing context.

---

## 1) What this app is

A multi-tenant timesheet + approvals + payroll reporting app with strict org scoping.

### Roles
- **admin**
  - Full org visibility
  - Invite users (manager/contractor), assign contractor → manager
  - Create projects + activate/deactivate
  - Manage project access (People → Project access mode)
  - Approve anyone
- **manager**
  - Scope = **direct reports only**
  - Can view submitted entries for direct reports and approve/reject
  - Can open **People** (profiles) but only see assigned reports (and self)
- **contractor**
  - Scope = self only
  - Can submit timesheets only for assigned projects

---

## 2) Pages that are in a “good” state now

### ✅ Login / Reset / Onboarding
- Auth works via Supabase Auth
- Onboarding gate enforced (RequireOnboarding + `isProfileComplete()` checks)

### ✅ Dashboard (`/dashboard`)
- Clean landing after login/onboarding
- Shows basic account overview (role, active flag, onboarding status, hourly rate for contractors)

### ✅ Timesheet (`/timesheet`)
- Standard timesheet entry flow
- Uses DB-backed view (`v_time_entries`) for consistent computed hours and reporting fields

### ✅ Projects (`/projects`)
- Admin:
  - Create project (includes `week_start`)
  - Activate/deactivate
  - Assign projects to a user via `/projects?user=<id>`
- Manager/Contractor:
  - Sees only allowed projects (via RLS + membership)
- Drawer UX:
  - Click project row opens details drawer
  - Shows project settings + a read-only member list

### ✅ Approvals (`/approvals`)
- Manager/Admin only
- Loads submitted entries for the selected week (week navigation included)
- Approve = sets week’s submitted rows → approved
- Reject = sets week’s submitted rows → rejected (sent back editable)

### ✅ Payroll report (`/reports/payroll`)
- Uses `v_time_entries.hours_worked` + `time_entries.hourly_rate_snapshot`
- Filters:
  - Date preset (week/month/custom)
  - Status
  - Project
  - Contractor (admin/manager; contractor is locked to self)
- Outputs:
  - KPI cards (Total Hours, Total Pay, Avg Rate)
  - Summary by Contractor
  - Summary by Project
  - CSV export (summary or detail)

### ✅ Admin Invite (`/admin`)
- Admin-only (RequireOnboarding + role guard)
- Invite user via `/api/admin/invite`
- Supports:
  - Invite manager
  - Invite contractor with:
    - hourly rate
    - required manager assignment

### ✅ People / Profiles (`/profiles`)
- “People” directory + edit page
- Visibility intent:
  - Admin: all org users
  - Manager: self + direct reports
  - Contractor: self only
- Edit rules (UI + should align with DB policies):
  - Admin can edit everyone
  - Manager can edit self + direct reports (esp. hourly rate for direct reports)
  - Contractor can only edit self (limited fields)

> NOTE: This page is still the most visually inconsistent vs the newer pages (it uses older layout patterns vs AppShell + theme classes).

---

## 3) Navigation (TopNav)

- TopNav is hidden on: `/`, `/login`, `/reset`, `/onboarding`
- Visible links by role:
  - Everyone: Dashboard, Timesheet, Payroll, Projects
  - Manager/Admin: Approvals, People
  - Admin only: Admin

---

## 4) Database baseline (critical)

### Core tables (RLS enabled)
- `orgs`
- `profiles`
- `projects`
- `project_members`
- `time_entries`

### View: `v_time_entries` (read model)
This view is the primary read model for:
- `/approvals`
- `/reports/payroll`
- (and optionally `/timesheet` UI lists)

It must include **computed hours**:

- `hours_worked` computed in SQL (recommended logic):
  - `hours = (time_out - time_in) - lunch_hours`
  - handles NULLs safely
  - clamps negatives to 0 (recommended)

This view should also expose (at minimum):
- `org_id`, `user_id`, `project_id`, `entry_date`, `status`, `notes`
- `hours_worked`
- `hourly_rate_snapshot`

Optional (nice for UI):
- `full_name` (from profiles)
- `project_name` (from projects)

---

## 5) Repo structure

src/
- app/
  - admin/
  - approvals/
  - dashboard/
  - profiles/
  - projects/
  - reports/payroll/
  - timesheet/
  - api/admin/invite/
- components/
  - auth/
  - layout/ (AppShell, TopNav)
- lib/
  - useProfile.ts
  - supabaseBrowser.ts
  - dateRanges.ts
  - date.ts

---

## 6) Environment variables

Required:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY   (server-only; API routes)
- NEXT_PUBLIC_SITE_URL        (invite redirect base)

---

## 7) Where we stand right now

### Solid + working
- End-to-end flow: login → onboarding → dashboard → timesheet → submit → approvals → payroll reporting
- Org scoping is DB-first (RLS is the source of truth)
- Approvals + Payroll run on `v_time_entries` so hours logic is consistent

### Remaining “polish + correctness” gaps
1) **People page UI consistency**
   - `/profiles` still uses older layout conventions vs the AppShell/theme system
   - Should be upgraded to match Projects/Payroll/Approvals (cards, grid, tags, alerts)

2) **Admin polish**
   - Optional: invite history panel (recent invites)
   - Optional: org settings (org name, default week start)

3) **DB/RLS validation pass (quick but important)**
   - Confirm managers can always select **self + direct reports** in `profiles`
   - Confirm `v_time_entries` exposes `org_id` + `hours_worked` (and optional names) used by pages
   - Add indexes if needed once data grows (entry_date, org_id, user_id, project_id, status)

---

## 8) Recommended next change (confirmed)

### Next step (highest value): Rebuild “People” to match theme
- Convert `/profiles/page.tsx` to use:
  - `AppShell`
  - the shared CSS classes used elsewhere (`card`, `cardPad`, `alert`, `pill`, `btnPrimary`, etc.)
- Keep the **exact same permissions logic** (no behavior change), just UX + consistency
- This is the biggest “professional” upgrade from login onward.

After that:
- Admin: add Invite History + Org Settings
- DB: performance indexes + tighten policies if any edge cases appear
