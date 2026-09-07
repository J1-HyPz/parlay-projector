import { Plus } from 'lucide-react';
export function AddToBuilder({
  game,
  className = '',
}: {
  game: { id: string; status: string };
  className?: string;
}) {
  if (game.status !== 'scheduled' && game.status !== 'live') return null;
  return (
    <a
      href={`/builder?game=${encodeURIComponent(game.id)}`}
      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium text-violet-300 hover:bg-violet-500/15 focus-visible:outline-2 focus-visible:outline-violet-400 ${className}`}
    >
      <Plus className="size-3.5" aria-hidden="true" />
      Add to Builder
    </a>
  );
}
