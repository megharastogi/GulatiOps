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

  const isAuthRoute =
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/auth');

  // A valid Supabase session isn't the same as being authorized — anyone with
  // the (public, browser-shipped) anon key could sign up directly against
  // Supabase Auth, bypassing the invite flow in auth/callback. Authorization
  // is membership in a household, nothing else.
  //
  // This runs on the *user-scoped* client, so it reads through the
  // household_users_self RLS policy rather than trusting an env var. If the
  // multi-household migration in schema.sql hasn't been applied, this query
  // returns nothing and everyone is locked out — fail-closed, and the
  // ?error=no_household redirect below says which case it is.
  let householdId: string | null = null;
  if (user) {
    const { data } = await supabase
      .from('household_users')
      .select('household_id')
      .eq('auth_user_id', user.id)
      .limit(1)
      .maybeSingle();
    householdId = data?.household_id ?? null;
  }

  if (!householdId && !isAuthRoute) {
    if (user) {
      // Signed in but attached to no household — destroy the session rather
      // than just declining to route them, so it can't be reused.
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('error', 'no_household');
      return NextResponse.redirect(url);
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (householdId && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
