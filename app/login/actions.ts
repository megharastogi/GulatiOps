'use server';

import { headers } from 'next/headers';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

type State = { sent?: boolean; error?: string };

const admin = createAdminClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function requestMagicLink(_prevState: State, formData: FormData): Promise<State> {
  const email = String(formData.get('email') || '')
    .trim()
    .toLowerCase();

  if (!email) return { error: 'Enter an email address.' };

  // The allowlist is now the invite list rather than a single env var: a
  // household must name this address in `invited_email` before it can request
  // a link at all. invited_email is never cleared, so this check passes for
  // returning users as well as first-time ones.
  //
  // Without this, anyone could request a magic link and get a valid Supabase
  // session — middleware would still refuse them for having no household, but
  // there's no reason to hand out sessions we intend to reject.
  const { data: invited } = await admin
    .from('households')
    .select('id')
    .ilike('invited_email', email)
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

  if (error) return { error: error.message };
  return { sent: true };
}
