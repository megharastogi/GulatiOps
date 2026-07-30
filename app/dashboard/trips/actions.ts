'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold } from '@/lib/household';
import {
  ACTIVITY_SLOTS,
  ACTIVITY_TYPES,
  ACTIVITY_PRIORITIES,
  ACTIVITY_STATUSES,
  ACTIVITY_PARTICIPANTS,
  type ActivitySlot,
  type ActivityType,
  type ActivityStatus,
  type ActivityParticipants,
} from '@/lib/trip-constants';

export type ActivityInput = {
  slot: ActivitySlot;
  type: ActivityType;
  name: string;
  description?: string | null;
  address?: string | null;
  url?: string | null;
  hours?: string | null;
  start_time?: string | null; // "HH:MM"
  end_time?: string | null; // "HH:MM"
  participants?: ActivityParticipants;
  is_adults_only?: boolean;
  reservation_info?: string | null;
  status?: ActivityStatus;
};

function isValidTimeRange(start?: string | null, end?: string | null) {
  if (!start || !end) return true;
  return end > start;
}

export async function updateTripNotes(tripId: string, notes: string) {
  const supabase = createAdminClient();
  const household = await getHousehold();

  const { error } = await supabase
    .from('trips')
    .update({ notes })
    .eq('id', tripId)
    .eq('household_id', household.id);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/trips/${tripId}`);
  return { ok: true };
}

export async function updateDayNotes(tripId: string, dayId: string, notes: string) {
  const supabase = createAdminClient();
  const household = await getHousehold();

  const { error } = await supabase
    .from('trip_days')
    .update({ notes })
    .eq('id', dayId)
    .eq('household_id', household.id);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/trips/${tripId}`);
  return { ok: true };
}

export async function addActivity(tripId: string, dayId: string, fields: ActivityInput) {
  if (!fields.name?.trim()) return { error: 'Name is required.' };
  if (!ACTIVITY_SLOTS.includes(fields.slot)) return { error: 'Invalid slot.' };
  if (!ACTIVITY_TYPES.includes(fields.type)) return { error: 'Invalid type.' };
  if (fields.participants && !ACTIVITY_PARTICIPANTS.includes(fields.participants)) {
    return { error: 'Invalid participants.' };
  }
  if (!isValidTimeRange(fields.start_time, fields.end_time)) {
    return { error: 'End time must be after start time.' };
  }

  const supabase = createAdminClient();
  const household = await getHousehold();

  // Verify the day belongs to this trip/household before writing.
  const { data: day, error: dayError } = await supabase
    .from('trip_days')
    .select('id')
    .eq('id', dayId)
    .eq('trip_id', tripId)
    .eq('household_id', household.id)
    .single();
  if (dayError || !day) return { error: 'Trip day not found.' };

  const { data: maxRow, error: maxError } = await supabase
    .from('trip_activities')
    .select('sort_order')
    .eq('trip_day_id', dayId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) return { error: maxError.message };
  const nextSortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { error: insertError } = await supabase.from('trip_activities').insert({
    trip_id: tripId,
    trip_day_id: dayId,
    household_id: household.id,
    slot: fields.slot,
    type: fields.type,
    name: fields.name.trim(),
    description: fields.description || null,
    address: fields.address || null,
    url: fields.url || null,
    hours: fields.hours || null,
    start_time: fields.start_time || null,
    end_time: fields.end_time || null,
    participants: fields.participants || 'everyone',
    is_adults_only: fields.is_adults_only || false,
    reservation_info: fields.reservation_info || null,
    priority: 'primary',
    status: fields.status || 'planned',
    sort_order: nextSortOrder,
  });
  if (insertError) return { error: insertError.message };

  revalidatePath(`/dashboard/trips/${tripId}`);
  return { ok: true };
}

export async function updateActivity(
  tripId: string,
  activityId: string,
  fields: Partial<ActivityInput>
) {
  if (fields.slot && !ACTIVITY_SLOTS.includes(fields.slot)) return { error: 'Invalid slot.' };
  if (fields.type && !ACTIVITY_TYPES.includes(fields.type)) return { error: 'Invalid type.' };
  if (fields.status && !ACTIVITY_STATUSES.includes(fields.status)) return { error: 'Invalid status.' };
  if (fields.participants && !ACTIVITY_PARTICIPANTS.includes(fields.participants)) {
    return { error: 'Invalid participants.' };
  }
  if (
    fields.start_time !== undefined &&
    fields.end_time !== undefined &&
    !isValidTimeRange(fields.start_time, fields.end_time)
  ) {
    return { error: 'End time must be after start time.' };
  }

  const supabase = createAdminClient();
  const household = await getHousehold();

  const updates: Record<string, unknown> = {};
  for (const key of [
    'slot',
    'type',
    'name',
    'description',
    'address',
    'url',
    'hours',
    'start_time',
    'end_time',
    'participants',
    'is_adults_only',
    'reservation_info',
    'status',
  ] as const) {
    if (fields[key] !== undefined) updates[key] = fields[key] || null;
  }
  if (updates.name !== undefined && !String(updates.name).trim()) return { error: 'Name is required.' };

  const { error, data } = await supabase
    .from('trip_activities')
    .update(updates)
    .eq('id', activityId)
    .eq('household_id', household.id)
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'Activity not found.' };

  revalidatePath(`/dashboard/trips/${tripId}`);
  return { ok: true };
}

export async function deleteActivity(tripId: string, activityId: string) {
  const supabase = createAdminClient();
  const household = await getHousehold();

  const { error } = await supabase
    .from('trip_activities')
    .delete()
    .eq('id', activityId)
    .eq('household_id', household.id);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/trips/${tripId}`);
  return { ok: true };
}

export async function moveActivity(
  tripId: string,
  activityId: string,
  targetDayId: string,
  fields?: { start_time?: string | null; end_time?: string | null }
) {
  if (fields && !isValidTimeRange(fields.start_time, fields.end_time)) {
    return { error: 'End time must be after start time.' };
  }

  const supabase = createAdminClient();
  const household = await getHousehold();

  // The target day id could be anything the client sends — re-verify it
  // actually belongs to this trip/household before repointing the activity.
  const { data: targetDay, error: dayError } = await supabase
    .from('trip_days')
    .select('id')
    .eq('id', targetDayId)
    .eq('trip_id', tripId)
    .eq('household_id', household.id)
    .single();
  if (dayError || !targetDay) return { error: 'Target day not found on this trip.' };

  const updates: Record<string, unknown> = { trip_day_id: targetDayId };
  if (fields?.start_time !== undefined) updates.start_time = fields.start_time || null;
  if (fields?.end_time !== undefined) updates.end_time = fields.end_time || null;

  const { error, data } = await supabase
    .from('trip_activities')
    .update(updates)
    .eq('id', activityId)
    .eq('household_id', household.id)
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'Activity not found.' };

  revalidatePath(`/dashboard/trips/${tripId}`);
  return { ok: true };
}

// Swaps sort_order with the neighboring unscheduled activity in the same day.
// Only meaningful for activities with no start_time/end_time — scheduled
// activities are ordered by their time instead.
export async function reorderUnscheduled(
  tripId: string,
  dayId: string,
  activityId: string,
  direction: 'up' | 'down'
) {
  const supabase = createAdminClient();
  const household = await getHousehold();

  const { data: siblings, error: fetchError } = await supabase
    .from('trip_activities')
    .select('id, sort_order')
    .eq('trip_day_id', dayId)
    .eq('household_id', household.id)
    .eq('priority', 'primary')
    .is('start_time', null)
    .order('sort_order', { ascending: true });
  if (fetchError) return { error: fetchError.message };
  if (!siblings) return { ok: true };

  const index = siblings.findIndex((s) => s.id === activityId);
  if (index === -1) return { error: 'Activity not found.' };
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= siblings.length) return { ok: true };

  const a = siblings[index];
  const b = siblings[swapIndex];
  const [{ error: errA }, { error: errB }] = await Promise.all([
    supabase.from('trip_activities').update({ sort_order: b.sort_order }).eq('id', a.id),
    supabase.from('trip_activities').update({ sort_order: a.sort_order }).eq('id', b.id),
  ]);
  if (errA || errB) return { error: (errA || errB)!.message };

  revalidatePath(`/dashboard/trips/${tripId}`);
  return { ok: true };
}
