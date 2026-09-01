import { Bell, CircleUserRound, Palette, Shield } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';

export default function ProfilePage() {
  return (
    <AppShell active="profile">
      <PageHeader eyebrow="Prototype" title="Profile" subtitle="Account and preference controls will be introduced in a future release." />
      <section className="mt-6 grid gap-3 md:grid-cols-3">
        {[
          ['Personal details', 'Profile settings placeholder', CircleUserRound],
          ['Notifications', 'Alert preferences placeholder', Bell],
          ['Appearance', 'Interface preferences placeholder', Palette],
        ].map(([title, description, Icon]) => (
          <article key={title as string} className="panel p-5"><Icon className="size-5 text-violet-300" /><h2 className="mt-4 text-sm font-semibold">{title as string}</h2><p className="mt-1.5 text-xs leading-5 text-white/35">{description as string}</p></article>
        ))}
      </section>
      <div className="panel mt-6 flex items-center gap-3 p-5"><span className="grid size-10 place-items-center rounded-xl bg-violet-500/[.08] text-violet-300"><Shield className="size-5" /></span><div><p className="text-xs text-white/34">Parlay Projector</p><p className="mt-1 text-sm font-medium text-white/60">by HyPz</p></div></div>
    </AppShell>
  );
}
