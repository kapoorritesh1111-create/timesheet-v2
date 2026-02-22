// src/app/admin/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import RequireOnboarding from "../../components/auth/RequireOnboarding";
import AppShell from "../../components/layout/AppShell";
import { supabase } from "../../lib/supabaseBrowser";
import { useProfile } from "../../lib/useProfile";

type Role = "admin" | "manager" | "contractor";
type ManagerRow = { id: string; full_name: string | null; role: Role };

function isValidEmail(s: string) {
  const v = s.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function AdminPage() {
  return (
    <RequireOnboarding>
      <AdminInner />
    </RequireOnboarding>
  );
}

function AdminInner() {
  const { loading: profLoading, userId, profile, error: profErr } = useProfile();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [hourlyRate, setHourlyRate] = useState<number>(0);
  const [inviteRole, setInviteRole] = useState<Exclude<Role, "admin">>("contractor");

  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const [managerId, setManagerId] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const isAdmin = profile?.role === "admin";

  const canSend = useMemo(() => {
    if (!isValidEmail(email)) return false;
    if (!fullName.trim()) return false;
    if (!["manager", "contractor"].includes(inviteRole)) return false;

    if (inviteRole === "contractor") {
      if (!managerId) return false;
      if (Number.isNaN(hourlyRate) || hourlyRate < 0) return false;
    }
    return true;
  }, [email, fullName, inviteRole, hourlyRate, managerId]);

  // Load managers list for assignment
  useEffect(() => {
    if (!profile?.org_id) return;
    if (!isAdmin) return;

    let cancelled = false;
    (async () => {
      setMsg("");

      const { data: mgrs, error: mgrErr } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("org_id", profile.org_id)
        .in("role", ["admin", "manager"])
        .eq("is_active", true)
        .order("role", { ascending: true })
        .order("full_name", { ascending: true });

      if (cancelled) return;

      if (mgrErr) {
        setManagers([]);
        setManagerId("");
        setMsg(mgrErr.message);
        return;
      }

      const list = (((mgrs as any) ?? []) as ManagerRow[]) || [];
      setManagers(list);

      // Default manager pick: first manager (not admin) if present, else first
      const prefer = list.find((m) => m.role === "manager")?.id || list[0]?.id || "";
      setManagerId((prev) => prev || prefer);
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.org_id, isAdmin]);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setBusy(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setMsg("Not logged in.");
        return;
      }

      const body = {
        email: email.trim(),
        full_name: fullName.trim(),
        hourly_rate: inviteRole === "contractor" ? Number(hourlyRate ?? 0) : 0,
        role: inviteRole,
        manager_id: inviteRole === "contractor" ? (managerId || null) : null,
      };

      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setMsg(json?.error || `Invite failed (${res.status})`);
        return;
      }

      setMsg("Invite sent ✅");

      // Reset inputs (keep manager selection to speed up invites)
      setEmail("");
      setFullName("");
      setHourlyRate(0);
      setInviteRole("contractor");
    } catch (err: any) {
      setMsg(err?.message || "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  if (profLoading) {
    return (
      <AppShell title="Admin" subtitle="Loading…">
        <div className="card cardPad" style={{ maxWidth: 980 }}>
          <div className="skeleton" style={{ height: 16, width: 220 }} />
          <div className="skeleton" style={{ height: 42, width: "100%", marginTop: 10 }} />
          <div className="skeleton" style={{ height: 300, width: "100%", marginTop: 10 }} />
        </div>
      </AppShell>
    );
  }

  if (!userId) {
    return (
      <AppShell title="Admin" subtitle="Admin-only tools">
        <div className="card cardPad" style={{ maxWidth: 980 }}>
          <div style={{ fontWeight: 950 }}>Please log in.</div>
        </div>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell title="Admin" subtitle="Admin-only tools">
        <div className="card cardPad" style={{ maxWidth: 980 }}>
          <div style={{ fontWeight: 950 }}>Profile missing</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{profErr || "No profile found."}</pre>
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell title="Admin" subtitle="Admin-only tools">
        <div className="card cardPad" style={{ maxWidth: 980, borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.06)" }}>
          <div style={{ fontWeight: 950 }}>Admin only</div>
          <div className="muted" style={{ marginTop: 6 }}>
            Your role is <b>{profile.role}</b>. Ask an admin for access if needed.
          </div>
          {msg ? <div style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 13 }}>{msg}</div> : null}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Admin" subtitle="Invite users and maintain org setup">
      {msg ? (
        <div
          className="card cardPad"
          style={{
            maxWidth: 980,
            marginBottom: 12,
            borderColor: msg.includes("✅") ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
            background: msg.includes("✅") ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)",
          }}
        >
          <div style={{ fontWeight: 950 }}>{msg.includes("✅") ? "Success" : "Notice"}</div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 6, fontSize: 13 }}>{msg}</div>
        </div>
      ) : null}

      <div className="card cardPad" style={{ maxWidth: 980 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 950, fontSize: 16 }}>Invite user</div>
            <div className="muted" style={{ marginTop: 6 }}>
              Contractors require a manager. Managers don’t require an hourly rate.
            </div>
          </div>
          <span className="tag">Admin</span>
        </div>

        <form onSubmit={sendInvite} style={{ marginTop: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr", gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>Email</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                inputMode="email"
                autoComplete="email"
              />
              {!email.trim() ? null : !isValidEmail(email) ? (
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Enter a valid email.</div>
              ) : null}
            </div>

            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>Full name</div>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Contractor"
                autoComplete="name"
              />
              {!fullName.trim() ? <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Full name is required.</div> : null}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>Role</div>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as any)}
              >
                <option value="contractor">contractor</option>
                <option value="manager">manager</option>
              </select>
            </div>

            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
                Hourly rate {inviteRole === "manager" ? "(n/a)" : ""}
              </div>
              <input
                value={Number.isNaN(hourlyRate) ? "" : hourlyRate}
                onChange={(e) => setHourlyRate(Number(e.target.value))}
                type="number"
                step="0.01"
                min="0"
                disabled={inviteRole === "manager"}
              />
              {inviteRole === "manager" ? (
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Managers don’t use hourly rate for payroll.</div>
              ) : null}
            </div>
          </div>

          {inviteRole === "contractor" ? (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>Assign manager</div>
              <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">Select…</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {(m.full_name || m.id).slice(0, 60)} — {m.role}
                  </option>
                ))}
              </select>
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                This controls who can approve and view this contractor in People/Approvals/Payroll.
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEmail("");
                setFullName("");
                setHourlyRate(0);
                setInviteRole("contractor");
                setMsg("");
              }}
              disabled={busy}
            >
              Clear
            </button>

            <button type="submit" className="btn btnPrimary" disabled={!canSend || busy}>
              {busy ? "Sending…" : "Send invite"}
            </button>
          </div>
        </form>
      </div>

      <div className="card cardPad" style={{ maxWidth: 980, marginTop: 12 }}>
        <div style={{ fontWeight: 950 }}>Next improvements (optional)</div>
        <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          Add an “Invite history” section (last 20 invites), and add an “Org settings” panel (name, default week start).
        </div>
      </div>
    </AppShell>
  );
}
