import { Suspense } from 'react';
import { RoutePending, RouteSkeleton } from '@/components/layout/RouteExperience';

export default function Loading() {
  return <Suspense fallback={<RouteSkeleton />}><RoutePending /></Suspense>;
}
