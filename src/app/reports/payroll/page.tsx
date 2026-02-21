// src/app/reports/payroll/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import RequireOnboarding from "../../../components/auth/RequireOnboarding";
import AppShell from "../../../components/layout/AppShell";
import { supabase } from "../../../lib/supabaseBrowser";
import { useProfile } from "../../../lib/useProfile";
import { toISODate } from "../../../lib/date";

type EntryStatus = "draft" | "submitted" | "approved" | "rejected";

type VTimeEntry = {
  id: string;
  user_id: string;
  entry_date: string; // YYYY-MM-DD
  project_id: string;
  status: EntryStatus;
  hours_worked: number | null;

  // v_time_entries extras
  full_name: string | null;
  project_name: string | null;

  // from time_entries (te.*) via view
  hourly_rate_snapshot: number | null;
};

type ProjectRow = { id: string; name: string };

function firstDayOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function lastDayOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function defaultStartEnd() {
  // default = last calendar month
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    start: toISODate(firstDayOfMonth(lastMonth)),
    end: toISODate(lastDayOfMonth(lastMonth)),
  };
}

function money(x: number) {
  return x.toFixed(2);
}

function PayrollInner() {
  const router = useRouter();
  const { loading: profLoading, userId, profile, error } = useProfile();

  const defaults = useMemo(() => defaultStartEnd(), []);
  const [startDate, setStartDate] = useState<string>(defaults.start);
  const [endDate, setEndDate] = useState<string>(defaults.end);
  const [status, setStatus] = useState<EntryStatus>("approved");
  const [projectId, setProjectId] = useState<string>("");
  const [contractorId, setContractorId] = useState<string>(""); // admin/manager only

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [rows, setRows] = useState<VTimeEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [contractors, setContractors] = useState<Array<{ id: string; full_name: string | null }>>([]);

  const role = profile?.role || null;
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const isContractor = role === "contractor";

  useEffect(() => {
    if (profLoading) return;
    if (!userId) router.replace("/login");
  }, [profLoading, userId, router]);

  // Load projects dropdown (RLS-scoped)
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.from("projects").select("id,name").order("name", { ascending: true });
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

  // Load contractor dropdown for admin/manager (RLS will scope managers to direct reports)
  useEffect(() => {
    if (!profile) return;
    if (!(isAdmin || isManager)) {
      setContractors([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name", { ascending: true });

      if (cancelled) return;
      if (error) {
        setContractors([]);
        return;
      }
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
        .select(
          [
            "id",
            "user_id",
            "entry_date",
            "project_id",
            "status",
            "hours_worked",
            "full_name",
            "project_name",
            "hourly_rate_snapshot",
          ].join(",")
        )
        .gte("entry_date", startDate)
        .lte("entry_date", endDate)
        .eq("status", status)
        .order("user_id", { ascending: true })
        .order("entry_date", { ascending: true });

      if (projectId) q = q.eq("project_id", projectId);

      // Contractor should never filter another user
      if (!isContractor && contractorId) q = q.eq("user_id", contractorId);

      const { data, error } = await q;
      if (error) {
        setRows([]);
        setMsg(error.message);
        return;
      }

      setRows(((data as any) ?? []) as VTimeEntry[]);
    } finally {
      setBusy(false);
    }
  }

  const summaryByUser = useMemo(() => {
    const map = new Map<
      string,
      {
        user_id: string;
        full_name: string;
        total_hours: number;
        first_rate: number;
        rate_is_mixed: boolean;
        total_pay: number;
      }
    >();

    for (const r of rows) {
      const uid = r.user_id;
      const hours = Number(r.hours_worked ?? 0);
      const rate = Number(r.hourly_rate_snapshot ?? 0);
      const pay = hours * rate;

      const existing = map.get(uid);
      if (!existing) {
        map.set(uid, {
          user_id: uid,
          full_name: r.full_name || "(no name)",
          total_hours: hours,
          first_rate: rate,
          rate_is_mixed: false,
          total_pay: pay,
        });
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
      const name = r.project_name || "(no project)";
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

  if (profLoading) {
    return (
      <AppShell title="Payroll">
        <div className="card cardPad">Loading…</div>
      </AppShell>
    );
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

  const controlsStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: 12,
  };

  const tableStyle: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 14,
  };

  const cell: CSSProperties = {
    padding: "10px 8px",
    borderBottom: "1px solid rgba(15, 23, 42, 0.10)",
    verticalAlign: "top",
  };

  return (
    <AppShell
      title="Payroll"
      subtitle="Approved hours × snapshot rate (audit-safe)"
      right={
        <button className="btn btnPrimary" onClick={load} disabled={busy}>
          {busy ? "Loading…" : "Run Report"}
        </button>
      }
    >
      <div className="card cardPad" style={{ marginBottom: 12 }}>
        <div style={controlsStyle}>
          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
              Start
            </div>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
              End
            </div>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
              Status
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value as EntryStatus)}>
              <option value="approved">approved</option>
              <option value="submitted">submitted</option>
              <option value="draft">draft</option>
              <option value="rejected">rejected</option>
            </select>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
              Project
            </div>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ gridColumn: isContractor ? "span 2" : "span 1" }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
              Contractor
            </div>
            <select
              value={contractorId}
              onChange={(e) => setContractorId(e.target.value)}
              disabled={isContractor}
              title={isContractor ? "Contractors can only view their own payroll" : undefined}
            >
              <option value="">{isContractor ? "(you)" : "All"}</option>
              {!isContractor &&
                contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name || c.id}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
              &nbsp;
            </div>
            <button
              className="btn"
              onClick={() => {
                setProjectId("");
                setContractorId("");
                setStatus("approved");
              }}
              disabled={busy}
            >
              Reset
            </button>
          </div>
        </div>

        {msg ? (
          <div style={{ marginTop: 10, color: "#b91c1c", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>
        ) : null}
      </div>

      <div className="card cardPad" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Summary by Contractor</div>
        {summaryByUser.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            No rows for the selected filters.
          </div>
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
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card cardPad">
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Summary by Project</div>
        {summaryByProject.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            No rows for the selected filters.
          </div>
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
