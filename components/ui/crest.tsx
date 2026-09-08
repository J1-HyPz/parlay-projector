'use client';

/**
 * A team badge, or a race's competition mark.
 *
 * Three jobs, none of which the bare `<img>` it replaces was doing:
 *
 *  1. **It reserves its box.** A remote crest that sizes itself on arrival
 *     shifts every row beneath it. The box is fixed by CSS before any network
 *     request finishes, so a list of twenty fixtures does not reflow as the
 *     provider's CDN answers.
 *
 *  2. **It fails to something readable.** These come from an external CDN and
 *     some of them 404. A broken-image glyph said nothing; the initials say
 *     which team it was.
 *
 *  3. **It is decorative.** The team's name is always beside it in text, so
 *     the image is `alt=""` and the fallback is `aria-hidden`. A screen reader
 *     that announced "Aston Villa" twice per row would be worse, not better.
 */

import { useState } from 'react';

const SIZES = {
  /** Inline with a line of text, in the hub tables and result lists. */
  xs: 'size-5 text-[8px]',
  sm: 'size-7 text-2xs',
  md: 'size-8 text-2xs',
  lg: 'size-10 text-xs',
  xl: 'size-16 text-xs md:size-20 md:text-sm',
} as const;

export type CrestSize = keyof typeof SIZES;

/**
 * Up to two letters, which is what fits. Prefers initials of separate words
 * ("Aston Villa" gives AV) and falls back to the opening letters of a single
 * word ("Barcelona" gives BA).
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '--';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * @param bare No enclosing circle: the logo sits directly on the surface. Used
 *   in the sport hubs, where crests appear inline in dense tables and a ring
 *   around each one would be louder than the data. The fallback is a plain
 *   disc rather than initials -- two letters are not legible at 20px.
 */
export function Crest({
  name,
  logo,
  size = 'md',
  bare = false,
  className = '',
}: {
  name: string;
  logo?: string | null;
  size?: CrestSize;
  bare?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = bare
    ? `grid shrink-0 place-items-center overflow-hidden ${SIZES[size]} ${className}`
    : `crest ${SIZES[size]} ${className}`;

  if (!logo || failed) {
    return (
      <span aria-hidden="true" className={box}>
        {bare ? <span className="size-full rounded-full bg-surface-3" /> : initialsOf(name)}
      </span>
    );
  }

  return (
    <span aria-hidden="true" className={box}>
      {/* oxlint-disable-next-line nextjs/no-img-element -- remote team badge from
          the sports provider CDN; next/image would need remotePatterns per
          provider and put optimisation in the request path for a decorative
          crest. See components/home/games-today.tsx. */}
      <img
        src={logo}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`size-full object-contain ${bare ? '' : 'p-0.5'}`}
      />
    </span>
  );
}
