// src/app/projects/page.tsx
"use client";

import { Suspense } from "react";
import RequireOnboarding from "../../components/auth/RequireOnboarding";
import ProjectsClient from "./projects-client";

export default function ProjectsPage() {
  return (
    <RequireOnboarding>
      <Suspense fallback={<div style={{ padding: 24 }}>Loading Projects…</div>}>
        <ProjectsClient />
      </Suspense>
    </RequireOnboarding>
  );
}
