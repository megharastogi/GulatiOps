import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold } from '@/lib/household';
import { ConnectorPanel, CopyRow } from './ConnectorPanel';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const household = await getHousehold();
  const admin = createAdminClient();

  // Only the hash is stored, so this is purely "have they ever made one" —
  // it changes the wording on the button, nothing more.
  const { count: tokenCount } = await admin
    .from('mcp_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', household.id)
    .is('revoked_at', null);

  const { count: emailCount } = await admin
    .from('inbound_emails')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', household.id);

  const forwardingAddress = household.inbound_address;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <h2 style={{ fontSize: 17, margin: '0 0 4px' }}>Setup</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Two things to connect. Both are one-time.
        </p>
      </div>

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>1. Forward your school email</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          In Gmail, go to Settings → Forwarding and POP/IMAP → Add a forwarding
          address, and enter:
        </p>

        {forwardingAddress ? (
          <CopyRow value={forwardingAddress} />
        ) : (
          <p className="error" style={{ marginTop: 0 }}>
            No forwarding address is set up for this household yet. Ask Megha.
          </p>
        )}

        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Gmail will send a confirmation code to that address. It won&apos;t
          arrive in your inbox — it lands here instead. Open{' '}
          <Link href="/dashboard/mail">Mail</Link> to read it, then paste the
          code back into Gmail. After that, set up a filter so school email
          forwards automatically.
        </p>

        {emailCount ? (
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            ✓ {emailCount} {emailCount === 1 ? 'email has' : 'emails have'} arrived
            so far.
          </p>
        ) : null}
      </section>

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>2. Connect Claude</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          Lets you ask Claude about your calendar and to-dos in plain English.
          Needs a paid Claude plan — Pro or above. Optional; everything here
          works without it.
        </p>
        <ConnectorPanel hasToken={(tokenCount ?? 0) > 0} />
      </section>
    </div>
  );
}
