export const ROUTE_VISUAL_DELAY = 1_000;
export const ROUTE_TIMEOUT = 15_000;
export const ROUTE_REVEAL = 180;
export const STARTUP_TIMEOUT = 2_500;
export const ROUTE_START_EVENT = 'gyopo-route-start';

export type RoutePhase = 'IDLE' | 'ROUTE_START' | 'LOADING' | 'DATA_READY' | 'REVEAL' | 'COMPLETE' | 'ERROR';
export type RouteState = {
  phase: RoutePhase;
  operation: number;
  destination: string;
  committed: boolean;
  startedAt: number;
  visual: boolean;
  error: 'timeout' | 'data' | null;
};
export type RouteAction =
  | { type: 'START'; operation: number; destination: string; now: number }
  | { type: 'COMMIT'; operation: number; destination: string }
  | { type: 'SLOW'; operation: number; now: number }
  | { type: 'LOADING' | 'DATA_READY' | 'REVEAL' | 'COMPLETE'; operation: number }
  | { type: 'ERROR'; operation: number; error: 'timeout' | 'data' };

export const initialRouteState: RouteState = { phase: 'IDLE', operation: 0, destination: '', committed: false, startedAt: 0, visual: false, error: null };
export const isRouteBusy = (state: RouteState) => state.phase === 'ROUTE_START' || state.phase === 'LOADING';

export function routeReducer(state: RouteState, action: RouteAction): RouteState {
  if (action.type === 'START') {
    if (action.operation <= state.operation || (isRouteBusy(state) && action.destination === state.destination)) return state;
    return { phase: 'ROUTE_START', operation: action.operation, destination: action.destination, committed: false, startedAt: action.now, visual: false, error: null };
  }
  if (action.operation !== state.operation || state.phase === 'ERROR' || state.phase === 'COMPLETE') return state;
  switch (action.type) {
    case 'COMMIT': return action.destination === state.destination ? { ...state, committed: true } : state;
    case 'SLOW': return isRouteBusy(state) && action.now - state.startedAt > ROUTE_VISUAL_DELAY ? { ...state, visual: true } : state;
    case 'LOADING': return state.phase === 'ROUTE_START' ? { ...state, phase: 'LOADING' } : state;
    case 'DATA_READY': return isRouteBusy(state) && state.committed ? { ...state, phase: 'DATA_READY', visual: false } : state;
    case 'REVEAL': return state.phase === 'DATA_READY' ? { ...state, phase: 'REVEAL' } : state;
    case 'COMPLETE': return state.phase === 'REVEAL' ? { ...state, phase: 'COMPLETE' } : state;
    case 'ERROR': return { ...state, phase: 'ERROR', visual: false, error: action.error };
  }
}

export function routeKey(pathname: string, search: string) {
  const query = new URLSearchParams(search).toString();
  return pathname + (query ? `?${query}` : '');
}

export function internalDestination(destination: string, currentUrl: string): string | null {
  try {
    const current = new URL(currentUrl);
    const next = new URL(destination, current);
    if (!/^https?:$/.test(next.protocol) || next.origin !== current.origin) return null;
    return routeKey(next.pathname, next.search);
  } catch { return null; }
}

export function linkDestination(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }, link: { href: string; target: string; download: boolean }, currentUrl: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.download || (link.target && link.target.toLowerCase() !== '_self')) return null;
  const destination = internalDestination(link.href, currentUrl);
  const current = new URL(currentUrl);
  if (!destination || destination === routeKey(current.pathname, current.search)) return null;
  return destination;
}

// Reports intent only. Call before router.push/replace; false means a duplicate is pending.
export function beginRoute(destination: string): boolean {
  if (typeof window === 'undefined') return false;
  const target = internalDestination(destination, window.location.href);
  if (!target) return false;
  const detail = { destination: target, accepted: true };
  window.dispatchEvent(new CustomEvent(ROUTE_START_EVENT, { detail }));
  return detail.accepted;
}

type Readiness = { destination: string; loading: boolean; error: boolean };
type Clock = {
  now: () => number;
  frame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  timer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelTimer: (id: ReturnType<typeof setTimeout>) => void;
  reducedMotion: () => boolean;
};

export function createRouteExperience(clock: Clock = {
  now: () => performance.now(), frame: (callback) => requestAnimationFrame(callback), cancelFrame: (id) => cancelAnimationFrame(id),
  timer: (callback, delay) => setTimeout(callback, delay), cancelTimer: (id) => clearTimeout(id),
  reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
}) {
  let state = initialRouteState;
  let committed = '';
  let frame = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const listeners = new Set<() => void>();
  const reports = new Map<string, Readiness>();
  const send = (action: RouteAction) => {
    const next = routeReducer(state, action);
    if (next === state) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const clear = () => {
    clock.cancelFrame(frame);
    timers.forEach(clock.cancelTimer);
    timers = [];
  };
  const check = () => {
    if (!isRouteBusy(state)) return;
    clock.cancelFrame(frame);
    const operation = state.operation;
    // Let the new route commit AND its critical-data effects register before deciding readiness.
    frame = clock.frame(() => { frame = clock.frame(() => {
      if (operation !== state.operation || !isRouteBusy(state)) return;
      send({ type: 'LOADING', operation });
      if (!state.committed) return;
      const current = [...reports.values()].filter((report) => report.destination === state.destination);
      if (current.some((report) => report.error)) {
        clear();
        send({ type: 'ERROR', operation, error: 'data' });
      } else if (!current.some((report) => report.loading)) {
        clear();
        send({ type: 'DATA_READY', operation });
        frame = clock.frame(() => {
          send({ type: 'REVEAL', operation });
          if (clock.reducedMotion()) send({ type: 'COMPLETE', operation });
          else timers.push(clock.timer(() => send({ type: 'COMPLETE', operation }), ROUTE_REVEAL));
        });
      }
    }); });
  };
  const start = (destination: string) => {
    if (isRouteBusy(state) && state.destination === destination) return false;
    clear();
    const operation = state.operation + 1;
    send({ type: 'START', operation, destination, now: clock.now() });
    if (destination === committed) send({ type: 'COMMIT', operation, destination });
    timers.push(clock.timer(() => send({ type: 'SLOW', operation, now: clock.now() }), ROUTE_VISUAL_DELAY + 1));
    timers.push(clock.timer(() => {
      if (operation !== state.operation || !isRouteBusy(state)) return;
      clear();
      send({ type: 'ERROR', operation, error: 'timeout' });
    }, ROUTE_TIMEOUT));
    check();
    return true;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
    commit(destination: string) {
      if (committed === destination && state.phase !== 'IDLE') return;
      committed = destination;
      if (state.destination !== destination) start(destination);
      send({ type: 'COMMIT', operation: state.operation, destination });
      check();
    },
    report(id: string, report: Readiness) {
      const previous = reports.get(id);
      reports.set(id, report);
      if (report.destination === committed && report.loading && !previous?.loading && !isRouteBusy(state)) start(committed);
      if (report.destination === state.destination && report.error && state.phase === 'COMPLETE') start(committed);
      check();
    },
    remove(id: string) { reports.delete(id); check(); },
    dispose() { clear(); reports.clear(); committed = ''; state = initialRouteState; },
  };
}

export async function withRouteTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The request timed out. Please try again.')), ROUTE_TIMEOUT);
    })]);
  } finally { clearTimeout(timer); }
}

export async function fetchRouteJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(ROUTE_TIMEOUT) });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return await response.json() as T;
}
