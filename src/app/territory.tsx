import { useLocalSearchParams } from 'expo-router';

import { parseTerritoryParams } from '@/features/shell/routes';
import { TerritoryScreen } from '@/features/territory/TerritoryScreen';

/** Monthly territory. Param: optional `month` ('YYYY-MM-01'), built by `territoryPath`. */
export default function TerritoryRoute() {
  const { month } = parseTerritoryParams(useLocalSearchParams<{ month?: string }>());
  return <TerritoryScreen month={month} />;
}
