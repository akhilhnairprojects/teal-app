import { useLocalSearchParams } from 'expo-router';

import { parseTripParams } from '@/features/shell/routes';
import { TripDetailsScreen } from '@/features/trip/TripDetailsScreen';

/** Trip details. Params: tripId, and optional stopId, stopSequence, vehicleId (built by `tripPath`). */
export default function TripRoute() {
  const params = useLocalSearchParams<{ tripId: string; stopId?: string; stopSequence?: string; vehicleId?: string }>();
  return <TripDetailsScreen params={parseTripParams(params)} />;
}
