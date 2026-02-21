"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
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

  // default week start = Sunday (SaaS payroll friendly + your request)
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
  const [contractors, setContractors] = useState<Array<{ id: string; full_name: string | null }>>([]);

  const [exportCurrentTableOnly, setExportCurrentTableOnly] = useState(false);
  const [currentTable, setCurrentTable] = useState<"contractors" | "projects">("contractors");

  const role = profile?.role || null;
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const isContractor = role === "contractor";

  useEffect(() => {
    if (profLoading) return;
    if (!userId) router.replace("/login");
  }, [profLoading, userId, router]);

  // Load projects incl week_start
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name,week_start")
        .order("name", { ascending: true });

      if (cancelled) return;
      if (error) {
        setMsg(error.message);
        setProjects([]);
        return;
      }
      setProjects(((data as any) ?? []) as ProjectRow[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [profile]);

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

  // Contractors dropdown for admin/manager (RLS scopes managers to direct reports)
  useEffect(() => {
    if (!profile) return;
    if (!(isAdmin || isManager)) {
      setContractors([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name", { ascending: true });

      if (cancelled) return;
      setContractors(((data as any) ?? []) as Array<{ id: string; full_name: string | null }>);
    })();

    return () => {
      cancelled = true;
    };
  }, [profile, isAdmin, isManager]);

  async function load() {
    if (!profile) return;
    setBusy(true);
    setMsg("");
    try {
      let q = supabase
        .from("v_time_entries")
        .select("*")
        .gte("entry_date", startDate)
        .lte("entry_date", endDate)
        .eq("status", status)
        .order("user_id", { ascending: true })
        .order("entry_date", { ascending: true });

      if (projectId) q = q.eq("project_id", projectId);
      if (!isContractor && contractorId) q = q.eq("user_id", contractorId);

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

  function exportSummaryCsv() {
    const projName = projectId ? projects.find((p) => p.id === projectId)?.name : "All";
    const contractorName = isContractor
      ? "(self)"
      : contractorId
        ? contractors.find((c) => c.id === contractorId)?.full_name || contractorId
        : "All";

    if (exportCurrentTableOnly) {
      if (currentTable === "contractors") {
        const header = ["Preset","WeekStart","Start","End","Status","Project","Contractor filter","Contractor","Hours","Rate","Pay"];
        const lines: string[] = [header.map(csvEscape).join(",")];

        for (const r of summaryByUser) {
          lines.push([preset, weekStart, startDate, endDate, status, projName, contractorName, r.full_name, r.total_hours.toFixed(2), r.rate_is_mixed ? "mixed" : money(r.first_rate), money(r.total_pay)].map(csvEscape).join(","));
        }
        lines.push([preset, weekStart, startDate, endDate, status, projName, contractorName, "TOTAL", totalsByUser.hours.toFixed(2), "", money(totalsByUser.pay)].map(csvEscape).join(","));
        return downloadCsv(`payroll_contractors_${startDate}_to_${endDate}.csv`, lines.join("\n"));
      }

      const header = ["Preset","WeekStart","Start","End","Status","Project filter","Contractor filter","Project","Hours","Pay"];
      const lines: string[] = [header.map(csvEscape).join(",")];

      for (const r of summaryByProject) {
        lines.push([preset, weekStart, startDate, endDate, status, projName, contractorName, r.project_name, r.total_hours.toFixed(2), money(r.total_pay)].map(csvEscape).join(","));
      }
      lines.push([preset, weekStart, startDate, endDate, status, projName, contractorName, "TOTAL", totalsByProject.hours.toFixed(2), money(totalsByProject.pay)].map(csvEscape).join(","));
      return downloadCsv(`payroll_projects_${startDate}_to_${endDate}.csv`, lines.join("\n"));
    }

    // both tables
    const header = ["Report","Preset","WeekStart","Start","End","Status","Project","Contractor","","Section","Name","Hours","Rate","Pay"];
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
    const header = ["entry_id","entry_date","status","contractor","user_id","project","project_id","hours","hourly_rate_snapshot","pay"];
    const lines: string[] = [header.map(csvEscape).join(",")];

    for (const r of rows) {
      const hours = Number(r.hours_worked ?? 0);
      const rate = Number(r.hourly_rate_snapshot ?? 0);
      const pay = hours * rate;
      lines.push([r.id, r.entry_date, r.status, getNameFromRow(r), r.user_id, getProjectNameFromRow(r), r.project_id, hours.toFixed(2), money(rate), money(pay)].map(csvEscape).join(","));
    }
    return downloadCsv(`payroll_details_${startDate}_to_${endDate}.csv`, lines.join("\n"));
  }

  if (profLoading) {
    return <AppShell title="Payroll"><div className="card cardPad">Loading…</div></AppShell>;
  }
  if (!userId) return null;

  if (!profile) {
    return (
      <AppShell title="Payroll">
        <div className="card cardPad">
          <div style={{ fontWeight: 900 }}>Profile missing</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{error || "No profile found."}</pre>
        </div>
      </AppShell>
    );
  }

  const controlsStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12 };
  const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
  const cell: CSSProperties = { padding: "10px 8px", borderBottom: "1px solid rgba(15, 23, 42, 0.10)", verticalAlign: "top" };
  const totalsRowStyle: CSSProperties = { fontWeight: 900, borderTop: "2px solid rgba(15, 23, 42, 0.18)" };

  return (
    <AppShell
      title="Payroll"
      subtitle={`Approved hours × snapshot rate • Week starts: ${weekStart}`}
      right={
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }} className="muted">
            <input type="checkbox" checked={exportCurrentTableOnly} onChange={(e) => setExportCurrentTableOnly(e.target.checked)} disabled={rows.length === 0 || busy} />
            Download as CSV (current table only)
          </label>

          <select value={currentTable} onChange={(e) => setCurrentTable(e.target.value as any)} disabled={!exportCurrentTableOnly || rows.length === 0 || busy}>
            <option value="contractors">Summary by Contractor</option>
            <option value="projects">Summary by Project</option>
          </select>

          <button className="btn" onClick={exportSummaryCsv} disabled={rows.length === 0 || busy}>Export Summary CSV</button>
          <button className="btn" onClick={exportDetailCsv} disabled={rows.length === 0 || busy}>Export Detail CSV</button>
          <button className="btn btnPrimary" onClick={load} disabled={busy}>{busy ? "Loading…" : "Run Report"}</button>
        </div>
      }
    >
      <div className="card cardPad" style={{ marginBottom: 12 }}>
        <div style={controlsStyle}>
          <div style={{ gridColumn: "span 2" }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Date Range</div>
            <select value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)}>
              <option value="current_week">Current week</option>
              <option value="last_week">Last week</option>
              <option value="current_month">Current month</option>
              <option value="last_month">Last month</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Start</div>
            <input type="date" value={startDate} onChange={(e) => { setPreset("custom"); setStartDate(e.target.value); }} />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>End</div>
            <input type="date" value={endDate} onChange={(e) => { setPreset("custom"); setEndDate(e.target.value); }} />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Status</div>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="approved">approved</option>
              <option value="submitted">submitted</option>
              <option value="draft">draft</option>
              <option value="rejected">rejected</option>
            </select>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Project</div>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Contractor</div>
            <select value={contractorId} onChange={(e) => setContractorId(e.target.value)} disabled={isContractor}>
              <option value="">{isContractor ? "(you)" : "All"}</option>
              {!isContractor && contractors.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.id}</option>)}
            </select>
          </div>
        </div>

        {msg ? <div style={{ marginTop: 10, color: "#b91c1c", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div> : null}
      </div>

      <div className="card cardPad" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 900 }}>Summary by Contractor</div>
          <button className="btn" onClick={() => setCurrentTable("contractors")}>Set as current table</button>
        </div>

        {summaryByUser.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>No rows for the selected filters.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ ...cell, textAlign: "left" }}>Contractor</th>
                  <th style={{ ...cell, textAlign: "right" }}>Hours</th>
                  <th style={{ ...cell, textAlign: "right" }}>Rate</th>
                  <th style={{ ...cell, textAlign: "right" }}>Pay</th>
                </tr>
              </thead>
              <tbody>
                {summaryByUser.map((r) => (
                  <tr key={r.user_id}>
                    <td style={{ ...cell, textAlign: "left" }}>{r.full_name}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{r.total_hours.toFixed(2)}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{r.rate_is_mixed ? "(mixed)" : money(r.first_rate)}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{money(r.total_pay)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...cell, ...totalsRowStyle, textAlign: "left" }}>TOTAL</td>
                  <td style={{ ...cell, ...totalsRowStyle, textAlign: "right" }}>{totalsByUser.hours.toFixed(2)}</td>
                  <td style={{ ...cell, ...totalsRowStyle, textAlign: "right" }} />
                  <td style={{ ...cell, ...totalsRowStyle, textAlign: "right" }}>{money(totalsByUser.pay)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card cardPad">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 900 }}>Summary by Project</div>
          <button className="btn" onClick={() => setCurrentTable("projects")}>Set as current table</button>
        </div>

        {summaryByProject.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>No rows for the selected filters.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ ...cell, textAlign: "left" }}>Project</th>
                  <th style={{ ...cell, textAlign: "right" }}>Hours</th>
                  <th style={{ ...cell, textAlign: "right" }}>Pay</th>
                </tr>
              </thead>
              <tbody>
                {summaryByProject.map((r) => (
                  <tr key={r.project_id}>
                    <td style={{ ...cell, textAlign: "left" }}>{r.project_name}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{r.total_hours.toFixed(2)}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{money(r.total_pay)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...cell, ...totalsRowStyle, textAlign: "left" }}>TOTAL</td>
                  <td style={{ ...cell, ...totalsRowStyle, textAlign: "right" }}>{totalsByProject.hours.toFixed(2)}</td>
                  <td style={{ ...cell, ...totalsRowStyle, textAlign: "right" }}>{money(totalsByProject.pay)}</td>
                </tr>
              </tbody>
            </table>
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
