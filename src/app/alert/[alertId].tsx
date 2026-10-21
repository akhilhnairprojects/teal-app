import { useLocalSearchParams } from 'expo-router';

import { AlertDetailsScreen } from '@/features/alert/AlertDetailsScreen';
import { firstParam } from '@/features/shell/routes';

/** Alert details for one alert id (built by `alertPath`). */
export default function AlertRoute() {
  const { alertId } = useLocalSearchParams<{ alertId: string }>();
  return <AlertDetailsScreen alertId={firstParam(alertId) ?? ''} />;
}
