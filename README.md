# Timesheet

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
  - Should be able to open **People** (profiles) page but only see assigned reports
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

### ✅ Projects (`/projects`)
- Admin:
  - Create project (includes `week_start`)
  - Activate/deactivate
  - Assign projects to a user via `/projects?user=<id>`
- Manager/Contractor:
  - Sees only allowed projects (via RLS + membership)
- Drawer UX:
  - Click project row opens details drawer
  - Shows project settings + a read-only member list (member management can be expanded next)

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
  - Summary by Contractor
  - Summary by Project
  - CSV export (summary or detail)
  - KPI cards (Total Hours, Total Pay, Avg Rate)

### ✅ Admin Invite (`/admin`)
- Admin-only tools page (uses AppShell + RequireOnboarding)
- Invite user via `/api/admin/invite`
- Supports:
  - Invite manager
  - Invite contractor with:
    - hourly rate
    - required manager assignment

### ✅ People / Profiles (`/profiles`)
- Table-based “directory + edit” page
- Visibility intent:
  - Admin: all org users
  - Manager: self + direct reports
  - Contractor: self only
- Admin controls:
  - Change role (except cannot demote admin if you enforce that)
  - Assign manager to contractors
  - Activate/inactivate users
  - Edit hourly rates (admin can edit anyone; manager can edit direct reports)

> NOTE: This page is currently the **most visually inconsistent** (still uses old layout/buttons vs AppShell + theme).

---

## 3) Database baseline (critical)

### Core tables (RLS enabled)
- `orgs`
- `profiles`
- `projects`
- `project_members`
- `time_entries`

### View: `v_time_entries`
This is the primary read model for approvals + payroll.
It must include **computed hours**:

- `hours_worked` is computed in SQL (recommended formula):
  - `hours = (time_out - time_in) - lunch_hours`
  - safely handles NULLs
  - clamps negatives to 0 (recommended)

This view should also expose:
- `org_id`, `user_id`, `project_id`, `entry_date`, `status`, `notes`
- `hourly_rate_snapshot`
- optional: `full_name`, `project_name` for nicer UI

---

## 4) Repo structure
src/
app/
admin/
approvals/
dashboard/
profiles/
projects/
reports/payroll/
timesheet/
api/admin/invite/
components/
auth/
layout/ # AppShell, TopNav
lib/
useProfile.ts
supabaseBrowser.ts
dateRanges.ts
date.ts


---

## 5) Environment variables

Required:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY   (server-only; API routes)
- NEXT_PUBLIC_SITE_URL        (invite redirect base)

---

## 6) Where we stand right now (status)

### Solid + working
- End-to-end user flow: login → onboarding → dashboard → timesheet → submit → approvals → payroll reporting
- Org scoping is DB-first (RLS is the source of truth)
- Payroll + approvals use the view (`v_time_entries`) for consistent calculations

### Known gaps / improvements
1) **TopNav**
   - Manager should see **People** in nav (currently only Admin sees Profiles)
   - Link should still go to `/profiles` but label it “People”
   - `/profiles` page + RLS already ensures managers only see assigned users

2) **UI consistency / theme**
   - `/profiles` page still uses older styles and doesn’t use AppShell
   - Should be upgraded to match the newer “card/cardPad/pill/btnPrimary” system

3) **Admin**
   - Optional: add “Invite history” and “Org settings”
   - Optional: improve validation + error surfacing to match other pages

---

## 7) Recommended next change (confirmed)

### Next step #1 (small + high value): Nav + People for managers
- Update `TopNav` so managers see “People”
- Keep permissions enforced by RLS + the profiles page filtering
- This improves the “login onward” polish immediately

### Next step #2 (bigger but important): Rebuild `/profiles` with AppShell + theme
- Convert `/profiles/page.tsx` to:
  - Use `AppShell`
  - Use the same components/classes as Projects/Payroll/Approvals
  - Keep the exact same permissions logic, just improve UX and consistency

(After that: Admin polish + org settings + theme preferences.)

---
