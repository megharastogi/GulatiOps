// Serves the PWA manifest per household, so the icon a family adds to their
// home screen is labelled with their own name rather than the product's.
//
// Three things have to line up for this to work at all, and any one of them
// missing puts "GulatiOps" back on everyone's home screen:
//
//   1. This route, replacing the static file that used to live in public/ —
//      a file there would shadow it, so it was deleted.
//   2. `crossorigin="use-credentials"` on the <link> in the root layout. A
//      manifest is fetched WITHOUT cookies by default, so without that
//      attribute this always sees a signed-out request.
//   3. middleware.ts leaving this path alone (it already excludes
//      manifest.webmanifest), or the unauthenticated fetch gets redirected
//      to /login and the browser parses an HTML page as JSON.
//
// iOS is a separate matter again: Safari's Add to Home Screen prefers
// apple-mobile-web-app-title, which the dashboard layout sets per household.

import { getHousehold } from '@/lib/household';

export const dynamic = 'force-dynamic';

const FALLBACK = 'GulatiOps';

export async function GET() {
  // Signed out, or a browser that fetched this without cookies anyway. The
  // manifest still has to be valid — a home screen icon is better named
  // generically than not installable.
  const household = await getHousehold().catch(() => null);
  const name = household?.name || FALLBACK;

  return Response.json(
    {
      name,
      short_name: name,
      description: 'Household chief of staff',
      start_url: '/dashboard',
      display: 'standalone',
      background_color: '#111111',
      theme_color: '#111111',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    {
      headers: {
        'content-type': 'application/manifest+json',
        // Two families share this URL and differ only by cookie.
        'cache-control': 'private, no-store',
      },
    }
  );
}
