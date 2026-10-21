import { useLocalSearchParams } from 'expo-router';

import { SignInScreen } from '@/features/account/SignInScreen';
import { parseSignInParams } from '@/features/shell/routes';

export default function SignInRoute() {
  const { next } = parseSignInParams(useLocalSearchParams<{ next?: string }>());
  return <SignInScreen next={next} />;
}
