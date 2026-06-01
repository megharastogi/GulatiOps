// /api/mcp.ts
// HTTP MCP server. Exposes household tools to Claude.
// Connect this URL to claude.ai as a custom connector.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { checkBusy, createEvent, listEvents, deleteEvent } from '../lib/google-calendar.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// -------- household resolver --------
async function getHousehold() {
  const { data } = await supabase
    .from('households')
    .select('*')
    .eq('digest_email', process.env.PRIMARY_DIGEST_EMAIL!)
    .single();
  if (!data) throw new Error('Household not seeded.');
  return data;
}

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

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// -------- MCP JSON-RPC handler --------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Accept secret via header or query param (claude.ai connector UI doesn't support headers)
  if (process.env.MCP_SHARED_SECRET) {
    const provided = req.headers['x-mcp-secret'] || req.query['secret'];
    if (provided !== process.env.MCP_SHARED_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { id, method, params } = req.body;

  try {
    if (method === 'initialize') {
      return res.json({
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
      return res.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }

    if (method === 'tools/call') {
      const result = await callTool(params.name, params.arguments || {});
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      });
    }

    return res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (e: any) {
    return res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: e.message || String(e) },
    });
  }
}
