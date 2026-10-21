import { useLocalSearchParams } from 'expo-router';

import { JoinGroupScreen } from '@/features/social/InviteScreens';
import { parseJoinGroupParams } from '@/features/shell/routes';

export default function JoinGroupRoute() {
  const params = useLocalSearchParams<{ code?: string }>();
  return <JoinGroupScreen code={parseJoinGroupParams(params)} />;
}
