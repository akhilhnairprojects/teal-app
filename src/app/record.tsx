import { useLocalSearchParams } from 'expo-router';

import { RecordScreen } from '@/features/record/RecordScreen';
import { parseRecordParams } from '@/features/shell/routes';

/** Record a run or ride: `/record?kind` (built by `recordPath`). */
export default function RecordRoute() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const { kind } = parseRecordParams(params);
  return <RecordScreen initialKind={kind} />;
}
