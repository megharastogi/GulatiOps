import Link from 'next/link';
import { signOut } from './actions';
import { getHousehold, hasFeature, type Feature } from '@/lib/household';

// `feature: null` means always shown. Everything else appears only for
// households that opted into it, so a family with {email,tasks} never sees a
// tab leading to a page they can't use.
const TABS: { href: string; label: string; feature: Feature | null }[] = [
  { href: '/dashboard', label: 'Home', feature: null },
  { href: '/dashboard/todo', label: 'Todo', feature: null },
  { href: '/dashboard/week', label: 'Week', feature: null },
  { href: '/dashboard/mail', label: 'Mail', feature: null },
  { href: '/dashboard/groceries', label: 'Groceries', feature: 'groceries' },
  { href: '/dashboard/trips', label: 'Trips', feature: 'trips' },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const household = await getHousehold();
  const tabs = TABS.filter((tab) => !tab.feature || hasFeature(household, tab.feature));
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px 8px',
        }}
      >
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

      <nav
        style={{
          display: 'flex',
          gap: 8,
          padding: '0 16px 12px',
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto',
        }}
      >
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="btn-secondary"
            style={{ whiteSpace: 'nowrap' }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <main style={{ flex: 1, padding: '16px', maxWidth: 640, width: '100%', margin: '0 auto' }}>
        {children}
      </main>
    </div>
  );
}
