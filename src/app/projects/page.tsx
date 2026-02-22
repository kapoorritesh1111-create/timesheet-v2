// src/app/projects/page.tsx
"use client";

import { Suspense } from "react";
import RequireOnboarding from "../../components/auth/RequireOnboarding";
import AppShell from "../../components/layout/AppShell";
import ProjectsClient from "./projects-client";

function ProjectsLoading() {
  return (
    <AppShell title="Projects" subtitle="Create projects and manage access">
      <div className="card cardPad prShell">
        <div className="prSkel">
          <div className="skeleton prSkelLine" />
          <div className="skeleton prSkelBar" />
          <div className="skeleton prSkelTable" />
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
