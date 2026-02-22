// src/components/layout/TopNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseBrowser";

function RoleBadge({ role }: { role: string | null | undefined }) {
  const r = (role || "").toLowerCase();
  const cls =
    r === "admin"
      ? "badge badgeAdmin"
      : r === "manager"
        ? "badge badgeManager"
        : "badge badgeContractor";
  return <span className={cls}>{r || "user"}</span>;
}

export default function TopNav() {
  const pathname = usePathname();
  const { profile } = useProfile();

  // Hide nav on auth + landing + onboarding
  if (pathname === "/login" || pathname === "/reset" || pathname === "/" || pathname === "/onboarding") return null;

  const role = (profile?.role || "").toLowerCase();
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const isManagerOrAdmin = isAdmin || isManager;

  const links: Array<{ href: string; label: string; show?: boolean; match?: "exact" | "prefix" }> = [
    { href: "/dashboard", label: "Dashboard", match: "exact" },
    { href: "/timesheet", label: "Timesheet", match: "exact" },
    { href: "/approvals", label: "Approvals", show: isManagerOrAdmin, match: "exact" },

    // reporting (nested routes should stay active)
    { href: "/reports/payroll", label: "Payroll", show: true, match: "prefix" },

    { href: "/projects", label: "Projects", match: "exact" },

    // ✅ People: Admin + Manager (page itself enforces scoping)
    { href: "/profiles", label: "People", show: isManagerOrAdmin, match: "exact" },

    // Admin only
    { href: "/admin", label: "Admin", show: isAdmin, match: "exact" },
  ];

  return (
    <div className="topNav">
      <div className="topNavInner">
        <div className="brand" aria-label="Timesheet Webapp">
          <span className="brandDot" />
          <span>Timesheet</span>
          <span style={{ marginLeft: 8 }}>
            <RoleBadge role={profile?.role} />
          </span>
        </div>

        <div className="navLinks">
          {links
            .filter((l) => l.show !== false)
            .map((l) => {
              const active =
                l.match === "prefix" ? pathname === l.href || pathname.startsWith(l.href + "/") : pathname === l.href;

              return (
                <Link key={l.href} href={l.href} className={active ? "pill pillActive" : "pill"}>
                  {l.label}
                </Link>
              );
            })}

          <button
            className="pill"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/login";
            }}
            title="Sign out"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
