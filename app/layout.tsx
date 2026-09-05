import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GulatiOps',
  description: 'Household chief of staff',
  // `manifest` is deliberately not set here. Next renders a plain
  // <link rel="manifest">, and a manifest requested without credentials is
  // always signed out — so the tag is written by hand below with
  // crossorigin="use-credentials". appleWebApp.title is likewise left to the
  // dashboard layout, which knows whose household it is.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#111111',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Lets the page paint under the notch and home indicator, which is what
  // makes env(safe-area-inset-*) return anything but 0 in standalone mode.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* use-credentials is what makes the manifest route see the session;
            without it the browser sends no cookies and every household gets
            the signed-out fallback name. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body>{children}</body>
    </html>
  );
}
