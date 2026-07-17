// Step 2 of Google Calendar OAuth: exchange code for tokens, store in Supabase.

import { createClient } from '@supabase/supabase-js';
import { getHousehold } from '@/lib/household';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  if (!code) return new Response('Missing code', { status: 400 });

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
    const err = await tokenResp.text();
    return new Response(`Token exchange failed: ${err}`, { status: 500 });
  }

  const tokens = await tokenResp.json();
  // { access_token, refresh_token, expires_in, scope, token_type }

  const household = await getHousehold().catch(() => null);
  if (!household) return new Response('Household not seeded yet', { status: 500 });

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase.from('google_oauth_tokens').upsert({
    household_id: household.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    scope: tokens.scope,
    updated_at: new Date().toISOString(),
  });

  return new Response(
    `<h2>Calendar connected ✓</h2><p>You can close this window. Your Chief of Staff can now read and create Google Calendar events.</p>`,
    { headers: { 'content-type': 'text/html' } }
  );
}
