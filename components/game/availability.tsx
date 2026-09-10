'use client';

/**
 * Who is and is not playing.
 *
 * Three states, kept strictly apart, because collapsing any two of them would
 * mislead in a way this application treats as the same failure as inventing a
 * number:
 *
 *   The provider publishes nothing for this competition — say so, and name the
 *   competition. Every football fixture is here.
 *
 *   The provider covers it and reports nobody missing — that is a real finding
 *   and reads as good news, not as a gap.
 *
 *   The provider lists players — show them, worst news first.
 *
 * Nothing here is a prediction. A status is what the provider said, in the
 * provider's own words where it has any, and this component adds no judgement
 * about what an absence is worth. That question needs player statistics this
 * application does not have.
 */

import { Stethoscope } from 'lucide-react';
import type {
  AvailabilityStatus,
  PlayerAvailability,
  ProbableStarter,
  TeamAvailability,
} from '@/lib/games/availability-normalise';
import type { GameDetail } from '@/lib/games/types';
import { EmptyNote } from '@/components/ui/states';
import { Section } from './game-sections';

/**
 * How each status reads.
 *
 * `available` is deliberately quiet rather than green: the player is on the
 * report for a reason, and a reassuring tick would overstate it. `listed` is
 * the same quiet treatment for a status this application does not recognise —
 * the provider's own label carries the meaning instead.
 */
const TONE: Record<AvailabilityStatus, { label: string; className: string }> = {
  out: { label: 'Out', className: 'border-rose-400/25 bg-rose-500/10 text-status-bad' },
  suspended: { label: 'Suspended', className: 'border-rose-400/25 bg-rose-500/10 text-status-bad' },
  personal: { label: 'Personal', className: 'border-rose-400/25 bg-rose-500/10 text-status-bad' },
  doubtful: { label: 'Doubtful', className: 'border-amber-400/25 bg-amber-500/10 text-status-warn' },
  questionable: {
    label: 'Questionable',
    className: 'border-amber-400/25 bg-amber-500/10 text-status-warn',
  },
  day_to_day: {
    label: 'Day to day',
    className: 'border-amber-400/25 bg-amber-500/10 text-status-warn',
  },
  available: { label: 'Expected to play', className: 'border-line bg-surface-2 text-ink-subtle' },
  listed: { label: 'Listed', className: 'border-line bg-surface-2 text-ink-subtle' },
};

function Player({ player }: { player: PlayerAvailability }) {
  const tone = TONE[player.status];

  return (
    <li className="flex items-start justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-ink">
          {player.name}
          {player.position && (
            <span className="ml-1.5 font-normal text-ink-faint">{player.position}</span>
          )}
        </span>
        {/*
          What is wrong, and when they are expected back — both the provider's,
          neither this application's. Omitted entirely when it does not say,
          rather than filled with a guess or a dash.
        */}
        {player.detail && (
          <span className="mt-0.5 block text-2xs leading-4 text-ink-faint">{player.detail}</span>
        )}
        {player.expected_return && (
          <span className="mt-0.5 block text-2xs leading-4 text-ink-faint">
            Expected back {player.expected_return}
          </span>
        )}
      </span>

      <span className="shrink-0 text-right">
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-2xs font-semibold ${tone.className}`}
        >
          {tone.label}
        </span>
        {/*
          The provider's own label, when it says something the normalised
          status does not — "10-day IL" is a more precise fact than "Out", and
          flattening it away would lose information the reader can use.
        */}
        {player.provider_status &&
          // Case-insensitively: the provider sends a bare lowercase "out"
          // beside a badge already reading "Out", and repeating it says
          // nothing.
          player.provider_status.toLowerCase() !== tone.label.toLowerCase() && (
            <span className="mt-1 block text-2xs text-ink-faint">{player.provider_status}</span>
          )}
      </span>
    </li>
  );
}

function Starter({ starter }: { starter: ProbableStarter }) {
  return (
    <p className="flex items-baseline justify-between gap-3 rounded-xl border border-violet-400/15 bg-violet-500/[.06] px-3 py-2">
      <span className="min-w-0">
        {/*
          The provider's word is "probable", so the reader's word is "probable".
          Nothing here is presented as a confirmed team sheet.
        */}
        <span className="block text-2xs uppercase tracking-wider text-violet-300/80">
          {starter.role}
        </span>
        <span className="mt-0.5 block truncate text-xs font-medium text-ink">{starter.name}</span>
      </span>
      {starter.position && (
        <span className="shrink-0 text-2xs text-ink-faint">{starter.position}</span>
      )}
    </p>
  );
}

function TeamColumn({
  name,
  team,
  probables,
}: {
  name: string;
  team: TeamAvailability;
  probables: ProbableStarter[];
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 truncate text-2xs font-semibold uppercase tracking-wider text-ink-faint">
        {name}
      </p>

      {probables.length > 0 && (
        <div className="mb-3 space-y-2">
          {probables.map((starter) => (
            <Starter key={starter.id ?? starter.name} starter={starter} />
          ))}
        </div>
      )}

      {team.players.length === 0 ? (
        // A real finding, not a gap: the provider covers this fixture and is
        // reporting nobody. Worded so it cannot be read as a failed load.
        <EmptyNote>No absences reported.</EmptyNote>
      ) : (
        <ul>
          {team.players.map((player) => (
            <Player key={player.id ?? player.name} player={player} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function Availability({ game }: { game: GameDetail }) {
  const availability = game.availability;

  return (
    <Section title="Availability" icon={Stethoscope}>
      {availability === null ? (
        <EmptyNote>
          {/*
            Named, not vague. "Unavailable" alone reads as a fault on this
            application's side; saying which competition and that the gap is
            the source's makes it a fact about coverage.
          */}
          No availability data is published for {game.league ?? 'this competition'}. This is a gap
          in the source, not a problem loading the page.
        </EmptyNote>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <TeamColumn
              name={game.home_team.name}
              team={availability.home}
              probables={availability.probables.home}
            />
            <TeamColumn
              name={game.away_team.name}
              team={availability.away}
              probables={availability.probables.away}
            />
          </div>

          {/*
            The list is the provider's fixture report, which is a selection
            rather than a full squad audit. Saying so once is the difference
            between reporting what the source said and claiming completeness
            it never offered.
          */}
          <p className="mt-4 border-t border-line pt-3 text-2xs leading-5 text-ink-faint">
            The provider&rsquo;s injury report for this fixture, most serious first. It is not a
            complete squad list, and a status can change up to kick-off.
          </p>
        </>
      )}
    </Section>
  );
}
