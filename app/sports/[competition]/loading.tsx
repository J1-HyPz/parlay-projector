/**
 * Hub loading state.
 *
 * Mirrors the real layout -- header, section nav, summary cards, two columns --
 * so the page does not jump when data arrives.
 */

export default function LoadingSportHub() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading competition">
      <div className="border-b border-white/8 pb-5">
        <div className="h-8 w-56 rounded-lg bg-white/[.06]" />
        <div className="mt-3 h-4 w-72 rounded bg-white/[.04]" />
      </div>

      <div className="mt-4 flex gap-2">
        {[0, 1, 2, 3, 4, 5].map((chip) => (
          <div key={chip} className="h-9 w-20 rounded-xl bg-white/[.04]" />
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <div key={card} className="h-[86px] rounded-2xl bg-white/[.035]" />
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-2">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="h-24 rounded-xl bg-white/[.035]" />
          ))}
        </div>
        <div className="h-72 rounded-2xl bg-white/[.035]" />
      </div>
    </div>
  );
}
