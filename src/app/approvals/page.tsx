// src/app/approvals/page.tsx
"use client";

import RequireOnboarding from "../../components/auth/RequireOnboarding";
import AppShell from "../../components/layout/AppShell";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseBrowser";
import { useProfile } from "../../lib/useProfile";
import { addDays, startOfWeekSunday, toISODate, weekRangeLabel } from "../../lib/date";

type EntryStatus = "draft" | "submitted" | "approved" | "rejected";

type EntryRow = {
  id: string;
  user_id: string;
  entry_date: string; // YYYY-MM-DD
  project_id: string;
  notes: string | null;
  status: EntryStatus;

  hours_worked: number | null; // from v_time_entries
  full_name?: string | null; // optional from v_time_entries
  project_name?: string | null; // optional from v_time_entries
};

type ProfileRow = { id: string; full_name: string | null; role: string | null; manager_id?: string | null };
type ProjectRow = { id: string; name: string };

type GroupKey = string;
type Group = {
  key: GroupKey;
  user_id: string;
  week_start: string;
  week_end: string;
  entries: EntryRow[];
};

function StatusPill({ status }: { status: EntryStatus }) {
  const cls =
    status === "approved"
      ? "statusPill statusApproved"
      : status === "submitted"
        ? "statusPill statusSubmitted"
        : status === "rejected"
          ? "statusPill statusRejected"
          : "statusPill statusDraft";
  return <span className={cls}>{status}</span>;
}

function ApprovalsLoading() {
  return (
    <AppShell title="Approvals" subtitle="Submitted timesheets">
      <div className="card cardPad" style={{ maxWidth: 1100 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="skeleton" style={{ height: 16, width: 220 }} />
          <div className="skeleton" style={{ height: 44, width: "100%" }} />
          <div className="skeleton" style={{ height: 280, width: "100%" }} />
        </div>
      </div>
    </AppShell>
  );
}

function ApprovalsInner() {
  const { loading: profLoading, profile, userId, error: profErr } = useProfile();

  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";
  const isManagerOrAdmin = isAdmin || isManager;

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekSunday(new Date()));
  const weekStartISO = useMemo(() => toISODate(weekStart), [weekStart]);
  const weekEndISO = useMemo(() => toISODate(addDays(weekStart, 6)), [weekStart]);

  const [loadingWeek, setLoadingWeek] = useState(false);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [projects, setProjects] = useState<Record<string, ProjectRow>>({});
  const [msg, setMsg] = useState("");
  const [busyKey, setBusyKey] = useState<string>("");

  useEffect(() => {
    if (!userId || !profile || !isManagerOrAdmin) return;

    let cancelled = false;

    (async () => {
      setLoadingWeek(true);
      setMsg("");

      try {
        // Profiles lookup:
        // - Admin: everyone in org
        // - Manager: direct reports only
        if (isAdmin) {
          const { data, error } = await supabase
            .from("profiles")
            .select("id, full_name, role, manager_id")
            .eq("org_id", profile.org_id);

          if (!cancelled) {
            if (error) setMsg(error.message);
            const map: Record<string, ProfileRow> = {};
            for (const r of (data ?? []) as any[]) map[r.id] = r;
            setProfiles(map);
          }
        } else {
          const { data, error } = await supabase
            .from("profiles")
            .select("id, full_name, role, manager_id")
            .eq("org_id", profile.org_id)
            .eq("manager_id", userId);

          if (!cancelled) {
            if (error) setMsg(error.message);
            const map: Record<string, ProfileRow> = {};
            for (const r of (data ?? []) as any[]) map[r.id] = r;
            setProfiles(map);
          }
        }

        // Projects lookup (org scoped)
        const { data: proj, error: projErr } = await supabase
          .from("projects")
          .select("id, name")
          .eq("org_id", profile.org_id);

        if (!cancelled) {
          if (projErr) setMsg((m) => (m ? `${m}\n${projErr.message}` : projErr.message));
          const pmap: Record<string, ProjectRow> = {};
          for (const p of (proj ?? []) as any[]) pmap[p.id] = p;
          setProjects(pmap);
        }

        // Build allowed user list for managers (direct reports)
        const allowedUserIds = !isAdmin ? Object.keys(profiles) : [];

        // Entries (submitted only)
        let q = supabase
          .from("v_time_entries")
          .select("id, user_id, entry_date, project_id, notes, status, hours_worked, full_name, project_name")
          .eq("org_id", profile.org_id)
          .eq("status", "submitted")
          .gte("entry_date", weekStartISO)
          .lte("entry_date", weekEndISO)
          .order("user_id", { ascending: true })
          .order("entry_date", { ascending: true });

        // ✅ Critical: manager scoping enforced at query time
        if (!isAdmin) {
          if (allowedUserIds.length === 0) {
            // no direct reports
            if (!cancelled) {
              setEntries([]);
              setLoadingWeek(false);
            }
            return;
          }
          q = q.in("user_id", allowedUserIds);
        }

        const { data: ent, error: entErr } = await q;

        if (!cancelled) {
          if (entErr) {
            setMsg((m) => (m ? `${m}\n${entErr.message}` : entErr.message));
            setEntries([]);
            setLoadingWeek(false);
            return;
          }
          setEntries(((ent as any) ?? []) as EntryRow[]);
          setLoadingWeek(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setMsg(e?.message || "Failed to load approvals.");
          setEntries([]);
          setLoadingWeek(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile, isAdmin, isManagerOrAdmin, weekStartISO, weekEndISO]);

  const groups: Group[] = useMemo(() => {
    const map = new Map<GroupKey, Group>();
    for (const e of entries) {
      const ws = weekStartISO;
      const we = weekEndISO;
      const key = `${e.user_id}|${ws}`;
      if (!map.has(key)) {
        map.set(key, { key, user_id: e.user_id, week_start: ws, week_end: we, entries: [] });
      }
      map.get(key)!.entries.push(e);
    }
    return Array.from(map.values()).sort((a, b) => (a.user_id + a.week_start).localeCompare(b.user_id + b.week_start));
  }, [entries, weekStartISO, weekEndISO]);

  function displayName(user_id: string, sample?: EntryRow) {
    return sample?.full_name || profiles[user_id]?.full_name || user_id.slice(0, 8);
  }

  function projectLabel(project_id: string, sample?: EntryRow) {
    return sample?.project_name || projects[project_id]?.name || project_id.slice(0, 8);
  }

  function groupTotalHours(g: Group) {
    return g.entries.reduce((acc, e) => acc + Number(e.hours_worked ?? 0), 0);
  }

  async function approveGroup(g: Group) {
    setBusyKey(g.key);
    setMsg("");

    try {
      const { error } = await supabase
        .from("time_entries")
        .update({ status: "approved" })
        .eq("user_id", g.user_id)
        .gte("entry_date", g.week_start)
        .lte("entry_date", g.week_end)
        .eq("status", "submitted");

      if (error) {
        setMsg(error.message);
        return;
      }

      setEntries((prev) => prev.filter((x) => !(x.user_id === g.user_id && x.entry_date >= g.week_start && x.entry_date <= g.week_end)));
      setMsg("Approved ✅");
    } finally {
      setBusyKey("");
    }
  }

  async function rejectGroup(g: Group) {
    setBusyKey(g.key);
    setMsg("");

    try {
      const { error } = await supabase
        .from("time_entries")
        .update({ status: "rejected" })
        .eq("user_id", g.user_id)
        .gte("entry_date", g.week_start)
        .lte("entry_date", g.week_end)
        .eq("status", "submitted");

      if (error) {
        setMsg(error.message);
        return;
      }

      setEntries((prev) => prev.filter((x) => !(x.user_id === g.user_id && x.entry_date >= g.week_start && x.entry_date <= g.week_end)));
      setMsg("Rejected (sent back editable) ✅");
    } finally {
      setBusyKey("");
    }
  }

  const headerRight = (
    <div className="apHeaderRight">
      <div className="apWeekNav">
        <button className="pill" onClick={() => setWeekStart((d) => addDays(d, -7))} disabled={!!busyKey || loadingWeek} title="Previous week">
          ← Prev
        </button>
        <button className="pill" onClick={() => setWeekStart(startOfWeekSunday(new Date()))} disabled={!!busyKey || loadingWeek} title="This week">
          This week
        </button>
        <button className="pill" onClick={() => setWeekStart((d) => addDays(d, 7))} disabled={!!busyKey || loadingWeek} title="Next week">
          Next →
        </button>
      </div>
    </div>
  );

  if (profLoading) return <ApprovalsLoading />;

  if (!userId) {
    return (
      <AppShell title="Approvals" subtitle="Please log in">
        <div className="alert alertWarn">
          <div style={{ fontWeight: 950 }}>Session required</div>
          <div className="muted" style={{ marginTop: 6 }}>Please log in again.</div>
        </div>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell title="Approvals" subtitle="Profile missing">
        <div className="alert alertWarn">
          <div style={{ fontWeight: 950 }}>Logged in, but profile could not be loaded</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{profErr || "No details."}</pre>
        </div>
      </AppShell>
    );
  }

  if (!isManagerOrAdmin) {
    return (
      <AppShell title="Approvals" subtitle="Manager/Admin only">
        <div className="alert alertWarn">
          <div style={{ fontWeight: 950 }}>Access restricted</div>
          <div className="muted" style={{ marginTop: 6 }}>This page is only for managers and admins.</div>
        </div>
      </AppShell>
    );
  }

  const subtitle = `${weekRangeLabel(weekStart)} • Submitted timesheets`;

  return (
    <AppShell title="Approvals" subtitle={subtitle} right={headerRight}>
      {msg ? (
        <div className="alert alertInfo">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg}</pre>
        </div>
      ) : null}

      {loadingWeek ? (
        <div className="card cardPad" style={{ marginTop: 14 }}>
          <div className="muted">Loading week…</div>
        </div>
      ) : groups.length === 0 ? (
        <div className="card cardPad" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 950 }}>Nothing to approve</div>
          <div className="muted" style={{ marginTop: 6 }}>
            {isAdmin ? "No submitted time entries for this week." : "No submitted time entries from your direct reports for this week."}
          </div>
        </div>
      ) : (
        <div className="apGroups">
          {groups.map((g) => {
            const sample = g.entries[0];
            const total = groupTotalHours(g);

            return (
              <section key={g.key} className="card cardPad apGroupCard">
                <div className="apGroupHeader">
                  <div>
                    <div className="apGroupTitle">{displayName(g.user_id, sample)}</div>
                    <div className="muted apGroupMeta">
                      Week: {g.week_start} → {g.week_end}
                    </div>
                  </div>

                  <div className="apGroupRight">
                    <div className="apGroupTotal">
                      <div className="muted" style={{ fontWeight: 900 }}>Total</div>
                      <div style={{ fontWeight: 950, fontSize: 18 }}>{total.toFixed(2)} hrs</div>
                    </div>

                    <div className="apGroupActions">
                      <button className="btnDanger" onClick={() => rejectGroup(g)} disabled={busyKey === g.key} title="Reject (send back)">
                        {busyKey === g.key ? "Working…" : "Reject"}
                      </button>
                      <button className="btnPrimary" onClick={() => approveGroup(g)} disabled={busyKey === g.key} title="Approve (lock)">
                        {busyKey === g.key ? "Working…" : "Approve"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="apTable">
                  <div className="apHead">
                    <div>Date</div>
                    <div>Project</div>
                    <div>Hours</div>
                    <div>Notes</div>
                    <div>Status</div>
                  </div>

                  {g.entries.map((e) => (
                    <div key={e.id} className="apRow">
                      <div className="apCellMono">{e.entry_date}</div>
                      <div>{projectLabel(e.project_id, e)}</div>
                      <div className="apCellMono">{Number(e.hours_worked ?? 0).toFixed(2)}</div>
                      <div className="apNotes">{e.notes || <span className="muted">—</span>}</div>
                      <div>
                        <StatusPill status={e.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

export default function ApprovalsPage() {
  return (
    <RequireOnboarding>
      <ApprovalsInner />
    </RequireOnboarding>
  );
}
