'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Inline rather than an icon package: six glyphs isn't worth a dependency,
// and these inherit currentColor so the active state costs nothing.
const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" />,
  todo: (
    <>
      <path d="M4 6.5 6 8.5 9.5 5" />
      <path d="M4 15.5 6 17.5 9.5 14" />
      <path d="M13 7h7M13 16h7" />
    </>
  ),
  week: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
  groceries: (
    <>
      <path d="M3 6h2l2.5 10h10L20 9H6" />
      <circle cx="9" cy="19.5" r="1.2" />
      <circle cx="17" cy="19.5" r="1.2" />
    </>
  ),
  trips: <path d="M2.5 13.5 21 5l-3.5 9.5L21 19l-6-1.5-3 3.5-1-5.5z" />,
};

export type Tab = { href: string; label: string; icon: string };

export default function TabBar({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();

  return (
    <nav className="tabbar" aria-label="Sections">
      {tabs.map((tab) => {
        // Home would otherwise match every page under /dashboard.
        const active =
          tab.href === '/dashboard' ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? 'tab tab-active' : 'tab'}
            aria-current={active ? 'page' : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {ICONS[tab.icon]}
            </svg>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
