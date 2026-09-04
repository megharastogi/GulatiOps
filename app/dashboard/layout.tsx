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

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const household = await getHousehold();
  const tabs = TABS.filter((tab) => !tab.feature || hasFeature(household, tab.feature));

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 style={{ fontSize: 18, margin: 0 }}>GulatiOps</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
