'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

type State = { sent?: boolean; error?: string };

export async function requestMagicLink(_prevState: State, formData: FormData): Promise<State> {
  const email = String(formData.get('email') || '')
    .trim()
    .toLowerCase();
  const ownerEmail = process.env.PRIMARY_DIGEST_EMAIL?.trim().toLowerCase();

  if (!email) return { error: 'Enter an email address.' };
  if (!ownerEmail || email !== ownerEmail) {
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
