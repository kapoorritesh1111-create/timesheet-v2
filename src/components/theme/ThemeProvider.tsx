"use client";

import { useEffect, useMemo, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseBrowser";

export type Density = "comfortable" | "compact";

export type ThemePrefs = {
  accent?: string;   // e.g. "#2563eb"
  radius?: number;   // px
  density?: Density; // comfortable/compact
};

const DEFAULT_PREFS: Required<ThemePrefs> = {
  accent: "#2563eb",
  radius: 12,
  density: "comfortable",
};

function safeParse(json: string | null) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useProfile();

  // NOTE: Profile TS type may not include ui_prefs yet; treat as any to avoid build failures.
  const profileAny = profile as any;

  const [prefs, setPrefs] = useState<Required<ThemePrefs>>(DEFAULT_PREFS);

  // Load prefs: profile.ui_prefs wins; otherwise localStorage; otherwise default
  useEffect(() => {
    const fromProfile = (profileAny?.ui_prefs as ThemePrefs | undefined) || null;
    const fromLocal = safeParse(localStorage.getItem("ts_theme_prefs")) as ThemePrefs | null;

    const merged: Required<ThemePrefs> = {
      accent: fromProfile?.accent || fromLocal?.accent || DEFAULT_PREFS.accent,
      radius: clamp(Number(fromProfile?.radius ?? fromLocal?.radius ?? DEFAULT_PREFS.radius), 6, 20),
      density:
        ((fromProfile?.density || fromLocal?.density || DEFAULT_PREFS.density) as any) === "compact"
          ? "compact"
          : "comfortable",
    };

    setPrefs(merged);
  }, [profileAny?.id]);

  // Apply CSS variables
  useEffect(() => {
    const root = document.documentElement;

    root.style.setProperty("--accent", prefs.accent);
    root.style.setProperty("--radius", `${prefs.radius}px`);

    if (prefs.density === "compact") {
      root.style.setProperty("--space-1", "6px");
      root.style.setProperty("--space-2", "10px");
      root.style.setProperty("--space-3", "14px");
      root.style.setProperty("--input-h", "36px");
    } else {
      root.style.setProperty("--space-1", "8px");
      root.style.setProperty("--space-2", "12px");
      root.style.setProperty("--space-3", "16px");
      root.style.setProperty("--input-h", "40px");
    }
  }, [prefs]);

  const api = useMemo(() => {
    return {
      prefs,
      async save(next: ThemePrefs) {
        const merged: Required<ThemePrefs> = {
          accent: next.accent || prefs.accent,
          radius: clamp(Number(next.radius ?? prefs.radius), 6, 20),
          density: next.density === "compact" ? "compact" : "comfortable",
        };

        // Save locally immediately
        localStorage.setItem("ts_theme_prefs", JSON.stringify(merged));
        setPrefs(merged);

        // Persist to profile if logged in
        if (profileAny?.id) {
          await supabase.from("profiles").update({ ui_prefs: merged }).eq("id", profileAny.id);
        }
      },
      reset() {
        localStorage.removeItem("ts_theme_prefs");
        setPrefs(DEFAULT_PREFS);
      },
    };
  }, [prefs, profileAny?.id]);

  // Convenience global handle (optional)
  // @ts-ignore
  if (typeof window !== "undefined") window.__TS_THEME__ = api;

  return <>{children}</>;
}
