import { useRef } from 'react';

export function useEffectEvent<T extends (...args: never[]) => unknown>(handler: T): T {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const eventRef = useRef((...args: Parameters<T>) => handlerRef.current(...args));
  return eventRef.current as T;
}
