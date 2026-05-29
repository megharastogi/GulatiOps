// cloudflare-email-worker.js
// Deploy this as a Cloudflare Email Worker.
// Set up Email Routing: chief@yourdomain.com -> this worker.
// Then forward school emails to chief@yourdomain.com from Gmail filters.

import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    const parser = new PostalMime();
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await parser.parse(raw);

    const payload = {
      from: parsed.from?.address || message.from,
      fromName: parsed.from?.name || '',
      to: message.to,
      subject: parsed.subject || '',
      text: parsed.text || '',
      html: parsed.html || '',
      headers: Object.fromEntries(
        (parsed.headers || []).map((h) => [h.key, h.value])
      ),
    };

    const resp = await fetch(env.VERCEL_INBOUND_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cof-secret': env.INBOUND_SHARED_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      // If our backend is down, let Cloudflare retry by throwing
      throw new Error(`Vercel inbound failed: ${resp.status}`);
    }
  },
};
