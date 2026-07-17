// HTTP MCP server. Exposes household tools to Claude.
// Connect this URL to claude.ai as a custom connector.

import { createClient } from '@supabase/supabase-js';
import { checkBusy, createEvent, listEvents, deleteEvent } from '@/lib/google-calendar';
import { getHousehold } from '@/lib/household';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// -------- tool definitions --------
const TOOLS = [
  {
    name: 'list_action_items',
    description:
      'List action items the user needs to handle. Filter by status, due_date range, or category.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'snoozed', 'dismissed'] },
        due_before: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        due_after: { type: 'string', description: 'ISO date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'list_school_events',
    description:
      'List school calendar events (days off, early pickup, spirit days, events, etc.) in a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD, default today' },
        end_date: { type: 'string', description: 'YYYY-MM-DD, default today+14' },
        event_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional filter list',
        },
      },
    },
  },
  {
    name: 'weekly_digest',
    description:
      'THE default tool for any "what\'s coming up", "what do I need to do", or general household status question. Returns school calendar events AND open action items AND recent emails in one call. Always prefer this over calling list_school_events and list_action_items separately.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'recent_emails',
    description:
      'List recently parsed inbound emails with their summaries. Filter by classification or source.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days back, default 7' },
        classification: {
          type: 'string',
          enum: ['action_required', 'informational', 'noise'],
        },
        include_noise: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'add_action_item',
    description: 'Add a new action item the user wants to remember.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        priority: { type: 'string', enum: ['urgent', 'normal', 'low'] },
        category: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'mark_action_done',
    description: 'Mark an action item complete by id or by fuzzy title match.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title_match: { type: 'string', description: 'Substring match if id unknown' },
      },
    },
  },
  {
    name: 'add_grocery_item',
    description:
      'Add an item to the pending grocery list. The user will use this list next time they order.',
    inputSchema: {
      type: 'object',
      properties: {
        item_name: { type: 'string' },
        quantity: { type: 'string' },
      },
      required: ['item_name'],
    },
  },
  {
    name: 'list_grocery_pending',
    description: 'List items currently waiting to be added to the next grocery order.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'clear_grocery_list',
    description: 'Mark all pending grocery items as ordered, clearing the list. Use after an order has been placed.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'remove_grocery_item',
    description: 'Remove a single item from the pending grocery list by name.',
    inputSchema: {
      type: 'object',
      properties: {
        item_name: { type: 'string', description: 'Name of the item to remove (substring match)' },
      },
      required: ['item_name'],
    },
  },
  {
    name: 'check_calendar_busy',
    description:
      'Check whether a calendar is busy in a given time window. Use BEFORE creating an event to warn about conflicts.',
    inputSchema: {
      type: 'object',
      properties: {
        start_iso: { type: 'string', description: 'ISO datetime with timezone' },
        end_iso: { type: 'string', description: 'ISO datetime with timezone' },
        calendar: { type: 'string', enum: ['personal', 'kian_school'], description: 'Which calendar to check. Default: personal.' },
      },
      required: ['start_iso', 'end_iso'],
    },
  },
  {
    name: 'create_calendar_event',
    description:
      'Create a calendar event. Use calendar="kian_school" for Kian\'s school calendar, "personal" (default) for Megha\'s personal calendar. ONLY add invite_emails when explicitly asked. Always check_calendar_busy first.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        start_iso: { type: 'string' },
        end_iso: { type: 'string' },
        calendar: { type: 'string', enum: ['personal', 'kian_school'], description: 'Which calendar to add the event to. Ask the user if unclear.' },
        all_day: { type: 'boolean', description: 'Set true for all-day events like school holidays, days off, spirit days.' },
        invite_emails: {
          type: 'array',
          items: { type: 'string' },
          description:
            'ONLY pass this if user explicitly asked to invite people. Otherwise omit.',
        },
      },
      required: ['summary', 'start_iso', 'end_iso'],
    },
  },
  {
    name: 'list_household_members',
    description:
      'List the household members (parents, children, etc.) with their emails for invites.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_calendar_events',
    description: 'List upcoming Google Calendar events with their IDs. Use this before deleting events to find the right event_id.',
    inputSchema: {
      type: 'object',
      properties: {
        calendar: { type: 'string', enum: ['personal', 'kian_school'] },
        time_min: { type: 'string', description: 'ISO datetime, default now' },
        time_max: { type: 'string', description: 'ISO datetime, default +90 days' },
      },
    },
  },
  {
    name: 'delete_calendar_event',
    description: 'Delete a Google Calendar event by ID. Use list_calendar_events first to find the event_id.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        calendar: { type: 'string', enum: ['personal', 'kian_school'] },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'create_trip',
    description:
      'Save a new trip header and auto-generate its trip_days rows for every date in the range. Call once planning basics (destination, dates, participants, constraints) are known, before saving day activities.',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
        participant_names: { type: 'array', items: { type: 'string' } },
        adult_count: { type: 'number' },
        kid_count: { type: 'number' },
        constraints: {
          type: 'object',
          description:
            'Free-form: nap_start, nap_end (HH:MM), date_night_days (array of YYYY-MM-DD), accommodation_address, etc.',
        },
      },
      required: ['destination', 'start_date', 'end_date'],
    },
  },
  {
    name: 'save_trip_day_activities',
    description:
      'Save or replace the full set of activities (primary + alternates) for one trip day. Replaces whatever was previously saved for that day.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD, must match an existing trip_day' },
        activities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slot: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
              type: { type: 'string', enum: ['activity', 'restaurant', 'date_night_restaurant'] },
              name: { type: 'string' },
              description: { type: 'string' },
              address: { type: 'string' },
              url: { type: 'string' },
              hours: { type: 'string' },
              is_adults_only: { type: 'boolean' },
              reservation_info: { type: 'string' },
              priority: { type: 'string', enum: ['primary', 'alternate_1', 'alternate_2'], description: 'Default: primary' },
              status: { type: 'string', enum: ['planned', 'confirmed', 'completed', 'cancelled'], description: 'Default: planned' },
            },
            required: ['slot', 'type', 'name'],
          },
        },
      },
      required: ['trip_id', 'date', 'activities'],
    },
  },
  {
    name: 'get_trip_itinerary',
    description:
      'Return a trip\'s itinerary — the full trip or a single day. Returns primary activities only unless include_alternates is set (e.g. user asks "what are my backups for dinner?").',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD. Omit for the full trip.' },
        include_alternates: { type: 'boolean', default: false },
      },
      required: ['trip_id'],
    },
  },
  {
    name: 'update_trip_activity',
    description:
      'Update, cancel, or swap a single trip activity. Pass fields to change directly, or pass swap_with_id to swap priority (e.g. promote an alternate to primary) between two activities.',
    inputSchema: {
      type: 'object',
      properties: {
        activity_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        address: { type: 'string' },
        url: { type: 'string' },
        hours: { type: 'string' },
        reservation_info: { type: 'string' },
        priority: { type: 'string', enum: ['primary', 'alternate_1', 'alternate_2'] },
        status: { type: 'string', enum: ['planned', 'confirmed', 'completed', 'cancelled'] },
        is_adults_only: { type: 'boolean' },
        slot: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
        swap_with_id: { type: 'string', description: 'Activity id to swap priority with, e.g. to promote an alternate.' },
      },
      required: ['activity_id'],
    },
  },
  {
    name: 'list_trips',
    description: 'List past and upcoming trips, optionally filtered by status. Use for post-trip recall ("what did we do in...").',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['planning', 'active', 'completed'] },
      },
    },
  },
  {
    name: 'delete_trip',
    description: 'Delete a trip and all its days and activities.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'string' },
      },
      required: ['trip_id'],
    },
  },
];

// -------- tool implementations --------
async function callTool(name: string, args: any) {
  const household = await getHousehold();

  switch (name) {
    case 'list_action_items': {
      let q = supabase
        .from('action_items')
        .select('id, title, description, details_url, due_date, priority, category, status')
        .eq('household_id', household.id);
      if (args.status) q = q.eq('status', args.status);
      else q = q.eq('status', 'open');
      if (args.due_before) q = q.lte('due_date', args.due_before);
      if (args.due_after) q = q.gte('due_date', args.due_after);
      const { data } = await q.order('due_date', { ascending: true, nullsFirst: false });
      return data || [];
    }

    case 'list_school_events': {
      const start = args.start_date || new Date().toISOString().slice(0, 10);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 14);
      const end = args.end_date || endDate.toISOString().slice(0, 10);
      let q = supabase
        .from('school_calendar')
        .select('*')
        .eq('household_id', household.id)
        .gte('start_date', start)
        .lte('start_date', end);
      if (args.event_types?.length) q = q.in('event_type', args.event_types);
      const { data } = await q.order('start_date', { ascending: true });
      return data || [];
    }

    case 'weekly_digest': {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const twoWeeks = new Date();
      twoWeeks.setDate(twoWeeks.getDate() + 14);
      const twoWeeksStr = twoWeeks.toISOString().slice(0, 10);

      const [events, actions, emails] = await Promise.all([
        supabase
          .from('school_calendar')
          .select('*')
          .eq('household_id', household.id)
          .gte('start_date', todayStr)
          .lte('start_date', twoWeeksStr)
          .order('start_date'),
        supabase
          .from('action_items')
          .select('*')
          .eq('household_id', household.id)
          .eq('status', 'open')
          .order('due_date', { ascending: true, nullsFirst: false }),
        supabase
          .from('inbound_emails')
          .select('from_name, source_name, subject, summary, classification, received_at')
          .eq('household_id', household.id)
          .gte('received_at', new Date(Date.now() - 7 * 86400_000).toISOString())
          .neq('classification', 'noise')
          .order('received_at', { ascending: false }),
      ]);

      return {
        as_of: todayStr,
        school_events_next_two_weeks: events.data || [],
        open_action_items: actions.data || [],
        emails_past_week: emails.data || [],
      };
    }

    case 'recent_emails': {
      const days = args.days || 7;
      let q = supabase
        .from('inbound_emails')
        .select(
          'id, from_name, source_name, subject, summary, classification, received_at, parsed_at'
        )
        .eq('household_id', household.id)
        .gte('received_at', new Date(Date.now() - days * 86400_000).toISOString());
      if (args.classification) q = q.eq('classification', args.classification);
      else if (!args.include_noise) q = q.neq('classification', 'noise');
      const { data } = await q.order('received_at', { ascending: false });
      return data || [];
    }

    case 'add_action_item': {
      const { data } = await supabase
        .from('action_items')
        .insert({
          household_id: household.id,
          title: args.title,
          description: args.description,
          due_date: args.due_date,
          priority: args.priority || 'normal',
          category: args.category || 'other',
        })
        .select()
        .single();
      return { added: true, item: data };
    }

    case 'mark_action_done': {
      let id = args.id;
      if (!id && args.title_match) {
        const { data } = await supabase
          .from('action_items')
          .select('id, title')
          .eq('household_id', household.id)
          .eq('status', 'open')
          .ilike('title', `%${args.title_match}%`)
          .limit(2);
        if (!data?.length) return { error: 'No matching open action items' };
        if (data.length > 1)
          return { error: 'Ambiguous match, please specify id', candidates: data };
        id = data[0].id;
      }
      const { data } = await supabase
        .from('action_items')
        .update({ status: 'done', done_at: new Date().toISOString() })
        .eq('id', id)
        .eq('household_id', household.id)
        .select()
        .single();
      return { marked_done: data };
    }

    case 'add_grocery_item': {
      const { data } = await supabase
        .from('grocery_pending')
        .insert({
          household_id: household.id,
          item_name: args.item_name,
          quantity: args.quantity,
          added_via: 'chat',
        })
        .select()
        .single();
      return { added: true, item: data };
    }

    case 'list_grocery_pending': {
      const { data } = await supabase
        .from('grocery_pending')
        .select('*')
        .eq('household_id', household.id)
        .eq('ordered', false)
        .order('added_at', { ascending: false });
      return data || [];
    }

    case 'clear_grocery_list': {
      const { count } = await supabase
        .from('grocery_pending')
        .update({ ordered: true, ordered_at: new Date().toISOString() })
        .eq('household_id', household.id)
        .eq('ordered', false);
      return { cleared: true, items_cleared: count ?? 0 };
    }

    case 'remove_grocery_item': {
      const { data, error } = await supabase
        .from('grocery_pending')
        .delete()
        .eq('household_id', household.id)
        .eq('ordered', false)
        .ilike('item_name', `%${args.item_name}%`)
        .select();
      if (error) throw error;
      return { removed: true, items_removed: data?.length ?? 0 };
    }

    case 'check_calendar_busy': {
      return await checkBusy(household.id, args.start_iso, args.end_iso, args.calendar);
    }

    case 'create_calendar_event': {
      const event = await createEvent(household.id, {
        summary: args.summary,
        description: args.description,
        location: args.location,
        startIso: args.start_iso,
        endIso: args.end_iso,
        inviteEmails: args.invite_emails,
        timezone: household.timezone,
        calendar: args.calendar,
        allDay: args.all_day,
      });
      return {
        created: true,
        event_id: event.id,
        html_link: event.htmlLink,
        attendees: event.attendees,
      };
    }

    case 'list_household_members': {
      const { data } = await supabase
        .from('household_members')
        .select('id, name, role, email, notes')
        .eq('household_id', household.id);
      return data || [];
    }

    case 'list_calendar_events': {
      const timeMax = args.time_max ||
        new Date(Date.now() + 90 * 86400_000).toISOString();
      return await listEvents(household.id, args.calendar, args.time_min, timeMax);
    }

    case 'delete_calendar_event': {
      return await deleteEvent(household.id, args.event_id, args.calendar);
    }

    case 'create_trip': {
      const { data: trip } = await supabase
        .from('trips')
        .insert({
          household_id: household.id,
          destination: args.destination,
          start_date: args.start_date,
          end_date: args.end_date,
          participant_names: args.participant_names || [],
          adult_count: args.adult_count,
          kid_count: args.kid_count,
          constraints: args.constraints || {},
        })
        .select()
        .single();

      const dateNightDays = new Set(trip.constraints?.date_night_days || []);
      const rows = [];
      let dayNumber = 1;
      for (
        let d = new Date(`${args.start_date}T00:00:00Z`);
        d <= new Date(`${args.end_date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        const dateStr = d.toISOString().slice(0, 10);
        rows.push({
          trip_id: trip.id,
          household_id: household.id,
          date: dateStr,
          day_number: dayNumber++,
          is_date_night: dateNightDays.has(dateStr),
        });
      }
      const { data: tripDays } = await supabase.from('trip_days').insert(rows).select();
      return { trip, trip_days: tripDays || [] };
    }

    case 'save_trip_day_activities': {
      const { data: day } = await supabase
        .from('trip_days')
        .select('id')
        .eq('trip_id', args.trip_id)
        .eq('household_id', household.id)
        .eq('date', args.date)
        .single();
      if (!day) return { error: 'No trip_day found for that trip_id/date' };

      await supabase.from('trip_activities').delete().eq('trip_day_id', day.id);

      const rows = (args.activities || []).map((a: any, i: number) => ({
        trip_id: args.trip_id,
        trip_day_id: day.id,
        household_id: household.id,
        slot: a.slot,
        type: a.type,
        name: a.name,
        description: a.description,
        address: a.address,
        url: a.url,
        hours: a.hours,
        is_adults_only: a.is_adults_only || false,
        reservation_info: a.reservation_info,
        priority: a.priority || 'primary',
        status: a.status || 'planned',
        sort_order: a.sort_order ?? i,
      }));
      const { data } = await supabase.from('trip_activities').insert(rows).select();
      return { saved: true, activities: data || [] };
    }

    case 'get_trip_itinerary': {
      const { data: trip } = await supabase
        .from('trips')
        .select('*')
        .eq('id', args.trip_id)
        .eq('household_id', household.id)
        .single();
      if (!trip) return { error: 'Trip not found' };

      let dayQuery = supabase
        .from('trip_days')
        .select('*')
        .eq('trip_id', args.trip_id)
        .order('day_number', { ascending: true });
      if (args.date) dayQuery = dayQuery.eq('date', args.date);
      const { data: days } = await dayQuery;

      const dayIds = (days || []).map((d: any) => d.id);
      let activities: any[] = [];
      if (dayIds.length) {
        let actQuery = supabase
          .from('trip_activities')
          .select('*')
          .in('trip_day_id', dayIds)
          .order('sort_order', { ascending: true });
        if (!args.include_alternates) actQuery = actQuery.eq('priority', 'primary');
        const { data } = await actQuery;
        activities = data || [];
      }

      const activitiesByDay: Record<string, any[]> = {};
      for (const a of activities) {
        (activitiesByDay[a.trip_day_id] ||= []).push(a);
      }

      return {
        trip,
        days: (days || []).map((d: any) => ({ ...d, activities: activitiesByDay[d.id] || [] })),
      };
    }

    case 'update_trip_activity': {
      if (args.swap_with_id) {
        const { data: a } = await supabase
          .from('trip_activities')
          .select('id, priority')
          .eq('id', args.activity_id)
          .eq('household_id', household.id)
          .single();
        const { data: b } = await supabase
          .from('trip_activities')
          .select('id, priority')
          .eq('id', args.swap_with_id)
          .eq('household_id', household.id)
          .single();
        if (!a || !b) return { error: 'Activity not found' };
        await supabase.from('trip_activities').update({ priority: b.priority }).eq('id', a.id);
        await supabase.from('trip_activities').update({ priority: a.priority }).eq('id', b.id);
        return { swapped: true, activity_id: a.id, swapped_with: b.id };
      }

      const updates: any = {};
      for (const key of [
        'name',
        'description',
        'address',
        'url',
        'hours',
        'reservation_info',
        'priority',
        'status',
        'is_adults_only',
        'slot',
      ]) {
        if (args[key] !== undefined) updates[key] = args[key];
      }
      const { data } = await supabase
        .from('trip_activities')
        .update(updates)
        .eq('id', args.activity_id)
        .eq('household_id', household.id)
        .select()
        .single();
      return { updated: data };
    }

    case 'list_trips': {
      let q = supabase.from('trips').select('*').eq('household_id', household.id);
      if (args.status) q = q.eq('status', args.status);
      const { data } = await q.order('start_date', { ascending: false });
      return data || [];
    }

    case 'delete_trip': {
      const { error } = await supabase
        .from('trips')
        .delete()
        .eq('id', args.trip_id)
        .eq('household_id', household.id);
      if (error) throw error;
      return { deleted: true, trip_id: args.trip_id };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// -------- MCP JSON-RPC handler --------
export async function POST(request: Request) {
  // Accept secret via header or query param (claude.ai connector UI doesn't support headers)
  if (process.env.MCP_SHARED_SECRET) {
    const { searchParams } = new URL(request.url);
    const provided = request.headers.get('x-mcp-secret') || searchParams.get('secret');
    if (provided !== process.env.MCP_SHARED_SECRET) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const { id, method, params } = await request.json();

  try {
    if (method === 'initialize') {
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'house-chief-of-staff', version: '0.1.0' },
        },
      });
    }

    if (method === 'tools/list') {
      return Response.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }

    if (method === 'tools/call') {
      const result = await callTool(params.name, params.arguments || {});
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      });
    }

    return Response.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (e: any) {
    return Response.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: e.message || String(e) },
    });
  }
}
