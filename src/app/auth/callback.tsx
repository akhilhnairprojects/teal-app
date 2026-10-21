import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { completeOAuthRedirect, oauthRedirectUrl } from '@/backend/auth';
import { afterSignIn } from '@/features/account/SignInScreen';
import { goBack, signInPath } from '@/features/shell/routes';
import { EmptyState, SheetPage } from '@/ui';

/**
 * Where Google sign-in returns when the redirect opens Teal directly (rather than being caught by
 * the in-app browser sheet). Redeems the one-time code, then continues like a normal sign-in.
 */
export default function OAuthCallbackRoute() {
  const params = useLocalSearchParams<{ code?: string; error?: string; error_code?: string }>();
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    for (const k of ['code', 'error', 'error_code'] as const) {
      const v = params[k];
      if (typeof v === 'string') query.set(k, v);
    }
    let live = true;
    void completeOAuthRedirect(`${oauthRedirectUrl()}?${query.toString()}`).then((r) => {
      if (!live) return;
      if (r.ok) router.replace(afterSignIn(r.value, null) as never);
      else setFailed(r.error.message);
    });
    return () => {
      live = false;
    };
  }, [params]);

  return (
    <SheetPage title="Signing in" onBack={goBack}>
      {failed ? (
        <EmptyState icon="alert-circle-outline" title={failed} action={{ label: 'Try again', onPress: () => router.replace(signInPath()) }} />
      ) : (
        <EmptyState icon="hourglass-outline" title="Finishing sign-in…" />
      )}
    </SheetPage>
  );
}
