import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { attachInvitedUser, destinationFor } from '@/lib/sign-in';

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
