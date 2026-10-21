import { useLocalSearchParams } from 'expo-router';

import { ActivityDetailScreen } from '@/features/activities/ActivityDetailScreen';
import { parseActivityParams } from '@/features/shell/routes';

/** One activity: `/activity/[activityId]` (a local id, or the server id of an activity from another device). */
export default function ActivityRoute() {
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  return <ActivityDetailScreen id={parseActivityParams({ activityId }) ?? ''} />;
}
