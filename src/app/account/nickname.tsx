import { useLocalSearchParams } from 'expo-router';

import { NicknameScreen } from '@/features/account/NicknameScreen';
import { parseSignInParams } from '@/features/shell/routes';

export default function NicknameRoute() {
  const { next } = parseSignInParams(useLocalSearchParams<{ next?: string }>());
  return <NicknameScreen next={next} />;
}
