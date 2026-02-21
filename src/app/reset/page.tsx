"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseBrowser";

export default function ResetPassword() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const passwordOk = useMemo(() => {
    // Simple baseline. You can strengthen later.
    return (password || "").trim().length >= 8;
  }, [password]);

  async function updatePassword() {
    setMsg("");
    setBusy(true);

    const { error } = await supabase.auth.updateUser({ password: password.trim() });

    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Password updated ✅ Redirecting…");
    router.replace("/onboarding");
  }

  return (
    <main style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <h1>Set Password</h1>
      <p style={{ opacity: 0.75 }}>
        Use this page after opening an invite or recovery link.
      </p>

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, opacity: 0.8 }}>New password</span>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type={show ? "text" : "password"}
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ padding: 12, borderRadius: 10, border: "1px solid #ccc", flex: 1 }}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              style={{
                borderRadius: 10,
                border: "1px solid #ddd",
                padding: "10px 12px",
                fontWeight: 700,
                background: "#fff",
              }}
              title={show ? "Hide password" : "Show password"}
            >
              {show ? "Hide" : "Show"}
            </button>
          </div>

          {!passwordOk && password.length > 0 ? (
            <div style={{ fontSize: 12, opacity: 0.75 }}>Use at least 8 characters.</div>
          ) : null}
        </label>

        <button
          onClick={updatePassword}
          disabled={!passwordOk || busy}
          style={{
            borderRadius: 10,
            border: "none",
            padding: 12,
            fontWeight: 600,
            background: !passwordOk || busy ? "#bbb" : "#111",
            color: "white",
          }}
        >
          {busy ? "Saving..." : "Save Password"}
        </button>

        {msg && (
          <div style={{ padding: 12, borderRadius: 10, background: "#f5f5f5" }}>
            {msg}
          </div>
        )}
      </div>
    </main>
  );
}
