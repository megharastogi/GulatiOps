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
// The href regex can't tell an <a> from a <link rel="stylesheet">, so a
// newsletter that pulls a webfont offered fonts.googleapis.com as one of its
// three links — handed to Jina to "read", and now offered to a reader as
// something to click. Anything that is plainly an asset is dropped.
const ASSET_URL =
  /\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)($|[?#])|^https?:\/\/fonts\.(googleapis|gstatic)\.com\//i;

export function extractLinks(html: string): string[] {
  const matches = [...html.matchAll(/href=["'](https?:\/\/[^"'\s>]+)["']/gi)];
  return [...new Set(matches.map((m) => m[1].replace(/&amp;/g, '&')))]
    .filter((url) => !/(unsubscribe|optout|pixel|beacon|open\.php|mailto)/i.test(url))
    .filter((url) => !ASSET_URL.test(url))
    .slice(0, 3);
}

export type FetchedNewsletter = {
  /** Where the content actually came from, after the tracking hops. */
  url: string | null;
  /** Readable text of the page, or '' if it couldn't be had. */
  content: string;
};

/**
 * The newsletter behind a link, and the URL it turned out to live at.
 *
 * The resolved URL is returned rather than discarded because the caller needs
 * to recognise it later: the parser reads this page and will happily offer
 * its address as an action item's "details" link, which sends you back to the
 * newsletter you already read instead of to the form you need to fill in.
 */
export async function fetchNewsletterContent(url: string): Promise<FetchedNewsletter> {
  try {
    const resolved = await resolveTrackingUrl(url);
    if (!resolved) return { url: null, content: '' };

    const target = stripIdentityParams(new URL(resolved));
    if (!isSafeFetchTarget(target)) return { url: null, content: '' };

    // Jina Reader renders JS-heavy pages (Smore, Peachjar) to plain text.
    const res = await fetch(`https://r.jina.ai/${target.toString()}`, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { url: target.toString(), content: '' };
    return { url: target.toString(), content: (await res.text()).slice(0, 4000) };
  } catch {
    return { url: null, content: '' };
  }
}

/**
 * Hosts that exist to publish bulletins. A page here is something a family
 * *reads*; it is never where a form gets filled in or a fee gets paid, so it
 * is never the right answer to "where does this task get done".
 *
 * Deliberately excludes school portals (Alma, FinalSite, TeamSideline) even
 * though those also send stub email: a portal page is a plausible
 * destination, and dropping one costs more than a wrong link does.
 */
const BULLETIN_HOSTS = /(^|\.)(smore\.com|peachjar\.com)$/i;

export function isBulletinUrl(url: string): boolean {
  try {
    return BULLETIN_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Origin + path, lowercased, no query, no trailing slash — enough to tell
 * "this is the newsletter again" from "this is the signup form", while
 * ignoring the utm noise that makes two copies of one link look different.
 */
export function urlIdentity(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/**
 * The links in an email, ready to render — the newsletter behind a stub is
 * usually the whole point of the mail, and reading it shouldn't require
 * opening the parser's summary and guessing.
 *
 * The href stays the original: a click-tracking wrapper redirects fine in a
 * browser, and resolving it here would mean a network round trip per email.
 * Only the *label* is improved. These wrappers carry their destination as a
 * path segment —
 *
 *   https://mandrillapp.com/track/click/30193320/app.smore.com?p=...
 *
 * — so the last segment that looks like a hostname is a better answer to
 * "where does this go" than the wrapper's own host. A heuristic, and a safe
 * one: it only ever changes what is displayed.
 */
export function newsletterLinks(html: string): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];

  for (const raw of extractLinks(html)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;

    const hinted = url.pathname
      .split('/')
      .filter((seg) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(seg) && /\.[a-z]{2,}$/i.test(seg))
      .pop();

    out.push({
      href: url.toString(),
      label: (hinted ?? url.hostname).replace(/^www\./, ''),
    });
  }

  // Opaque wrappers from one sender all reduce to the same host, and three
  // buttons reading "tracking.teamsideline.com" give a reader no way to pick.
  const seen = new Map<string, number>();
  for (const link of out) seen.set(link.label, (seen.get(link.label) ?? 0) + 1);
  const used = new Map<string, number>();
  for (const link of out) {
    if ((seen.get(link.label) ?? 0) < 2) continue;
    const n = (used.get(link.label) ?? 0) + 1;
    used.set(link.label, n);
    link.label = `${link.label} (${n})`;
  }

  return out;
}
