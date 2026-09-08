/**
 * The filter chip, and the row it lives in.
 *
 * Schedule and Live each had their own copy, and Live's had grown a fourth
 * visual state the Schedule did not know about. The row itself is the more
 * interesting half: seventeen competitions never fit one line on a phone, and
 * a row that can only scroll hides most of what the application tracks at
 * every screen size.
 *
 * So `.chip-row` scrolls below `md` -- with a fade at the right edge, so it is
 * visible that there is more -- and wraps above it, where the whole set fits
 * and is worth seeing at once. The Live page in particular exists to say which
 * sports are followed; a set you have to drag through does not say it.
 */

import type { ReactNode } from 'react';

export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <fieldset className="chip-row border-0 p-0 m-0">
      <legend className="sr-only">{label}</legend>
      {children}
    </fieldset>
  );
}

export interface ChipProps {
  /** Pressed state. Renders as `aria-pressed`, not as colour alone. */
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /**
   * Present for information rather than as a choice: a sport the application
   * does not track, or one with nothing to show. Disabled, and styled so it
   * does not compete with a chip that would actually do something.
   */
  inert?: boolean;
  /** Decorative sport mark. Hidden from assistive technology -- the label carries it. */
  emoji?: string;
  /** Accessible name, when the visible label is abbreviated. */
  ariaLabel?: string;
  title?: string;
  /** A tally, e.g. how many games this chip would show. */
  count?: ReactNode;
  /** Tone for the count: emphasised when the chip has something live. */
  countTone?: 'default' | 'active';
}

export function Chip({
  active,
  onClick,
  children,
  inert = false,
  emoji,
  ariaLabel,
  title,
  count,
  countTone = 'default',
}: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title}
      disabled={inert}
      onClick={onClick}
      className={`chip ${active ? 'chip-on' : inert ? 'chip-inert' : 'chip-off'}`}
    >
      {emoji && (
        <span aria-hidden="true" className="text-2xs">
          {emoji}
        </span>
      )}
      {children}
      {count !== undefined && (
        <span
          className={`tabular-nums ${
            active
              ? 'text-white'
              : inert
                ? 'text-ink-disabled'
                : countTone === 'active'
                  ? 'text-violet-300'
                  : 'text-ink-faint'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
