import Ionicons from '@expo/vector-icons/Ionicons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useColorScheme } from 'react-native';

import {
  appleSignInAvailable,
  normalizeCode,
  requestEmailCode,
  signInWithApple,
  signInWithGoogle,
  verifyEmailCode,
  type AuthState,
} from '@/backend/auth';
import { BACKEND_CONFIGURED } from '@/backend/config';
import type { Result } from '@/backend/errors';
import { accountPath, goBack, nicknamePath } from '@/features/shell/routes';
import { useNow } from '@/mbta/live/usePolling';
import { fonts, radius, usePalette } from '@/theme';
import { EmptyState, SheetPage, SheetScrollView } from '@/ui';

import { Body, Button, Card, ErrorText, Field, formStyles } from './formUi';
import { GATE_COPY } from './SignInGate';

/** Where to go after a successful sign-in. */
export function afterSignIn(state: AuthState, next: string | null): string {
  if (state.status === 'needsProfile') return String(nicknamePath()) + (next ? `?next=${encodeURIComponent(next)}` : '');
  return next ?? String(accountPath());
}

type Provider = 'apple' | 'google' | 'email';

/**
 * Sign in with Apple (iPhone) or Google first; an emailed 6-digit code stays available behind "Use
 * email instead" for people without either. First sign-in creates the account, then asks for a nickname.
 */
export function SignInScreen({ next }: { next: string | null }) {
  const c = usePalette();
  const dark = useColorScheme() === 'dark';
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);

  useEffect(() => {
    let live = true;
    void appleSignInAvailable().then((v) => live && setApple(v));
    return () => {
      live = false;
    };
  }, []);

  if (!BACKEND_CONFIGURED && Platform.OS === 'web') {
    return (
      <SheetPage title="Sign in" onBack={goBack}>
        <EmptyState icon="phone-portrait-outline" title={GATE_COPY.unavailableWeb} />
      </SheetPage>
    );
  }

  const run = async (provider: Provider, f: () => Promise<Result<AuthState>>) => {
    setBusy(provider);
    setError(null);
    const r = await f();
    setBusy(null);
    if (r.ok) router.replace(afterSignIn(r.value, next) as never);
    else if (r.error.code !== 'sign_in_cancelled') setError(r.error.message);
  };

  return (
    <SheetPage title="Sign in" onBack={goBack}>
      <SheetScrollView contentContainerStyle={formStyles.content}>
        <Card>
          <Text style={[styles.title, { color: c.text }]}>Join Teal</Text>
          <Body muted>Save your runs and rides, climb the leaderboards, claim territory and add friends.</Body>

          {apple ? (
            <AppleAuthentication.AppleAuthenticationButton
              testID="sign-in-apple"
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={radius.pill}
              style={[styles.provider, busy !== null && styles.dim]}
              onPress={() => busy === null && void run('apple', signInWithApple)}
            />
          ) : null}

          <Pressable
            testID="sign-in-google"
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            disabled={busy !== null}
            onPress={() => void run('google', signInWithGoogle)}
            style={({ pressed }) => [
              styles.provider,
              styles.google,
              { borderColor: c.border },
              (pressed || busy !== null) && styles.dim,
            ]}
          >
            <Ionicons name="logo-google" size={18} color="#1F1F1F" />
            <Text style={styles.googleText}>{busy === 'google' ? 'Opening Google…' : 'Continue with Google'}</Text>
          </Pressable>

          <ErrorText>{error}</ErrorText>
        </Card>

        {showEmail ? (
          <EmailSignIn next={next} />
        ) : (
          <Pressable testID="sign-in-show-email" accessibilityRole="button" onPress={() => setShowEmail(true)} style={styles.link}>
            <Text style={[styles.linkText, { color: c.brand }]}>Use email instead</Text>
          </Pressable>
        )}

        <Body muted>Teal only uses your sign-in to recognise you. Other people see your nickname, never your name or email.</Body>
      </SheetScrollView>
    </SheetPage>
  );
}

/** Fallback: email → 6-digit code. The code field accepts paste and iOS one-time-code autofill. */
function EmailSignIn({ next }: { next: string | null }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const now = useNow(1_000);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

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

  return step === 'email' ? (
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
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.4 },
  provider: { height: 48, width: '100%', borderRadius: radius.pill },
  google: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
  },
  googleText: { fontFamily: fonts.semibold, fontSize: 16, color: '#1F1F1F' },
  dim: { opacity: 0.6 },
  link: { alignSelf: 'center', paddingVertical: 8 },
  linkText: { fontFamily: fonts.semibold, fontSize: 15 },
});

