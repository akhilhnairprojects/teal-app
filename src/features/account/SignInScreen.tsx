import { router } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';

import { normalizeCode, requestEmailCode, verifyEmailCode, type AuthState } from '@/backend/auth';
import { BACKEND_CONFIGURED } from '@/backend/config';
import { accountPath, goBack, nicknamePath } from '@/features/shell/routes';
import { useNow } from '@/mbta/live/usePolling';
import { EmptyState, SheetPage, SheetScrollView } from '@/ui';

import { Body, Button, Card, ErrorText, Field, formStyles } from './formUi';
import { GATE_COPY } from './SignInGate';

/** Where to go after a successful verification. */
export function afterSignIn(state: AuthState, next: string | null): string {
  if (state.status === 'needsProfile') return String(nicknamePath()) + (next ? `?next=${encodeURIComponent(next)}` : '');
  return next ?? String(accountPath());
}

/** Email → 6-digit code (spec §3.2). The code field accepts paste and iOS one-time-code autofill. */
export function SignInScreen({ next }: { next: string | null }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const now = useNow(1_000);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  if (!BACKEND_CONFIGURED && Platform.OS === 'web') {
    return (
      <SheetPage title="Sign in" onBack={goBack}>
        <EmptyState icon="phone-portrait-outline" title={GATE_COPY.unavailableWeb} />
      </SheetPage>
    );
  }

  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await requestEmailCode(email);
    setBusy(false);
    if (!r.ok) {
      setError(r.error.code === 'invalid_payload' ? 'Enter a valid email address.' : r.error.message);
      return;
    }
    setResendAt(Date.now() + r.value.resendAfterMs);
    setStep('code');
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const r = await verifyEmailCode(email, code);
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    router.replace(afterSignIn(r.value, next) as never);
  };

  return (
    <SheetPage title="Sign in" onBack={goBack}>
      <SheetScrollView contentContainerStyle={formStyles.content}>
        {step === 'email' ? (
          <Card>
            <Body>We’ll email you a 6-digit code. No password needed.</Body>
            <Field
              label="Email"
              testID="sign-in-email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="you@example.com"
              returnKeyType="send"
              onSubmitEditing={() => void send()}
            />
            <ErrorText>{error}</ErrorText>
            <Button testID="sign-in-send" label="Email me a code" onPress={() => void send()} busy={busy} disabled={!email.trim()} />
          </Card>
        ) : (
          <Card>
            <Body>Enter the code we sent to {email.trim()}. It expires in 10 minutes.</Body>
            <Field
              label="6-digit code"
              testID="sign-in-code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              placeholder="123456"
              returnKeyType="done"
              onSubmitEditing={() => void verify()}
            />
            <ErrorText>{error}</ErrorText>
            <Button testID="sign-in-verify" label="Sign in" onPress={() => void verify()} busy={busy} disabled={normalizeCode(code).length !== 6} />
            <Button
              testID="sign-in-resend"
              kind="secondary"
              label={wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
              onPress={() => void send()}
              disabled={wait > 0 || busy}
            />
            <Button
              kind="secondary"
              label="Use a different email"
              onPress={() => {
                setError(null);
                setStep('email');
              }}
              disabled={busy}
            />
          </Card>
        )}
        <Body muted>Your email is used only to sign in. Other people see your nickname, never your email.</Body>
      </SheetScrollView>
    </SheetPage>
  );
}
