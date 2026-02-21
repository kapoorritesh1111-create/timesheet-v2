// src/app/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "../lib/useProfile";
import { isProfileComplete } from "../lib/profileCompletion";

export default function HomePage() {
  const router = useRouter();
  const { loading, userId, profile } = useProfile();

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

    router.replace("/dashboard");
  }, [loading, userId, profile, router]);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1>Loading…</h1>
      <p style={{ opacity: 0.75 }}>
        Redirecting to your workspace.
      </p>
    </main>
  );
}
