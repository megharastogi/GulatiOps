import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getHouseholdForUser } from '@/lib/household';

const admin = createAdminClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Attaches a freshly signed-in user to the household that invited them.
 *
 * There's a chicken-and-egg in the membership model: middleware authorizes on
 * a household_users row, but a brand-new user has none until they've signed in
 * at least once. This closes it — someone names the address up front in
 * household_invites, and the first sign-in from that address claims it.
 *
 * The role comes off the invite rather than being assumed here. A family
 * provisioned by scripts/provision.ts gets no household_users row until this
 * runs, so hardcoding either value would be wrong for half the callers: the
 * founding user would arrive as a member, or everyone invited from the setup
 * page would arrive as an owner and become unremovable.
 *
 * Idempotent: an existing membership row short-circuits the whole thing, the
 * upsert is a no-op on conflict, and the claim stamp only lands on an invite
 * that hasn't been claimed already.
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

  // Exact match rather than ilike — see the note in app/login/actions.ts.
  // This is the call that hands out household membership, so a pattern match
  // here is the difference between "invited" and "resembles someone invited".
  const { data: invite } = await admin
    .from('household_invites')
    .select('id, household_id, role')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();

  if (!invite) return;

  await admin
    .from('household_users')
    .upsert(
      { household_id: invite.household_id, auth_user_id: authUserId, role: invite.role },
      { onConflict: 'household_id,auth_user_id' }
    );

  // Display state for the setup page, plus the link a removal follows to find
  // this person's membership row. Guarded on claimed_at so a re-run keeps the
  // original timestamp rather than sliding it forward.
  await admin
    .from('household_invites')
    .update({ claimed_at: new Date().toISOString(), claimed_by: authUserId })
    .eq('id', invite.id)
    .is('claimed_at', null);
}

/**
 * Where to send someone who has just signed in.
 *
 * A household that hasn't been through the wizard goes there first; everyone
 * else goes where they were headed. Only the default destination is
 * redirected — a magic link carrying an explicit `next` was aimed at a
 * particular page, and hijacking that would break every link we ever send.
 */
async function destinationFor(authUserId: string, next: string): Promise<string> {
  if (next !== '/dashboard') return next;

  const household = await getHouseholdForUser(authUserId);
  return household && !household.onboarded_at ? '/onboarding' : next;
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
      const destination = await destinationFor(data.user.id, next);
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
