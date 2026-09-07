export const control =
  'min-h-10 rounded-lg border border-white/15 bg-[#15121e] px-3 py-2 text-sm text-white/85 focus-visible:outline-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-40';
export const action =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-violet-400/25 bg-violet-500/15 px-3 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/25 focus-visible:outline-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-40';
export function displayTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not supplied';
  return new Date(value).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
