// src/app/timesheet/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import RequireOnboarding from "../../components/auth/RequireOnboarding";
import AppShell from "../../components/layout/AppShell";
import { supabase } from "../../lib/supabaseBrowser";
import { useProfile } from "../../lib/useProfile";
import { addDays, formatShort, startOfWeekSunday, toISODate, weekRangeLabel } from "../../lib/date";

type Project = {
  id: string;
  name: string;
  parent_id?: string | null;
  is_active?: boolean | null;
};

type EntryStatus = "draft" | "submitted" | "approved" | "rejected";

type TimeEntryRow = {
  id: string;
  entry_date: string; // YYYY-MM-DD
  project_id: string;
  time_in: string | null; // "HH:MM:SS"
  time_out: string | null;
  lunch_hours: number | null;
  mileage: number | null;
  notes: string | null;
  status: EntryStatus;
  hours_worked?: number | null; // exists in v_time_entries after DB fix
};

type DraftRow = {
  id?: string;
  tempId: string;
  entry_date: string;
  project_id: string;
  time_in: string; // "HH:MM"
  time_out: string; // "HH:MM"
  lunch_hours: number;
  mileage: number;
  notes: string;
  status?: EntryStatus;
};

function timeToHHMM(t: string | null): string {
  if (!t) return "";
  return t.slice(0, 5);
}

function normalizeHHMM(s: string): string {
  if (!s) return "";
  const [hRaw, mRaw] = s.split(":");
  const h = String(Number(hRaw ?? 0)).padStart(2, "0");
  const m = String(Number(mRaw ?? 0)).padStart(2, "0");
  return `${h}:${m}`;
}

function StatusPill({ status }: { status: EntryStatus | undefined }) {
  const s = (status ?? "draft") as EntryStatus;
  const cls =
    s === "approved"
      ? "statusPill statusApproved"
      : s === "submitted"
        ? "statusPill statusSubmitted"
        : s === "rejected"
          ? "statusPill statusRejected"
          : "statusPill statusDraft";
  return <span className={cls}>{s}</span>;
}

function TimesheetInner() {
  const { loading: profLoading, profile, userId } = useProfile();

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekSunday(new Date()));
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekStartISO = useMemo(() => toISODate(weekStart), [weekStart]);
  const weekEndISO = useMemo(() => toISODate(addDays(weekStart, 6)), [weekStart]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [msg, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [loadingWeek, setLoadingWeek] = useState(false);

  const canView = !!userId && !!profile;
  const isManagerOrAdmin = profile?.role === "admin" || profile?.role === "manager";
  const isContractor = profile?.role === "contractor";

  useEffect(() => {
    if (!canView) return;

    let cancelled = false;

    (async () => {
      setLoadingWeek(true);
      setMsg("");

      // PROJECTS (STRICT)
      // - Admin/Manager: org active projects
      // - Contractor: ONLY membership-based projects
      try {
        if (isManagerOrAdmin) {
          const { data: projRows, error: projErr } = await supabase
            .from("projects")
            .select("id, name, parent_id, is_active")
            .eq("org_id", profile!.org_id)
            .eq("is_active", true)
            .order("name", { ascending: true });

          if (!cancelled) {
            if (projErr) setMsg(projErr.message);
            setProjects((((projRows as any) ?? []) as Project[]) || []);
          }
        } else {
          const { data: pm, error: pmErr } = await supabase
            .from("project_members")
            .select("project_id, projects:project_id (id, name, parent_id, is_active)")
            .eq("profile_id", userId!)
            .eq("is_active", true);

          if (!cancelled) {
            if (pmErr) {
              setMsg(pmErr.message);
              setProjects([]);
            } else {
              const list = (((pm as any) ?? []) as any[]).map((x) => x.projects).filter(Boolean) as Project[];
              const uniq = Array.from(new Map(list.map((p) => [p.id, p])).values())
                .filter((p) => p.is_active !== false)
                .sort((a, b) => a.name.localeCompare(b.name));
              setProjects(uniq);
            }
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setMsg(e?.message || "Failed to load projects");
          setProjects([]);
        }
      }

      // ENTRIES
      // NOTE: hours_worked comes from v_time_entries after DB fix below.
      const { data: entryRows, error: entryErr } = await supabase
        .from("v_time_entries")
        .select("id, entry_date, project_id, time_in, time_out, lunch_hours, mileage, notes, status, hours_worked")
        .gte("entry_date", weekStartISO)
        .lte("entry_date", weekEndISO)
        .order("entry_date", { ascending: true });

      if (!cancelled) {
        if (entryErr) {
          setMsg((m) => (m ? `${m}\n${entryErr.message}` : entryErr.message));
          setRows([]);
          setLoadingWeek(false);
          return;
        }

        const mapped: DraftRow[] = (((entryRows as any) ?? []) as TimeEntryRow[]).map((r) => ({
          id: r.id,
          tempId: r.id,
          entry_date: r.entry_date,
          project_id: r.project_id,
          time_in: timeToHHMM(r.time_in),
          time_out: timeToHHMM(r.time_out),
          lunch_hours: Number(r.lunch_hours ?? 0),
          mileage: Number(r.mileage ?? 0),
          notes: r.notes ?? "",
          status: r.status,
        }));

        setRows(mapped);
        setLoadingWeek(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canView, userId, profile, isManagerOrAdmin, weekStartISO, weekEndISO]);

  const hoursByDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of weekDays) map[toISODate(d)] = 0;

    for (const r of rows) {
      const dayKey = r.entry_date;
      const tin = r.time_in ? normalizeHHMM(r.time_in) : "";
      const tout = r.time_out ? normalizeHHMM(r.time_out) : "";
      if (!tin || !tout) continue;

      const [h1, m1] = tin.split(":").map(Number);
      const [h2, m2] = tout.split(":").map(Number);
      if ([h1, m1, h2, m2].some((x) => Number.isNaN(x))) continue;

      const start = h1 * 60 + m1;
      const end = h2 * 60 + m2;
      const minutes = Math.max(end - start, 0);
      const hours = Math.max(minutes / 60 - (r.lunch_hours ?? 0), 0);

      map[dayKey] = (map[dayKey] ?? 0) + hours;
    }
    return map;
  }, [rows, weekDays]);

  const weekTotal = useMemo(() => Object.values(hoursByDay).reduce((a, b) => a + b, 0), [hoursByDay]);

  function addLine(entryDateISO: string) {
    const tempId = `tmp_${crypto.randomUUID()}`;
    const firstProject = projects[0]?.id ?? "";
    setRows((prev) => [
      ...prev,
      {
        tempId,
        entry_date: entryDateISO,
        project_id: firstProject,
        time_in: "",
        time_out: "",
        lunch_hours: 0,
        mileage: 0,
        notes: "",
        status: "draft",
      },
    ]);
  }

  function removeLine(tempId: string) {
    setRows((prev) => prev.filter((r) => r.tempId !== tempId));
  }

  function updateRow(tempId: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)));
  }

  async function saveDraft() {
    if (!userId || !profile) return;

    if (isContractor && projects.length === 0) {
      setMsg("No projects assigned. Ask your admin to assign projects (Profiles → Project access).");
      return;
    }

    setBusy(true);
    setMsg("");

    try {
      const weekRows = rows.filter((r) => r.entry_date >= weekStartISO && r.entry_date <= weekEndISO);

      const results = await Promise.all(
        weekRows.map(async (r) => {
          const hasAnyInput =
            !!r.project_id ||
            !!r.time_in ||
            !!r.time_out ||
            (r.lunch_hours ?? 0) > 0 ||
            (r.mileage ?? 0) > 0 ||
            !!r.notes;

          if (!hasAnyInput) return { ok: true, skipped: true };
          if (!r.project_id) return { ok: false, error: `Project required for ${r.entry_date}` };
          if (r.status === "submitted" || r.status === "approved") return { ok: true, skipped: true };

          const payload = {
            org_id: profile.org_id,
            user_id: userId,
            entry_date: r.entry_date,
            project_id: r.project_id,
            time_in: r.time_in ? normalizeHHMM(r.time_in) + ":00" : null,
            time_out: r.time_out ? normalizeHHMM(r.time_out) + ":00" : null,
            lunch_hours: r.lunch_hours ?? 0,
            mileage: r.mileage ?? 0,
            notes: r.notes ?? null,
            status: (r.status === "rejected" ? "draft" : (r.status ?? "draft")) as EntryStatus,
          };

          if (r.id) {
            const { error } = await supabase.from("time_entries").update(payload).eq("id", r.id);
            if (error) return { ok: false, error: error.message };
            return { ok: true };
          } else {
            const { data, error } = await supabase.from("time_entries").insert(payload).select("id").single();
            if (error) return { ok: false, error: error.message };
            updateRow(r.tempId, { id: data.id, tempId: data.id });
            return { ok: true };
          }
        })
      );

      const errors = results.filter((x: any) => !x.ok).map((x: any) => x.error);
      setMsg(errors.length ? errors.join("\n") : "Saved ✅");
    } finally {
      setBusy(false);
    }
  }

  async function submitWeek() {
    if (!userId) return;

    if (isContractor && projects.length === 0) {
      setMsg("No projects assigned. Ask your admin to assign projects (Profiles → Project access).");
      return;
    }

    setBusy(true);
    setMsg("");

    try {
      const { error } = await supabase
        .from("time_entries")
        .update({ status: "submitted" })
        .eq("user_id", userId)
        .gte("entry_date", weekStartISO)
        .lte("entry_date", weekEndISO)
        .in("status", ["draft", "rejected"]);

      if (error) {
        setMsg(error.message);
        return;
      }

      const { data: entryRows, error: entryErr } = await supabase
        .from("v_time_entries")
        .select("id, entry_date, project_id, time_in, time_out, lunch_hours, mileage, notes, status, hours_worked")
        .gte("entry_date", weekStartISO)
        .lte("entry_date", weekEndISO)
        .order("entry_date", { ascending: true });

      if (entryErr) {
        setMsg(`Submitted, but reload failed: ${entryErr.message}`);
        return;
      }

      const mapped: DraftRow[] = (((entryRows as any) ?? []) as TimeEntryRow[]).map((r) => ({
        id: r.id,
        tempId: r.id,
        entry_date: r.entry_date,
        project_id: r.project_id,
        time_in: timeToHHMM(r.time_in),
        time_out: timeToHHMM(r.time_out),
        lunch_hours: Number(r.lunch_hours ?? 0),
        mileage: Number(r.mileage ?? 0),
        notes: r.notes ?? "",
        status: r.status,
      }));

      setRows(mapped);
      setMsg("Week submitted ✅");
    } finally {
      setBusy(false);
    }
  }

  const headerSubtitle = profile ? `${weekRangeLabel(weekStart)} • Role: ${profile.role}` : `${weekRangeLabel(weekStart)}`;

  const headerRight = (
    <div className="tsHeaderRight">
      <div className="tsWeekNav">
        <button className="pill" onClick={() => setWeekStart((d) => addDays(d, -7))} disabled={busy || loadingWeek} title="Previous week">
          ← Prev
        </button>
        <button
          className="pill"
          onClick={() => setWeekStart(startOfWeekSunday(new Date()))}
          disabled={busy || loadingWeek}
          title="Jump to current week"
        >
          This week
        </button>
        <button className="pill" onClick={() => setWeekStart((d) => addDays(d, 7))} disabled={busy || loadingWeek} title="Next week">
          Next →
        </button>
      </div>

      <div className="tsActions">
        <button disabled={busy || loadingWeek} onClick={saveDraft}>
          {busy ? "Saving…" : "Save Draft"}
        </button>
        <button className="btnPrimary" disabled={busy || loadingWeek} onClick={submitWeek}>
          {busy ? "Working…" : "Submit Week"}
        </button>
      </div>
    </div>
  );

  if (profLoading) {
    return (
      <AppShell title="Weekly Timesheet" subtitle="Loading profile…">
        <div className="card cardPad">
          <div className="muted">Loading…</div>
        </div>
      </AppShell>
    );
  }

  if (!profile || !userId) return null;

  return (
    <AppShell title="Weekly Timesheet" subtitle={headerSubtitle} right={headerRight}>
      {msg ? (
        <div className="alert alertInfo">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg}</pre>
        </div>
      ) : null}

      {isContractor && projects.length === 0 ? (
        <div className="alert alertWarn">
          <div style={{ fontWeight: 950 }}>No projects assigned</div>
          <div className="muted" style={{ marginTop: 6 }}>
            You can’t submit time until an admin assigns at least one project.
          </div>
        </div>
      ) : null}

      <div className="card cardPad tsSummary">
        <div className="tsSummaryRow">
          <div>
            <div className="tsSummaryTitle">Week total</div>
            <div className="tsSummaryValue">{weekTotal.toFixed(2)} hrs</div>
          </div>
          <div className="muted tsSummaryHint">Tip: Add multiple lines per day. Submitted/approved lines lock.</div>
        </div>
      </div>

      {loadingWeek ? (
        <div className="card cardPad" style={{ marginTop: 14 }}>
          <div className="muted">Loading week…</div>
        </div>
      ) : (
        <div className="tsDays">
          {weekDays.map((day) => {
            const dayISO = toISODate(day);
            const dayRows = rows.filter((r) => r.entry_date === dayISO);

            return (
              <section key={dayISO} className="card cardPad tsDayCard">
                <div className="tsDayHeader">
                  <div className="tsDayTitle">
                    {formatShort(day)} <span className="muted">({dayISO})</span>
                  </div>
                  <div className="tsDayTotal">Day total: {(hoursByDay[dayISO] ?? 0).toFixed(2)} hrs</div>
                </div>

                <div className="tsGridHead">
                  <div>Project</div>
                  <div>In</div>
                  <div>Out</div>
                  <div>Lunch</div>
                  <div>Notes</div>
                  <div>Miles</div>
                  <div>Status</div>
                </div>

                {dayRows.length === 0 ? <div className="muted" style={{ marginTop: 10 }}>No lines for this day.</div> : null}

                {dayRows.map((r) => {
                  const locked = r.status === "submitted" || r.status === "approved";

                  return (
                    <div key={r.tempId} className="tsGridRow">
                      <select
                        value={r.project_id}
                        disabled={locked || (isContractor && projects.length === 0)}
                        onChange={(e) => updateRow(r.tempId, { project_id: e.target.value })}
                      >
                        <option value="">Select…</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>

                      <input type="time" step={60} value={r.time_in} disabled={locked} onChange={(e) => updateRow(r.tempId, { time_in: e.target.value })} />

                      <input type="time" step={60} value={r.time_out} disabled={locked} onChange={(e) => updateRow(r.tempId, { time_out: e.target.value })} />

                      <input
                        value={r.lunch_hours}
                        disabled={locked}
                        onChange={(e) => updateRow(r.tempId, { lunch_hours: Number(e.target.value) })}
                        type="number"
                        min="0"
                        step="0.25"
                      />

                      <input
                        value={r.notes}
                        disabled={locked}
                        onChange={(e) => updateRow(r.tempId, { notes: e.target.value })}
                        placeholder="What did you work on?"
                      />

                      <input
                        value={r.mileage}
                        disabled={locked}
                        onChange={(e) => updateRow(r.tempId, { mileage: Number(e.target.value) })}
                        type="number"
                        min="0"
                        step="0.1"
                      />

                      <div className="tsStatusCell">
                        <StatusPill status={(r.status ?? "draft") as EntryStatus} />
                        {!locked ? (
                          <button className="btnDanger tsRemoveBtn" onClick={() => removeLine(r.tempId)} title="Remove line">
                            ✕
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={() => addLine(dayISO)}
                    disabled={isContractor && projects.length === 0}
                    title={isContractor && projects.length === 0 ? "Admin must assign a project first" : "Add a new line"}
                  >
                    + Add line
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

export default function TimesheetPage() {
  return (
    <RequireOnboarding>
      <TimesheetInner />
    </RequireOnboarding>
  );
}
