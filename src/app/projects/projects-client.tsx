"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "../../components/layout/AppShell";
import { supabase } from "../../lib/supabaseBrowser";
import { useProfile } from "../../lib/useProfile";

type WeekStart = "sunday" | "monday";

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

function weekStartLabel(ws?: WeekStart | null) {
  const v = ws || "sunday";
  return v === "monday" ? "Week starts Monday" : "Week starts Sunday";
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

  // Busy states (separate so UI doesn't feel janky)
  const [busyProjectId, setBusyProjectId] = useState<string>(""); // used for activate + assignment
  const [savingWeekStartId, setSavingWeekStartId] = useState<string>(""); // used for week_start only

  // Admin project creation state
  const [newName, setNewName] = useState("");
  const [newWeekStart, setNewWeekStart] = useState<WeekStart>("sunday");
  const [createBusy, setCreateBusy] = useState(false);

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

  // ✅ Step 1: Inline edit week_start (Admin only)
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

  // ---- UI guards ----
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
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                Project name
              </div>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Retail KPI Dashboard" />
            </div>

            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                Week start
              </div>
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
            Toggle projects to grant access. Inactive projects can still be assigned, but typically should stay off.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {projects.length === 0 ? (
              <div className="muted">No projects found in this org.</div>
            ) : (
              projects.map((p) => {
                const assigned = assignedProjectIds.has(p.id);
                const busy = busyProjectId === p.id;

                return (
                  <div
                    key={p.id}
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
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <input
                        type="checkbox"
                        checked={assigned}
                        disabled={busy}
                        onChange={(e) => toggleAssignment(p.id, e.target.checked)}
                        style={{ width: 18, height: 18 }}
                      />
                      <div>
                        <div style={{ fontWeight: 900, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <span>{p.name}</span>
                          {!p.is_active ? <Badge>Inactive</Badge> : null}
                          <Badge>{weekStartLabel(p.week_start)}</Badge>
                        </div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                          {p.id}
                        </div>
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

      {/* Project list */}
      <div className="card cardPad" style={{ maxWidth: 1100 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 950, fontSize: 16 }}>All projects</div>
            <div className="muted" style={{ marginTop: 6 }}>
              {manageUserId ? "Select projects above to assign access." : "Use People → Project access to assign projects to contractors."}
            </div>
          </div>
          <Badge>{projects.length} total</Badge>
        </div>

        {projects.length === 0 ? (
          <div className="muted" style={{ marginTop: 12 }}>
            No projects found.
          </div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {projects.map((p) => {
              const busy = busyProjectId === p.id;
              const savingWs = savingWeekStartId === p.id;

              return (
                <div
                  key={p.id}
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
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span>{p.name}</span>
                      {!p.is_active ? <Badge>Inactive</Badge> : null}
                      <Badge>{weekStartLabel(p.week_start)}</Badge>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {p.id}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {/* ✅ Admin inline week start editor */}
                    {isAdmin ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span className="muted" style={{ fontSize: 12, fontWeight: 800 }}>
                          Week start
                        </span>
                        <select
                          value={(p.week_start || "sunday") as WeekStart}
                          disabled={savingWs}
                          onChange={(e) => updateProjectWeekStart(p.id, e.target.value as WeekStart)}
                          title="Changes how weekly reports/timesheets calculate week boundaries"
                          style={{ minWidth: 130 }}
                        >
                          <option value="sunday">Sunday</option>
                          <option value="monday">Monday</option>
                        </select>
                        <span className="muted" style={{ fontSize: 12, minWidth: 70 }}>
                          {savingWs ? "Saving…" : ""}
                        </span>
                      </div>
                    ) : null}

                    <button className="btn" onClick={() => setProjectInUrl(p.id)}>
                      Select
                    </button>

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

        {/* Selected project control */}
        <div style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
            Selected project
          </div>
          <select value={selectedProjectId} onChange={(e) => setProjectInUrl(e.target.value)} style={{ maxWidth: 520 }}>
            <option value="">— Select a project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>

          {selectedProjectId ? (
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Tip: When a project is selected, reports can snap week ranges to that project’s week start.
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
