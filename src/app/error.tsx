'use client';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { Suspense, useState } from 'react';
import { beginRoute, RouteErrorState, useRouteReadiness } from '@/components/layout/RouteExperience';

function ErrorSignal({ retrying }: { retrying: boolean }) {
  useRouteReadiness(retrying, !retrying);
  return null;
}

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [attemptedError, setAttemptedError] = useState<Error | null>(null);
  return <><Suspense fallback={null}><ErrorSignal retrying={attemptedError === error} /></Suspense><RouteErrorState message="요청한 페이지를 표시하지 못했습니다. 잠시 후 다시 시도해주세요." onRetry={() => { if (attemptedError === error) return; setAttemptedError(error); beginRoute(window.location.href); retry(); }} /></>;
}
