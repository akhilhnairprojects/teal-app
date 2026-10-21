import { useLocalSearchParams } from 'expo-router';

import { ParkingScreen } from '@/features/parking/ParkingScreen';
import { parseParkParams } from '@/features/shell/routes';

/** Bike parking mode: `/park?toName&toLat&toLon` (all optional; built by `parkPath`). */
export default function ParkRoute() {
  const params = useLocalSearchParams<{ toName?: string; toLat?: string; toLon?: string }>();
  return <ParkingScreen params={parseParkParams(params)} />;
}
