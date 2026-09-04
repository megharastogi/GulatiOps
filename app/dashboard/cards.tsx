// /app/dashboard/cards.tsx
// The event and action-item cards, shared by /dashboard and
// /dashboard/week. Both pages list the same two things out of the same
// two tables, and until these were pulled out they had drifted: the week
// page grew blurbs and source links while home kept rendering a bare
// title and date, which just looks like the feature never shipped.

import Link from 'next/link';
import { type SourceEmail } from '@/lib/digest';
import { markDone } from './actions';

export function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** "Thu · Sep 10", the header a day's events sit under. */
export function formatDayHeading(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    rest: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };
}

/** The month/day pair for an event's calendar tile. */
export function formatDateTile(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  return {
    month: d.toLocaleDateString('en-US', { month: 'short' }),
    day: d.toLocaleDateString('en-US', { day: 'numeric' }),
  };
}

/** 6:00 PM. Sits under the tile, in the column where a task has its box. */
export function formatTime(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400_000);
}

/** Overdue and today read differently from "next week sometime". */
function dueLabel(dueDate: string | null) {
  // Said out loud rather than left blank: an undated item sorts as though it
  // were due in a fortnight, and a blank line makes that placement look
  // arbitrary instead of deliberate.
  if (!dueDate) return { text: 'No due date', urgent: false };
  const days = daysUntil(dueDate);
  if (days < 0) return { text: `Overdue — was ${formatDate(dueDate)}`, urgent: true };
  if (days === 0) return { text: 'Due today', urgent: true };
  if (days === 1) return { text: 'Due tomorrow', urgent: true };
  return { text: `Due ${formatDate(dueDate)}`, urgent: false };
}

/** Opens /dashboard/mail scrolled to that email, with its body expanded. */
export function mailHref(emailId: string) {
  return `/dashboard/mail?open=${emailId}#email-${emailId}`;
}

/** Reads better than "Open the link" when we know what kind of thing it is. */
const DETAILS_LABEL: Record<string, string> = {
  volunteer: 'Sign up',
  form: 'Open the form',
  payment: 'Pay',
  rsvp: 'RSVP',
  supply: 'Open the list',
};

/**
 * `details_url` is a signup or form link the parser lifted out of forwarded
 * email — third-party text we're about to make tappable. Only http(s) gets
 * through: a `javascript:` href is a script that runs on tap, and `data:` is
 * a page we'd be rendering on our own origin. The host is shown next to the
 * label so you can see where a link goes before following it.
 */
function detailsLink(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return { href: parsed.toString(), host: parsed.hostname.replace(/^www\./, '') };
  } catch {
    return null; // not a URL at all
  }
}

/**
 * What a card is actually about, and who said so. A title and a date alone
 * leave you guessing what "Spirit Day" asks of you, so the parser's own
 * description sits underneath and the email behind it is one tap away — the
 * answer to "wait, who said this and did I read it right?".
 *
 * A missing source isn't an error. Events lose theirs if the email is deleted
 * (`on delete set null`), and action items added through the todo form or the
 * MCP never had one.
 */
function Provenance({
  blurb,
  source,
  action,
}: {
  blurb?: string | null;
  source?: SourceEmail | null;
  action?: React.ReactNode;
}) {
  return (
    <>
      {blurb && <p className="blurb">{blurb}</p>}
      {action}
      {source && (
        <Link className="source-link" href={mailHref(source.id)}>
          {source.source_name || source.from_name || 'Original email'} ·{' '}
          {formatWhen(source.received_at)} →
        </Link>
      )}
    </>
  );
}

/**
 * An event leads with *when*: a calendar tile in the same left column where a
 * task keeps its checkbox. That shared gutter is what makes the two types
 * tell themselves apart at a glance — one column holds a date, the other
 * holds something you can press — and it reads with the colour drained out.
 *
 * The date is repeated here even though the day heading above already states
 * it. Strictly that is redundant; in practice the tile is the thing the eye
 * lands on when scanning, and a heading scrolled just off the top of the
 * screen isn't much help.
 */
export function EventCard({ event }: { event: any }) {
  const { month, day } = formatDateTile(event.start_date);
  const time = formatTime(event.start_time);

  return (
    <div className="card row-card">
      <div className="gutter">
        <div className="datetile">
          <div className="datetile-m">{month}</div>
          <div className="datetile-d">{day}</div>
        </div>
        <div className="datetile-time">{time ?? 'All day'}</div>
      </div>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{event.title}</div>
        {event.location && (
          <div className="muted" style={{ fontSize: 13 }}>
            {event.location}
          </div>
        )}
        <Provenance
          blurb={event.description || event.source_email?.summary}
          source={event.source_email}
        />
      </div>
    </div>
  );
}

/**
 * Events for one day, under a single heading. Assumes the list is already
 * ordered by start_date, which every caller's query guarantees.
 */
export function EventDays({ events }: { events: any[] }) {
  const days: [string, any[]][] = [];
  for (const e of events) {
    const last = days[days.length - 1];
    if (last && last[0] === e.start_date) last[1].push(e);
    else days.push([e.start_date, [e]]);
  }

  return (
    <div className="day-groups">
      {days.map(([date, dayEvents]) => {
        const { weekday, rest } = formatDayHeading(date);
        const days_out = daysUntil(date);
        return (
          <section key={date}>
            <div className="day-head">
              <span className="day-dow">{weekday}</span>
              <span className="day-rest">{rest}</span>
              {days_out <= 1 && (
                <span className="day-now">{days_out === 0 ? 'Today' : 'Tomorrow'}</span>
              )}
              <span className="day-line" />
            </div>
            <div className="stack-8">
              {dayEvents.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * A task leads with a checkbox, and the checkbox is the real control — an
 * empty box that can't be ticked is a lie about what the card does. Marking
 * done from wherever you are beats navigating to Todo to press a button next
 * to the same row.
 *
 * A plain form post, so it works before hydration and needs no client
 * component; markDone revalidates all three listing pages.
 */
export function ActionCard({ item }: { item: any }) {
  const due = dueLabel(item.due_date);
  const details = detailsLink(item.details_url);
  // 'other' is the parser's fallback, which tells a reader nothing.
  const category = item.category && item.category !== 'other' ? item.category : null;

  return (
    <div className="card row-card">
      <form className="gutter" action={markDone.bind(null, item.id)}>
        <button
          type="submit"
          className={due?.urgent ? 'checkbox checkbox-urgent' : 'checkbox'}
          aria-label={`Mark "${item.title}" done`}
          title="Mark done"
        />
      </form>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{item.title}</div>
        {(due || category) && (
          <div
            className={due?.urgent ? undefined : 'muted'}
            style={{ fontSize: 13, color: due?.urgent ? 'var(--danger)' : undefined }}
          >
            {due?.text}
            {due && category ? ' · ' : ''}
            {category}
          </div>
        )}
        <Provenance
          blurb={item.description || item.source_email?.summary}
          source={item.source_email}
          action={
            // Opens away from the dashboard on purpose: in standalone PWA mode
            // a same-tab navigation to an outside site replaces the app with a
            // window that has no back button.
            details && (
              <div>
                <a
                  className="btn-secondary details-link"
                  href={details.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {DETAILS_LABEL[item.category] ?? 'Open the link'}{' '}
                  <span className="details-host">{details.host} ↗</span>
                </a>
              </div>
            )
          }
        />
      </div>
    </div>
  );
}
