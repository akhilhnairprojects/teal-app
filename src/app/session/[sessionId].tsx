import { useLocalSearchParams } from 'expo-router';

import { SessionScreen } from '@/features/social/SessionScreen';
import { parseSessionParams } from '@/features/shell/routes';

export default function SessionRoute() {
  const params = useLocalSearchParams<{ sessionId?: string }>();
  return <SessionScreen sessionId={parseSessionParams(params)} />;
}
