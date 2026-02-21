// src/app/projects/projects-client.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseBrowser";
import { useProfile } from "../../lib/useProfile";

type Project = {
  id: string;
  name: string;
  is_active: boolean;
  org_id: string;
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

export default function ProjectsClient() {
  const router = useRouter();
  const searchParams = useSearchParams(); // inside Suspense via page.tsx
  const { loading, userId, profile, error: profErr } = useProfile();

  const selectedProjectId = useMemo(() => searchParams.get("project") || "", [searchParams]);

  // NEW: project assignment mode
  const manageUserId = useMemo(() => searchParams.get("user") || "", [searchParams]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [fetchErr, setFetchErr] = useState<string>("");

  // Assignment UI state
  const [manageUser, setManageUser] = useState<SimpleProfile | null>(null);
  const [memberMap, setMemberMap] = useState<Record<string, MemberRow>>({});
  const [busyProjectId, setBusyProjectId] = useState<string>("");

  const isAdmin = profile?.role === "admin";
  const isManagerOrAdmin = profile?.role === "admin" || profile?.role === "manager";

  function setProjectInUrl(projectId: string) {
    const base = manageUserId ? `/projects?user=${encodeURIComponent(manageUserId)}` : "/projects";
    const url = projectId ? `${base}&project=${encodeURIComponent(projectId)}` : base;
    router.replace(url);
  }

  // Load projects list (same logic as before, but also needed for assignment mode)
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

    (async () => {
      setFetchErr("");

      // Admin/Manager: show org projects
      // Contractor: membership-driven projects
      if (isManagerOrAdmin) {
        const { data, error } = await supabase
          .from("projects")
          .select("id, name, is_active, org_id")
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
          .select("project_id, projects:project_id (id, name, is_active, org_id)")
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
    })();
  }, [loading, userId, profile, profErr, router, isManagerOrAdmin]);

  // Load user being managed + membership map (Admin only)
  useEffect(() => {
    if (loading) return;
    if (!profile) return;

    // Only activate assignment UI if query param exists
    if (!manageUserId) {
      setManageUser(null);
      setMemberMap({});
      return;
    }

    // Only admin can manage assignments (keep simple + safe)
    if (!isAdmin) {
      setFetchErr("Only Admin can manage project access.");
      return;
    }

    let cancelled = false;
    (async () => {
      setFetchErr("");

      // Load managed user's profile (for display)
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

      // Load membership rows for that user (org scoped)
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
        // update is_active
        const { error } = await supabase
          .from("project_members")
          .update({ is_active: nextAssigned })
          .eq("id", existing.id);

        if (error) {
          setFetchErr(error.message);
          return;
        }

        setMemberMap((prev) => ({
          ...prev,
          [projectId]: { ...existing, is_active: nextAssigned },
        }));
      } else {
        // insert new membership
        const payload: any = {
          org_id: profile.org_id,
          project_id: projectId,
          profile_id: manageUserId,
          user_id: manageUserId, // keep compatible with your current schema
          is_active: true,
        };

        const { data, error } = await supabase
          .from("project_members")
          .insert(payload)
          .select("id, project_id, is_active")
          .single();

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

  return (
    <main style={{ maxWidth: 1100, margin: "24px auto", padding: 16 }}>
      <h1 style={{ margin: 0 }}>Projects</h1>

      {loading && <p style={{ marginTop: 10 }}>Loading…</p>}

      {!loading && !userId && (
        <div style={{ marginTop: 12 }}>
          <p>Please log in.</p>
          <button onClick={() => router.push("/login")}>Go to Login</button>
        </div>
      )}

      {!loading && userId && !profile && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
          <div style={{ fontWeight: 800 }}>Logged in, but profile could not be loaded.</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{profErr || "No details."}</pre>
        </div>
      )}

      {!!fetchErr && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f3c", borderRadius: 10 }}>
          <div style={{ fontWeight: 800 }}>Error</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{fetchErr}</pre>
        </div>
      )}

      {!!profile && (
        <div style={{ marginTop: 12, opacity: 0.85 }}>
          Role: <b>{profile.role}</b> &nbsp;|&nbsp; Org: <code>{profile.org_id}</code>
        </div>
      )}

      {/* NEW: Admin project access management */}
      {isAdmin && manageUserId ? (
        <section style={{ marginTop: 18, padding: 14, border: "1px solid #eee", borderRadius: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Manage project access</div>
              <div style={{ opacity: 0.8, marginTop: 6 }}>
                User:{" "}
                <b>
                  {manageUser?.full_name || manageUserId}
                </b>{" "}
                {manageUser?.role ? <span style={{ opacity: 0.75 }}>({manageUser.role})</span> : null}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => router.push("/profiles")}>Back to Profiles</button>
              <button onClick={() => router.replace("/projects")}>Exit access mode</button>
            </div>
          </div>

          <div style={{ marginTop: 12, opacity: 0.75 }}>
            Check projects to grant access. Uncheck to remove access.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {projects.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No projects found in this org.</div>
            ) : (
              projects.map((p) => {
                const assigned = assignedProjectIds.has(p.id);
                const busy = busyProjectId === p.id;

                return (
                  <label
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: 12,
                      border: "1px solid #eee",
                      borderRadius: 12,
                      background: p.is_active ? "#fff" : "#fafafa",
                      opacity: p.is_active ? 1 : 0.75,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={assigned}
                        disabled={busy}
                        onChange={(e) => toggleAssignment(p.id, e.target.checked)}
                        style={{ width: 18, height: 18 }}
                      />
                      <div>
                        <div style={{ fontWeight: 900 }}>
                          {p.name}{" "}
                          {!p.is_active ? <span style={{ fontWeight: 700, opacity: 0.7 }}>(inactive)</span> : null}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                          {p.id}
                        </div>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      {busy ? "Updating…" : assigned ? "Assigned" : "Not assigned"}
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </section>
      ) : null}

      {/* Existing “selected project” UI */}
      <section style={{ marginTop: 16 }}>
        <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>
          Selected Project (via URL query param)
        </label>
        <select
          value={selectedProjectId}
          onChange={(e) => setProjectInUrl(e.target.value)}
          style={{ padding: 8, minWidth: 320 }}
        >
          <option value="">— Select a project —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.is_active ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      </section>

      <section style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 10 }}>Projects</h3>
        {projects.length === 0 ? (
          <p style={{ opacity: 0.8 }}>No projects found.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {projects.map((p) => (
              <li key={p.id}>
                <b>{p.name}</b> — <code>{p.id}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
