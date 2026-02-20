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

  // Hide nav on auth pages
  if (pathname === "/login" || pathname === "/reset" || pathname === "/") return null;

  const role = (profile?.role || "").toLowerCase();
  const isAdmin = role === "admin";
  const isManager = role === "manager";

  const links: Array<{ href: string; label: string; show?: boolean }> = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/timesheet", label: "Timesheet" },
    { href: "/approvals", label: "Approvals", show: isAdmin || isManager },
    { href: "/projects", label: "Projects" },
    { href: "/profiles", label: "Profiles", show: isAdmin },
    { href: "/admin", label: "Admin", show: isAdmin },
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
              const active = pathname === l.href;
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
