import { useLocalSearchParams } from 'expo-router';

import { LeaderboardsScreen } from '@/features/leaderboards/LeaderboardsScreen';
import { parseLeaderboardsParams } from '@/features/shell/routes';

/** Leaderboards: `/leaderboards?board&period&scope` (all optional; built by `leaderboardsPath`). */
export default function LeaderboardsRoute() {
  const params = useLocalSearchParams<{ board?: string; period?: string; scope?: string }>();
  return <LeaderboardsScreen params={parseLeaderboardsParams(params)} />;
}
