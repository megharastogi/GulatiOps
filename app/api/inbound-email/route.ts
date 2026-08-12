// Receives forwarded emails from Cloudflare Email Workers.
// Cloudflare Worker POSTs JSON: { from, to, subject, text, html, headers }

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { timingSafeEqual } from 'crypto';
import { getHousehold } from '@/lib/household';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Verify the request actually came from your Cloudflare Worker. Fails
// closed (missing env var -> false) and uses a constant-time comparison.
function verifySharedSecret(request: Request): boolean {
  const secret = process.env.INBOUND_SHARED_SECRET;
  if (!secret) return false;

  const provided = request.headers.get('x-cof-secret') || '';
  const providedBuf = Buffer.from(provided);
  const secretBuf = Buffer.from(secret);
  if (providedBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(providedBuf, secretBuf);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
}

// Only render a details_url as a clickable link if it's a plain https URL —
// blocks javascript:/data: URIs the model might otherwise copy verbatim
// from a malicious email into an <a href>.
function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!verifySharedSecret(request)) return new Response(null, { status: 401 });

  const { from, fromName, to, subject, text, html, headers } = await request.json();

  // For single-household MVP, resolve household by the `to` address
  const household = await getHousehold().catch(() => null);
  if (!household) {
    return Response.json({ error: 'no household configured' }, { status: 500 });
  }

  // 1. Store raw email immediately (durability before parsing)
  const { data: emailRow, error: insertErr } = await supabase
    .from('inbound_emails')
    .insert({
      household_id: household.id,
      from_address: from,
      from_name: fromName,
      to_address: to,
      subject,
      body_text: text,
      body_html: html,
      raw_headers: headers,
    })
    .select()
    .single();

  if (insertErr) {
    console.error('insert failed', insertErr);
    return Response.json({ error: 'insert failed' }, { status: 500 });
  }

  // 2. Respond 200 fast — parse async (Vercel functions don't truly do background
  //    work, so we await inline; for higher volume, push to a queue)
  try {
    await parseAndProcessEmail(emailRow.id, household);
  } catch (e) {
    console.error('parse failed', e);
    await supabase
      .from('inbound_emails')
      .update({ parse_error: String(e) })
      .eq('id', emailRow.id);
  }

  return Response.json({ ok: true, email_id: emailRow.id });
}

// Lightweight guardrails on the model's JSON output before it reaches the
// database — enum fields get clamped to a known-good value instead of
// trusting whatever the model (or a crafted email trying to steer it)
// returned, dates/times are validated by format, free text is length-capped,
// and array sizes are capped so one email can't flood the tables.
const CLASSIFICATIONS = new Set(['action_required', 'informational', 'noise']);
const EVENT_TYPES = new Set([
  'day_off', 'early_pickup', 'late_start', 'event', 'fundraiser', 'spirit_day', 'conference', 'social',
]);
const PRIORITIES = new Set(['urgent', 'normal', 'low']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const MAX_ITEMS = 20;

function truncateOrNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.slice(0, max);
}

function dateOrNull(value: unknown): string | null {
  return typeof value === 'string' && DATE_RE.test(value) ? value : null;
}

function timeOrNull(value: unknown): string | null {
  return typeof value === 'string' && TIME_RE.test(value) ? value : null;
}

function normalizeParsedOutput(raw: any) {
  const school_events = Array.isArray(raw?.school_events)
    ? raw.school_events
        .slice(0, MAX_ITEMS)
        .map((e: any) => ({
          event_type: EVENT_TYPES.has(e?.event_type) ? e.event_type : 'event',
          title: truncateOrNull(e?.title, 200) || 'Untitled event',
          description: truncateOrNull(e?.description, 1000),
          start_date: dateOrNull(e?.start_date),
          end_date: dateOrNull(e?.end_date),
          start_time: timeOrNull(e?.start_time),
          end_time: timeOrNull(e?.end_time),
          location: truncateOrNull(e?.location, 200),
        }))
        // An event with no valid date isn't useful on a calendar and
        // shouldn't be stored — better to drop it than show "undefined".
        .filter((e: any) => e.start_date)
    : [];

  const action_items = Array.isArray(raw?.action_items)
    ? raw.action_items.slice(0, MAX_ITEMS).map((a: any) => ({
        title: truncateOrNull(a?.title, 200) || 'Untitled task',
        description: truncateOrNull(a?.description, 1000),
        details_url: safeHttpsUrl(a?.details_url),
        due_date: dateOrNull(a?.due_date),
        priority: PRIORITIES.has(a?.priority) ? a.priority : 'normal',
        category: truncateOrNull(a?.category, 50),
      }))
    : [];

  return {
    classification: CLASSIFICATIONS.has(raw?.classification) ? raw.classification : 'informational',
    source_type: truncateOrNull(raw?.source_type, 50),
    source_name: truncateOrNull(raw?.source_name, 200),
    summary: truncateOrNull(raw?.summary, 500),
    school_events,
    action_items,
  };
}

function extractLinks(html: string): string[] {
  const matches = [...html.matchAll(/href=["'](https?:\/\/[^"'\s>]+)["']/gi)];
  return [...new Set(matches.map((m) => m[1]))]
    .filter((url) => !/(unsubscribe|optout|pixel|beacon|open\.php|mailto)/i.test(url))
    .slice(0, 3);
}

async function fetchNewsletterContent(url: string): Promise<string> {
  try {
    // Strip query params before handing the URL to a third party (Jina) —
    // that's typically where signed/personalized tokens live (recipient
    // IDs, tracking params). The newsletter body itself rarely depends on
    // them, so this trades a little enrichment quality for not leaking
    // per-recipient identifiers off-platform.
    const stripped = new URL(url);
    stripped.search = '';

    // Use Jina Reader to handle JS-rendered pages (Smore, Peachjar, etc.)
    const readerUrl = `https://r.jina.ai/${stripped.toString()}`;
    const res = await fetch(readerUrl, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    return (await res.text()).slice(0, 4000);
  } catch {
    return '';
  }
}

async function parseAndProcessEmail(emailId: string, household: any) {
  const { data: email } = await supabase
    .from('inbound_emails')
    .select('*')
    .eq('id', emailId)
    .single();

  if (!email) return;

  // Fetch linked newsletter content
  const links = extractLinks(email.body_html || '');
  const linkedContents = await Promise.all(links.map(fetchNewsletterContent));
  const newsletterSection = linkedContents
    .map((c, i) => (c ? `\nLinked page ${i + 1} (${links[i]}):\n${c}` : ''))
    .filter(Boolean)
    .join('\n');

  // Build context for the parser
  const today = new Date().toISOString().slice(0, 10);
  const householdMembers = await supabase
    .from('household_members')
    .select('name, role, notes')
    .eq('household_id', household.id);

  const parserPrompt = `You are parsing an email that was forwarded into a family's
"chief of staff" system. Extract structured information.

Today's date: ${today}
Household members: ${JSON.stringify(householdMembers.data)}

Email:
From: ${email.from_name || ''} <${email.from_address}>
Subject: ${email.subject}
Body:
${email.body_text || email.body_html?.replace(/<[^>]+>/g, ' ') || ''}${newsletterSection}

Return ONLY a JSON object with this shape, no prose, no markdown fences:

{
  "classification": "action_required" | "informational" | "noise",
  "source_type": "school" | "activity" | "grocery" | "medical" | "other",
  "source_name": "<organization name, e.g. 'Lincoln Elementary PTA'>",
  "summary": "<1-2 sentence summary in plain English>",
  "school_events": [
    {
      "event_type": "day_off" | "early_pickup" | "late_start" | "event" | "fundraiser" | "spirit_day" | "conference" | "social",
      "title": "<short title>",
      "description": "<details>",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null",
      "start_time": "HH:MM or null",
      "end_time": "HH:MM or null",
      "location": "<location or null>"
    }
  ],
  "action_items": [
    {
      "title": "<short title, e.g. 'Sign up for Teacher Appreciation Week lunch slot'>",
      "description": "<context>",
      "details_url": "<signup or info URL if present, else null>",
      "due_date": "YYYY-MM-DD or null",
      "priority": "urgent" | "normal" | "low",
      "category": "volunteer" | "form" | "payment" | "rsvp" | "supply" | "other"
    }
  ]
}

Rules:
- "noise" = truly no useful content: marketing, unsubscribe confirmations, generic thank-you notes with no dates or asks. Do NOT classify as noise just because it is formatted like a newsletter — newsletters often contain events and action items.
- "informational" = contains useful info (dates, events, reminders) but nothing the parent must actively do
- "action_required" = the parent must sign up, RSVP, pay, send something, or attend something
- If the email or any linked page contains ANY dates, events, or asks, it is at minimum "informational"
- Spirit days, themed dress days → school_events with event_type "spirit_day", AND no action item unless something specific must be brought
- Extract ALL notable dates as school_events, even if no parent action is needed — e.g. "Donuts with Dads", "last pizza lunch", "Moving Up Mass", graduation, class parties. Use event_type "social" for fun/celebratory events that are worth knowing about but require no action.
- Always extract dates in absolute YYYY-MM-DD form; "next Friday" must be resolved against today's date
- If a single email contains multiple events or asks, return them all
- If nothing extractable, return empty arrays for school_events and action_items`;

  const parseResp = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2000,
    messages: [{ role: 'user', content: parserPrompt }],
  });

  const textBlock = parseResp.content.find((b) => b.type === 'text') as any;
  const rawText = textBlock.text.replace(/```json|```/g, '').trim();
  const parsed = normalizeParsedOutput(JSON.parse(rawText));

  // 3. Update inbound_emails with parse output
  await supabase
    .from('inbound_emails')
    .update({
      parsed_at: new Date().toISOString(),
      classification: parsed.classification,
      source_type: parsed.source_type,
      source_name: parsed.source_name,
      summary: parsed.summary,
    })
    .eq('id', emailId);

  // 4. Insert school events
  for (const evt of parsed.school_events || []) {
    await supabase.from('school_calendar').insert({
      household_id: household.id,
      source_email_id: emailId,
      event_type: evt.event_type,
      title: evt.title,
      description: evt.description,
      start_date: evt.start_date,
      end_date: evt.end_date,
      start_time: evt.start_time,
      end_time: evt.end_time,
      location: evt.location,
    });
  }

  // 5. Insert action items
  for (const item of parsed.action_items || []) {
    await supabase.from('action_items').insert({
      household_id: household.id,
      source_email_id: emailId,
      title: item.title,
      description: item.description,
      details_url: item.details_url,
      due_date: item.due_date,
      priority: item.priority,
      category: item.category,
    });
  }

  // 6. Send per-email summary IF action_required or informational with dates
  const shouldNotify =
    parsed.classification === 'action_required' ||
    (parsed.classification === 'informational' && parsed.school_events?.length > 0);

  if (shouldNotify && resend) {
    await sendPerEmailSummary(household, email, parsed);
  }
}

async function sendPerEmailSummary(household: any, email: any, parsed: any) {
  if (!resend) return;

  const urgencyBadge =
    parsed.classification === 'action_required' ? '⚡ Action needed' : 'ℹ️ Heads up';

  // Everything below is derived from a forwarded email (or the model's read
  // of one) and is untrusted — escape all free text before it goes into
  // HTML you'll actually open. start_date/start_time/due_date are already
  // format-validated in normalizeParsedOutput so are safe to embed as-is;
  // details_url is already restricted to https by safeHttpsUrl but still
  // gets escaped defensively as an attribute value.
  const eventsHtml = (parsed.school_events || [])
    .map(
      (e: any) =>
        `<li><strong>${escapeHtml(e.title)}</strong> — ${e.start_date}${e.start_time ? ` at ${e.start_time}` : ''}${e.location ? `, ${escapeHtml(e.location)}` : ''}</li>`
    )
    .join('');

  const actionsHtml = (parsed.action_items || [])
    .map(
      (a: any) =>
        `<li><strong>${escapeHtml(a.title)}</strong>${a.due_date ? ` (due ${a.due_date})` : ''}${a.details_url ? ` — <a href="${escapeHtml(a.details_url)}">link</a>` : ''}</li>`
    )
    .join('');

  const html = `
    <p>${urgencyBadge} — from ${escapeHtml(parsed.source_name || email.from_name || email.from_address)}</p>
    <p>${escapeHtml(parsed.summary)}</p>
    ${eventsHtml ? `<p><strong>Dates:</strong></p><ul>${eventsHtml}</ul>` : ''}
    ${actionsHtml ? `<p><strong>To do:</strong></p><ul>${actionsHtml}</ul>` : ''}
    <hr/>
    <p style="color:#888;font-size:12px">Original subject: ${escapeHtml(email.subject)}</p>
  `;

  await resend.emails.send({
    from: 'House Chief of Staff <chief@yourdomain.com>',
    to: household.digest_email,
    subject: `${urgencyBadge}: ${email.subject}`,
    html,
  });

  await supabase.from('notifications_sent').insert({
    household_id: household.id,
    kind: 'per_email',
    subject: email.subject,
    body_preview: parsed.summary,
    related_email_id: email.id,
  });
}
