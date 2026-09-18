'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { STARTUP_TIMEOUT } from '@/lib/routeExperience';
import '@/styles/route-experience.css';

function StartupStatus({ sessionChecked, regionReady }: { sessionChecked: boolean; regionReady: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expired, setExpired] = useState(false);
  const skip = /^\/(master|admin)(\/|$)/.test(pathname) || searchParams.get('compact') === '1' || searchParams.get('embed') === '1';
  const ready = sessionChecked && regionReady;

  useEffect(() => {
    if (ready || skip) return;
    const timer = window.setTimeout(() => setExpired(true), STARTUP_TIMEOUT);
    return () => window.clearTimeout(timer);
  }, [ready, skip]);

  if (ready || skip) return null;
  if (expired) return <p role="status" className="startup-deferred">기본 화면을 먼저 열었습니다. {!sessionChecked ? '로그인 상태' : '지역 설정'}를 계속 확인하고 있습니다.</p>;
  return <div className="startup-experience" role="status" aria-live="polite">
    <div><p className="startup-wordmark">GYOPO</p><p className="startup-label">START</p><p>로그인 상태와 지역 설정을 확인하고 있습니다.</p><span className="startup-line" aria-hidden="true" /></div>
  </div>;
}

export default function StartupExperience({ children, sessionChecked, regionReady }: { children: ReactNode; sessionChecked?: boolean; regionReady?: boolean; ready?: boolean }) {
  // The legacy root appruntime.tsx has no region-readiness contract; keep its pass-through behavior.
  return <>{children}<Suspense fallback={null}>{sessionChecked !== undefined && regionReady !== undefined && <StartupStatus sessionChecked={sessionChecked} regionReady={regionReady} />}</Suspense></>;
}
