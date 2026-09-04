'use client';

import { useState } from 'react';
import type { Brief } from '@/lib/brief';

/**
 * The brief, plus a way to get it off the screen and into a message. Copying
 * is the whole point of writing it in this shape — a class parent forwards
 * this, they don't screenshot a dashboard.
 *
 * Client-side only for the clipboard; the text itself is composed on the
 * server so what gets copied is exactly what is rendered.
 */
export default function BriefCard({ brief, text }: { brief: Brief; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations (an
      // insecure origin, a browser that wants a different gesture). Say so
      // rather than showing a button that silently does nothing.
      setCopied(false);
      alert('Copy failed — select the text and copy it by hand.');
    }
  }

  const sections: [string, typeof brief.ask][] = [
    ['Ask', brief.ask],
    ['This week', brief.thisWeek],
    ['Looking ahead', brief.lookingAhead],
  ];

  return (
    <div className="card brief">
      <div className="brief-head">
        <h2 className="brief-title">The brief</h2>
        <button type="button" className="btn-secondary brief-copy" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy as text'}
        </button>
      </div>

      {sections.map(([title, entries]) =>
        entries.length ? (
          <section key={title} className="brief-section">
            <h3 className="brief-section-title">{title}</h3>
            <ul className="brief-list">
              {entries.map((e, i) => (
                <li key={i}>
                  {e.when && <span className="brief-when">{e.when}</span>}
                  <span className="brief-what">{e.what}</span>
                  {e.detail && <span className="brief-detail">{e.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
        ) : null
      )}
    </div>
  );
}
