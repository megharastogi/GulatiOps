'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  ACTIVITY_SLOTS,
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  ACTIVITY_PARTICIPANTS,
  type ActivitySlot,
  type ActivityType,
  type ActivityStatus,
  type ActivityParticipants,
} from '@/lib/trip-constants';
import {
  updateTripNotes,
  updateDayNotes,
  addActivity,
  updateActivity,
  deleteActivity,
  moveActivity,
  reorderUnscheduled,
  type ActivityInput,
} from '../actions';

type TripActivity = {
  id: string;
  trip_day_id: string;
  slot: string;
  type: string;
  name: string;
  description: string | null;
  address: string | null;
  url: string | null;
  hours: string | null;
  start_time: string | null;
  end_time: string | null;
  participants: string;
  is_adults_only: boolean;
  reservation_info: string | null;
  status: string;
  sort_order: number;
};

type TripDay = {
  id: string;
  date: string;
  day_number: number;
  is_date_night: boolean;
  notes: string | null;
};

type Trip = {
  id: string;
  destination: string;
  notes: string | null;
  constraints: Record<string, any> | null;
};

const SLOT_LABEL: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

const TYPE_LABEL: Record<string, string> = {
  activity: 'Activity',
  restaurant: 'Restaurant',
  date_night_restaurant: 'Date Night',
};

const TYPE_ICON: Record<string, string> = {
  activity: '📍',
  restaurant: '🍽',
  date_night_restaurant: '💕',
};

const PARTICIPANTS_LABEL: Record<string, string> = {
  everyone: 'Everyone',
  adults_only: 'Adults only',
  kids_only: 'Kids only',
  kids_with_nanny: 'Kids + nanny',
};

const PX_PER_MIN = 1.1;
const MIN_BLOCK_MIN = 24;
const DEFAULT_START_MIN = 6 * 60; // 6am
const DEFAULT_END_MIN = 24 * 60; // midnight

function parseMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToTimeInput(min: number | null): string {
  if (min == null) return '';
  const h = Math.floor(min / 60)
    .toString()
    .padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function hourLabel(hour24: number): string {
  const h = ((hour24 % 24) + 24) % 24;
  const ampm = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12} ${ampm}`;
}

function formatShortDay(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    date: d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
  };
}

function formatLongDay(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

type PositionedActivity = TripActivity & {
  startMin: number;
  endMin: number;
  col: number;
  numCols: number;
  conflict: boolean;
};

// Clusters mutually-overlapping activities and assigns each a column within
// its cluster (classic calendar-day-view layout algorithm), so overlapping
// blocks sit side-by-side instead of stacking on top of each other. Overlap
// alone isn't a scheduling conflict here — a parent's adults_only errand next
// to kids_with_nanny time is the plan working as intended. Only overlaps
// where the *same* participants group double-books are flagged as conflicts.
function layoutOverlaps(items: (TripActivity & { startMin: number; endMin: number })[]): PositionedActivity[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const positioned: (TripActivity & { startMin: number; endMin: number; col: number; numCols: number })[] = [];
  let clusterEnd = -1;

  const flushCluster = (cluster: (TripActivity & { startMin: number; endMin: number })[]) => {
    const columnEnds: number[] = [];
    const withCol = cluster.map((item) => {
      let col = columnEnds.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(item.endMin);
      } else {
        columnEnds[col] = item.endMin;
      }
      return { ...item, col };
    });
    const numCols = columnEnds.length;
    for (const item of withCol) positioned.push({ ...item, numCols });
  };

  let cluster: (TripActivity & { startMin: number; endMin: number })[] = [];
  for (const item of sorted) {
    if (cluster.length === 0 || item.startMin < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMin);
    } else {
      flushCluster(cluster);
      cluster = [item];
      clusterEnd = item.endMin;
    }
  }
  if (cluster.length) flushCluster(cluster);

  return positioned.map((item) => ({
    ...item,
    conflict: positioned.some(
      (other) =>
        other.id !== item.id &&
        other.participants === item.participants &&
        item.startMin < other.endMin &&
        other.startMin < item.endMin
    ),
  }));
}

export default function TripDayView({
  trip,
  days,
  activitiesByDay,
}: {
  trip: Trip;
  days: TripDay[];
  activitiesByDay: Record<string, TripActivity[]>;
}) {
  const [isPending, startTransition] = useTransition();
  const [activeDayId, setActiveDayId] = useState<string>(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return days.find((d) => d.date === todayStr)?.id ?? days[0]?.id ?? '';
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tripNotes, setTripNotes] = useState(trip.notes ?? '');
  const [tripNotesOpen, setTripNotesOpen] = useState(!!trip.notes);
  const [dayNotes, setDayNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(days.map((d) => [d.id, d.notes ?? '']))
  );
  const editPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingId && editPanelRef.current) {
      editPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [editingId]);

  const activeDay = days.find((d) => d.id === activeDayId);
  const dayActivities = activitiesByDay[activeDayId] || [];

  const scheduled = useMemo(() => {
    const withMinutes = dayActivities
      .map((a) => ({ ...a, startMin: parseMinutes(a.start_time), endMin: parseMinutes(a.end_time) }))
      .filter((a): a is TripActivity & { startMin: number; endMin: number } => a.startMin != null && a.endMin != null);
    return layoutOverlaps(withMinutes);
  }, [dayActivities]);

  const unscheduled = dayActivities
    .filter((a) => !a.start_time || !a.end_time)
    .sort((a, b) => a.sort_order - b.sort_order);

  const { gridStart, gridEnd } = useMemo(() => {
    if (!scheduled.length) return { gridStart: DEFAULT_START_MIN, gridEnd: DEFAULT_END_MIN };
    const minStart = Math.min(...scheduled.map((a) => a.startMin));
    const maxEnd = Math.max(...scheduled.map((a) => a.endMin));
    return {
      gridStart: Math.max(0, Math.floor(minStart / 60) * 60),
      gridEnd: Math.min(24 * 60, Math.ceil(maxEnd / 60) * 60),
    };
  }, [scheduled]);

  const gridHeight = (gridEnd - gridStart) * PX_PER_MIN;
  const hours: number[] = [];
  for (let h = Math.ceil(gridStart / 60); h <= Math.floor(gridEnd / 60); h++) hours.push(h);

  const editingActivity = dayActivities.find((a) => a.id === editingId) || null;

  function saveTripNotes() {
    startTransition(() => {
      updateTripNotes(trip.id, tripNotes);
    });
  }

  function saveDayNotes(dayId: string) {
    startTransition(() => {
      updateDayNotes(trip.id, dayId, dayNotes[dayId] ?? '');
    });
  }

  function handleAddSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const fields: ActivityInput = {
      slot: (fd.get('slot') as ActivitySlot) || 'morning',
      type: (fd.get('type') as ActivityType) || 'activity',
      participants: (fd.get('participants') as ActivityParticipants) || 'everyone',
      name: String(fd.get('name') || ''),
      start_time: String(fd.get('start_time') || '') || null,
      end_time: String(fd.get('end_time') || '') || null,
      address: String(fd.get('address') || '') || null,
      url: String(fd.get('url') || '') || null,
      reservation_info: String(fd.get('reservation_info') || '') || null,
    };
    startTransition(async () => {
      const res = await addActivity(trip.id, activeDayId, fields);
      if (!res?.error) setAdding(false);
    });
  }

  function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingActivity) return;
    const fd = new FormData(e.currentTarget);
    const targetDayId = String(fd.get('trip_day_id') || editingActivity.trip_day_id);
    const fields: Partial<ActivityInput> = {
      slot: (fd.get('slot') as ActivitySlot) || undefined,
      type: (fd.get('type') as ActivityType) || undefined,
      participants: (fd.get('participants') as ActivityParticipants) || undefined,
      name: String(fd.get('name') || ''),
      start_time: String(fd.get('start_time') || '') || null,
      end_time: String(fd.get('end_time') || '') || null,
      address: String(fd.get('address') || '') || null,
      url: String(fd.get('url') || '') || null,
      reservation_info: String(fd.get('reservation_info') || '') || null,
      status: (fd.get('status') as ActivityStatus) || undefined,
    };
    startTransition(async () => {
      const res = await updateActivity(trip.id, editingActivity.id, fields);
      if (res?.error) return;
      if (targetDayId !== editingActivity.trip_day_id) {
        await moveActivity(trip.id, editingActivity.id, targetDayId);
        setActiveDayId(targetDayId);
      }
      setEditingId(null);
    });
  }

  function handleDelete() {
    if (!editingActivity) return;
    if (!window.confirm(`Delete "${editingActivity.name}"?`)) return;
    startTransition(() => {
      deleteActivity(trip.id, editingActivity.id);
    });
    setEditingId(null);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="card">
        <button
          type="button"
          className="btn-ghost"
          style={{ padding: 0, fontWeight: 600, color: 'var(--text)' }}
          onClick={() => setTripNotesOpen((v) => !v)}
        >
          {tripNotesOpen ? '▾' : '▸'} Notes {trip.notes ? '' : '(links, Airbnb reviews, etc.)'}
        </button>
        {tripNotesOpen && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              value={tripNotes}
              onChange={(e) => setTripNotes(e.target.value)}
              rows={4}
              placeholder="Paste links, Airbnb reviews, restaurant recs..."
              style={{
                width: '100%',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                padding: 8,
                fontSize: 14,
              }}
            />
            <button type="button" className="btn-secondary" disabled={isPending} onClick={saveTripNotes} style={{ alignSelf: 'flex-start' }}>
              Save notes
            </button>
          </div>
        )}
      </div>

      <div className="day-tabs">
        {days.map((day) => {
          const { weekday, date } = formatShortDay(day.date);
          return (
            <button
              key={day.id}
              type="button"
              className={`day-tab${day.id === activeDayId ? ' active' : ''}`}
              onClick={() => {
                setActiveDayId(day.id);
                setEditingId(null);
                setAdding(false);
              }}
            >
              <div>{weekday}</div>
              <div>{date}</div>
              {day.is_date_night && <div style={{ fontSize: 10 }}>♥</div>}
            </button>
          );
        })}
      </div>

      {activeDay && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>
            {formatLongDay(activeDay.date)}
            {activeDay.is_date_night ? ' · date night' : ''}
          </h3>

          {scheduled.length > 0 ? (
            <div className="hour-grid-wrap">
              <div className="hour-labels" style={{ height: gridHeight }}>
                {hours.map((h) => (
                  <div key={h} className="hour-label" style={{ top: (h * 60 - gridStart) * PX_PER_MIN }}>
                    {hourLabel(h)}
                  </div>
                ))}
              </div>
              <div className="hour-grid" style={{ height: gridHeight }}>
                {hours.map((h) => (
                  <div key={h} className="hour-grid-line" style={{ top: (h * 60 - gridStart) * PX_PER_MIN }} />
                ))}
                {scheduled.map((a) => {
                  const top = (a.startMin - gridStart) * PX_PER_MIN;
                  const height = Math.max(MIN_BLOCK_MIN, a.endMin - a.startMin) * PX_PER_MIN;
                  const width = `calc(${100 / a.numCols}% - 4px)`;
                  const left = `calc(${(a.col / a.numCols) * 100}% + 2px)`;
                  const participantsClass = ACTIVITY_PARTICIPANTS.includes(a.participants as ActivityParticipants)
                    ? a.participants
                    : 'everyone';
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`activity-block activity-block--${participantsClass}${a.conflict ? ' activity-block--conflict' : ''}`}
                      style={{ top, height, width, left }}
                      onClick={() => setEditingId(a.id)}
                      title={a.conflict ? 'Conflicts with another activity for the same people' : undefined}
                    >
                      <span className="activity-name">
                        {a.conflict && <span className="conflict-flag">⚠ </span>}
                        {TYPE_ICON[a.type] ?? ''} {a.name}
                      </span>
                      {a.address && <span>{a.address}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Nothing scheduled yet — add a time below or use the Unscheduled list.
            </p>
          )}

          <div className="who-legend">
            {ACTIVITY_PARTICIPANTS.map((p) => (
              <span key={p}>
                <span className="who-legend-dot" style={{ background: `var(--who-${p})` }} />
                {PARTICIPANTS_LABEL[p]}
              </span>
            ))}
            <span>⚠ = same people double-booked</span>
          </div>

          {unscheduled.length > 0 && (
            <div>
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', marginBottom: 4 }}>
                Unscheduled
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {unscheduled.map((a, i) => (
                  <div key={a.id} className="card unscheduled-row">
                    <div className="reorder-btns">
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={i === 0 || isPending}
                        onClick={() => startTransition(() => reorderUnscheduled(trip.id, activeDayId, a.id, 'up'))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={i === unscheduled.length - 1 || isPending}
                        onClick={() => startTransition(() => reorderUnscheduled(trip.id, activeDayId, a.id, 'down'))}
                      >
                        ↓
                      </button>
                    </div>
                    <button type="button" className="btn-ghost" style={{ flex: 1, textAlign: 'left', color: 'var(--text)' }} onClick={() => setEditingId(a.id)}>
                      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                        {SLOT_LABEL[a.slot] ?? a.slot} · {TYPE_LABEL[a.type] ?? a.type}
                      </div>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {a.name}
                        <span
                          className="who-tag"
                          style={{ background: `var(--who-${ACTIVITY_PARTICIPANTS.includes(a.participants as ActivityParticipants) ? a.participants : 'everyone'})` }}
                        >
                          {PARTICIPANTS_LABEL[a.participants] ?? 'Everyone'}
                        </span>
                      </div>
                      {a.hours && <div className="muted" style={{ fontSize: 13 }}>{a.hours}</div>}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!adding ? (
            <button type="button" className="btn-secondary" onClick={() => setAdding(true)} style={{ alignSelf: 'flex-start' }}>
              + Add activity
            </button>
          ) : (
            <form onSubmit={handleAddSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input name="name" placeholder="Name" required style={inputStyle} />
              <div style={{ display: 'flex', gap: 8 }}>
                <select name="type" style={inputStyle} defaultValue="activity">
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <select name="slot" style={inputStyle} defaultValue="morning">
                  {ACTIVITY_SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {SLOT_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <select name="participants" style={inputStyle} defaultValue="everyone">
                {ACTIVITY_PARTICIPANTS.map((p) => (
                  <option key={p} value={p}>
                    {PARTICIPANTS_LABEL[p]}
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                    Start
                  </div>
                  <TimeSelect name="start_time" />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                    End
                  </div>
                  <TimeSelect name="end_time" />
                </div>
              </div>
              <input name="address" placeholder="Address (optional)" style={inputStyle} />
              <input name="url" placeholder="Link (optional)" style={inputStyle} />
              <input name="reservation_info" placeholder="Reservation info (optional)" style={inputStyle} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn" disabled={isPending}>
                  Add
                </button>
                <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>Day notes</summary>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea
                value={dayNotes[activeDayId] ?? ''}
                onChange={(e) => setDayNotes((n) => ({ ...n, [activeDayId]: e.target.value }))}
                rows={3}
                placeholder="Booking confirmations, links for this day..."
                style={{
                  width: '100%',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  padding: 8,
                  fontSize: 14,
                }}
              />
              <button type="button" className="btn-secondary" disabled={isPending} onClick={() => saveDayNotes(activeDayId)} style={{ alignSelf: 'flex-start' }}>
                Save
              </button>
            </div>
          </details>
        </div>
      )}

      {editingActivity && (
        <div ref={editPanelRef} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Edit activity</strong>
            <button type="button" className="btn-ghost" onClick={() => setEditingId(null)}>
              ✕
            </button>
          </div>
          <form key={editingActivity.id} onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input name="name" defaultValue={editingActivity.name} required style={inputStyle} />
            <div style={{ display: 'flex', gap: 8 }}>
              <select name="type" defaultValue={editingActivity.type} style={inputStyle}>
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <select name="slot" defaultValue={editingActivity.slot} style={inputStyle}>
                {ACTIVITY_SLOTS.map((s) => (
                  <option key={s} value={s}>
                    {SLOT_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <select name="participants" defaultValue={editingActivity.participants || 'everyone'} style={inputStyle}>
              {ACTIVITY_PARTICIPANTS.map((p) => (
                <option key={p} value={p}>
                  {PARTICIPANTS_LABEL[p]}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                  Start
                </div>
                <TimeSelect name="start_time" defaultValue={editingActivity.start_time} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                  End
                </div>
                <TimeSelect name="end_time" defaultValue={editingActivity.end_time} />
              </div>
            </div>
            <input name="address" defaultValue={editingActivity.address ?? ''} placeholder="Address" style={inputStyle} />
            <input name="url" defaultValue={editingActivity.url ?? ''} placeholder="Link" style={inputStyle} />
            <input
              name="reservation_info"
              defaultValue={editingActivity.reservation_info ?? ''}
              placeholder="Reservation info"
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <select name="status" defaultValue={editingActivity.status} style={inputStyle}>
                {ACTIVITY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select name="trip_day_id" defaultValue={editingActivity.trip_day_id} style={inputStyle}>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {formatShortDay(d.date).weekday} {formatShortDay(d.date).date}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button type="button" className="btn-ghost" style={{ color: 'var(--danger)' }} onClick={handleDelete}>
                Delete
              </button>
              <button type="submit" className="btn" disabled={isPending}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '8px 10px',
  fontSize: 14,
};

const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

// Custom hour/minute/AM-PM dropdown picker. Replaces the native
// <input type="time">, whose rendering (segmented text vs. wheel vs.
// icon-triggered popover, and icon visibility in dark mode) varies too
// much across browsers/OS to be a reliable "picker" experience. Plain
// <select> elements render consistently and visibly everywhere. Submits
// as a single "HH:MM" 24h string via a hidden input, so form-level
// FormData reads (`fd.get(name)`) work unchanged.
function TimeSelect({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  const initMin = parseMinutes(defaultValue ?? null);
  const initHour24 = initMin != null ? Math.floor(initMin / 60) : null;
  const [hour12, setHour12] = useState(
    initHour24 != null ? String(initHour24 % 12 === 0 ? 12 : initHour24 % 12) : ''
  );
  const [minute, setMinute] = useState(initMin != null ? String(initMin % 60).padStart(2, '0') : '');
  const [ampm, setAmpm] = useState(initHour24 != null ? (initHour24 < 12 ? 'AM' : 'PM') : '');

  let value = '';
  if (hour12 && minute !== '' && ampm) {
    let h = Number(hour12) % 12;
    if (ampm === 'PM') h += 12;
    value = `${String(h).padStart(2, '0')}:${minute}`;
  }

  const selectStyle: React.CSSProperties = { ...inputStyle, padding: '8px 4px', textAlign: 'center' };

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input type="hidden" name={name} value={value} />
      <select value={hour12} onChange={(e) => setHour12(e.target.value)} style={selectStyle} aria-label="Hour">
        <option value="">Hr</option>
        {HOURS_12.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <select value={minute} onChange={(e) => setMinute(e.target.value)} style={selectStyle} aria-label="Minute">
        <option value="">Min</option>
        {MINUTE_STEPS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select value={ampm} onChange={(e) => setAmpm(e.target.value)} style={selectStyle} aria-label="AM/PM">
        <option value="">--</option>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
