// src/app/reports/payroll/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import RequireOnboarding from "../../../components/auth/RequireOnboarding";
import AppShell from "../../../components/layout/AppShell";
import { supabase } from "../../../lib/supabaseBrowser";
import { useProfile } from "../../../lib/useProfile";
import { presetToRange, DatePreset, WeekStart } from "../../../lib/dateRanges";

type EntryStatus = "draft" | "submitted" | "approved" | "rejected";

type VTimeEntryAny = {
  id: string;
  user_id: string;
  entry_date: string;
  project_id: string;
  status: EntryStatus;
  hours_worked: number | null;
  hourly_rate_snapshot?: number | null;

  full_name?: string | null;
  project_name?: string | null;

  [key: string]: any;
};

type ProjectRow = { id: string; name: string; week_start?: WeekStart | null };
type ContractorRow = { id: string; full_name: string | null };

function money(x: number) {
  return x.toFixed(2);
}

function csvEscape(value: unknown) {
  const s = value === null || value === undefined ? "" : String(value);
  const needsQuotes = /[",\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getNameFromRow(r: VTimeEntryAny) {
  return r.full_name ?? r.profile_full_name ?? r.contractor_name ?? r.user_full_name ?? r.name ?? "(no name)";
}
function getProjectNameFromRow(r: VTimeEntryAny) {
  return r.project_name ?? r.project_title ?? r.project ?? r.project_display_name ?? "(no project)";
}

function PayrollInner() {
  const router = useRouter();
  const { loading: profLoading, userId, profile, error } = useProfile();

  // default week start = Sunday
  const [weekStart, setWeekStart] = useState<WeekStart>("sunday");

  const [preset, setPreset] = useState<DatePreset>("last_month");
  const initial = useMemo(() => presetToRange("last_month", "sunday"), []);
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);

  const [status, setStatus] = useState<EntryStatus>("approved");
  const [projectId, setProjectId] = useState("");
  const [contractorId, setContractorId] = useState("");

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [rows, setRows] = useState<VTimeEntryAny[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [contractors, setContractors] = useState<ContractorRow[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(false);

  const [exportCurrentTableOnly, setExportCurrentTableOnly] = useState(false);
  const [currentTable, setCurrentTable] = useState<"contractors" | "projects">("contractors");

  const role = profile?.role || null;
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const isContractor = role === "contractor";
  const isManagerOrAdmin = isAdmin || isManager;

  useEffect(() => {
    if (profLoading) return;
    if (!userId) router.replace("/login");
  }, [profLoading, userId, router]);

  // Load projects + contractors (scoped)
  useEffect(() => {
    if (!profile || !userId) return;
    let cancelled = false;

    (async () => {
      setLoadingLookups(true);
      setMsg("");

      try {
        // Projects (org-scoped)
        const { data: proj, error: projErr } = await supabase
          .from("projects")
          .select("id,name,week_start")
          .eq("org_id", profile.org_id)
          .order("name", { ascending: true });

        if (cancelled) return;
        if (projErr) {
          setProjects([]);
          setMsg(projErr.message);
        } else {
          setProjects(((proj as any) ?? []) as ProjectRow[]);
        }

        // Contractors dropdown:
        // - Admin: all active contractors in org
        // - Manager: direct reports (contractors only)
        // - Contractor: none (self)
        if (!isManagerOrAdmin) {
          setContractors([]);
          setContractorId("");
          setLoadingLookups(false);
          return;
        }

        let q = supabase
          .from("profiles")
          .select("id, full_name")
          .eq("org_id", profile.org_id)
          .eq("is_active", true)
          .eq("role", "contractor")
          .order("full_name", { ascending: true });

        if (isManager && !isAdmin) {
          q = q.eq("manager_id", userId);
        }

        const { data: ppl, error: pplErr } = await q;

        if (cancelled) return;
        if (pplErr) {
          setContractors([]);
          setMsg((m) => (m ? `${m}\n${pplErr.message}` : pplErr.message));
        } else {
          const list = (((ppl as any) ?? []) as ContractorRow[]) || [];
          setContractors(list);

          // If current contractorId is not allowed anymore, clear it
          if (contractorId && !list.some((c) => c.id === contractorId)) {
            setContractorId("");
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setMsg(e?.message || "Failed to load lookups.");
          setProjects([]);
          setContractors([]);
        }
      } finally {
        if (!cancelled) setLoadingLookups(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.org_id, userId, isAdmin, isManager]);

  // Update effective week start based on selected project
  useEffect(() => {
    if (!projectId) {
      setWeekStart("sunday");
      return;
    }
    const p = projects.find((x) => x.id === projectId);
    const ws = (p?.week_start || "sunday") as WeekStart;
    setWeekStart(ws === "monday" ? "monday" : "sunday");
  }, [projectId, projects]);

  // When preset changes (not custom), update dates using effective weekStart
  useEffect(() => {
    if (preset === "custom") return;
    const r = presetToRange(preset as any, weekStart);
    setStartDate(r.start);
    setEndDate(r.end);
  }, [preset, weekStart]);

  async function load() {
    if (!profile || !userId) return;

    // Manager with no direct reports: show a helpful message (avoid “why is it blank?”)
    if (isManager && !isAdmin && contractors.length === 0) {
      setRows([]);
      setMsg("No contractors assigned to you yet. Ask Admin to set manager_id on contractor profiles.");
      return;
    }

    setBusy(true);
    setMsg("");

    try {
      let q = supabase
        .from("v_time_entries")
        .select("*")
        .eq("org_id", profile.org_id)
        .gte("entry_date", startDate)
        .lte("entry_date", endDate)
        .eq("status", status)
        .order("user_id", { ascending: true })
        .order("entry_date", { ascending: true });

      if (projectId) q = q.eq("project_id", projectId);

      // ✅ Scoping:
      // Contractor always sees self
      if (isContractor) {
        q = q.eq("user_id", userId);
      } else {
        // Admin can filter any contractor; Manager can filter only direct reports
        if (contractorId) {
          const allowed = isAdmin ? true : contractors.some((c) => c.id === contractorId);
          if (allowed) q = q.eq("user_id", contractorId);
        } else if (isManager && !isAdmin) {
          // Manager without a specific filter: limit to direct reports
          q = q.in("user_id", contractors.map((c) => c.id));
        }
      }

      const { data, error } = await q;

      if (error) {
        setRows([]);
        setMsg(error.message);
        return;
      }

      setRows(((data as any) ?? []) as VTimeEntryAny[]);
    } finally {
      setBusy(false);
    }
  }

  const summaryByUser = useMemo(() => {
    const map = new Map<
      string,
      { user_id: string; full_name: string; total_hours: number; first_rate: number; rate_is_mixed: boolean; total_pay: number }
    >();

    for (const r of rows) {
      const uid = r.user_id;
      const hours = Number(r.hours_worked ?? 0);
      const rate = Number(r.hourly_rate_snapshot ?? 0);
      const pay = hours * rate;

      const existing = map.get(uid);
      if (!existing) {
        map.set(uid, { user_id: uid, full_name: getNameFromRow(r), total_hours: hours, first_rate: rate, rate_is_mixed: false, total_pay: pay });
      } else {
        existing.total_hours += hours;
        existing.total_pay += pay;
        if (Math.abs(existing.first_rate - rate) > 0.000001) existing.rate_is_mixed = true;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [rows]);

  const summaryByProject = useMemo(() => {
    const map = new Map<string, { project_id: string; project_name: string; total_hours: number; total_pay: number }>();
    for (const r of rows) {
      const pid = r.project_id;
      const name = getProjectNameFromRow(r);
      const hours = Number(r.hours_worked ?? 0);
      const rate = Number(r.hourly_rate_snapshot ?? 0);
      const pay = hours * rate;

      const existing = map.get(pid);
      if (!existing) map.set(pid, { project_id: pid, project_name: name, total_hours: hours, total_pay: pay });
      else {
        existing.total_hours += hours;
        existing.total_pay += pay;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.project_name.localeCompare(b.project_name));
  }, [rows]);

  const totalsByUser = useMemo(() => {
    let hours = 0, pay = 0;
    for (const r of summaryByUser) { hours += r.total_hours; pay += r.total_pay; }
    return { hours, pay };
  }, [summaryByUser]);

  const totalsByProject = useMemo(() => {
    let hours = 0, pay = 0;
    for (const r of summaryByProject) { hours += r.total_hours; pay += r.total_pay; }
    return { hours, pay };
  }, [summaryByProject]);

  const avgRate = useMemo(() => {
    const h = totalsByUser.hours;
    if (h <= 0) return 0;
    return totalsByUser.pay / h;
  }, [totalsByUser]);

  function exportSummaryCsv() {
    const projName = projectId ? projects.find((p) => p.id === projectId)?.name : "All";

    const contractorName = isContractor
      ? "(you)"
      : contractorId
        ? contractors.find((c) => c.id === contractorId)?.full_name || contractorId
        : "All";

    if (exportCurrentTableOnly) {
      if (currentTable === "contractors") {
        const header = ["Preset", "WeekStart", "Start", "End", "Status", "Project", "Contractor filter", "Contractor", "Hours", "Rate", "Pay"];
        const lines: string[] = [header.map(csvEscape).join(",")];

        for (const r of summaryByUser) {
          lines.push([preset, weekStart, startDate, endDate, status, projName, contractorName, r.full_name, r.total_hours.toFixed(2), r.rate_is_mixed ? "mixed" : money(r.first_rate), money(r.total_pay)].map(csvEscape).join(","));
        }
        lines.push([preset, weekStart, startDate, endDate, status, projName, contractorName, "TOTAL", totalsByUser.hours.toFixed(2), "", money(totalsByUser.pay)].map(csvEscape).join(","));
        return downloadCsv(`payroll_contractors_${startDate}_to_${endDate}.csv`, lines.join("\n"));
      }

      const header = ["Preset", "WeekStart", "Start", "End", "Status", "Project filter", "Contractor filter", "Project", "Hours", "Pay"];
      const lines: string[] = [header.map(csvEscape).join(",")];

      for (const r of summaryByProject) {
        lines.push([preset, weekStart, startDate, endDate, status, projName, contractorName, r.project_name, r.total_hours.toFixed(2), money(r.total_pay)].map(csvEscape).join(","));
      }
      lines.push([preset, weekStart, startDate, endDate, status, projName, contractorName, "TOTAL", totalsByProject.hours.toFixed(2), money(totalsByProject.pay)].map(csvEscape).join(","));
      return downloadCsv(`payroll_projects_${startDate}_to_${endDate}.csv`, lines.join("\n"));
    }

    const header = ["Report", "Preset", "WeekStart", "Start", "End", "Status", "Project", "Contractor", "", "Section", "Name", "Hours", "Rate", "Pay"];
    const baseMeta = ["Payroll Summary", preset, weekStart, startDate, endDate, status, projName || "All", contractorName || "All", ""];
    const lines: string[] = [header.map(csvEscape).join(",")];

    for (const r of summaryByUser) {
      lines.push([...baseMeta, "By Contractor", r.full_name, r.total_hours.toFixed(2), r.rate_is_mixed ? "mixed" : money(r.first_rate), money(r.total_pay)].map(csvEscape).join(","));
    }
    lines.push([...baseMeta, "By Contractor", "TOTAL", totalsByUser.hours.toFixed(2), "", money(totalsByUser.pay)].map(csvEscape).join(","));

    for (const r of summaryByProject) {
      lines.push([...baseMeta, "By Project", r.project_name, r.total_hours.toFixed(2), "", money(r.total_pay)].map(csvEscape).join(","));
    }
    lines.push([...baseMeta, "By Project", "TOTAL", totalsByProject.hours.toFixed(2), "", money(totalsByProject.pay)].map(csvEscape).join(","));

    return downloadCsv(`payroll_summary_${startDate}_to_${endDate}.csv`, lines.join("\n"));
  }

  function exportDetailCsv() {
    const header = ["entry_id", "entry_date", "status", "contractor", "user_id", "project", "project_id", "hours", "hourly_rate_snapshot", "pay"];
    const lines: string[] = [header.map(csvEscape).join(",")];

    for (const r of rows) {
      const hours = Number(r.hours_worked ?? 0);
      const rate = Number(r.hourly_rate_snapshot ?? 0);
      const pay = hours * rate;
      lines.push([r.id, r.entry_date, r.status, getNameFromRow(r), r.user_id, getProjectNameFromRow(r), r.project_id, hours.toFixed(2), money(rate), money(pay)].map(csvEscape).join(","));
    }
    return downloadCsv(`payroll_details_${startDate}_to_${endDate}.csv`, lines.join("\n"));
  }

  const headerRight = (
    <div className="payHeaderRight">
      <label className="payCsvToggle muted">
        <input type="checkbox" checked={exportCurrentTableOnly} onChange={(e) => setExportCurrentTableOnly(e.target.checked)} disabled={rows.length === 0 || busy} />
        Download current table only
      </label>

      <select value={currentTable} onChange={(e) => setCurrentTable(e.target.value as any)} disabled={!exportCurrentTableOnly || rows.length === 0 || busy}>
        <option value="contractors">Summary by Contractor</option>
        <option value="projects">Summary by Project</option>
      </select>

      <button className="pill" onClick={exportSummaryCsv} disabled={rows.length === 0 || busy}>Export Summary CSV</button>
      <button className="pill" onClick={exportDetailCsv} disabled={rows.length === 0 || busy}>Export Detail CSV</button>
      <button className="btnPrimary" onClick={load} disabled={busy || loadingLookups}>
        {busy ? "Loading…" : "Run Report"}
      </button>
    </div>
  );

  if (profLoading) {
    return (
      <AppShell title="Payroll" subtitle="Loading profile…">
        <div className="card cardPad"><div className="muted">Loading…</div></div>
      </AppShell>
    );
  }

  if (!userId) return null;

  if (!profile) {
    return (
      <AppShell title="Payroll" subtitle="Profile required">
        <div className="alert alertWarn">
          <div style={{ fontWeight: 950 }}>Profile missing</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{error || "No profile found."}</pre>
        </div>
      </AppShell>
    );
  }

  const subtitle = `Approved hours × snapshot rate • Week starts: ${weekStart}`;

  return (
    <AppShell title="Payroll" subtitle={subtitle} right={headerRight}>
      <div className="card cardPad payControls">
        <div className="payGrid">
          <div className="payField paySpan2">
            <div className="payLabel">Date Range</div>
            <select value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)}>
              <option value="current_week">Current week</option>
              <option value="last_week">Last week</option>
              <option value="current_month">Current month</option>
              <option value="last_month">Last month</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div className="payField">
            <div className="payLabel">Start</div>
            <input type="date" value={startDate} onChange={(e) => { setPreset("custom"); setStartDate(e.target.value); }} />
          </div>

          <div className="payField">
            <div className="payLabel">End</div>
            <input type="date" value={endDate} onChange={(e) => { setPreset("custom"); setEndDate(e.target.value); }} />
          </div>

          <div className="payField">
            <div className="payLabel">Status</div>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="approved">approved</option>
              <option value="submitted">submitted</option>
              <option value="draft">draft</option>
              <option value="rejected">rejected</option>
            </select>
          </div>

          <div className="payField">
            <div className="payLabel">Project</div>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="payField">
            <div className="payLabel">Contractor</div>
            <select value={contractorId} onChange={(e) => setContractorId(e.target.value)} disabled={isContractor || !isManagerOrAdmin}>
              <option value="">{isContractor ? "(you)" : "All"}</option>
              {!isContractor && contractors.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name || c.id}</option>
              ))}
            </select>
          </div>
        </div>

        {msg ? (
          <div className="alert alertInfo" style={{ marginTop: 10 }}>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg}</pre>
          </div>
        ) : null}
      </div>

      <div className="payKpis">
        <div className="card cardPad payKpi">
          <div className="payKpiLabel">Total Hours</div>
          <div className="payKpiValue">{totalsByUser.hours.toFixed(2)}</div>
        </div>
        <div className="card cardPad payKpi">
          <div className="payKpiLabel">Total Pay</div>
          <div className="payKpiValue">${money(totalsByUser.pay)}</div>
        </div>
        <div className="card cardPad payKpi">
          <div className="payKpiLabel">Avg Rate</div>
          <div className="payKpiValue">${money(avgRate)}</div>
        </div>
      </div>

      <div className="card cardPad paySection">
        <div className="paySectionHeader">
          <div className="paySectionTitle">Summary by Contractor</div>
          <button className="pill" onClick={() => setCurrentTable("contractors")} title="Use for CSV export">Set current</button>
        </div>

        {summaryByUser.length === 0 ? (
          <div className="muted">No rows for the selected filters.</div>
        ) : (
          <div className="payTableWrap">
            <div className="payTableHead">
              <div>Contractor</div>
              <div className="right">Hours</div>
              <div className="right">Rate</div>
              <div className="right">Pay</div>
            </div>

            {summaryByUser.map((r) => (
              <div key={r.user_id} className="payTableRow">
                <div>{r.full_name}</div>
                <div className="right mono">{r.total_hours.toFixed(2)}</div>
                <div className="right mono">{r.rate_is_mixed ? "mixed" : money(r.first_rate)}</div>
                <div className="right mono">${money(r.total_pay)}</div>
              </div>
            ))}

            <div className="payTableTotals">
              <div>TOTAL</div>
              <div className="right mono">{totalsByUser.hours.toFixed(2)}</div>
              <div />
              <div className="right mono">${money(totalsByUser.pay)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="card cardPad paySection">
        <div className="paySectionHeader">
          <div className="paySectionTitle">Summary by Project</div>
          <button className="pill" onClick={() => setCurrentTable("projects")} title="Use for CSV export">Set current</button>
        </div>

        {summaryByProject.length === 0 ? (
          <div className="muted">No rows for the selected filters.</div>
        ) : (
          <div className="payTableWrap">
            <div className="payTableHead payProjCols">
              <div>Project</div>
              <div className="right">Hours</div>
              <div className="right">Pay</div>
            </div>

            {summaryByProject.map((r) => (
              <div key={r.project_id} className="payTableRow payProjCols">
                <div>{r.project_name}</div>
                <div className="right mono">{r.total_hours.toFixed(2)}</div>
                <div className="right mono">${money(r.total_pay)}</div>
              </div>
            ))}

            <div className="payTableTotals payProjCols">
              <div>TOTAL</div>
              <div className="right mono">{totalsByProject.hours.toFixed(2)}</div>
              <div className="right mono">${money(totalsByProject.pay)}</div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function PayrollPage() {
  return (
    <RequireOnboarding>
      <PayrollInner />
    </RequireOnboarding>
  );
}
