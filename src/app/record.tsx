import { useLocalSearchParams } from 'expo-router';

import { RecordScreen } from '@/features/record/RecordScreen';
import { parseRecordParams } from '@/features/shell/routes';

/** Record a run or ride: `/record?kind&sessionId` (built by `recordPath`). */
export default function RecordRoute() {
  const params = useLocalSearchParams<{ kind?: string; sessionId?: string }>();
  const { kind, sessionId } = parseRecordParams(params);
  return <RecordScreen initialKind={kind} sessionId={sessionId} />;
}
