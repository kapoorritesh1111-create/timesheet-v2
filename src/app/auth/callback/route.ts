import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (!code) {
    // No auth code — send user to login with a clean message
    return NextResponse.redirect(new URL(`/login?error=missing_code`, url.origin));
  }

  const supabase = createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=auth_callback_failed`, url.origin)
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
