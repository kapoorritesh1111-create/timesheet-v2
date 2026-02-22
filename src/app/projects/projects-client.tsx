"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "../../components/layout/AppShell";
import { supabase } from "../../lib/supabaseBrowser";
import { useProfile } from "../../lib/useProfile";

type WeekStart = "sunday" | "monday";
type ActiveFilter = "all" | "active" | "inactive";

type Project = {
  id: string;
  name: string;
  is_active: boolean;
  org_id: string;
  week_start?: WeekStart | null;
};

type MemberRow = {
  id: string;
  project_id: string;
  is_active: boolean;
};

type SimpleProfile = {
  id: string;
  full_name: string | null;
  role: string | null;
};

type DrawerMember = {
  profile_id: string;
  full_name: string | null;
  role: string | null;
};

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        border: "1px solid rgba(15,23,42,0.10)",
        background: "rgba(255,255,255,0.9)",
        fontSize: 12,
        fontWeight: 700,
        color: "rgba(15,23,42,0.75)",
      }}
    >
      {children}
    </span>
  );
}

function PillButton({
  children,
  onClick,
  disabled,
  title,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "primary" | "default" | "danger";
}) {
  const base: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.10)",
    background: "white",
    fontWeight: 850,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };

  const style: React.CSSProperties =
    variant === "primary"
      ? { ...base, borderColor: "rgba(37,99,235,0.25)", boxShadow: "0 1px 0 rgba(15,23,42,0.03)" }
      : variant === "danger"
        ? { ...base, borderColor: "rgba(239,68,68,0.25)" }
        : base;

  return (
    <button className="btn" style={style} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

function weekStartLabel(ws?: WeekStart | null) {
  const v = ws || "sunday";
  return v === "monday" ? "Week starts Monday" : "Week starts Sunday";
}

function normalize(s: string) {
  return s.trim().toLowerCase();
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    // ignore (some browsers)
  }
}

export default function ProjectsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading, userId, profile, error: profErr } = useProfile();

  const selectedProjectId = useMemo(() => searchParams.get("project") || "", [searchParams]);
  const manageUserId = useMemo(() => searchParams.get("user") || "", [searchParams]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [fetchErr, setFetchErr] = useState<string>("");

  // Assignment UI state (Admin only)
  const [manageUser, setManageUser] = useState<SimpleProfile | null>(null);
  const [memberMap, setMemberMap] = useState<Record<string, MemberRow>>({});

  // Busy states
  const [busyProjectId, setBusyProjectId] = useState<string>("");
  const [savingWeekStartId, setSavingWeekStartId] = useState<string>("");

  // Admin project creation state
  const [newName, setNewName] = useState("");
  const [newWeekStart, setNewWeekStart] = useState<WeekStart>("sunday");
  const [createBusy, setCreateBusy] = useState(false);

  // Search + filter
  const [q, setQ] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  // ✅ Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerProjectId, setDrawerProjectId] = useState<string>("");
  const [drawerMembers, setDrawerMembers] = useState<DrawerMember[]>([]);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [drawerMsg, setDrawerMsg] = useState<string>("");

  const isAdmin = profile?.role === "admin";
  const isManagerOrAdmin = profile?.role === "admin" || profile?.role === "manager";

  function setProjectInUrl(projectId: string) {
    const base = manageUserId ? `/projects?user=${encodeURIComponent(manageUserId)}` : "/projects";
    const url = projectId ? `${base}&project=${encodeURIComponent(projectId)}` : base;
    router.replace(url);
  }

  async function reloadProjects() {
    if (!profile) return;
    setFetchErr("");

    if (isManagerOrAdmin) {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, is_active, org_id, week_start")
        .eq("org_id", profile.org_id)
        .order("name", { ascending: true });

      if (error) {
        setFetchErr(error.message);
        return;
      }
      setProjects((data || []) as Project[]);
    } else {
      const { data, error } = await supabase
        .from("project_members")
        .select("project_id, projects:project_id (id, name, is_active, org_id, week_start)")
        .eq("profile_id", profile.id)
        .eq("is_active", true);

      if (error) {
        setFetchErr(error.message);
        return;
      }

      const flattened = (data || []).map((row: any) => row.projects).filter(Boolean) as Project[];
      const uniq = Array.from(new Map(flattened.map((p) => [p.id, p])).values());
      uniq.sort((a, b) => a.name.localeCompare(b.name));
      setProjects(uniq);
    }
  }

  useEffect(() => {
    if (loading) return;

    if (!userId) {
      router.replace("/login");
      return;
    }

    if (!profile) {
      setFetchErr(profErr || "Profile could not be loaded.");
      return;
    }

    reloadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, userId, profile, profErr, router]);

  // Load user being managed + membership map (Admin only)
  useEffect(() => {
    if (loading) return;
    if (!profile) return;

    if (!manageUserId) {
      setManageUser(null);
      setMemberMap({});
      return;
    }

    if (!isAdmin) {
      setFetchErr("Only Admin can manage project access.");
      return;
    }

    let cancelled = false;
    (async () => {
      setFetchErr("");

      const { data: u, error: uErr } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("id", manageUserId)
        .maybeSingle();

      if (cancelled) return;

      if (uErr) {
        setFetchErr(uErr.message);
        return;
      }
      if (!u) {
        setFetchErr("User not found.");
        return;
      }

      setManageUser(u as SimpleProfile);

      const { data: mem, error: memErr } = await supabase
        .from("project_members")
        .select("id, project_id, is_active")
        .eq("org_id", profile.org_id)
        .eq("profile_id", manageUserId);

      if (cancelled) return;

      if (memErr) {
        setFetchErr(memErr.message);
        return;
      }

      const map: Record<string, MemberRow> = {};
      for (const r of (mem as any) ?? []) {
        map[r.project_id] = r;
      }
      setMemberMap(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, profile, manageUserId, isAdmin]);

  const assignedProjectIds = useMemo(() => {
    return new Set(
      Object.entries(memberMap)
        .filter(([, v]) => v.is_active)
        .map(([k]) => k)
    );
  }, [memberMap]);

  const filteredProjects = useMemo(() => {
    const query = normalize(q);
    return projects.filter((p) => {
      if (activeFilter === "active" && !p.is_active) return false;
      if (activeFilter === "inactive" && p.is_active) return false;
      if (!query) return true;
      const hay = `${p.name} ${p.id}`.toLowerCase();
      return hay.includes(query);
    });
  }, [projects, q, activeFilter]);

  const counts = useMemo(() => {
    let total = projects.length;
    let active = 0;
    let inactive = 0;
    for (const p of projects) {
      if (p.is_active) active++;
      else inactive++;
    }
    return { total, active, inactive };
  }, [projects]);

  async function toggleAssignment(projectId: string, nextAssigned: boolean) {
    if (!profile) return;
    if (!isAdmin) return;
    if (!manageUserId) return;

    setBusyProjectId(projectId);
    setFetchErr("");

    try {
      const existing = memberMap[projectId];

      if (existing) {
        const { error } = await supabase.from("project_members").update({ is_active: nextAssigned }).eq("id", existing.id);
        if (error) {
          setFetchErr(error.message);
          return;
        }

        setMemberMap((prev) => ({
          ...prev,
          [projectId]: { ...existing, is_active: nextAssigned },
        }));
      } else {
        const payload: any = {
          org_id: profile.org_id,
          project_id: projectId,
          profile_id: manageUserId,
          user_id: manageUserId,
          is_active: true,
        };

        const { data, error } = await supabase.from("project_members").insert(payload).select("id, project_id, is_active").single();
        if (error) {
          setFetchErr(error.message);
          return;
        }

        setMemberMap((prev) => ({
          ...prev,
          [projectId]: data as MemberRow,
        }));
      }
    } finally {
      setBusyProjectId("");
    }
  }

  async function createProject() {
    if (!profile) return;
    if (!isAdmin) return;

    const name = newName.trim();
    if (name.length < 2) {
      setFetchErr("Project name must be at least 2 characters.");
      return;
    }

    setCreateBusy(true);
    setFetchErr("");

    try {
      const { error } = await supabase.from("projects").insert({
        org_id: profile.org_id,
        name,
        is_active: true,
        week_start: newWeekStart,
      });

      if (error) {
        setFetchErr(error.message);
        return;
      }

      setNewName("");
      setNewWeekStart("sunday");
      await reloadProjects();
    } finally {
      setCreateBusy(false);
    }
  }

  async function toggleProjectActive(projectId: string, nextActive: boolean) {
    if (!profile) return;
    if (!isAdmin) return;

    setBusyProjectId(projectId);
    setFetchErr("");

    try {
      const { error } = await supabase
        .from("projects")
        .update({ is_active: nextActive })
        .eq("id", projectId)
        .eq("org_id", profile.org_id);

      if (error) {
        setFetchErr(error.message);
        return;
      }

      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, is_active: nextActive } : p)));
    } finally {
      setBusyProjectId("");
    }
  }

  async function updateProjectWeekStart(projectId: string, weekStart: WeekStart) {
    if (!profile) return;
    if (!isAdmin) return;

    setSavingWeekStartId(projectId);
    setFetchErr("");

    try {
      const { error } = await supabase
        .from("projects")
        .update({ week_start: weekStart })
        .eq("id", projectId)
        .eq("org_id", profile.org_id);

      if (error) {
        setFetchErr(error.message);
        return;
      }

      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, week_start: weekStart } : p)));
    } finally {
      setSavingWeekStartId("");
    }
  }

  // ✅ Step 3: Drawer open + member load
  async function openDrawer(projectId: string) {
    setDrawerOpen(true);
    setDrawerProjectId(projectId);
    setDrawerMembers([]);
    setDrawerMsg("");
    setDrawerBusy(true);

    try {
      // Load members for the project (read-only)
      // NOTE: Requires select access to project_members within org scope.
      const { data, error } = await supabase
        .from("project_members")
        .select("profile_id, profiles:profile_id(full_name, role)")
        .eq("project_id", projectId)
        .eq("is_active", true);

      if (error) {
        setDrawerMsg(error.message);
        return;
      }

      const members: DrawerMember[] =
        (data || []).map((r: any) => ({
          profile_id: r.profile_id,
          full_name: r.profiles?.full_name ?? null,
          role: r.profiles?.role ?? null,
        })) || [];

      members.sort((a, b) => (a.full_name || a.profile_id).localeCompare(b.full_name || b.profile_id));
      setDrawerMembers(members);
    } finally {
      setDrawerBusy(false);
    }
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setDrawerProjectId("");
    setDrawerMembers([]);
    setDrawerMsg("");
    setDrawerBusy(false);
  }

  const drawerProject = useMemo(() => {
    if (!drawerProjectId) return null;
    return projects.find((p) => p.id === drawerProjectId) || null;
  }, [drawerProjectId, projects]);

  // ---- guards ----
  if (loading) {
    return (
      <AppShell title="Projects" subtitle="Create projects and manage access">
        <div className="card cardPad">Loading…</div>
      </AppShell>
    );
  }

  if (!userId) {
    return (
      <AppShell title="Projects" subtitle="Create projects and manage access">
        <div className="card cardPad">
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Please log in.</div>
          <button className="btn btnPrimary" onClick={() => router.push("/login")}>
            Go to Login
          </button>
        </div>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell title="Projects" subtitle="Create projects and manage access">
        <div className="card cardPad">
          <div style={{ fontWeight: 900 }}>Logged in, but profile could not be loaded.</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{profErr || "No details."}</pre>
        </div>
      </AppShell>
    );
  }

  const headerRight = (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {manageUserId ? (
        <>
          <button className="btn" onClick={() => router.push("/profiles")}>
            Back to People
          </button>
          <button className="btn" onClick={() => router.replace("/projects")}>
            Exit Access Mode
          </button>
        </>
      ) : null}
    </div>
  );

  const subtitle = manageUserId ? "Assign project access to a user" : "Create projects, activate/deactivate, and manage access";

  return (
    <AppShell title="Projects" subtitle={subtitle} right={headerRight}>
      {/* Error banner */}
      {fetchErr ? (
        <div
          className="card cardPad"
          style={{
            borderColor: "rgba(239,68,68,0.35)",
            background: "rgba(239,68,68,0.06)",
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Error</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{fetchErr}</div>
        </div>
      ) : null}

      {/* Admin: create project */}
      {isAdmin && !manageUserId ? (
        <div className="card cardPad" style={{ marginBottom: 12, maxWidth: 1100 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 950, fontSize: 16 }}>Create project</div>
              <div className="muted" style={{ marginTop: 6 }}>
                Project-level settings (like week start) are used across reports and timesheets.
              </div>
            </div>
            <Badge>Admin</Badge>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 12, marginTop: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Project name</div>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Retail KPI Dashboard" />
            </div>

            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Week start</div>
              <select value={newWeekStart} onChange={(e) => setNewWeekStart(e.target.value as WeekStart)}>
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "end" }}>
              <button className="btn btnPrimary" onClick={createProject} disabled={createBusy || newName.trim().length < 2}>
                {createBusy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Search + Filter bar */}
      <div className="card cardPad" style={{ marginBottom: 12, maxWidth: 1100 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 260 }}>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Search</div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or ID…" />
            </div>

            <div style={{ minWidth: 180 }}>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Status</div>
              <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}>
                <option value="all">All</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <button className="btn" onClick={() => { setQ(""); setActiveFilter("all"); }}>
                Clear
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Badge>Total: {counts.total}</Badge>
            <Badge>Active: {counts.active}</Badge>
            <Badge>Inactive: {counts.inactive}</Badge>
            <Badge>Showing: {filteredProjects.length}</Badge>
          </div>
        </div>
      </div>

      {/* Admin: manage access mode */}
      {isAdmin && manageUserId ? (
        <div className="card cardPad" style={{ marginBottom: 12, maxWidth: 1100 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 950, fontSize: 16 }}>Manage project access</div>
              <div className="muted" style={{ marginTop: 6 }}>
                User: <b>{manageUser?.full_name || manageUserId}</b> {manageUser?.role ? `(${manageUser.role})` : ""}
              </div>
            </div>
            <Badge>Grant / remove access</Badge>
          </div>

          <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            Toggle projects to grant access. Click a project row (not the checkbox) to open details.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {filteredProjects.length === 0 ? (
              <div className="muted">No projects match your filters.</div>
            ) : (
              filteredProjects.map((p) => {
                const assigned = assignedProjectIds.has(p.id);
                const busy = busyProjectId === p.id;

                return (
                  <div
                    key={p.id}
                    onClick={() => openDrawer(p.id)}
                    style={{
                      padding: 12,
                      border: "1px solid rgba(15,23,42,0.08)",
                      borderRadius: 14,
                      background: p.is_active ? "white" : "rgba(15,23,42,0.02)",
                      opacity: p.is_active ? 1 : 0.85,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                      cursor: "pointer",
                    }}
                    title="Open project details"
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <input
                        type="checkbox"
                        checked={assigned}
                        disabled={busy}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => toggleAssignment(p.id, e.target.checked)}
                        style={{ width: 18, height: 18 }}
                      />
                      <div>
                        <div style={{ fontWeight: 900, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <span>{p.name}</span>
                          {!p.is_active ? <Badge>Inactive</Badge> : null}
                          <Badge>{weekStartLabel(p.week_start)}</Badge>
                        </div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{p.id}</div>
                      </div>
                    </div>

                    <div className="muted" style={{ fontSize: 12 }}>
                      {busy ? "Updating…" : assigned ? "Assigned" : "Not assigned"}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {/* Projects list */}
      <div className="card cardPad" style={{ maxWidth: 1100 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 950, fontSize: 16 }}>All projects</div>
            <div className="muted" style={{ marginTop: 6 }}>
              Click a row to open project details. Use People → Project access to assign members.
            </div>
          </div>
          <Badge>Showing {filteredProjects.length}</Badge>
        </div>

        {filteredProjects.length === 0 ? (
          <div className="muted" style={{ marginTop: 12 }}>
            No projects match your filters.
          </div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {filteredProjects.map((p) => {
              const busy = busyProjectId === p.id;
              const savingWs = savingWeekStartId === p.id;

              return (
                <div
                  key={p.id}
                  onClick={() => openDrawer(p.id)}
                  style={{
                    padding: 12,
                    border: "1px solid rgba(15,23,42,0.08)",
                    borderRadius: 14,
                    background: "white",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                    cursor: "pointer",
                  }}
                  title="Open project details"
                >
                  <div>
                    <div style={{ fontWeight: 900, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span>{p.name}</span>
                      {!p.is_active ? <Badge>Inactive</Badge> : null}
                      <Badge>{weekStartLabel(p.week_start)}</Badge>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{p.id}</div>
                  </div>

                  <div
                    style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isAdmin ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span className="muted" style={{ fontSize: 12, fontWeight: 800 }}>Week start</span>
                        <select
                          value={(p.week_start || "sunday") as WeekStart}
                          disabled={savingWs}
                          onChange={(e) => updateProjectWeekStart(p.id, e.target.value as WeekStart)}
                          style={{ minWidth: 130 }}
                        >
                          <option value="sunday">Sunday</option>
                          <option value="monday">Monday</option>
                        </select>
                        <span className="muted" style={{ fontSize: 12, minWidth: 70 }}>{savingWs ? "Saving…" : ""}</span>
                      </div>
                    ) : null}

                    <button className="btn" onClick={() => setProjectInUrl(p.id)}>Select</button>

                    {isAdmin ? (
                      <button className="btn" disabled={busy} onClick={() => toggleProjectActive(p.id, !p.is_active)}>
                        {busy ? "Working…" : p.is_active ? "Deactivate" : "Activate"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Selected project</div>
          <select value={selectedProjectId} onChange={(e) => setProjectInUrl(e.target.value)} style={{ maxWidth: 520 }}>
            <option value="">— Select a project —</option>
            {filteredProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ✅ Drawer */}
      {drawerOpen && drawerProject ? (
        <div
          onClick={closeDrawer}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.35)",
            zIndex: 50,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 92vw)",
              height: "100%",
              background: "white",
              borderLeft: "1px solid rgba(15,23,42,0.10)",
              boxShadow: "-12px 0 40px rgba(15,23,42,0.15)",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 950 }}>{drawerProject.name}</div>
                <div className="muted" style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {!drawerProject.is_active ? <Badge>Inactive</Badge> : <Badge>Active</Badge>}
                  <Badge>{weekStartLabel(drawerProject.week_start)}</Badge>
                </div>
              </div>
              <button className="btn" onClick={closeDrawer} aria-label="Close">
                Close
              </button>
            </div>

            <div className="card cardPad">
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Project ID</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <code style={{ fontSize: 12 }}>{drawerProject.id}</code>
                <button className="btn" onClick={() => copyToClipboard(drawerProject.id)}>Copy</button>
              </div>
            </div>

            <div className="card cardPad">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 950 }}>Settings</div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    Week start affects weekly reports and timesheet week boundaries.
                  </div>
                </div>
                {isAdmin ? <Badge>Admin</Badge> : <Badge>Read only</Badge>}
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                <div>
                  <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Week start</div>
                  <select
                    value={(drawerProject.week_start || "sunday") as WeekStart}
                    disabled={!isAdmin || savingWeekStartId === drawerProject.id}
                    onChange={(e) => updateProjectWeekStart(drawerProject.id, e.target.value as WeekStart)}
                  >
                    <option value="sunday">Sunday</option>
                    <option value="monday">Monday</option>
                  </select>
                </div>

                {isAdmin ? (
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <PillButton
                      variant="danger"
                      disabled={busyProjectId === drawerProject.id}
                      onClick={() => toggleProjectActive(drawerProject.id, !drawerProject.is_active)}
                      title="Enable/disable this project"
                    >
                      {busyProjectId === drawerProject.id
                        ? "Working…"
                        : drawerProject.is_active
                          ? "Deactivate"
                          : "Activate"}
                    </PillButton>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card cardPad" style={{ flex: 1, overflow: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 950 }}>Members</div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    Read-only list for now (member management is the next step).
                  </div>
                </div>
                <Badge>{drawerMembers.length}</Badge>
              </div>

              {drawerMsg ? (
                <div style={{ marginTop: 10, color: "#b91c1c", fontSize: 13, whiteSpace: "pre-wrap" }}>{drawerMsg}</div>
              ) : null}

              {drawerBusy ? (
                <div className="muted" style={{ marginTop: 12 }}>Loading members…</div>
              ) : drawerMembers.length === 0 ? (
                <div className="muted" style={{ marginTop: 12 }}>No active members on this project.</div>
              ) : (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {drawerMembers.map((m) => (
                    <div key={m.profile_id} style={{ padding: 10, border: "1px solid rgba(15,23,42,0.08)", borderRadius: 12 }}>
                      <div style={{ fontWeight: 900, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span>{m.full_name || m.profile_id}</span>
                        {m.role ? <Badge>{m.role}</Badge> : null}
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{m.profile_id}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="muted" style={{ fontSize: 12 }}>
              Tip: Next step will add “Manage members” inside this drawer for Admins.
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
