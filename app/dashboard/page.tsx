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

function formatTime12(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default async function DashboardHome() {
  const household = await getHousehold();
  const supabase = createAdminClient();

  const today = new Date().toISOString().slice(0, 10);
  const twoWeeks = new Date();
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  const twoWeeksStr = twoWeeks.toISOString().slice(0, 10);

  const [{ data: events }, { data: actionItems }, { data: activeTrips }] = await Promise.all([
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
    supabase
      .from('trips')
      .select('*')
      .eq('household_id', household.id)
      .lte('start_date', today)
      .gte('end_date', today),
  ]);

  const activeTrip = activeTrips?.[0] ?? null;
  let todayDayId: string | null = null;
  let todayActivities: any[] = [];
  if (activeTrip) {
    const { data: day } = await supabase
      .from('trip_days')
      .select('id')
      .eq('trip_id', activeTrip.id)
      .eq('date', today)
      .maybeSingle();
    todayDayId = day?.id ?? null;
    if (todayDayId) {
      const { data: acts } = await supabase
        .from('trip_activities')
        .select('*')
        .eq('trip_day_id', todayDayId)
        .eq('priority', 'primary')
        .neq('status', 'cancelled')
        .order('sort_order', { ascending: true });
      todayActivities = (acts || []).sort((a, b) => {
        if (!a.start_time && !b.start_time) return 0;
        if (!a.start_time) return 1;
        if (!b.start_time) return -1;
        return a.start_time < b.start_time ? -1 : 1;
      });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {activeTrip && (
        <section>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <h2 style={{ fontSize: 15, margin: 0 }}>Today on your trip · {activeTrip.destination}</h2>
            <Link href={`/dashboard/trips/${activeTrip.id}`} className="muted" style={{ fontSize: 13 }}>
              Full itinerary
            </Link>
          </div>
          {todayActivities.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {todayActivities.map((a) => (
                <Link key={a.id} href={`/dashboard/trips/${activeTrip.id}`} className="card">
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: `var(--who-${a.participants || 'everyone'})`,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {formatTime12(a.start_time) || 'No time set'}
                    {a.address ? ` · ${a.address}` : ''}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">Nothing planned for today yet.</p>
          )}
        </section>
      )}

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
