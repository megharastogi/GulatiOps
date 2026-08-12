// Step 2 of Google Calendar OAuth: exchange code for tokens, store in Supabase.
//
// Gated by middleware.ts (must be signed in as the owner). Also verifies the
// `state` param against the cookie set in google-oauth/route.ts, and the
// signed-in user's email against PRIMARY_DIGEST_EMAIL as defense in depth —
// without these, anyone who could get this URL loaded in an authorized
// browser could rebind the household's calendar to an attacker's account.

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createClient as createAuthClient } from '@/lib/supabase/server';
import { getHousehold } from '@/lib/household';
import { encryptToken, decryptToken } from '@/lib/token-crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const authClient = await createAuthClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  const ownerEmail = process.env.PRIMARY_DIGEST_EMAIL?.trim().toLowerCase();
  if (!user || !ownerEmail || user.email?.trim().toLowerCase() !== ownerEmail) {
    return new Response('Not authorized to connect this calendar.', { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code) return new Response('Missing code', { status: 400 });

  const cookieStore = await cookies();
  const expectedState = cookieStore.get('google_oauth_state')?.value;
  cookieStore.delete('google_oauth_state');
  if (!state || !expectedState || state !== expectedState) {
    return new Response('OAuth state mismatch — please restart the connection flow from /api/google-oauth.', { status: 400 });
  }

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    // Don't echo Google's raw error body back to the browser.
    console.error('Google token exchange failed:', await tokenResp.text());
    return new Response('Token exchange failed. Check server logs.', { status: 500 });
  }

  const tokens = await tokenResp.json();
  // { access_token, refresh_token, expires_in, scope, token_type }

  const household = await getHousehold().catch(() => null);
  if (!household) return new Response('Household not seeded yet', { status: 500 });

  // Google only returns refresh_token on the first consent (or when
  // prompt=consent forces re-issuance, which google-oauth/route.ts sets —
  // but fall back to the existing one rather than nulling it out if it's
  // ever omitted).
  let refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    const { data: existing } = await supabase
      .from('google_oauth_tokens')
      .select('refresh_token')
      .eq('household_id', household.id)
      .maybeSingle();
    refreshToken = existing?.refresh_token ? decryptToken(existing.refresh_token) : null;
  }
  if (!refreshToken) {
    return new Response('Google did not return a refresh token and none exists to fall back on. Try again.', { status: 500 });
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error } = await supabase.from('google_oauth_tokens').upsert({
    household_id: household.id,
    access_token: encryptToken(tokens.access_token),
    refresh_token: encryptToken(refreshToken),
    expires_at: expiresAt,
    scope: tokens.scope,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error('Failed to store Google OAuth tokens:', error.message);
    return new Response('Failed to save calendar connection. Check server logs.', { status: 500 });
  }

  return new Response(
    `<h2>Calendar connected ✓</h2><p>You can close this window. Your Chief of Staff can now read and create Google Calendar events.</p>`,
    { headers: { 'content-type': 'text/html' } }
  );
}
