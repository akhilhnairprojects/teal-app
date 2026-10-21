import { useLocalSearchParams } from 'expo-router';

import { GroupScreen } from '@/features/social/GroupScreen';
import { parseGroupParams } from '@/features/shell/routes';

export default function GroupRoute() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  return <GroupScreen groupId={parseGroupParams(params)} />;
}
