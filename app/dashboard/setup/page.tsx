import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold, hasFeature } from '@/lib/household';
import { ConnectorPanel, CopyRow } from './ConnectorPanel';
import { KidsPanel } from './KidsPanel';
import { ParserInstructions } from './ParserInstructions';
import { NotificationCheck } from './NotificationCheck';
import { PeoplePanel } from './PeoplePanel';
import { listKids, listLogins } from './actions';

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

  // The same editor the first-run wizard uses. Families onboarded before the
  // wizard existed never see it, so this is their only way in.
  const kids = await listKids();

  const logins = await listLogins();
  const signInUrl = `${process.env.APP_URL || ''}/login`;

  // Only suggest what this household's tools can actually answer.
  const examples = [
    "What's coming up this week?",
    'What do I still need to do?',
    `Add "bring photos for class" to my list, due Tuesday`,
    'I ordered the pizza, mark it done',
    ...(hasFeature(household, 'groceries') ? ['Add eggs and avocados to the grocery list'] : []),
    ...(hasFeature(household, 'calendar')
      ? ['Put Curriculum Night on my calendar, and check I am free first']
      : []),
    ...(hasFeature(household, 'trips') ? ['Start planning our Thanksgiving trip'] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <h2 style={{ fontSize: 17, margin: '0 0 4px' }}>Setup</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Who&apos;s in the family, and two things to connect.
        </p>
      </div>

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Your kids</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          Names, schools and grades go to whatever reads this household&apos;s
          email, so a newsletter comes back as &ldquo;permission slip for
          Ada&rdquo; rather than something generic. Two kids at two schools is
          fine — add a row each.
        </p>
        <KidsPanel initialKids={kids} />
      </section>

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Anything else we should know</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          Free text, read alongside every email that arrives. Useful for the
          things that aren&apos;t about one kid — what to ignore, what always
          matters, how your family actually works. You probably won&apos;t know
          what to put here until you&apos;ve seen a week of it.
        </p>
        <ParserInstructions initial={household.parser_instructions} />
      </section>

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
          Lets you ask Claude about this household in plain English instead of
          opening the dashboard. Needs a paid Claude plan — Pro or above.
          Optional: everything here works without it.
        </p>
        <ConnectorPanel hasToken={(tokenCount ?? 0) > 0} examples={examples} />
        <p className="muted" style={{ fontSize: 13, marginTop: 14, marginBottom: 0 }}>
          Treat that link like a password — anyone who has it can read this
          household&apos;s email and to-dos. If it ever gets out, generate a new
          one here and the old one stops working immediately.
        </p>
      </section>

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Who else can sign in</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          Add a partner, a grandparent, anyone who should see this. They get the
          same view you do — the same email, the same to-dos, the same setup
          page — so only add someone you&apos;d hand your phone to. Adding them
          here is what lets them request a sign-in link; nothing is emailed out,
          so you&apos;ll need to tell them yourself.
        </p>
        <PeoplePanel initialLogins={logins} signInUrl={signInUrl} />
      </section>

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Notifications</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          Weekly notifications aren&apos;t built yet. This checks whether this
          phone could receive one.
        </p>
        <NotificationCheck />
      </section>
    </div>
  );
}
