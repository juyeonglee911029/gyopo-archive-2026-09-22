'use client';

import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { REGIONS, regionLabel, regionTimeZone } from '@/lib/regions';
import { useGlobalStore } from '@/store/useGlobalStore';

function formatClock(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

export default function WorldClock({ showRegionSelector = true }: { showRegionSelector?: boolean }) {
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const setSelectedCountry = useGlobalStore((state) => state.setSelectedCountry);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const koreaZone = 'Asia/Seoul';
  const selectedZone = regionTimeZone(selectedCountry);
  const selectedLabel = selectedCountry === 'Global' ? '세계 기준 (UTC)' : regionLabel(selectedCountry);

  return (
    <div className="home-world-clock mt-7 grid min-w-0 gap-2 sm:grid-cols-2">
      <div className="home-clock-card min-w-0 overflow-hidden rounded-2xl border border-teal-300/20 bg-teal-300/[.07] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-[10px] font-black uppercase tracking-[.18em] text-teal-200"><Clock3 size={14} /><span className="truncate">한국 시간</span></div>
        <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2"><strong className="font-display shrink-0 text-xl font-extrabold text-white tabular-nums">{now ? formatClock(now, koreaZone) : '--:--:--'}</strong><span className="min-w-0 truncate text-right text-[11px] text-slate-400">{now ? formatDate(now, koreaZone) : ''}</span></div>
      </div>
      <div className="home-clock-card min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[.05] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-[10px] font-black uppercase tracking-[.18em] text-slate-400"><Clock3 size={14} className="shrink-0 text-cyan-300" /><span className="truncate">선택 지역</span></div>
        {showRegionSelector && <select aria-label="시간을 볼 국가 선택" value={selectedCountry} onChange={(event) => setSelectedCountry(event.target.value)} className="mt-2 w-full min-w-0 max-w-full truncate rounded-lg border border-white/10 bg-white/[.06] px-2 py-1 text-[10px] font-bold tracking-normal text-slate-200 outline-none"><option value="Global">🌐 전체 지역</option>{REGIONS.filter((region) => region.id !== 'Global').map((region) => <option key={region.id} value={region.id}>{region.flag} {region.label}</option>)}</select>}
        <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2"><strong className="font-display shrink-0 text-xl font-extrabold text-white tabular-nums">{now ? formatClock(now, selectedZone) : '--:--:--'}</strong><span className="min-w-0 truncate text-right text-[11px] text-slate-400">{selectedLabel}</span></div>
      </div>
    </div>
  );
}
