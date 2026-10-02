'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { attachInvitedUser, destinationFor } from '@/lib/sign-in';

// `email` rides along once the message is sent, so the code form knows which
// address the code belongs to without asking for it a second time.
type State = { sent?: boolean; email?: string; error?: string };

/**
 * Supabase's own wording, translated for someone who has never heard of
 * Supabase.
 *
 * The project sends two auth emails an hour on the built-in provider, shared
 * across every household, so the person most likely to see this is whoever
 * signs in for the first time shortly after someone else did — a brand-new
 * family, with no reason to read "email rate limit exceeded" as anything other
 * than "this is broken". Saying it's temporary is the difference between them
 * trying again and them never coming back.
 *
 * Anything else keeps Supabase's message: those are rare and worth being able
 * to read straight off the screen.
 */
function signInError(error: { message: string; status?: number; code?: string }): string {
  const rateLimited =
    error.code === 'over_email_send_rate_limit' ||
    error.status === 429 ||
    /rate limit/i.test(error.message);

  return rateLimited
    ? 'Too many sign-in emails were sent just now. Try again in half an hour — nothing is wrong with your account.'
    : error.message;
}

const admin = createAdminClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function requestMagicLink(_prevState: State, formData: FormData): Promise<State> {
  const email = String(formData.get('email') || '')
    .trim()
    .toLowerCase();

  if (!email) return { error: 'Enter an email address.' };

  // The allowlist is the invite list rather than a single env var: some
  // household must have named this address in household_invites before it can
  // request a link at all. Invite rows are not consumed on sign-in, so this
  // check passes for returning users as well as first-time ones — which is
  // also why deleting the row is what revokes access.
  //
  // Without this, anyone could request a magic link and get a valid Supabase
  // session — middleware would still refuse them for having no household, but
  // there's no reason to hand out sessions we intend to reject.
  //
  // Exact match, not ilike. Rows are stored lowercase (and constrained to it),
  // so nothing is lost — and under ilike the `_` in an ordinary address like
  // first_last@gmail.com is a wildcard that can match another household's
  // invite, which is a way in for an address nobody invited.
  const { data: invited } = await admin
    .from('household_invites')
    .select('household_id')
    .eq('email', email)
    .maybeSingle();

  if (!invited) {
    return { error: 'That email is not recognized.' };
  }

  const headersList = await headers();
  const origin = headersList.get('origin') ?? `https://${headersList.get('host')}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) return { error: signInError(error) };
  return { sent: true, email };
}

/**
 * Signs in with the code from the same email the magic link comes in.
 *
 * This is the only way into the iOS home screen app. The app keeps its own
 * cookies, separate from Safari's, and a magic link always opens in Safari —
 * so the link signs Safari in and leaves the app signed out. The copy of
 * Safari's cookies iOS hands the app when it's added to the home screen
 * doesn't survive either: it shares Safari's refresh token, and whichever of
 * the two refreshes second finds that token already spent. Typing the code
 * into the app itself gives the app a session of its own.
 *
 * Needs {{ .Token }} in the Magic Link email template in Supabase.
 */
export async function verifyCode(_prevState: State, formData: FormData): Promise<State> {
  const email = String(formData.get('email') || '')
    .trim()
    .toLowerCase();
  // Strip anything that isn't a digit — iOS one-time-code autofill and pasting
  // from mail both tend to bring spaces along.
  const token = String(formData.get('token') || '').replace(/\D/g, '');

  if (!email) return { error: 'Enter an email address.' };
  if (!token) return { sent: true, email, error: 'Enter the code from the email.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });

  if (error || !data.user) {
    return {
      sent: true,
      email,
      error: 'That code is wrong or has expired. Check the latest email, or send a new one.',
    };
  }

  await attachInvitedUser(data.user.id, data.user.email);
  redirect(await destinationFor(data.user.id, '/dashboard'));
}
