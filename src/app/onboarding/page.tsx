// src/app/onboarding/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/layout/AppShell";
import { supabase } from "../../lib/supabaseBrowser";
import { useProfile } from "../../lib/useProfile";
import { isProfileComplete } from "../../lib/profileCompletion";

export default function OnboardingPage() {
  const router = useRouter();
  const { loading, userId, profile, error } = useProfile();

  const isContractor = (profile?.role || "").toLowerCase() === "contractor";

  const [fullName, setFullName] = useState("");
  const [hourlyRate, setHourlyRate] = useState<number>(0);

  // Matches CURRENT DB baseline
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Prefill from profile
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name || "");
    setHourlyRate(Number(profile.hourly_rate ?? 0));
    setPhone(profile.phone || "");
    setAddress(profile.address || "");
    setAvatarUrl(profile.avatar_url || "");
  }, [profile]);

  // If not logged in, go login.
  useEffect(() => {
    if (loading) return;
    if (!userId) router.replace("/login");
  }, [loading, userId, router]);

  // If already complete, go dashboard.
  useEffect(() => {
    if (loading) return;
    if (profile && isProfileComplete(profile)) {
      router.replace("/dashboard");
    }
  }, [loading, profile, router]);

  const canSave = useMemo(() => {
    const nameOk = fullName.trim().length >= 2;
    if (!nameOk) return false;

    if (isContractor) {
      const rateOk = Number.isFinite(hourlyRate) && hourlyRate > 0;
      if (!rateOk) return false;
    }

    return true;
  }, [fullName, hourlyRate, isContractor]);

  async function save() {
    if (!profile) return;

    setBusy(true);
    setMsg("");

    const patch: any = {
      full_name: fullName.trim(),
      hourly_rate: isContractor ? Number(hourlyRate) : 0, // your DB currently defaults to 0
      phone: phone.trim() || null,
      address: address.trim() || null,
      avatar_url: avatarUrl.trim() || null,
      onboarding_completed_at: new Date().toISOString(),
    };

    const { error: err } = await supabase.from("profiles").update(patch).eq("id", profile.id);

    if (err) {
      setMsg(err.message);
      setBusy(false);
      return;
    }

    router.replace("/dashboard");
  }

  return (
    <AppShell
      title="Complete your profile"
      subtitle="Just one minute — confirm your details so your account is set up correctly."
    >
      <div className="card">
        {loading ? (
          <div style={{ padding: 14 }}>Loading…</div>
        ) : !userId ? (
          <div style={{ padding: 14 }}>
            <p>Please log in.</p>
            <button className="btn" onClick={() => router.push("/login")}>
              Go to Login
            </button>
          </div>
        ) : !profile ? (
          <div style={{ padding: 14 }}>
            <div style={{ fontWeight: 800 }}>Profile could not be loaded.</div>
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{error || "No details."}</pre>
          </div>
        ) : (
          <div style={{ padding: 14, display: "grid", gap: 14 }}>
            {msg ? (
              <div className="card" style={{ padding: 12 }}>
                {msg}
              </div>
            ) : null}

            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, opacity: 0.85 }}>Full name *</span>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  className="input"
                  autoComplete="name"
                />
              </label>

              {isContractor ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>Hourly rate (USD) *</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={Number(hourlyRate)}
                    onChange={(e) => setHourlyRate(Number(e.target.value))}
                    placeholder="e.g. 85"
                    className="input"
                  />
                </label>
              ) : null}
            </div>

            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Optional (professional profile)</div>

              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>Phone</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(optional)"
                    className="input"
                    autoComplete="tel"
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>Address</span>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="(optional)"
                    className="input"
                    autoComplete="street-address"
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>Avatar image URL</span>
                  <input
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://… (optional)"
                    className="input"
                    inputMode="url"
                  />
                </label>

                {avatarUrl.trim() ? (
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarUrl.trim()}
                      alt="Avatar preview"
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 999,
                        objectFit: "cover",
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                      onError={(e) => {
                        // Hide broken image preview
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Preview (if the link is publicly accessible).
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="btnPrimary"
                disabled={!canSave || busy}
                onClick={save}
                title={!canSave ? "Please fill required fields" : "Save profile"}
              >
                {busy ? "Saving…" : "Save & Continue"}
              </button>

              <button className="btn" onClick={() => router.replace("/dashboard")} disabled={busy}>
                Skip for now
              </button>
            </div>

            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Tip: later we can upgrade avatar to an upload button (Supabase Storage) instead of URL.
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
