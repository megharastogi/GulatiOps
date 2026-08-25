import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold } from '@/lib/household';
import TripDayView from './TripDayView';
import DeleteTripButton from './DeleteTripButton';

export const dynamic = 'force-dynamic';

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
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
        <DeleteTripButton tripId={trip.id} destination={trip.destination} />
      </div>

      {days?.length ? (
        <TripDayView trip={trip} days={days} activitiesByDay={activitiesByDay} />
      ) : (
        <p className="muted">No days saved yet.</p>
      )}
    </div>
  );
}
