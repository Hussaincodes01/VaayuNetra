import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing: exchange the PKCE code (or verify a token_hash) for a session, then go to the
 * dashboard in the user's saved language.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const rawNext = url.searchParams.get("next") ?? "/dashboard";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/dashboard";

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing code") };
  if (error)
    return NextResponse.redirect(new URL("/login?error=link", url.origin));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("lang")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };
  const bare = next.replace(/^\/hi(?=\/|$)/, "") || "/dashboard";
  const target = profile?.lang === "hi" ? `/hi${bare}` : bare;
  return NextResponse.redirect(new URL(target, url.origin));
}
