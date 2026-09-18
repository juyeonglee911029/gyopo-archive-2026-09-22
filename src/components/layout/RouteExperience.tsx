'use client';

import { createContext, Suspense, useContext, useEffect, useId, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createRouteExperience, initialRouteState, isRouteBusy, linkDestination, routeKey, ROUTE_START_EVENT } from '@/lib/routeExperience';
import '@/styles/route-experience.css';

export { beginRoute } from '@/lib/routeExperience';

const RouteContext = createContext<ReturnType<typeof createRouteExperience> | null>(null);

function RouteCommit() {
  const experience = useContext(RouteContext);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const destination = routeKey(pathname, searchParams.toString());
  useLayoutEffect(() => { experience?.commit(destination); }, [experience, destination]);
  return null;
}

export function useRouteReadiness(loading: boolean, error = false) {
  const experience = useContext(RouteContext);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const destination = routeKey(pathname, searchParams.toString());
  const id = useId();
  useLayoutEffect(() => { experience?.report(id, { destination, loading, error }); }, [experience, id, destination, loading, error]);
  useLayoutEffect(() => () => { experience?.remove(id); }, [experience, id, destination]);
}

export function RoutePending() {
  useRouteReadiness(true);
  return <RouteSkeleton label="페이지를 불러오는 중입니다." />;
}

export function RouteSkeleton({ label = '목록을 불러오는 중입니다.' }: { label?: string }) {
  return <section className="ui-state route-state route-skeleton" aria-busy="true">
    <p role="status">{label}</p>
    <div aria-hidden="true" className="route-skeleton-lines"><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" /></div>
  </section>;
}

export function RouteErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <section className="ui-state route-state route-error">
    <h2>불러오지 못했습니다</h2><p role="alert">{message}</p>
    <div className="route-state-actions"><button type="button" onClick={onRetry}>다시 시도</button><Link href="/">홈으로</Link></div>
  </section>;
}

export default function RouteExperience({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [retryKey, setRetryKey] = useState(0);
  const [experience] = useState(() => createRouteExperience());
  const state = useSyncExternalStore(experience.subscribe, experience.getSnapshot, () => initialRouteState);
  const busy = isRouteBusy(state);
  const ready = state.phase === 'DATA_READY' || state.phase === 'REVEAL';

  useEffect(() => {
    const onBegin = (event: Event) => {
      const detail = (event as CustomEvent<{ destination: string; accepted: boolean }>).detail;
      detail.accepted = experience.start(detail.destination);
    };
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.closest('[data-route-experience="ignore"]')) return;
      const href = anchor.href;
      const operation = experience.getSnapshot().operation;
      const destination = linkDestination(event, { href, target: anchor.target, download: anchor.hasAttribute('download') }, window.location.href);
      if (!destination) return;
      const pending = experience.getSnapshot();
      if (isRouteBusy(pending) && pending.destination === destination) {
        event.preventDefault();
        return;
      }
      // Next Link prevents the native default itself. Observe in capture, but leave its
      // handlers and href intact. Only a repeated pending target cancels the native default.
      queueMicrotask(() => {
        if (anchor.href === href && experience.getSnapshot().operation === operation) experience.start(destination);
      });
    };
    const onPopState = () => {
      const destination = routeKey(window.location.pathname, window.location.search);
      if (experience.getSnapshot().destination !== destination) experience.start(destination);
    };
    window.addEventListener(ROUTE_START_EVENT, onBegin);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener(ROUTE_START_EVENT, onBegin);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      experience.dispose();
    };
  }, [experience]);

  return <RouteContext.Provider value={experience}>
    <Suspense fallback={null}><RouteCommit /></Suspense>
    <div className="route-experience" data-route-state={state.phase}>
      {busy && <div className="route-activity-line" aria-hidden="true" />}
      {ready && <div className="route-ready-line" aria-hidden="true"><span>READY</span></div>}
      <p className="route-sr-only" role="status" aria-live="polite">{busy ? '페이지를 불러오는 중입니다.' : state.phase === 'ERROR' ? '페이지를 모두 불러오지 못했습니다.' : state.phase === 'COMPLETE' ? '페이지를 불러왔습니다.' : ''}</p>
      {busy && state.visual && <p className="route-loading-note" aria-hidden="true">연결을 기다리고 있습니다.</p>}
      {state.error === 'timeout' && <RouteErrorState message="15초 안에 페이지를 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요. 다른 메뉴는 계속 사용할 수 있습니다." onRetry={() => {
        if (!experience.start(state.destination)) return;
        if (state.committed) { setRetryKey((value) => value + 1); router.refresh(); }
        else router.push(state.destination);
      }} />}
      <div className="route-content" key={retryKey}>{children}</div>
    </div>
  </RouteContext.Provider>;
}
