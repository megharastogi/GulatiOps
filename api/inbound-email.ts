// /api/inbound-email.ts
// Receives forwarded emails from Cloudflare Email Workers.
// Cloudflare Worker POSTs JSON: { from, to, subject, text, html, headers }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Verify the request actually came from your Cloudflare Worker
function verifySharedSecret(req: VercelRequest): boolean {
  return req.headers['x-cof-secret'] === process.env.INBOUND_SHARED_SECRET;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!verifySharedSecret(req)) return res.status(401).end();

  const { from, fromName, to, subject, text, html, headers } = req.body;

  // For single-household MVP, resolve household by the `to` address
  const { data: household } = await supabase
    .from('households')
    .select('*')
    .eq('digest_email', process.env.PRIMARY_DIGEST_EMAIL!)
    .single();

  if (!household) return res.status(500).json({ error: 'no household configured' });

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
    return res.status(500).json({ error: 'insert failed' });
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

  return res.status(200).json({ ok: true, email_id: emailRow.id });
}

function extractLinks(html: string): string[] {
  const matches = [...html.matchAll(/href=["'](https?:\/\/[^"'\s>]+)["']/gi)];
  return [...new Set(matches.map((m) => m[1]))]
    .filter((url) => !/(unsubscribe|optout|pixel|beacon|open\.php|mailto)/i.test(url))
    .slice(0, 3);
}

async function fetchNewsletterContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return '';
    const html = await res.text();
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 4000);
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
    .map((c, i) => c ? `\nLinked page ${i + 1} (${links[i]}):\n${c}` : '')
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
      "event_type": "day_off" | "early_pickup" | "late_start" | "event" | "fundraiser" | "spirit_day" | "conference",
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
  const parsed = JSON.parse(rawText);

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
  const urgencyBadge =
    parsed.classification === 'action_required' ? '⚡ Action needed' : 'ℹ️ Heads up';

  const eventsHtml = (parsed.school_events || [])
    .map(
      (e: any) =>
        `<li><strong>${e.title}</strong> — ${e.start_date}${e.start_time ? ` at ${e.start_time}` : ''}${e.location ? `, ${e.location}` : ''}</li>`
    )
    .join('');

  const actionsHtml = (parsed.action_items || [])
    .map(
      (a: any) =>
        `<li><strong>${a.title}</strong>${a.due_date ? ` (due ${a.due_date})` : ''}${a.details_url ? ` — <a href="${a.details_url}">link</a>` : ''}</li>`
    )
    .join('');

  const html = `
    <p>${urgencyBadge} — from ${parsed.source_name || email.from_name || email.from_address}</p>
    <p>${parsed.summary}</p>
    ${eventsHtml ? `<p><strong>Dates:</strong></p><ul>${eventsHtml}</ul>` : ''}
    ${actionsHtml ? `<p><strong>To do:</strong></p><ul>${actionsHtml}</ul>` : ''}
    <hr/>
    <p style="color:#888;font-size:12px">Original subject: ${email.subject}</p>
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
