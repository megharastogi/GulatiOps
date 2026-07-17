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
  if (!resp.ok) {
    throw new Error(
      `Token refresh failed: ${await resp.text()}. The Google OAuth consent screen is in Testing mode, ` +
      `so refresh tokens expire after 7 days. Re-auth at https://gulati-ops.vercel.app/api/google-oauth and try again.`
    );
  }
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

function resolveCalendarId(calendar?: string): string {
  if (calendar === 'kian_school') {
    return process.env.KIAN_SCHOOL_CALENDAR_ID || 'primary';
  }
  return 'primary';
}

export async function checkBusy(
  householdId: string,
  startIso: string,
  endIso: string,
  calendar?: string
): Promise<{ busy: boolean; conflicts: any[] }> {
  const token = await getValidAccessToken(householdId);
  const calendarId = resolveCalendarId(calendar);
  const resp = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      timeMin: startIso,
      timeMax: endIso,
      items: [{ id: calendarId }],
    }),
  });
  if (!resp.ok) throw new Error(`freeBusy failed: ${await resp.text()}`);
  const data = await resp.json();
  const busyBlocks = data.calendars?.[calendarId]?.busy || [];
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
    allDay?: boolean;
    inviteEmails?: string[];
    timezone?: string;
    calendar?: string;
  }
) {
  const token = await getValidAccessToken(householdId);
  const calendarId = resolveCalendarId(evt.calendar);
  const tz = evt.timezone || 'America/Los_Angeles';
  const startDate = evt.startIso.slice(0, 10);
  const endDate = evt.allDay
    ? new Date(new Date(evt.endIso).getTime() + 86400000).toISOString().slice(0, 10)
    : evt.endIso.slice(0, 10);
  const body: any = {
    summary: evt.summary,
    description: evt.description,
    location: evt.location,
    start: evt.allDay ? { date: startDate } : { dateTime: evt.startIso, timeZone: tz },
    end: evt.allDay ? { date: endDate } : { dateTime: evt.endIso, timeZone: tz },
  };
  if (evt.inviteEmails?.length) {
    body.attendees = evt.inviteEmails.map((email) => ({ email }));
  }

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) throw new Error(`createEvent failed: ${await resp.text()}`);
  return resp.json();
}

export async function listEvents(
  householdId: string,
  calendar?: string,
  timeMin?: string,
  timeMax?: string
) {
  const token = await getValidAccessToken(householdId);
  const calendarId = resolveCalendarId(calendar);
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
    timeMin: timeMin || new Date().toISOString(),
    ...(timeMax ? { timeMax } : {}),
  });
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) throw new Error(`listEvents failed: ${await resp.text()}`);
  const data = await resp.json();
  return (data.items || []).map((e: any) => ({
    id: e.id,
    summary: e.summary,
    start: e.start?.date || e.start?.dateTime,
    end: e.end?.date || e.end?.dateTime,
    all_day: !!e.start?.date,
  }));
}

export async function deleteEvent(
  householdId: string,
  eventId: string,
  calendar?: string
) {
  const token = await getValidAccessToken(householdId);
  const calendarId = resolveCalendarId(calendar);
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }
  );
  if (!resp.ok && resp.status !== 404) throw new Error(`deleteEvent failed: ${await resp.text()}`);
  return { deleted: true, event_id: eventId };
}
