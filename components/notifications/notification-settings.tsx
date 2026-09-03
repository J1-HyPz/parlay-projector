'use client';

/**
 * Notification settings, editable in the application.
 *
 * These used to be environment variables, which meant editing the TrueNAS
 * compose file and redeploying to turn an event off. They are now stored
 * alongside the watchlist and re-read by the poller every cycle, so a change
 * takes effect within one interval.
 *
 * The webhook URL is not here, and not editable. It is a credential, the
 * application has no authentication, and anyone able to reach the server could
 * otherwise point the notifications at a channel of their own. The panel
 * reports only whether one is present.
 */

import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, CircleSlash, LoaderCircle, Send } from 'lucide-react';

const EVENT_COPY: Record<string, string> = {
  kickoff: 'A game kicks off',
  final: 'A game finishes, with the final score',
  postponed: 'A game is postponed',
  cancelled: 'A game is cancelled',
};

interface SettingsResponse {
  settings: {
    enabled: boolean;
    events: string[];
    poll_seconds: number;
    max_per_poll: number;
  };
  supported_events: string[];
  limits: { min_poll_seconds: number; max_poll_seconds: number };
  webhook: { configured: boolean; misconfigured: boolean; env_var: string };
  error?: string;
}

type TestState = 'idle' | 'sending' | 'delivered' | 'failed';

function Spinner({ className = '' }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={`motion-safe:animate-spin motion-reduce:animate-none ${className}`}
    />
  );
}

/** A labelled switch. A real button, so it is keyboard-operable by default. */
function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
        checked ? 'border-violet-400/40 bg-violet-600' : 'border-white/12 bg-white/[.06]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export function NotificationSettings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/notifications/settings', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as SettingsResponse;
        if (!controller.signal.aborted) setData(body);
      } catch {
        // Leaves the panel in its loading shape rather than asserting a state
        // it cannot support.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const save = useCallback(
    async (update: Record<string, unknown>) => {
      setSaving(true);
      try {
        const response = await fetch('/api/notifications/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(update),
        });
        if (!response.ok) throw new Error(String(response.status));
        // The server is the authority: it clamps the interval and drops
        // unknown events, so the response is what actually applies.
        setData((await response.json()) as SettingsResponse);
      } catch {
        // Keep the previous view rather than showing a state the server did
        // not confirm.
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const sendTest = useCallback(async () => {
    setTest('sending');
    setTestMessage(null);
    try {
      const response = await fetch('/api/notifications/test', { method: 'POST' });
      const body = (await response.json()) as { delivered?: boolean; message?: string };
      setTest(body.delivered ? 'delivered' : 'failed');
      setTestMessage(body.message ?? null);
    } catch {
      setTest('failed');
      setTestMessage('The request did not complete.');
    }
  }, []);

  if (loading) {
    return (
      <section className="mt-6" aria-busy="true" aria-label="Loading notification settings">
        <div className="h-56 rounded-2xl bg-white/[.035] motion-safe:animate-pulse motion-reduce:animate-none" />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mt-6">
        <output className="block rounded-xl border border-amber-400/20 bg-amber-500/[.06] px-4 py-5 text-sm text-amber-200/80">
          Notification settings could not be loaded.
        </output>
      </section>
    );
  }

  const { settings, webhook } = data;
  const active = new Set(settings.events);
  // Nothing can be sent without a webhook, so the controls say so rather than
  // letting someone configure delivery that cannot happen.
  const locked = !webhook.configured || webhook.misconfigured;

  return (
    <section className="mt-6" aria-labelledby="settings-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="settings-heading" className="text-base font-semibold">
            Settings
          </h2>
          <p className="mt-1 text-xs text-white/34">
            Applied within one poll. No redeploy needed.
          </p>
        </div>
        {saving && <Spinner className="size-4 text-violet-300/70" />}
      </div>

      <div className="panel mt-3 divide-y divide-white/7">
        {/* Master switch */}
        <div className="flex items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/72">Send notifications</p>
            <p className="mt-0.5 text-[11px] text-white/32">
              {locked
                ? 'Requires a webhook in the app environment.'
                : 'Turn off to pause everything without losing your settings.'}
            </p>
          </div>
          <Toggle
            label="Send notifications"
            checked={settings.enabled && !locked}
            disabled={locked || saving}
            onChange={(next) => void save({ enabled: next })}
          />
        </div>

        {/* Per-event switches */}
        {data.supported_events.map((event) => (
          <div key={event} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white/72">{EVENT_COPY[event] ?? event}</p>
            </div>
            <Toggle
              label={EVENT_COPY[event] ?? event}
              checked={active.has(event)}
              disabled={locked || !settings.enabled || saving}
              onChange={(next) => {
                const events = next
                  ? [...settings.events, event]
                  : settings.events.filter((entry) => entry !== event);
                void save({ events });
              }}
            />
          </div>
        ))}

        {/* Interval */}
        <div className="flex items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <label htmlFor="poll-interval" className="text-sm text-white/72">
              Check for changes every
            </label>
            <p className="mt-0.5 text-[11px] text-white/32">
              Shorter means faster alerts and more requests to the data provider.
            </p>
          </div>
          <select
            id="poll-interval"
            value={settings.poll_seconds}
            disabled={locked || saving}
            onChange={(event) => void save({ pollSeconds: Number(event.target.value) })}
            className="min-h-9 shrink-0 rounded-xl border border-white/9 bg-white/[.02] px-3 text-xs text-white/70 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            {[60, 120, 300, 600, 1800, 3600].map((seconds) => (
              <option key={seconds} value={seconds} className="bg-[#0e0c15]">
                {seconds < 3600 ? `${seconds / 60} min` : '1 hour'}
              </option>
            ))}
          </select>
        </div>

        {/* Proof of delivery */}
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/72">Test the connection</p>
            <p className="mt-0.5 text-[11px] text-white/32">
              Posts one message now. The only way to prove the whole path works.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={locked || test === 'sending'}
            className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-xl border border-white/9 bg-white/[.02] px-3 text-xs text-white/60 transition hover:bg-white/[.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            {test === 'sending' ? <Spinner className="size-3.5" /> : <Send className="size-3.5" aria-hidden="true" />}
            Send test
          </button>

          <output aria-live="polite" className="w-full text-[11px]">
            {test === 'delivered' && (
              <span className="flex items-center gap-1.5 text-emerald-300">
                <CircleCheck className="size-3.5" aria-hidden="true" />
                Delivered — check your Discord channel.
              </span>
            )}
            {test === 'failed' && (
              <span className="flex items-center gap-1.5 text-amber-300">
                <CircleAlert className="size-3.5" aria-hidden="true" />
                {testMessage ?? 'Not delivered.'}
              </span>
            )}
          </output>
        </div>
      </div>

      {data.error === 'settings_not_persisted' && (
        <output className="mt-3 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/[.06] px-4 py-3 text-[11px] text-amber-200/80">
          <CircleSlash className="size-3.5 shrink-0" aria-hidden="true" />
          Saved for now, but not written to disk — the data directory is not writable, so this
          will reset on restart.
        </output>
      )}
    </section>
  );
}
