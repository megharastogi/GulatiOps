import Link from 'next/link';
import { signOut } from './actions';

const TABS = [
  { href: '/dashboard', label: 'Home' },
  { href: '/dashboard/todo', label: 'Todo' },
  { href: '/dashboard/groceries', label: 'Groceries' },
  { href: '/dashboard/trips', label: 'Trips' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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
        <form action={signOut}>
          <button type="submit" className="btn-ghost">
            Sign out
          </button>
        </form>
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
        {TABS.map((tab) => (
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
