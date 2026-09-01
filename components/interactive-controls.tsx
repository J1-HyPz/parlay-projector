'use client';

import { useState } from 'react';

export function SportFilters({ compact = false }: { compact?: boolean }) {
  const sports = ['All', 'NFL', 'NBA', 'MLB', 'NHL', 'Football', 'Tennis'];
  const [selected, setSelected] = useState('All');

  return (
    <div className="horizontal-cards" aria-label="Sport filters">
      {sports.map((sport) => (
        <button
          key={sport}
          type="button"
          aria-pressed={selected === sport}
          onClick={() => setSelected(sport)}
          className={`shrink-0 rounded-xl border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${compact ? 'min-h-9' : 'min-h-10'} ${selected === sport ? 'border-violet-500 bg-violet-600 text-white hover:bg-violet-500' : 'border-white/9 bg-white/[.02] text-white/48 hover:bg-white/[.05] hover:text-white'}`}
        >
          {sport}
        </button>
      ))}
    </div>
  );
}

export function FilterSelect({ label, items }: { label: string; items: string[] }) {
  return (
    <select
      aria-label={label}
      defaultValue={items[0]}
      className="h-10 min-w-28 rounded-xl border border-white/9 bg-[#0f0d17] px-3 text-xs text-white/55 outline-none focus:border-violet-400/40"
    >
      {items.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
  );
}

const riskOptions = [
  { key: 'low', title: 'Low Risk', description: 'Higher predicted confidence.' },
  { key: 'medium', title: 'Medium Risk', description: 'Balanced confidence and projected return.' },
  { key: 'high', title: 'High Risk', description: 'Larger projected return potential.' },
];

export function RiskSelector() {
  const [selected, setSelected] = useState('low');

  return (
    <div className="grid gap-3 md:grid-cols-3" aria-label="Risk level">
      {riskOptions.map((risk) => (
        <button
          key={risk.key}
          type="button"
          aria-pressed={selected === risk.key}
          onClick={() => setSelected(risk.key)}
          className={`min-h-24 rounded-2xl border p-4 text-left transition ${selected === risk.key ? 'border-violet-400/45 bg-violet-500/[.12] shadow-[0_0_0_1px_rgba(139,92,246,.08)]' : 'border-white/[.085] bg-white/[.025] hover:border-violet-400/25'}`}
        >
          <span className="flex items-center gap-2 text-sm font-semibold"><span className={`size-2 rounded-full ${selected === risk.key ? 'bg-violet-400' : 'bg-white/20'}`} />{risk.title}</span>
          <span className="mt-2 block text-xs leading-5 text-white/38">{risk.description}</span>
        </button>
      ))}
    </div>
  );
}
