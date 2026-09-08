/**
 * Page chrome shared by every route.
 *
 * The dead placeholder pieces that used to live here -- a StatCard that always
 * rendered `--` and a TeamPlaceholder that rendered "Team placeholder" -- are
 * gone. Both were left over from before the data was real, neither was
 * imported anywhere, and a component whose whole job is to display a fake
 * value is a liability in an application with a rule against fabricating them.
 * The live StatCard is components/ui/stat-card.tsx.
 */

import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <p className="mb-2 text-2xs font-semibold uppercase tracking-[.15em] text-violet-300">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] text-ink-strong sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-xs leading-6 text-ink-subtle sm:text-sm">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function PlaceholderLine({ className = '' }: { className?: string }) {
  return <span className={`placeholder-line block ${className}`} />;
}

/**
 * A section title, and optionally a link out of it.
 *
 * The link used to be a `<span>`. It was styled as a link, sat where a link
 * sits, said "View schedule" -- and did nothing when clicked. Either it goes
 * somewhere or it should not look like it does, so `href` is now required
 * alongside the label and it renders as an anchor.
 */
export function SectionHeading({
  title,
  href,
  linkLabel,
  id,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  id?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <h2 id={id} className="text-base font-semibold tracking-tight text-ink-strong">
        {title}
      </h2>
      {href && linkLabel && (
        <a
          href={href}
          className="focus-ring shrink-0 rounded-lg px-1 py-1 text-xs text-violet-300 transition hover:text-violet-200"
        >
          {linkLabel}
        </a>
      )}
    </div>
  );
}
