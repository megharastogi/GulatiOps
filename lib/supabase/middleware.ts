import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A valid Supabase session isn't the same as being authorized — anyone
  // with the (public, browser-shipped) anon key could sign up directly
  // against Supabase Auth, bypassing this app's own magic-link allowlist
  // in login/actions.ts, and previously would have inherited full access
  // to this household's data (dashboard pages/Server Actions use the
  // service-role client, which doesn't check identity on its own).
  const ownerEmail = process.env.PRIMARY_DIGEST_EMAIL?.trim().toLowerCase();
  const isOwner = !!user && !!ownerEmail && user.email?.trim().toLowerCase() === ownerEmail;

  const isAuthRoute =
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/auth');

  if (!isOwner && !isAuthRoute) {
    if (user) {
      // Signed in, but not the household owner — destroy the session
      // rather than just declining to route them, so it can't be reused.
      await supabase.auth.signOut();
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (isOwner && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return response;
}
