// Step 1 of Google Calendar OAuth: redirect user to Google's consent screen.
// Visit https://<your-vercel-app>.vercel.app/api/google-oauth in your browser
// after deploying to connect your calendar. One-time setup.
//
// Gated by middleware.ts (must be signed in) — magic-link login only ever
// issues a session to PRIMARY_DIGEST_EMAIL, so reaching this route at all
// already means you're the owner. The email check below is defense in
// depth in case that assumption ever changes. The `state` cookie defends
// against a CSRF-style attack where a signed-in owner is tricked into
// completing an OAuth flow initiated with an attacker's authorization code.

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createClient } from '@/lib/supabase/server';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ownerEmail = process.env.PRIMARY_DIGEST_EMAIL?.trim().toLowerCase();
  if (!user || !ownerEmail || user.email?.trim().toLowerCase() !== ownerEmail) {
    return new Response('Not authorized to connect this calendar.', { status: 403 });
  }

  const state = randomBytes(24).toString('hex');

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent', // forces refresh_token issuance on every consent
    state,
  });

  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  response.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes — plenty for a consent flow, short enough to limit replay
    path: '/api',
  });
  return response;
}
