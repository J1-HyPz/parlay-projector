import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

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
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[.15em] text-violet-300">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-[28px]">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-white/45">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, icon: Icon, note }: { label: string; icon: LucideIcon; note?: string }) {
  return (
    <article className="panel flex min-h-28 items-center justify-between p-4">
      <div>
        <p className="text-xs text-white/42">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-white/75">--</p>
        {note ? <p className="mt-1 text-[10px] text-white/27">{note}</p> : <span className="mt-2 block h-1.5 w-20 rounded-full bg-white/[.06]" />}
      </div>
      <span className="grid size-10 place-items-center rounded-xl border border-violet-400/15 bg-violet-500/[.08] text-violet-300">
        <Icon className="size-[18px]" />
      </span>
    </article>
  );
}

export function PlaceholderLine({ className = '' }: { className?: string }) {
  return <span className={`placeholder-line block ${className}`} />;
}

export function TeamPlaceholder({ label = 'Team placeholder' }: { label?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/9 bg-white/[.04] text-[9px] text-white/32">--</span>
      <span className="truncate text-sm text-white/68">{label}</span>
    </div>
  );
}

export function SectionHeading({ title, link }: { title: string; link?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {link && <span className="text-xs text-violet-300">{link}</span>}
    </div>
  );
}
