import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold } from '@/lib/household';

export const dynamic = 'force-dynamic';

function formatDay(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

const SLOT_LABEL: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const household = await getHousehold();
  const supabase = createAdminClient();

  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', id)
    .eq('household_id', household.id)
    .single();

  if (!trip) notFound();

  const { data: days } = await supabase
    .from('trip_days')
    .select('*')
    .eq('trip_id', id)
    .order('day_number', { ascending: true });

  const dayIds = (days || []).map((d) => d.id);
  let activities: any[] = [];
  if (dayIds.length) {
    const { data } = await supabase
      .from('trip_activities')
      .select('*')
      .in('trip_day_id', dayIds)
      .eq('priority', 'primary')
      .order('sort_order', { ascending: true });
    activities = data || [];
  }

  const activitiesByDay: Record<string, any[]> = {};
  for (const a of activities) {
    (activitiesByDay[a.trip_day_id] ||= []).push(a);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <Link href="/dashboard/trips" className="muted" style={{ fontSize: 13 }}>
          ← All trips
        </Link>
        <h2 style={{ fontSize: 20, margin: '4px 0 0' }}>{trip.destination}</h2>
        {trip.constraints?.accommodation_address && (
          <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>
            {trip.constraints.accommodation_address}
          </p>
        )}
      </div>

      {days?.length ? (
        days.map((day) => (
          <section key={day.id}>
            <h3 style={{ fontSize: 14, marginBottom: 6 }}>
              {formatDay(day.date)}
              {day.is_date_night ? ' · date night' : ''}
            </h3>
            {activitiesByDay[day.id]?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activitiesByDay[day.id].map((a) => (
                  <div key={a.id} className="card">
                    <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                      {SLOT_LABEL[a.slot] ?? a.slot}
                    </div>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    {a.address && (
                      <div className="muted" style={{ fontSize: 13 }}>
                        {a.address}
                      </div>
                    )}
                    {a.reservation_info && (
                      <div className="muted" style={{ fontSize: 13 }}>
                        {a.reservation_info}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>
                Nothing planned yet.
              </p>
            )}
          </section>
        ))
      ) : (
        <p className="muted">No days saved yet.</p>
      )}
    </div>
  );
}
