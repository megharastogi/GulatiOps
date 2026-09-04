// /lib/digest.ts
// The weekly digest: what's coming up, what's still open, what came in.
//
// Shared by the `weekly_digest` MCP tool and the /dashboard/week page so the
// two can't drift. The Supabase client is passed in rather than constructed
// here, because the callers legitimately differ — the MCP route has no user
// session and uses the service-role client, while the page uses the
// user-scoped one so the RLS policies apply.

type QueryClient = {
  from: (table: string) => any;
};

/**
 * The email an event or action item was parsed out of. Without it a row is a
 * bare assertion — "Early dismissal Thursday" with nothing behind it to
 * check — so both the digest and the week page carry the provenance along.
 * Null for anything entered by hand through the todo form or the MCP.
 *
 * The `!source_email_id` hint names the foreign key column rather than
 * leaving PostgREST to infer which relationship is meant.
 */
export type SourceEmail = {
  id: string;
  subject: string | null;
  source_name: string | null;
  from_name: string | null;
  received_at: string;
  summary: string | null;
};

export const SOURCE_EMAIL =
  'source_email:inbound_emails!source_email_id (id, subject, source_name, from_name, received_at, summary)';

export type Digest = {
  as_of: string;
  school_events_next_two_weeks: any[];
  open_action_items: any[];
  emails_past_week: any[];
};

/**
 * An item whose email never stated a deadline is not infinitely far away —
 * it arrived in a school email a few days ago and probably wants doing. But
 * `nulls last` filed it behind a task due in May 2027, and `nulls first`
 * would rank it above something genuinely due tomorrow.
 *
 * So an undated item sorts as though it were due at the end of the two-week
 * horizon this app already uses everywhere else: late enough not to outrank
 * a real deadline this week, early enough not to be buried under next
 * spring. Priority breaks a tie, then newest first, since a task from this
 * week's mail is more likely live than one from June.
 */
const UNDATED_HORIZON_DAYS = 14;

const PRIORITY_RANK: Record<string, number> = { urgent: 0, normal: 1, low: 2 };

export function sortActionItems<T extends Record<string, any>>(items: T[]): T[] {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + UNDATED_HORIZON_DAYS);
  const horizonStr = horizon.toISOString().slice(0, 10);

  // ISO dates compare correctly as plain strings, so no parsing per item.
  return [...items].sort((a, b) => {
    const da = a.due_date || horizonStr;
    const db = b.due_date || horizonStr;
    if (da !== db) return da < db ? -1 : 1;

    const pa = PRIORITY_RANK[a.priority] ?? 1;
    const pb = PRIORITY_RANK[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;

    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  });
}

export async function getDigest(
  supabase: QueryClient,
  householdId: string
): Promise<Digest> {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const twoWeeks = new Date();
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  const twoWeeksStr = twoWeeks.toISOString().slice(0, 10);

  const [events, actions, emails] = await Promise.all([
    supabase
      .from('school_calendar')
      .select(`*, ${SOURCE_EMAIL}`)
      .eq('household_id', householdId)
      .gte('start_date', todayStr)
      .lte('start_date', twoWeeksStr)
      .order('start_date'),
    supabase
      .from('action_items')
      .select(`*, ${SOURCE_EMAIL}`)
      .eq('household_id', householdId)
      .eq('status', 'open')
      .order('due_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('inbound_emails')
      .select('id, from_name, source_name, subject, summary, classification, received_at')
      .eq('household_id', householdId)
      .gte('received_at', new Date(Date.now() - 7 * 86400_000).toISOString())
      .neq('classification', 'noise')
      .order('received_at', { ascending: false }),
  ]);

  return {
    as_of: todayStr,
    school_events_next_two_weeks: events.data || [],
    open_action_items: sortActionItems(actions.data || []),
    emails_past_week: emails.data || [],
  };
}
