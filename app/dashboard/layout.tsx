import Link from 'next/link';
import { signOut } from './actions';
import { getHousehold, hasFeature, type Feature } from '@/lib/household';
import TabBar, { type Tab } from './TabBar';

// `feature: null` means always shown. Everything else appears only for
// households that opted into it, so a family with {email,tasks} never sees a
// tab leading to a page they can't use.
const TABS: (Tab & { feature: Feature | null })[] = [
  { href: '/dashboard', label: 'Home', icon: 'home', feature: null },
  { href: '/dashboard/todo', label: 'Todo', icon: 'todo', feature: null },
  { href: '/dashboard/week', label: 'Week', icon: 'week', feature: null },
  { href: '/dashboard/mail', label: 'Mail', icon: 'mail', feature: null },
  { href: '/dashboard/groceries', label: 'Food', icon: 'groceries', feature: 'groceries' },
  { href: '/dashboard/trips', label: 'Trips', icon: 'trips', feature: 'trips' },
];

/**
 * Safari's Add to Home Screen prefers apple-mobile-web-app-title over the
 * manifest, and this is the page a family is looking at when they add it —
 * so the per-household name has to be set here as well as in the manifest.
 */
export async function generateMetadata() {
  const household = await getHousehold().catch(() => null);
  if (!household) return {};
  return {
    title: household.name,
    appleWebApp: { capable: true, statusBarStyle: 'default' as const, title: household.name },
  };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const household = await getHousehold();
  const tabs = TABS.filter((tab) => !tab.feature || hasFeature(household, tab.feature));

  return (
    <div className="app-shell">
      <header className="app-header">
        {/* The household, not the product. Every family that uses this sees
            their own name here — "GulatiOps" is whose software it is, which
            is the least useful thing to put at the top of their screen. */}
        <h1 className="app-title">{household.name}</h1>
        <div className="app-header-actions">
          <Link href="/dashboard/setup" className="btn-ghost">
            Setup
          </Link>
          <form action={signOut}>
            <button type="submit" className="btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="app-main">{children}</main>

      {/* Bottom bar on a phone, a row of pills under the header on a wide
          screen. Same markup either way — see .tabbar in globals.css. */}
      <TabBar tabs={tabs} />
    </div>
  );
}
