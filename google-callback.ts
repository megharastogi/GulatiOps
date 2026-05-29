// /api/google-callback.ts
// Step 2 of Google Calendar OAuth: exchange code for tokens, store in Supabase.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = req.query.code as string;
  if (!code) return res.status(400).send('Missing code');

  // Exchange code for tokens
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
    return res.status(500).send(`Token exchange failed: ${err}`);
  }

  const tokens = await tokenResp.json();
  // { access_token, refresh_token, expires_in, scope, token_type }

  const { data: household } = await supabase
    .from('households')
    .select('*')
    .eq('digest_email', process.env.PRIMARY_DIGEST_EMAIL!)
    .single();

  if (!household) return res.status(500).send('Household not seeded yet');

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from('google_oauth_tokens')
    .upsert({
      household_id: household.id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    });

  res.send(
    `<h2>Calendar connected ✓</h2><p>You can close this window. Your Chief of Staff can now read and create Google Calendar events.</p>`
  );
}
