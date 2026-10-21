import { useLocalSearchParams } from 'expo-router';

import { PlannerScreen } from '@/features/planner/PlannerScreen';
import { parsePlanParams } from '@/features/shell/routes';

/** Plan a trip: `/plan?toName&toLat&toLon&toStopId&q` (all optional; built by `planPath`). */
export default function PlanRoute() {
  const params = useLocalSearchParams<{ q?: string; toName?: string; toLat?: string; toLon?: string; toStopId?: string }>();
  return <PlannerScreen params={parsePlanParams(params)} />;
}
