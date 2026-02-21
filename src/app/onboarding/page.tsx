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

  // Optional “SaaS profile” fields (safe: we will attempt save, then fallback if columns missing)
  const [phone, setPhone] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [stateRegion, setStateRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Prefill from profile
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name || "");
    setHourlyRate(Number(profile.hourly_rate ?? 0));
  }, [profile]);

  // If not logged in, go login.
  useEffect(() => {
    if (loading) return;
    if (!userId) router.replace("/login");
  }, [loading, userId, router]);

  // If profile already complete, go dashboard.
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

    // Attempt to save extended fields too.
    // If your DB doesn’t have these columns yet, we fallback to only required fields.
    const patchExtended: any = {
      full_name: fullName.trim(),
      hourly_rate: isContractor ? Number(hourlyRate) : null,

      // Optional fields (require DB columns if you want them stored)
      phone: phone.trim() || null,
      address_line1: address1.trim() || null,
      address_line2: address2.trim() || null,
      city: city.trim() || null,
      state: stateRegion.trim() || null,
      postal_code: postalCode.trim() || null,
      country: country.trim() || null,

      // a nice flag for gating later, if you add the column
      onboarding_completed_at: new Date().toISOString(),
    };

    const { error: err1 } = await supabase.from("profiles").update(patchExtended).eq("id", profile.id);

    if (err1) {
      // Fallback: save only the minimal required columns (always exist in your current schema)
      const minimalPatch: any = {
        full_name: fullName.trim(),
        hourly_rate: isContractor ? Number(hourlyRate) : null,
      };

      const { error: err2 } = await supabase.from("profiles").update(minimalPatch).eq("id", profile.id);

      if (err2) {
        setMsg(err2.message);
        setBusy(false);
        return;
      }

      setMsg(
        "Saved the required profile fields. (Optional fields require DB columns — ask me and I’ll give you the SQL.)"
      );
      setBusy(false);
      router.replace("/dashboard");
      return;
    }

    setBusy(false);
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
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>Phone</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>Country</span>
                  <input value={country} onChange={(e) => setCountry(e.target.value)} className="input" />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>Address line 1</span>
                  <input value={address1} onChange={(e) => setAddress1(e.target.value)} className="input" />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>Address line 2</span>
                  <input value={address2} onChange={(e) => setAddress2(e.target.value)} className="input" />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>City</span>
                  <input value={city} onChange={(e) => setCity(e.target.value)} className="input" />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>State/Region</span>
                  <input value={stateRegion} onChange={(e) => setStateRegion(e.target.value)} className="input" />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, opacity: 0.85 }}>Postal code</span>
                  <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="input" />
                </label>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                If you want these optional fields saved, we’ll add DB columns in Supabase (I’ll give you the exact SQL).
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
          </div>
        )}
      </div>
    </AppShell>
  );
}
