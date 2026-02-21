// src/app/dashboard/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/layout/AppShell";
import { useProfile } from "../../lib/useProfile";
import { isProfileComplete } from "../../lib/profileCompletion";

export default function DashboardPage() {
  const router = useRouter();
  const { loading, userId, profile, error } = useProfile();

  useEffect(() => {
    if (loading) return;

    if (!userId) {
      router.replace("/login");
      return;
    }

    if (!isProfileComplete(profile)) {
      router.replace("/onboarding");
      return;
    }
  }, [loading, userId, profile, router]);

  if (loading) {
    return (
      <AppShell title="Dashboard">
        <div className="card" style={{ padding: 14 }}>
          Loading…
        </div>
      </AppShell>
    );
  }

  if (!userId) {
    return null;
  }

  if (!profile) {
    return (
      <AppShell title="Dashboard">
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 800 }}>Profile missing</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
            {error || "No profile found."}
          </pre>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Dashboard"
      subtitle={`Welcome back${profile.full_name ? `, ${profile.full_name}` : ""}`}
    >
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>
          Account Overview
        </div>

        <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
          <div>
            <strong>Role:</strong> {profile.role}
          </div>

          {profile.role === "contractor" && (
            <div>
              <strong>Hourly Rate:</strong>{" "}
              {Number(profile.hourly_rate ?? 0).toFixed(2)}
            </div>
          )}

          <div>
            <strong>Active:</strong>{" "}
            {profile.is_active ? "Yes" : "No"}
          </div>

          <div>
            <strong>Onboarding Completed:</strong>{" "}
            {profile.onboarding_completed_at ? "Yes" : "No"}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
