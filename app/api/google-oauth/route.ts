// Step 1 of Google Calendar OAuth: redirect user to Google's consent screen.
// Visit https://<your-vercel-app>.vercel.app/api/google-oauth in your browser
// after deploying to connect your calendar. One-time setup.

import { NextResponse } from 'next/server';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

export async function GET() {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent', // forces refresh_token issuance on every consent
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
