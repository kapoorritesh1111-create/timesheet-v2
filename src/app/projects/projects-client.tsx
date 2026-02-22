// src/app/projects/projects-client.tsx
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
    // ignore
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

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerProjectId, setDrawerProjectId] = useState<string>("");
  const [drawerMembers, setDrawerMembers] = useState<DrawerMember[]>([]);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [drawerMsg, setDrawerMsg] = useState<string>("");

  const isAdmin = profile?.role === "admin";
  const isManagerOrAdmin = profile?.role === "admin" || profile?.role === "manager";

  function tag(text: string, kind?: "ok" | "warn" | "muted") {
    const cls = kind === "ok" ? "tag tagOk" : kind === "warn" ? "tag tagWarn" : "tag";
    return <span className={cls}>{text}</span>;
  }

  function setProjectInUrl(projectId: string) {
    // Fix: ensure proper ? / & handling
    const params = new URLSearchParams();
    if (manageUserId) params.set("user", manageUserId);
    if (projectId) params.set("project", projectId);
    const qs = params.toString();
    router.replace(qs ? `/projects?${qs}` : "/projects");
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
      const { error } = await supabase.from("projects").update({ is_active: nextActive }).eq("id", projectId).eq("org_id", profile.org_id);

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
      const { error } = await supabase.from("projects").update({ week_start: weekStart }).eq("id", projectId).eq("org_id", profile.org_id);

      if (error) {
        setFetchErr(error.message);
        return;
      }

      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, week_start: weekStart } : p)));
    } finally {
      setSavingWeekStartId("");
    }
  }

  async function openDrawer(projectId: string) {
    setDrawerOpen(true);
    setDrawerProjectId(projectId);
    setDrawerMembers([]);
    setDrawerMsg("");
    setDrawerBusy(true);

    try {
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
          <div style={{ fontWeight: 950, marginBottom: 8 }}>Please log in.</div>
          <button className="btnPrimary" onClick={() => router.push("/login")}>
            Go to Login
          </button>
        </div>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell title="Projects" subtitle="Create projects and manage access">
        <div className="alert alertWarn">
          <div style={{ fontWeight: 950 }}>Logged in, but profile could not be loaded.</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{profErr || "No details."}</pre>
        </div>
      </AppShell>
    );
  }

  const headerRight = (
    <div className="prHeaderRight">
      {manageUserId ? (
        <>
          <button className="pill" onClick={() => router.push("/profiles")}>
            Back to People
          </button>
          <button className="pill" onClick={() => router.replace("/projects")}>
            Exit Access Mode
          </button>
        </>
      ) : null}
    </div>
  );

  const subtitle = manageUserId ? "Assign project access to a user" : "Create projects, activate/deactivate, and manage access";

  return (
    <AppShell title="Projects" subtitle={subtitle} right={headerRight}>
      {fetchErr ? (
        <div className="alert alertInfo">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{fetchErr}</pre>
        </div>
      ) : null}

      {/* Admin: create project */}
      {isAdmin && !manageUserId ? (
        <div className="card cardPad prShell" style={{ marginTop: 14 }}>
          <div className="prCardHeader">
            <div>
              <div className="prTitle">Create project</div>
              <div className="muted prSub">
                Project-level settings (like week start) are used across reports and timesheets.
              </div>
            </div>
            {tag("Admin")}
          </div>

          <div className="prCreateGrid">
            <div>
              <div className="prLabel">Project name</div>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Retail KPI Dashboard" />
            </div>

            <div>
              <div className="prLabel">Week start</div>
              <select value={newWeekStart} onChange={(e) => setNewWeekStart(e.target.value as WeekStart)}>
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
            </div>

            <div className="prCreateBtnWrap">
              <button className="btnPrimary" onClick={createProject} disabled={createBusy || newName.trim().length < 2}>
                {createBusy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Search + Filter bar */}
      <div className="card cardPad prShell" style={{ marginTop: 14 }}>
        <div className="prFilters">
          <div className="prFiltersLeft">
            <div className="prField prSearch">
              <div className="prLabel">Search</div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or ID…" />
            </div>

            <div className="prField">
              <div className="prLabel">Status</div>
              <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}>
                <option value="all">All</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </select>
            </div>

            <div className="prClearWrap">
              <button className="pill" onClick={() => { setQ(""); setActiveFilter("all"); }}>
                Clear
              </button>
            </div>
          </div>

          <div className="prFiltersRight">
            {tag(`Total: ${counts.total}`)}
            {tag(`Active: ${counts.active}`, "ok")}
            {tag(`Inactive: ${counts.inactive}`, "muted")}
            {tag(`Showing: ${filteredProjects.length}`)}
          </div>
        </div>
      </div>

      {/* Admin access mode */}
      {isAdmin && manageUserId ? (
        <div className="card cardPad prShell" style={{ marginTop: 14 }}>
          <div className="prCardHeader">
            <div>
              <div className="prTitle">Manage project access</div>
              <div className="muted prSub">
                User: <b>{manageUser?.full_name || manageUserId}</b> {manageUser?.role ? `(${manageUser.role})` : ""}
              </div>
            </div>
            {tag("Grant / remove access")}
          </div>

          <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            Toggle projects to grant access. Click a project row to open details.
          </div>

          <div className="prList" style={{ marginTop: 12 }}>
            {filteredProjects.length === 0 ? (
              <div className="muted">No projects match your filters.</div>
            ) : (
              filteredProjects.map((p) => {
                const assigned = assignedProjectIds.has(p.id);
                const busy = busyProjectId === p.id;

                return (
                  <div key={p.id} className={`prRow ${!p.is_active ? "prRowInactive" : ""}`} onClick={() => openDrawer(p.id)}>
                    <div className="prRowLeft">
                      <input
                        type="checkbox"
                        checked={assigned}
                        disabled={busy}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => toggleAssignment(p.id, e.target.checked)}
                        className="prCheck"
                        aria-label="Toggle assignment"
                      />
                      <div>
                        <div className="prRowTitle">
                          <span>{p.name}</span>
                          {!p.is_active ? tag("Inactive", "warn") : null}
                          {tag(weekStartLabel(p.week_start))}
                        </div>
                        <div className="prRowMeta muted">{p.id}</div>
                      </div>
                    </div>

                    <div className="prRowRight muted">{busy ? "Updating…" : assigned ? "Assigned" : "Not assigned"}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {/* Projects list */}
      <div className="card cardPad prShell" style={{ marginTop: 14 }}>
        <div className="prCardHeader">
          <div>
            <div className="prTitle">All projects</div>
            <div className="muted prSub">
              Click a row to open project details. Use People → Project access to assign members.
            </div>
          </div>
          {tag(`Showing ${filteredProjects.length}`)}
        </div>

        {filteredProjects.length === 0 ? (
          <div className="muted" style={{ marginTop: 12 }}>
            No projects match your filters.
          </div>
        ) : (
          <div className="prList" style={{ marginTop: 12 }}>
            {filteredProjects.map((p) => {
              const busy = busyProjectId === p.id;
              const savingWs = savingWeekStartId === p.id;

              return (
                <div key={p.id} className="prRow" onClick={() => openDrawer(p.id)} title="Open project details">
                  <div className="prRowLeft">
                    <div className="prDot" aria-hidden />
                    <div>
                      <div className="prRowTitle">
                        <span>{p.name}</span>
                        {!p.is_active ? tag("Inactive", "warn") : null}
                        {tag(weekStartLabel(p.week_start))}
                      </div>
                      <div className="prRowMeta muted">{p.id}</div>
                    </div>
                  </div>

                  <div className="prRowActions" onClick={(e) => e.stopPropagation()}>
                    {isAdmin ? (
                      <div className="prInline">
                        <span className="muted prInlineLabel">Week start</span>
                        <select
                          value={(p.week_start || "sunday") as WeekStart}
                          disabled={savingWs}
                          onChange={(e) => updateProjectWeekStart(p.id, e.target.value as WeekStart)}
                        >
                          <option value="sunday">Sunday</option>
                          <option value="monday">Monday</option>
                        </select>
                        <span className="muted prInlineSaving">{savingWs ? "Saving…" : ""}</span>
                      </div>
                    ) : null}

                    <button className="pill" onClick={() => setProjectInUrl(p.id)}>
                      Select
                    </button>

                    {isAdmin ? (
                      <button className="pill" disabled={busy} onClick={() => toggleProjectActive(p.id, !p.is_active)}>
                        {busy ? "Working…" : p.is_active ? "Deactivate" : "Activate"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="prSelected">
          <div className="prLabel">Selected project</div>
          <select value={selectedProjectId} onChange={(e) => setProjectInUrl(e.target.value)} className="prSelectedSelect">
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

      {/* Drawer */}
      {drawerOpen && drawerProject ? (
        <div className="prDrawerOverlay" onClick={closeDrawer}>
          <div className="prDrawer" onClick={(e) => e.stopPropagation()}>
            <div className="prDrawerHeader">
              <div>
                <div className="prDrawerTitle">{drawerProject.name}</div>
                <div className="prDrawerTags">
                  {drawerProject.is_active ? tag("Active", "ok") : tag("Inactive", "warn")}
                  {tag(weekStartLabel(drawerProject.week_start))}
                </div>
              </div>
              <button className="pill" onClick={closeDrawer} aria-label="Close">
                Close
              </button>
            </div>

            <div className="card cardPad">
              <div className="prLabel">Project ID</div>
              <div className="prIdRow">
                <code className="prCode">{drawerProject.id}</code>
                <button className="pill" onClick={() => copyToClipboard(drawerProject.id)}>
                  Copy
                </button>
              </div>
            </div>

            <div className="card cardPad">
              <div className="prCardHeader">
                <div>
                  <div className="prTitle" style={{ fontSize: 14 }}>Settings</div>
                  <div className="muted prSub" style={{ marginTop: 4 }}>
                    Week start affects weekly reports and timesheet week boundaries.
                  </div>
                </div>
                {isAdmin ? tag("Admin") : tag("Read only")}
              </div>

              <div className="prDrawerSettings">
                <div>
                  <div className="prLabel">Week start</div>
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
                  <div className="prDrawerActions">
                    <button
                      className="pill"
                      disabled={busyProjectId === drawerProject.id}
                      onClick={() => toggleProjectActive(drawerProject.id, !drawerProject.is_active)}
                      title="Enable/disable this project"
                    >
                      {busyProjectId === drawerProject.id ? "Working…" : drawerProject.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card cardPad prDrawerMembers">
              <div className="prCardHeader">
                <div>
                  <div className="prTitle">Members</div>
                  <div className="muted prSub">Read-only list for now (member management is next).</div>
                </div>
                {tag(String(drawerMembers.length))}
              </div>

              {drawerMsg ? (
                <div className="alert alertInfo" style={{ marginTop: 10 }}>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{drawerMsg}</pre>
                </div>
              ) : null}

              {drawerBusy ? (
                <div className="muted" style={{ marginTop: 12 }}>Loading members…</div>
              ) : drawerMembers.length === 0 ? (
                <div className="muted" style={{ marginTop: 12 }}>No active members on this project.</div>
              ) : (
                <div className="prMemberList" style={{ marginTop: 12 }}>
                  {drawerMembers.map((m) => (
                    <div key={m.profile_id} className="prMemberRow">
                      <div className="prMemberTop">
                        <span className="prMemberName">{m.full_name || m.profile_id}</span>
                        {m.role ? tag(m.role) : null}
                      </div>
                      <div className="muted prMemberId">{m.profile_id}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="muted prDrawerFooter">
              Tip: Next step will add “Manage members” inside this drawer for Admins.
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
