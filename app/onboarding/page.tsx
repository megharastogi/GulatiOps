import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold, hasFeature } from '@/lib/household';
import { listKids } from '@/app/dashboard/setup/actions';
import { Wizard } from './Wizard';

export const dynamic = 'force-dynamic';

/**
 * First-run setup, outside /dashboard so it renders without the tab bar —
 * there is nothing useful to tab to yet.
 *
 * Middleware has already established a signed-in user attached to a household
 * by the time this renders; the only extra guard is onboarded_at, so typing
 * the URL later lands on the dashboard rather than a second welcome.
 */
export default async function OnboardingPage() {
  const household = await getHousehold();
  if (household.onboarded_at) redirect('/dashboard');

  const admin = createAdminClient();
  const { count: tokenCount } = await admin
    .from('mcp_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', household.id)
    .is('revoked_at', null);

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
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 16px 64px' }}>
      <Wizard
        householdName={household.name}
        kids={await listKids()}
        forwardingAddress={household.inbound_address}
        hasToken={(tokenCount ?? 0) > 0}
        examples={examples}
      />
    </main>
  );
}
