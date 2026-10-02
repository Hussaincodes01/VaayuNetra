import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);
const PROTECTED = /^\/(?:(?:en|hi)\/)?dashboard(?:\/|$)/;

/**
 * next-intl locale routing, plus Supabase session refresh. /dashboard requires a signed-in user;
 * everything else (the landing page, /map, /login) is public.
 */
export default async function middleware(request: NextRequest) {
  const response = intl(request);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;
  if (!url || !key || !PROTECTED.test(path)) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) =>
        list.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        ),
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return response;

  const locale = path.startsWith("/hi") ? "/hi" : "";
  const login = new URL(`${locale}/login`, request.url);
  login.searchParams.set("next", path);
  const redirect = NextResponse.redirect(login);
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

export const config = {
  // Skip API and auth routes, Next.js internals, Vercel internals and files with an extension.
  matcher: "/((?!api|auth|trpc|_next|_vercel|.*\\..*).*)",
};
