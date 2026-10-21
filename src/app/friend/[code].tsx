import { useLocalSearchParams } from 'expo-router';

import { FriendInviteScreen } from '@/features/social/InviteScreens';
import { parseFriendInviteParams } from '@/features/shell/routes';

export default function FriendInviteRoute() {
  const params = useLocalSearchParams<{ code?: string }>();
  return <FriendInviteScreen code={parseFriendInviteParams(params)} />;
}
