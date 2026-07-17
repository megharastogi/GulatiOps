import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold } from '@/lib/household';

export const dynamic = 'force-dynamic';

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default async function DashboardHome() {
  const household = await getHousehold();
  const supabase = createAdminClient();

  const today = new Date().toISOString().slice(0, 10);
  const twoWeeks = new Date();
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  const twoWeeksStr = twoWeeks.toISOString().slice(0, 10);

  const [{ data: events }, { data: actionItems }] = await Promise.all([
    supabase
      .from('school_calendar')
      .select('*')
      .eq('household_id', household.id)
      .gte('start_date', today)
      .lte('start_date', twoWeeksStr)
      .order('start_date', { ascending: true }),
    supabase
      .from('action_items')
      .select('*')
      .eq('household_id', household.id)
      .eq('status', 'open')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(5),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h2 style={{ fontSize: 15, marginBottom: 8 }}>Coming up</h2>
        {events?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {events.map((e) => (
              <div key={e.id} className="card">
                <div style={{ fontWeight: 600 }}>{e.title}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {formatDate(e.start_date)}
                  {e.location ? ` · ${e.location}` : ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Nothing on the school calendar in the next 2 weeks.</p>
        )}
      </section>

      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <h2 style={{ fontSize: 15, margin: 0 }}>Open action items</h2>
          <Link href="/dashboard/todo" className="muted" style={{ fontSize: 13 }}>
            View all
          </Link>
        </div>
        {actionItems?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actionItems.map((a) => (
              <div key={a.id} className="card">
                <div style={{ fontWeight: 600 }}>{a.title}</div>
                {a.due_date && (
                  <div className="muted" style={{ fontSize: 13 }}>
                    Due {formatDate(a.due_date)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Nothing open. Nice.</p>
        )}
      </section>
    </div>
  );
}
