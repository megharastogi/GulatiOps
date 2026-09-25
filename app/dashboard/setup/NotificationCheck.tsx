'use client';

// Whether this device could receive a weekly notification, if we sent one.
//
// Nothing sends push yet — there is no service worker and no VAPID key. This
// only answers the question that has to be answered first: on THIS phone, in
// THIS context, would push work at all? On iOS the answer is no unless the
// app was opened from the home screen icon, and that failure is silent —
// a notifications toggle in a Safari tab would just never fire.
//
// Runs in an effect rather than during render: every check below reads
// browser state that does not exist on the server, so doing it inline would
// mismatch hydration.

import { useEffect, useState } from 'react';

type Check = {
  label: string;
  ok: boolean | null; // null = could not determine
  detail: string;
};

export function NotificationCheck() {
  const [checks, setChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    async function run() {
      const result: Check[] = [];

      // 1. Standalone. The one that actually catches people out: iOS refuses
      //    push to a Safari tab, with no error and no prompt.
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true;
      result.push({
        label: 'Opened from the home screen',
        ok: standalone,
        detail: standalone
          ? 'Running as an installed app.'
          : 'This is a browser tab. On iPhone, notifications only work when the app is opened from its home screen icon — Share → Add to Home Screen, then open that icon and come back here.',
      });

      // 2-3. The APIs themselves. Present on modern iOS and Android; absent
      //      in odd contexts like an in-app webview (Instagram, Gmail).
      const hasSW = 'serviceWorker' in navigator;
      const hasPush = 'PushManager' in window;
      result.push({
        label: 'Browser supports push',
        ok: hasSW && hasPush,
        detail:
          hasSW && hasPush
            ? 'Service worker and push are both available.'
            : 'This browser does not expose push. If you opened this from inside another app, try opening it in Safari or Chrome instead.',
      });

      // 4. Permission. Note "default" is not a failure — it means we have
      //    simply never asked. Asking is a separate, deliberate tap later.
      const hasNotification = 'Notification' in window;
      const permission = hasNotification ? Notification.permission : null;
      result.push({
        label: 'Notification permission',
        ok: permission === 'denied' ? false : permission === 'granted' ? true : null,
        detail:
          permission === 'granted'
            ? 'Already granted.'
            : permission === 'denied'
              ? 'Blocked. iOS will not ask again — turn it back on in Settings → Notifications, under this app’s name.'
              : 'Not asked yet. That is expected — nothing has requested it.',
      });

      // 5. Is anything actually subscribed? Will be "no" until push is built;
      //    included so this page keeps telling the truth afterwards.
      if (hasSW) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = reg ? await reg.pushManager?.getSubscription() : null;
          result.push({
            label: 'Subscribed to weekly notifications',
            ok: Boolean(sub),
            detail: sub
              ? 'This device is registered to receive them.'
              : 'Not yet — weekly notifications have not been built.',
          });
        } catch {
          result.push({
            label: 'Subscribed to weekly notifications',
            ok: false,
            detail: 'Could not read the subscription state.',
          });
        }
      }

      // 6. Home screen icon. Unrelated to push, but this is the page where
      //    "why is my icon a screenshot of the page" gets answered: the
      //    manifest points at /icons/, and nothing has been put there.
      try {
        const res = await fetch('/icons/icon-192.png', { method: 'HEAD' });
        result.push({
          label: 'Home screen icon',
          ok: res.ok,
          detail: res.ok
            ? 'Icon file is being served.'
            : 'Missing. The app still installs, but iOS falls back to a screenshot of the page for the icon.',
        });
      } catch {
        result.push({ label: 'Home screen icon', ok: null, detail: 'Could not check.' });
      }

      setChecks(result);
    }

    run();
  }, []);

  if (!checks) {
    return (
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        Checking…
      </p>
    );
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {checks.map((check) => (
        <li key={check.label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span aria-hidden style={{ lineHeight: '20px', flexShrink: 0 }}>
            {check.ok === true ? '✓' : check.ok === false ? '✗' : '–'}
          </span>
          <span>
            <span style={{ fontSize: 14 }}>{check.label}</span>
            <span className="muted" style={{ display: 'block', fontSize: 13 }}>
              {check.detail}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
