// /lib/newsletter.ts
// Pulling the linked newsletter behind a school email into the parser prompt.
//
// School platforms (Alma, Smore, Peachjar) send a stub email whose entire
// content is "check out this week's newsletter" plus a link. Everything the
// parser needs — dates, forms, deadlines — is on the other side of it.

// Query params that identify the recipient rather than the content. These are
// dropped before a URL is handed to a third party; anything else is kept,
// because plenty of newsletters put the article id in the query string.
const IDENTITY_PARAM =
  /^(utm_|mc_|_hs|vero_|pk_|ck_|mkt_)|^(e|email|recipient|recipient_id|subscriber|subscriber_id|uid|user|user_id|contact|contact_id|token|auth|key|sig|signature)$/i;

export function stripIdentityParams(url: URL): URL {
  for (const name of [...url.searchParams.keys()]) {
    if (IDENTITY_PARAM.test(name)) url.searchParams.delete(name);
  }
  return url;
}

// These URLs come out of forwarded email, so they're attacker-influenced. We
// follow them ourselves now (see resolveTrackingUrl), which means refusing
// anything that could point back inside our own network.
export function isSafeFetchTarget(url: URL): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return false;
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return false;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false; // cloud metadata
  }
  return true;
}

/**
 * Follows the redirect chain to the real destination.
 *
 * Newsletter links in school email are almost always click-tracking wrappers
 * (Mandrill, SendGrid, Mailchimp) where the real destination is encoded *in
 * the query string*. Stripping params before fetching — which is what this
 * code used to do — turns those into a 400 and loses the whole newsletter.
 *
 * Following the redirect does register a click with the tracker. That's
 * acceptable: the tracker issued the token and already knows the recipient.
 * What's worth protecting is not handing that token to Jina, and stripping
 * the *resolved* URL still does that.
 */
export async function resolveTrackingUrl(
  url: string,
  maxHops = 5
): Promise<string | null> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }

  for (let hop = 0; hop < maxHops; hop++) {
    if (!isSafeFetchTarget(current)) return null;

    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Unreachable or timed out — hand back what we have and let the reader
      // try it; a dead link costs us an empty string, not an exception.
      return current.toString();
    }

    if (res.status < 300 || res.status > 399) return current.toString();

    const location = res.headers.get('location');
    if (!location) return current.toString();

    try {
      current = new URL(location, current);
    } catch {
      return current.toString();
    }
  }

  return isSafeFetchTarget(current) ? current.toString() : null;
}

/** Links worth following out of an email body: no tracking pixels, max 3. */
export function extractLinks(html: string): string[] {
  const matches = [...html.matchAll(/href=["'](https?:\/\/[^"'\s>]+)["']/gi)];
  return [...new Set(matches.map((m) => m[1].replace(/&amp;/g, '&')))]
    .filter((url) => !/(unsubscribe|optout|pixel|beacon|open\.php|mailto)/i.test(url))
    .slice(0, 3);
}

/** Readable text of the newsletter behind a link, or '' if it can't be had. */
export async function fetchNewsletterContent(url: string): Promise<string> {
  try {
    const resolved = await resolveTrackingUrl(url);
    if (!resolved) return '';

    const target = stripIdentityParams(new URL(resolved));
    if (!isSafeFetchTarget(target)) return '';

    // Jina Reader renders JS-heavy pages (Smore, Peachjar) to plain text.
    const res = await fetch(`https://r.jina.ai/${target.toString()}`, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return '';
    return (await res.text()).slice(0, 4000);
  } catch {
    return '';
  }
}
