// src/lib/profileCompletion.ts
import type { Profile } from "./useProfile";

/**
 * Minimal "SaaS professional" completion rules:
 * - full_name is required for everyone
 * - contractors must have hourly_rate > 0
 * - inactive users are treated as not complete (they shouldn't proceed)
 *
 * You can tighten/expand later (phone/address/avatar, etc.)
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

  return true;
}
