// src/components/auth/RequireOnboarding.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "../../lib/useProfile";
import { isProfileComplete } from "../../lib/profileCompletion";

type Props = {
  children: React.ReactNode;
};

export default function RequireOnboarding({ children }: Props) {
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
  }, [loading, userId, profile, router]);

  if (loading) return null;
  if (!userId) return null;
  if (!isProfileComplete(profile)) return null;

  return <>{children}</>;
}
