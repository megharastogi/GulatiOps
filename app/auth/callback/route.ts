import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

const admin = createAdminClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Attaches a freshly signed-in user to the household that invited them.
 *
 * There's a chicken-and-egg in the membership model: middleware authorizes on
 * a household_users row, but a brand-new user has none until they've signed in
 * at least once. This closes it — the household names the address up front in
 * `invited_email`, and the first sign-in from that address claims it.
 *
 * Idempotent and single-use in effect: once the row exists, the insert is a
 * no-op on conflict, and a second person signing in with a different address
 * finds no matching invite.
 */
async function attachInvitedUser(authUserId: string, email: string | undefined) {
  if (!email) return;

  const { data: existing } = await admin
    .from('household_users')
    .select('household_id')
    .eq('auth_user_id', authUserId)
    .limit(1)
    .maybeSingle();

  if (existing) return;

  const { data: household } = await admin
    .from('households')
    .select('id')
    .ilike('invited_email', email.trim().toLowerCase())
    .maybeSingle();

  if (!household) return;

  await admin
    .from('household_users')
    .upsert(
      { household_id: household.id, auth_user_id: authUserId, role: 'owner' },
      { onConflict: 'household_id,auth_user_id' }
    );
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      await attachInvitedUser(data.user.id, data.user.email);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
