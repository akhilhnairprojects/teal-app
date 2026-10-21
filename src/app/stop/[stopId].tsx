import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { firstParam, parseStopFilter } from '@/features/shell/routes';
import { StopDetailsScreen } from '@/features/stop/StopDetailsScreen';

/** Stop details. Params: stopId, and optional routeId + directionId to filter (built by `stopPath`). */
export default function StopRoute() {
  const { stopId, routeId, directionId } = useLocalSearchParams<{ stopId: string; routeId?: string; directionId?: string }>();
  const filter = useMemo(() => parseStopFilter({ routeId, directionId }), [routeId, directionId]);
  return <StopDetailsScreen stopId={firstParam(stopId) ?? ''} filter={filter} />;
}
