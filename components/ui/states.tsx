/**
 * Empty, error and unavailable states.
 *
 * Nine components had grown their own version of "there is nothing here",
 * ranging from a bare sentence in a 120px box to a centred panel with an icon
 * and a retry button. The inconsistency mattered most where it was least
 * visible: an *empty* result and a *failed* request looked identical, so a
 * provider outage read as a quiet day.
 *
 * These three keep them apart:
 *
 *   EmptyState  nothing matched, and that is a fact about the data
 *   ErrorState  we could not find out, and here is how to try again
 *   Unavailable one section of an otherwise working page could not load
 *
 * None of them invent a state. Where a value is legitimately absent the caller
 * still passes `--`; these only decide how absence is framed.
 */

import type { LucideIcon } from 'lucide-react';
import { CircleAlert, Inbox, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Nothing matched.
 *
 * @param hint A second line for what would widen the search. Only pass it when
 *   there is genuinely something the reader can do.
 * @param action A link or button; the caller owns the wording.
 */
export function EmptyState({
  title,
  hint,
  action,
  icon: Icon,
  className = '',
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={`panel flex min-h-[150px] flex-col items-center justify-center gap-2 p-6 text-center ${className}`}
    >
      {Icon && (
        <span
          aria-hidden="true"
          className="mb-1 grid size-10 place-items-center rounded-xl border border-line bg-surface-1 text-ink-subtle"
        >
          <Icon className="size-4" />
        </span>
      )}
      <p className="text-xs text-ink-subtle">{title}</p>
      {hint && <p className="text-2xs text-ink-faint">{hint}</p>}
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  );
}

/**
 * The request failed.
 *
 * Always offers the retry, because unlike an empty result this is a state the
 * reader can act on -- and says the failure is usually temporary, because
 * otherwise the honest "unavailable" reads as "gone".
 */
export function ErrorState({
  title,
  onRetry,
  className = '',
}: {
  title: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`panel flex min-h-[150px] flex-col items-center justify-center gap-3 p-6 text-center ${className}`}
    >
      <span
        aria-hidden="true"
        className="grid size-10 place-items-center rounded-xl border border-amber-400/20 bg-amber-500/[.08] text-status-warn"
      >
        <TriangleAlert className="size-4" />
      </span>
      <p className="text-xs text-ink-subtle">{title}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="button-quiet min-h-9">
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * One section of a working page could not load.
 *
 * Smaller and quieter than ErrorState: the rest of the page is fine, and this
 * should not read as though the whole thing fell over.
 */
export function Unavailable({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div
      className={`panel flex min-h-[120px] w-full items-center justify-center p-4 text-center text-xs text-ink-subtle ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Nothing to show, inside a panel that already has its own chrome.
 *
 * The quietest of the three: a bordered box nested directly inside another
 * bordered box reads as a fault rather than as an absence.
 */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-5 text-ink-subtle">{children}</p>;
}

/**
 * The same two facts, inside a section of a larger page.
 *
 * A whole-page EmptyState in a sidebar section would claim the page is empty
 * when only one block of it is. These are a single row, sized to sit in a
 * list.
 */
export function InlineEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-line bg-surface-1 px-4 py-5 text-sm text-ink-subtle">
      <Inbox aria-hidden="true" className="size-4 shrink-0 text-ink-faint" />
      {children}
    </p>
  );
}

/** Something went wrong in this section only. The rest of the page still works. */
export function InlineError({ children }: { children: ReactNode }) {
  return (
    <output className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/[.06] px-4 py-5 text-sm text-status-warn">
      <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </output>
  );
}

/**
 * A degraded-but-usable banner: stale scores, a partial provider failure.
 *
 * Amber rather than red, and it never replaces the content it sits above --
 * showing something slightly old is better than showing nothing, as long as
 * the page says which it is.
 */
export function StaleNotice({ children }: { children: ReactNode }) {
  return (
    <output
      className="mt-4 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/[.06] px-3 py-2 text-2xs text-status-warn"
    >
      <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </output>
  );
}
