// /lib/google-calendar.ts
// Helper for calling Google Calendar API with automatic token refresh.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getValidAccessToken(householdId: string): Promise<string> {
  const { data: row } = await supabase
    .from('google_oauth_tokens')
    .select('*')
    .eq('household_id', householdId)
    .single();

  if (!row) throw new Error('Google Calendar not connected. Visit /api/google-oauth.');

  const expiresAt = new Date(row.expires_at).getTime();
  // Refresh 60s before expiry
  if (Date.now() < expiresAt - 60_000) return row.access_token;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) throw new Error(`Token refresh failed: ${await resp.text()}`);
  const tokens = await resp.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from('google_oauth_tokens')
    .update({
      access_token: tokens.access_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('household_id', householdId);

  return tokens.access_token;
}

export async function checkBusy(
  householdId: string,
  startIso: string,
  endIso: string
): Promise<{ busy: boolean; conflicts: any[] }> {
  const token = await getValidAccessToken(householdId);
  const resp = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      timeMin: startIso,
      timeMax: endIso,
      items: [{ id: 'primary' }],
    }),
  });
  if (!resp.ok) throw new Error(`freeBusy failed: ${await resp.text()}`);
  const data = await resp.json();
  const busyBlocks = data.calendars?.primary?.busy || [];
  return { busy: busyBlocks.length > 0, conflicts: busyBlocks };
}

export async function createEvent(
  householdId: string,
  evt: {
    summary: string;
    description?: string;
    location?: string;
    startIso: string;
    endIso: string;
    inviteEmails?: string[]; // only set when user explicitly asked
    timezone?: string;
  }
) {
  const token = await getValidAccessToken(householdId);
  const body: any = {
    summary: evt.summary,
    description: evt.description,
    location: evt.location,
    start: { dateTime: evt.startIso, timeZone: evt.timezone || 'America/Los_Angeles' },
    end: { dateTime: evt.endIso, timeZone: evt.timezone || 'America/Los_Angeles' },
  };
  if (evt.inviteEmails?.length) {
    body.attendees = evt.inviteEmails.map((email) => ({ email }));
  }

  const resp = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) throw new Error(`createEvent failed: ${await resp.text()}`);
  return resp.json();
}
