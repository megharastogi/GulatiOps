// /lib/brief.ts
// The week in the shape a class parent already writes it.
//
// The room-parent emails this app ingests all follow one format, because it
// is the format that works: what you have to DO, then what happens day by
// day, then what is coming after. Not a feed, not four lists of cards — a
// short note you could read at a bus stop or forward to another parent.
//
// This composes that note from rows we already have. Deliberately no model
// call: it renders on every page view, and the warm opening line of a real
// class-parent email ("hard to believe the first day is almost here!") is
// the one part that would have to be invented. A generated pleasantry reads
// worse than none, so the brief states facts and leaves the voice to whoever
// sends it.

export type BriefEntry = {
  when: string | null;
  what: string;
  detail: string | null;
};

export type Brief = {
  asOf: string;
  ask: BriefEntry[];
  thisWeek: BriefEntry[];
  lookingAhead: BriefEntry[];
  isEmpty: boolean;
};

function dayLabel(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  });
}

function timeLabel(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'a.m.' : 'p.m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${dateStr}T00:00:00`).getTime() - today.getTime()) / 86400_000);
}

// Every one of these is followed by a period and then a capital letter, which
// is exactly what a naive sentence split looks for. "St." alone cost us
// "Arrive at the gym by 5:30pm for St" and "Joint St" in the first draft —
// and this is a school app, so "St." is in half the sentences.
const ABBREVIATIONS = new Set([
  'st', 'mr', 'mrs', 'ms', 'dr', 'fr', 'jr', 'sr', 'prof', 'rev',
  'ave', 'rd', 'blvd', 'dept', 'inc', 'no', 'vs', 'etc', 'approx', 'est',
  'a', 'p', 'm', 'am', 'pm', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec',
]);

/**
 * One sentence of context, not the whole description. A brief that reprints
 * every parsed paragraph is the wall of text it exists to replace.
 */
function firstSentence(text: string | null | undefined, limit = 120): string | null {
  if (!text) return null;
  const trimmed = text.trim();

  let sentence = trimmed;
  for (const m of trimmed.matchAll(/[.;!?](\s|$)/g)) {
    const at = m.index!;
    // A single letter or a known abbreviation before the dot means the dot
    // isn't the end of anything.
    const word = trimmed.slice(0, at).match(/([A-Za-z]+)$/)?.[1]?.toLowerCase();
    if (word && (word.length === 1 || ABBREVIATIONS.has(word))) continue;
    sentence = trimmed.slice(0, at);
    break;
  }

  return sentence.length > limit ? `${sentence.slice(0, limit - 1).trimEnd()}…` : sentence;
}

/** Same words as the title tells a reader nothing they haven't just read. */
function detailFor(title: string, description: string | null | undefined, fallback?: string | null) {
  const sentence = firstSentence(description);
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (sentence && norm(sentence) !== norm(title)) return sentence;
  return fallback && norm(fallback) !== norm(title) ? fallback : null;
}

/** Two rows for one Labor Day is a calendar problem; repeating it here is ours. */
function dedupe(entries: BriefEntry[]): BriefEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.when ?? ''}|${e.what.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dueLabel(dueDate: string | null): string | null {
  if (!dueDate) return null;
  const days = daysUntil(dueDate);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due ${dayLabel(dueDate)}`;
}

export function buildBrief(digest: {
  as_of: string;
  school_events_next_two_weeks: any[];
  open_action_items: any[];
}): Brief {
  // The ASK is what someone has to act on now. An item due in November is
  // real, but putting it here would make the section ignorable.
  const ask: BriefEntry[] = dedupe(digest.open_action_items
    .filter((a) => a.due_date && daysUntil(a.due_date) <= 7)
    .map((a) => ({
      when: dueLabel(a.due_date),
      what: a.title,
      detail: detailFor(a.title, a.description),
    })));

  const toEntry = (e: any): BriefEntry => {
    const time = timeLabel(e.start_time);
    return {
      when: time ? `${dayLabel(e.start_date)}, ${time}` : dayLabel(e.start_date),
      what: e.title,
      detail: detailFor(e.title, e.description, e.location),
    };
  };

  const events = digest.school_events_next_two_weeks;
  const thisWeek = dedupe(events.filter((e) => daysUntil(e.start_date) <= 7).map(toEntry));
  const lookingAhead = dedupe(events.filter((e) => daysUntil(e.start_date) > 7).map(toEntry));

  return {
    asOf: digest.as_of,
    ask,
    thisWeek,
    lookingAhead,
    isEmpty: !ask.length && !thisWeek.length && !lookingAhead.length,
  };
}

/** The sendable form. This is what a copy button puts on the clipboard. */
export function briefToText(brief: Brief, householdName?: string): string {
  const heading = new Date(`${brief.asOf}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });

  const lines: string[] = [`${householdName ? `${householdName} — ` : ''}Week of ${heading}`];

  const section = (title: string, entries: BriefEntry[]) => {
    if (!entries.length) return;
    lines.push('', title);
    for (const e of entries) {
      lines.push(`- ${e.when ? `${e.when} — ` : ''}${e.what}`);
      // Indented so a detail can't be mistaken for another item in a text
      // message, where there is no styling to tell them apart.
      if (e.detail) lines.push(`    ${e.detail}`);
    }
  };

  section('ASK', brief.ask);
  section('THIS WEEK', brief.thisWeek);
  section('LOOKING AHEAD', brief.lookingAhead);

  return lines.join('\n');
}
