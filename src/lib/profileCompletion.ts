// src/lib/profileCompletion.ts
import type { Profile } from "./useProfile";

/**
 * "Complete" profile definition for gating:
 * - User must be active
 * - full_name required
 * - contractors must have hourly_rate > 0
 * - onboarding_completed_at must be set (this is the explicit completion marker)
 */
export function isProfileComplete(profile: Profile | null): boolean {
  if (!profile) return false;

  if (profile.is_active === false) return false;

  const nameOk = (profile.full_name || "").trim().length >= 2;
  if (!nameOk) return false;

  const role = (profile.role || "").toLowerCase();
  if (role === "contractor") {
    const rate = Number(profile.hourly_rate ?? 0);
    if (!Number.isFinite(rate) || rate <= 0) return false;
  }

  // Explicit onboarding completion marker
  if (!profile.onboarding_completed_at) return false;

  return true;
}
