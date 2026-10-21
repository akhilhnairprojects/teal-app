import { Redirect, router, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { useAuth, type MyProfile } from '@/backend/auth';
import { nicknamePath, signInPath } from '@/features/shell/routes';
import { usePalette } from '@/theme';
import { EmptyState } from '@/ui';

/** Copy for each gate state, exported for tests. */
export const GATE_COPY = {
  unavailableTitle: 'Accounts aren’t set up in this build',
  unavailableWeb: 'Available in the iPhone app',
  unavailableMessage: 'Recording, bike parking and territory still work without an account.',
  signedOutTitle: 'Sign in to see this',
  signedOutMessage: 'Leaderboards and friends need a Teal account. Recording and territory work without one.',
  signIn: 'Sign in',
} as const;

/**
 * Wraps leaderboard and social pages (spec §3.2): shows why the page is unavailable,
 * offers sign-in (returning here afterwards), sends a new account to the nickname screen, and renders
 * `children` once signed in. `children` may be a function of the signed-in profile.
 */
export function SignInGate({ children, next }: { children: ReactNode | ((profile: MyProfile) => ReactNode); next?: string }) {
  const c = usePalette();
  const auth = useAuth();
  const pathname = usePathname() || '/';
  switch (auth.status) {
    case 'unavailable':
      return (
        <EmptyState
          icon="person-circle-outline"
          title={Platform.OS === 'web' ? GATE_COPY.unavailableWeb : GATE_COPY.unavailableTitle}
          message={GATE_COPY.unavailableMessage}
        />
      );
    case 'loading':
      return (
        <View style={styles.center} testID="sign-in-gate-loading">
          <ActivityIndicator color={c.brand} />
        </View>
      );
    case 'signedOut':
      return (
        <EmptyState
          icon="person-circle-outline"
          title={GATE_COPY.signedOutTitle}
          message={GATE_COPY.signedOutMessage}
          action={{ label: GATE_COPY.signIn, onPress: () => router.push(signInPath({ next: next ?? pathname })) }}
        />
      );
    case 'needsProfile':
      return <Redirect href={nicknamePath()} />;
    case 'signedIn':
      return <>{typeof children === 'function' ? children(auth.profile) : children}</>;
  }
}

const styles = StyleSheet.create({ center: { paddingVertical: 32, alignItems: 'center' } });
