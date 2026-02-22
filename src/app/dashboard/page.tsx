// src/app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import RequireOnboarding from "../../components/auth/RequireOnboarding";
import AppShell from "../../components/layout/AppShell";
import { supabase } from "../../lib/supabaseBrowser";
import { useProfile } from "../../lib/useProfile";
import { isProfileComplete } from "../../lib/profileCompletion";
import { addDays, startOfWeekSunday, toISODate, weekRangeLabel } from "../../lib/date";

type EntryStatus = "draft" | "submitted" | "approved" | "rejected";

type VEntry = {
  id: string;
  user_id: string;
  entry_date: string;
  status: EntryStatus;
  hours_worked: number | null;
  hourly_rate_snapshot?: number | null;
  org_id?: string;
};

function money(x: number) {
  return x.toFixed(2);
}

export default function DashboardPage() {
  const router = useRouter();
  const { loading, userId, profile, error } = useProfile();

  // Keep your existing guard behavior
  useEffect(() => {
    if (loading) return;

    if (!userId) {
      router.replace("/login");
      return;
    }

    if (!isProfileComplete(profile)) {
      router.replace("/onboarding");
      return;
    }
  }, [loading, userId, profile, router]);

  const role = profile?.role || null;
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const isContractor = role === "contractor";
  const isManagerOrAdmin = isAdmin || isManager;

  // Date windows
  const thisWeekStart = useMemo(() => startOfWeekSunday(new Date()), []);
  const lastWeekStart = useMemo(() => addDays(thisWeekStart, -7), [thisWeekStart]);

  const thisWeekStartISO = useMemo(() => toISODate(thisWeekStart), [thisWeekStart]);
  const thisWeekEndISO = useMemo(() => toISODate(addDays(thisWeekStart, 6)), [thisWeekStart]);

  const lastWeekStartISO = useMemo(() => toISODate(lastWeekStart), [lastWeekStart]);
  const lastWeekEndISO = useMemo(() => toISODate(addDays(lastWeekStart, 6)), [lastWeekStart]);

  const last30StartISO = useMemo(() => toISODate(addDays(new Date(), -30)), []);
  const todayISO = useMemo(() => toISODate(new Date()), []);

  // KPI state
  const [kpiThisWeekHours, setKpiThisWeekHours] = useState<number>(0);
  const [kpiLastWeekHours, setKpiLastWeekHours] = useState<number>(0);
  const [kpiPendingApprovals, setKpiPendingApprovals] = useState<number>(0);
  const [kpiLast30Pay, setKpiLast30Pay] = useState<number>(0);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!profile || !userId) return;

    let cancelled = false;

    (async () => {
      setBusy(true);
      setMsg("");

      try {
        // 1) This week hours
        {
          let q = supabase
            .from("v_time_entries")
            .select("hours_worked, user_id, org_id")
            .gte("entry_date", thisWeekStartISO)
            .lte("entry_date", thisWeekEndISO)
            .eq("status", "approved");

          // Contractors see only themselves; managers/admin still rely on RLS (but we keep it org-safe when possible)
          if (isContractor) q = q.eq("user_id", userId);

          const { data, error } = await q;
          if (!cancelled) {
            if (error) setMsg(error.message);
            const sum = (((data as any) ?? []) as VEntry[]).reduce((acc, r) => acc + Number(r.hours_worked ?? 0), 0);
            setKpiThisWeekHours(sum);
          }
        }

        // 2) Last week hours
        {
          let q = supabase
            .from("v_time_entries")
            .select("hours_worked, user_id, org_id")
            .gte("entry_date", lastWeekStartISO)
            .lte("entry_date", lastWeekEndISO)
            .eq("status", "approved");

          if (isContractor) q = q.eq("user_id", userId);

          const { data, error } = await q;
          if (!cancelled) {
            if (error) setMsg((m) => (m ? `${m}\n${error.message}` : error.message));
            const sum = (((data as any) ?? []) as VEntry[]).reduce((acc, r) => acc + Number(r.hours_worked ?? 0), 0);
            setKpiLastWeekHours(sum);
          }
        }

        // 3) Pending approvals (manager/admin)
        if (isManagerOrAdmin) {
          const { data, error } = await supabase
            .from("v_time_entries")
            .select("id")
            .eq("org_id", profile.org_id)
            .eq("status", "submitted");

          if (!cancelled) {
            if (error) setMsg((m) => (m ? `${m}\n${error.message}` : error.message));
            setKpiPendingApprovals(((data as any) ?? [])?.length ?? 0);
          }
        } else {
          setKpiPendingApprovals(0);
        }

        // 4) Last 30 days pay (contractor)
        if (isContractor) {
          const { data, error } = await supabase
            .from("v_time_entries")
            .select("hours_worked, hourly_rate_snapshot")
            .eq("user_id", userId)
            .gte("entry_date", last30StartISO)
            .lte("entry_date", todayISO)
            .eq("status", "approved");

          if (!cancelled) {
            if (error) setMsg((m) => (m ? `${m}\n${error.message}` : error.message));
            const pay = (((data as any) ?? []) as VEntry[]).reduce((acc, r) => {
              const h = Number(r.hours_worked ?? 0);
              const rate = Number(r.hourly_rate_snapshot ?? 0);
              return acc + h * rate;
            }, 0);
            setKpiLast30Pay(pay);
          }
        } else {
          setKpiLast30Pay(0);
        }
      } catch (e: any) {
        if (!cancelled) setMsg(e?.message || "Failed to load dashboard.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    profile,
    userId,
    isContractor,
    isManagerOrAdmin,
    thisWeekStartISO,
    thisWeekEndISO,
    lastWeekStartISO,
    lastWeekEndISO,
    last30StartISO,
    todayISO,
  ]);

  if (loading) {
    return (
      <AppShell title="Dashboard" subtitle="Loading…">
        <div className="card cardPad">
          <div className="muted">Loading…</div>
        </div>
      </AppShell>
    );
  }

  if (!userId) return null;

  if (!profile) {
    return (
      <AppShell title="Dashboard" subtitle="Profile required">
        <div className="alert alertWarn">
          <div style={{ fontWeight: 950 }}>Profile missing</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{error || "No profile found."}</pre>
        </div>
      </AppShell>
    );
  }

  const subtitle = `Welcome back${profile.full_name ? `, ${profile.full_name}` : ""}`;

  const headerRight = (
    <div className="dbHeaderRight">
      <button className="pill" onClick={() => router.push("/timesheet")}>
        Enter time
      </button>

      {isManagerOrAdmin ? (
        <button className="pill" onClick={() => router.push("/approvals")}>
          Review approvals
        </button>
      ) : null}

      <button className="btnPrimary" onClick={() => router.push("/reports/payroll")}>
        Payroll
      </button>
    </div>
  );

  return (
    <RequireOnboarding>
      <AppShell title="Dashboard" subtitle={subtitle} right={headerRight}>
        {msg ? (
          <div className="alert alertInfo">
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg}</pre>
          </div>
        ) : null}

        <div className="dbKpis">
          <div className="card cardPad dbKpi">
            <div className="dbKpiLabel">This week (approved)</div>
            <div className="dbKpiValue">{kpiThisWeekHours.toFixed(2)} hrs</div>
            <div className="muted dbKpiHint">{weekRangeLabel(thisWeekStart)}</div>
          </div>

          <div className="card cardPad dbKpi">
            <div className="dbKpiLabel">Last week (approved)</div>
            <div className="dbKpiValue">{kpiLastWeekHours.toFixed(2)} hrs</div>
            <div className="muted dbKpiHint">{weekRangeLabel(lastWeekStart)}</div>
          </div>

          {isManagerOrAdmin ? (
            <div className="card cardPad dbKpi">
              <div className="dbKpiLabel">Pending approvals</div>
              <div className="dbKpiValue">{kpiPendingApprovals}</div>
              <div className="muted dbKpiHint">Submitted entries needing review</div>
            </div>
          ) : (
            <div className="card cardPad dbKpi">
              <div className="dbKpiLabel">Status</div>
              <div className="dbKpiValue">{profile.is_active ? "Active" : "Inactive"}</div>
              <div className="muted dbKpiHint">Account access</div>
            </div>
          )}
        </div>

        {isContractor ? (
          <div className="card cardPad dbPayCard">
            <div className="dbPayHeader">
              <div>
                <div className="dbPayTitle">Estimated pay (last 30 days)</div>
                <div className="muted">Approved hours × snapshot rate</div>
              </div>
              <div className="dbPayValue">${money(kpiLast30Pay)}</div>
            </div>

            <div className="dbInfoGrid">
              <div className="dbInfoItem">
                <div className="dbInfoLabel">Role</div>
                <div className="dbInfoValue">{profile.role}</div>
              </div>
              <div className="dbInfoItem">
                <div className="dbInfoLabel">Hourly Rate</div>
                <div className="dbInfoValue">{Number(profile.hourly_rate ?? 0).toFixed(2)}</div>
              </div>
              <div className="dbInfoItem">
                <div className="dbInfoLabel">Onboarding</div>
                <div className="dbInfoValue">{profile.onboarding_completed_at ? "Complete" : "Incomplete"}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="card cardPad dbPayCard">
            <div className="dbPayHeader">
              <div>
                <div className="dbPayTitle">Org overview</div>
                <div className="muted">Quick access to core areas</div>
              </div>
              <div className="dbPayValue">{busy ? "…" : "Ready"}</div>
            </div>

            <div className="dbQuickGrid">
              <button className="dbQuickBtn" onClick={() => router.push("/timesheet")}>
                Timesheet
                <span className="muted">Enter and submit time</span>
              </button>

              <button className="dbQuickBtn" onClick={() => router.push("/projects")}>
                Projects
                <span className="muted">Manage workstreams</span>
              </button>

              <button className="dbQuickBtn" onClick={() => router.push("/reports/payroll")}>
                Payroll
                <span className="muted">Run pay reports</span>
              </button>

              {isManagerOrAdmin ? (
                <button className="dbQuickBtn" onClick={() => router.push("/approvals")}>
                  Approvals
                  <span className="muted">Review submissions</span>
                </button>
              ) : null}
            </div>
          </div>
        )}

        <div className="card cardPad dbFooterCard">
          <div style={{ fontWeight: 950 }}>Account</div>
          <div className="dbInfoGrid" style={{ marginTop: 10 }}>
            <div className="dbInfoItem">
              <div className="dbInfoLabel">Role</div>
              <div className="dbInfoValue">{profile.role}</div>
            </div>
            <div className="dbInfoItem">
              <div className="dbInfoLabel">Active</div>
              <div className="dbInfoValue">{profile.is_active ? "Yes" : "No"}</div>
            </div>
            <div className="dbInfoItem">
              <div className="dbInfoLabel">Onboarding</div>
              <div className="dbInfoValue">{profile.onboarding_completed_at ? "Yes" : "No"}</div>
            </div>
          </div>
        </div>
      </AppShell>
    </RequireOnboarding>
  );
}
