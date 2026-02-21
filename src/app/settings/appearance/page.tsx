"use client";

import RequireOnboarding from "../../../components/auth/RequireOnboarding";
import AppShell from "../../../components/layout/AppShell";
import { useProfile } from "../../../lib/useProfile";

export default function AppearanceSettingsPage() {
  const { profile } = useProfile();
  const prefs = ((profile as any)?.ui_prefs || {}) as any;

  async function save(patch: any) {
    // @ts-ignore
    const api = typeof window !== "undefined" ? window.__TS_THEME__ : null;
    if (api?.save) await api.save(patch);
  }

  function reset() {
    // @ts-ignore
    const api = typeof window !== "undefined" ? window.__TS_THEME__ : null;
    api?.reset?.();
  }

  return (
    <RequireOnboarding>
      <AppShell title="Appearance" subtitle="Customize your workspace theme">
        <div className="card cardPad" style={{ maxWidth: 720 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                Accent color
              </div>
              <input
                type="color"
                defaultValue={prefs.accent || "#2563eb"}
                onChange={(e) => save({ accent: e.target.value })}
                style={{ height: 42, width: "100%" }}
              />
            </div>

            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                Radius
              </div>
              <input
                type="number"
                min={6}
                max={20}
                defaultValue={prefs.radius ?? 12}
                onChange={(e) => save({ radius: Number(e.target.value) })}
              />
            </div>

            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                Density
              </div>
              <select defaultValue={prefs.density || "comfortable"} onChange={(e) => save({ density: e.target.value })}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <button className="btn" onClick={reset}>
              Reset to default
            </button>
          </div>

          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Saved per-user (stored in your profile).
          </div>
        </div>
      </AppShell>
    </RequireOnboarding>
  );
}
