// src/app/api/admin/invite/route.ts
import { NextResponse } from "next/server";
import { supabaseService } from "../../../../lib/supabaseServer";

type Role = "admin" | "manager" | "contractor";

/**
 * Admin invite endpoint
 * POST /api/admin/invite
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });

    const email = String(body.email || "").trim().toLowerCase();
    const full_name = String(body.full_name || "").trim();
    const hourly_rate = Number(body.hourly_rate ?? 0);
    const role = String(body.role || "contractor") as Role;
    const manager_id = body.manager_id ? String(body.manager_id) : null;

    const project_ids_raw = Array.isArray(body.project_ids) ? body.project_ids : [];
    const project_ids = project_ids_raw
      .map((x: any) => String(x || "").trim())
      .filter((x: string) => x.length > 0);

    if (!email) return NextResponse.json({ ok: false, error: "Email required" }, { status: 400 });
    if (!["manager", "contractor"].includes(role)) {
      return NextResponse.json({ ok: false, error: "Role must be manager or contractor" }, { status: 400 });
    }
    if (Number.isNaN(hourly_rate) || hourly_rate < 0) {
      return NextResponse.json({ ok: false, error: "Hourly rate invalid" }, { status: 400 });
    }

    const supa = supabaseService();

    // Verify caller token
    const { data: caller, error: callerErr } = await supa.auth.getUser(token);
    if (callerErr || !caller?.user) {
      return NextResponse.json({ ok: false, error: callerErr?.message || "Unauthorized" }, { status: 401 });
    }

    // Caller must be admin
    const { data: callerProf, error: callerProfErr } = await supa
      .from("profiles")
      .select("id, org_id, role")
      .eq("id", caller.user.id)
      .maybeSingle();

    if (callerProfErr) return NextResponse.json({ ok: false, error: callerProfErr?.message || "Profile lookup failed" }, { status: 400 });
    if (!callerProf?.org_id || callerProf.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Admin only" }, { status: 403 });
    }

    // Invite
    const redirectTo = (`${process.env.NEXT_PUBLIC_SITE_URL || ""}/auth/callback`).trim() || undefined;

    const { data: inviteData, error: inviteErr } = await supa.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inviteErr) return NextResponse.json({ ok: false, error: inviteErr.message }, { status: 400 });

    const invitedUserId = inviteData.user?.id;
    if (!invitedUserId) return NextResponse.json({ ok: false, error: "Invite created but missing user id" }, { status: 400 });

    // Upsert profile for invited user
    const payload = {
      id: invitedUserId,
      org_id: callerProf.org_id,
      role,
      full_name: full_name || null,
      hourly_rate: hourly_rate, // allow hourly_rate for any role (admin wants flexibility)
      is_active: true,
      manager_id: role === "contractor" ? manager_id : null,
    };

    const { error: upErr } = await supa.from("profiles").upsert(payload, { onConflict: "id" });
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 400 });

    // Optional: assign projects (recommended for contractors)
    if (project_ids.length > 0) {
      // Validate projects belong to org
      const { data: validProjects, error: projErr } = await supa
        .from("projects")
        .select("id")
        .eq("org_id", callerProf.org_id)
        .in("id", project_ids);

      if (projErr) return NextResponse.json({ ok: false, error: projErr.message }, { status: 400 });

      const validIds = new Set(((validProjects as any) ?? []).map((p: any) => p.id));
      const invalid = project_ids.filter((id: string) => !validIds.has(id));
      if (invalid.length) {
        return NextResponse.json(
          { ok: false, error: `Invalid project(s) for this org: ${invalid.join(", ")}` },
          { status: 400 }
        );
      }

      const memberRows = project_ids.map((pid: string) => ({
        org_id: callerProf.org_id,
        project_id: pid,
        user_id: invitedUserId,
        profile_id: invitedUserId, // your schema uses both; keep consistent
        is_active: true,
      }));

      // Upsert by PK: (project_id, user_id)
      const { error: memErr } = await supa
        .from("project_members")
        .upsert(memberRows as any, { onConflict: "project_id,user_id" });

      if (memErr) return NextResponse.json({ ok: false, error: memErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
