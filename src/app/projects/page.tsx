"use client";

import { Suspense } from "react";
import RequireOnboarding from "../../components/auth/RequireOnboarding";
import AppShell from "../../components/layout/AppShell";
import ProjectsClient from "./projects-client";

function ProjectsLoading() {
  return (
    <AppShell title="Projects" subtitle="Create projects and manage access">
      <div className="card cardPad" style={{ maxWidth: 980 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="skeleton" style={{ height: 16, width: 260 }} />
          <div className="skeleton" style={{ height: 40, width: "100%" }} />
          <div className="skeleton" style={{ height: 320, width: "100%" }} />
        </div>
      </div>
    </AppShell>
  );
}

export default function ProjectsPage() {
  return (
    <RequireOnboarding>
      <Suspense fallback={<ProjectsLoading />}>
        <ProjectsClient />
      </Suspense>
    </RequireOnboarding>
  );
}
