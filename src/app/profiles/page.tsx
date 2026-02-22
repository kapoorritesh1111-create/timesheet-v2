// src/app/profiles/page.tsx
"use client";

import RequireOnboarding from "../../components/auth/RequireOnboarding";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/layout/AppShell";
import { supabase } from "../../lib/supabaseBrowser";
import { useProfile } from "../../lib/useProfile";

type Role = "admin" | "manager" | "contractor";
type ActiveFilter = "all" | "active" | "inactive";
type ScopeFilter = "visible" | "all_org"; // visible = applies role scoping; all_org = admin only

type ProfileRow = {
  id: string;
  org_id: string;
  role: Role;
  full_name: string | null;
  hourly_rate: number | null;
  is_active: boolean | null;
  manager_id: string | null;
};

function normalize(s: string) {
  return s.trim().toLowerCase();
}

function tag(text: string, kind?: "ok" | "warn" | "muted") {
  const cls = kind === "ok" ? "tag tagOk" : kind === "warn" ? "tag tagWarn" : "tag";
  return <span className={cls}>{text}</span>;
}

function roleLabel(r: Role) {
  if (r === "admin") return "Admin";
  if (r === "manager") return "Manager";
  return "Contractor";
}

function activeLabel(v: boolean | null) {
  return v === false ? "Inactive" : "Active";
}

function safeName(r: ProfileRow) {
  return (r.full_name || "").trim() || "(no name)";
}

function ProfilesInner() {
  const router = useRouter();
  const { loading: profLoading, profile, userId, error: profErr } = useProfile();

  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState<string>("");

  // UI filters
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [scope, setScope] = useState<ScopeFilter>("visible");

  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";

  const visibleRows = useMemo(() => {
    if (!profile || !userId) return [];
    if (isAdmin) {
      // admin can optionally view visible scope (same as others) or all org
      if (scope === "all_org") return rows;
      // visible scope for admin = all org anyway, but keep option in case you later add admin scoping
      return rows;
    }

    // Manager sees self + direct reports
    if (isManager) return rows.filter((r) => r.id === userId || r.manager_id === userId);

    // Contractor sees self only
    return rows.filter((r) => r.id === userId);
  }, [rows, profile, userId, isAdmin, isManager, scope]);

  const managers = useMemo(() => {
    return rows
      .filter((r) => r.role === "manager" || r.role === "admin")
      .filter((r) => r.is_active !== false)
      .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
  }, [rows]);

  const filtered = useMemo(() => {
    const query = normalize(q);
    return visibleRows
      .filter((r) => {
        if (roleFilter !== "all" && r.role !== roleFilter) return false;
        if (activeFilter === "active" && r.is_active === false) return false;
        if (activeFilter === "inactive" && r.is_active !== false) return false;
        if (!query) return true;
        const hay = `${r.full_name || ""} ${r.id} ${r.role}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => safeName(a).localeCompare(safeName(b)));
  }, [visibleRows, q, roleFilter, activeFilter]);

  const counts = useMemo(() => {
    let total = visibleRows.length;
    let active = 0;
    let inactive = 0;
    let admins = 0;
    let managersC = 0;
    let contractors = 0;

    for (const r of visibleRows) {
      if (r.is_active === false) inactive++;
      else active++;

      if (r.role === "admin") admins++;
      else if (r.role === "manager") managersC++;
      else contractors++;
    }
    return { total, active, inactive, admins, managers: managersC, contractors, showing: filtered.length };
  }, [visibleRows, filtered.length]);

  useEffect(() => {
    if (!profile?.org_id) return;

    let cancelled = false;
    (async () => {
      setMsg("");
      const { data, error } = await supabase
        .from("profiles")
        .select("id, org_id, role, full_name, hourly_rate, is_active, manager_id")
        .eq("org_id", profile.org_id)
        .order("role", { ascending: true })
        .order("full_name", { ascending: true });

      if (cancelled) return;

      if (error) {
        setMsg(error.message);
        setRows([]);
        return;
      }

      setRows(((data as any) ?? []) as ProfileRow[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.org_id]);

  async function saveRow(id: string, patch: Partial<ProfileRow>) {
    setBusyId(id);
    setMsg("");

    const { error } = await supabase.from("profiles").update(patch).eq("id", id);
    if (error) {
      setMsg(error.message);
      setBusyId("");
      return;
    }

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setBusyId("");
  }

  if (profLoading) {
    return (
      <AppShell title="People" subtitle="Loading…">
        <div className="card cardPad prfShell">
          <div className="skeleton" style={{ height: 16, width: 220 }} />
          <div className="skeleton" style={{ height: 44, width: "100%", marginTop: 10 }} />
          <div className="skeleton" style={{ height: 360, width: "100%", marginTop: 10 }} />
        </div>
      </AppShell>
    );
  }

  if (!profile || !userId) {
    return (
      <AppShell title="People" subtitle="Profiles and access">
        <div className="card cardPad prfShell">
          <div style={{ fontWeight: 950, marginBottom: 8 }}>Please log in.</div>
          <button className="btnPrimary" onClick={() => router.push("/login")}>
            Go to Login
          </button>
        </div>
      </AppShell>
    );
  }

  const subtitle = isAdmin ? "Admin view (org users)" : isManager ? "Manager view (your team)" : "Your profile";

  const headerRight = (
    <div className="prfHeaderRight">
      <button className="pill" onClick={() => router.push("/dashboard")}>Dashboard</button>
      <button className="pill" onClick={() => router.push("/projects")}>Projects</button>
      <button className="pill" onClick={() => router.push("/timesheet")}>Timesheet</button>
      {isAdmin ? (
        <button className="pill" onClick={() => router.push("/admin")}>Admin</button>
      ) : null}
    </div>
  );

  return (
    <AppShell title="People" subtitle={subtitle} right={headerRight}>
      {msg ? (
        <div className="alert alertInfo">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg}</pre>
        </div>
      ) : null}

      <div className="card cardPad prfShell" style={{ marginTop: 14 }}>
        <div className="prfToolbar">
          <div className="prfLeft">
            <div className="prfField prfSearch">
              <div className="prfLabel">Search</div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, role, or ID…" />
            </div>

            <div className="prfField">
              <div className="prfLabel">Role</div>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)}>
                <option value="all">All</option>
                <option value="admin">admin</option>
                <option value="manager">manager</option>
                <option value="contractor">contractor</option>
              </select>
            </div>

            <div className="prfField">
              <div className="prfLabel">Status</div>
              <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            {isAdmin ? (
              <div className="prfField">
                <div className="prfLabel">Scope</div>
                <select value={scope} onChange={(e) => setScope(e.target.value as ScopeFilter)}>
                  <option value="visible">Visible</option>
                  <option value="all_org">All org</option>
                </select>
              </div>
            ) : null}

            <div className="prfClear">
              <button className="pill" onClick={() => { setQ(""); setRoleFilter("all"); setActiveFilter("all"); }}>
                Clear
              </button>
            </div>
          </div>

          <div className="prfRight">
            {tag(`Total: ${counts.total}`)}
            {tag(`Active: ${counts.active}`, "ok")}
            {tag(`Inactive: ${counts.inactive}`, "muted")}
            {tag(`Showing: ${counts.showing}`)}
          </div>
        </div>
      </div>

      {!profile ? (
        <div className="alert alertWarn" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 950 }}>Profile missing</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{profErr || "No profile found."}</pre>
        </div>
      ) : null}

      <div className="card cardPad prfShell" style={{ marginTop: 14 }}>
        <div className="prfHeader">
          <div>
            <div className="prfTitle">Profiles</div>
            <div className="muted prfSub">
              Edit name, role, manager, hourly rate and status based on permissions.
            </div>
          </div>
          {tag(String(filtered.length))}
        </div>

        {filtered.length === 0 ? (
          <div className="muted" style={{ marginTop: 12 }}>
            No results for your filters.
          </div>
        ) : (
          <div className="prfList" style={{ marginTop: 12 }}>
            {filtered.map((r) => {
              const isSelf = r.id === userId;
              const isDirectReport = r.manager_id === userId;

              const canEditRow =
                isAdmin ||
                (isManager && (isSelf || isDirectReport)) ||
                isSelf; // contractor self (name only; rate handled below)

              const canAssignManager = isAdmin && r.role === "contractor";
              const canChangeRole = isAdmin && r.role !== "admin";

              // Hourly rate rules:
              // - Admin can edit anyone (including themselves)
              // - Manager can edit direct reports
              const canEditHourlyRate = isAdmin || (isManager && isDirectReport);

              const saving = busyId === r.id;

              return (
                <div key={r.id} className={`prfRow ${r.is_active === false ? "prfRowInactive" : ""}`}>
                  <div className="prfRowTop">
                    <div className="prfRowName">
                      <span className="prfAvatar" aria-hidden>
                        {(safeName(r)[0] || "U").toUpperCase()}
                      </span>
                      <div>
                        <div className="prfNameLine">
                          <span className="prfNameText">{safeName(r)}</span>
                          {tag(roleLabel(r.role))}
                          {r.is_active === false ? tag("Inactive", "warn") : tag("Active", "ok")}
                          {isSelf ? tag("You") : null}
                        </div>
                        <div className="muted prfRowMeta">{r.id}</div>
                      </div>
                    </div>

                    <div className="prfRowActions">
                      <button
                        className="pill"
                        onClick={() => router.push(`/projects?user=${encodeURIComponent(r.id)}`)}
                        disabled={!isAdmin && !isManager && !isSelf}
                        title="Manage project access"
                      >
                        Project access
                      </button>

                      <button
                        className="btnPrimary"
                        disabled={!canEditRow || saving}
                        onClick={() =>
                          saveRow(r.id, {
                            full_name: r.full_name || null,
                            role: r.role,
                            manager_id: r.manager_id,
                            hourly_rate: Number(r.hourly_rate ?? 0),
                            is_active: r.is_active !== false,
                          })
                        }
                        title="Save changes"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>

                  <div className="prfGrid">
                    <div>
                      <div className="prfLabel">Full name</div>
                      <input
                        value={r.full_name ?? ""}
                        disabled={!canEditRow}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, full_name: e.target.value } : x)))
                        }
                        placeholder="Full name"
                      />
                    </div>

                    <div>
                      <div className="prfLabel">Role</div>
                      <select
                        value={r.role}
                        disabled={!canChangeRole}
                        onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, role: e.target.value as Role } : x)))}
                      >
                        <option value="contractor">contractor</option>
                        <option value="manager">manager</option>
                        {isAdmin ? <option value="admin">admin</option> : null}
                      </select>
                      {!canChangeRole ? <div className="muted prfHint">Role locked</div> : null}
                    </div>

                    <div>
                      <div className="prfLabel">Manager</div>
                      <select
                        value={r.manager_id ?? ""}
                        disabled={!canAssignManager}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, manager_id: e.target.value || null } : x)))
                        }
                      >
                        <option value="">—</option>
                        {managers.map((m) => (
                          <option key={m.id} value={m.id}>
                            {(m.full_name || m.id).slice(0, 40)}
                          </option>
                        ))}
                      </select>
                      {!canAssignManager ? <div className="muted prfHint">Admin only</div> : null}
                    </div>

                    <div>
                      <div className="prfLabel">Hourly rate</div>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={Number(r.hourly_rate ?? 0)}
                        disabled={!canEditHourlyRate}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, hourly_rate: Number(e.target.value) } : x)))
                        }
                      />
                      {!canEditHourlyRate ? <div className="muted prfHint">{isManager ? "Direct reports only" : "Locked"}</div> : null}
                    </div>

                    <div>
                      <div className="prfLabel">Status</div>
                      <select
                        value={r.is_active === false ? "inactive" : "active"}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, is_active: e.target.value === "active" } : x)))
                        }
                      >
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                      </select>
                      {!isAdmin ? <div className="muted prfHint">Admin only</div> : null}
                    </div>

                    <div>
                      <div className="prfLabel">Quick</div>
                      <div className="prfQuick">
                        <button className="pill" onClick={() => copyToClipboard(r.id)} title="Copy user ID">
                          Copy ID
                        </button>
                        <button className="pill" onClick={() => setMsg(`Selected: ${safeName(r)}\n${r.id}`)} title="Show details in message area">
                          Info
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

export default function ProfilesPage() {
  return (
    <RequireOnboarding>
      <ProfilesInner />
    </RequireOnboarding>
  );
}
