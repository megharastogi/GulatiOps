import { type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api|manifest.webmanifest|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    // The Google OAuth routes live under /api (excluded above so the MCP
    // endpoint and webhooks stay unauthenticated-by-middleware), but they
    // must require a logged-in session — without this they're reachable by
    // anyone who knows the URL, who could bind their own Google account to
    // this household's calendar.
    '/api/google-oauth',
    '/api/google-callback',
  ],
};
