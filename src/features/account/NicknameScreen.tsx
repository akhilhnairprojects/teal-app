import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { claimNickname, updateMySettings, useAuth, validateNicknameLocally } from '@/backend/auth';
import { accountPath, goBack, signInPath } from '@/features/shell/routes';
import { TERRITORY_NOTICE_COPY } from '@/features/territory/TerritoryNotice';
import { fonts, usePalette } from '@/theme';
import { EmptyState, SheetPage, SheetScrollView } from '@/ui';

import { Body, Button, Card, ErrorText, Field, formStyles, ToggleRow } from './formUi';

/** Copy for a local validation failure. */
export function nicknameProblemText(reason: 'length' | 'chars' | 'reserved'): string {
  switch (reason) {
    case 'length':
      return 'Use 3 to 20 characters.';
    case 'chars':
      return 'Start with a letter or number; then letters, numbers, dots, dashes or underscores.';
    case 'reserved':
      return 'That nickname is reserved. Try another.';
  }
}

/**
 * Pick a nickname (new account, with the 13+ confirmation) or change it (once a week; a case-only
 * change is always allowed). The nickname is the only thing other people see besides territory
 * squares, so a new account also sees the territory notice here, with a switch to turn it off
 * before anything is claimed (review B1).
 */
export function NicknameScreen({ next }: { next: string | null }) {
  const c = usePalette();
  const auth = useAuth();
  const creating = auth.status === 'needsProfile';
  const current = auth.status === 'signedIn' ? auth.profile.nickname : '';
  const [name, setName] = useState(current);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [territoryOn, setTerritoryOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === 'loading') {
    return (
      <SheetPage title="Nickname" onBack={goBack}>
        <ActivityIndicator style={styles.loading} color={c.brand} />
      </SheetPage>
    );
  }
  if (auth.status === 'signedOut' || auth.status === 'unavailable') {
    return (
      <SheetPage title="Nickname" onBack={goBack}>
        <EmptyState
          icon="person-circle-outline"
          title="Sign in first"
          action={auth.status === 'signedOut' ? { label: 'Sign in', onPress: () => router.replace(signInPath({ next })) } : undefined}
        />
      </SheetPage>
    );
  }

  const local = validateNicknameLocally(name);
  const hint = name.trim() && !local.ok ? nicknameProblemText(local.reason) : null;

  const submit = async () => {
    if (!local.ok) return;
    setBusy(true);
    setError(null);
    const r = await claimNickname(name, { ageConfirmed });
    if (!r.ok) {
      setBusy(false);
      setError(r.error.message);
      return;
    }
    if (creating) {
      // The notice was on screen: record it, with the choice made. If this fails (offline), the notice
      // shows again before the first run is saved, and the server claims nothing until it is recorded.
      await updateMySettings({ territoryNoticeSeen: true, territoryOptIn: territoryOn });
    }
    setBusy(false);
    if (next) router.replace(next as never);
    else if (creating) router.replace(accountPath());
    else goBack();
  };

  return (
    <SheetPage title={creating ? 'Pick a nickname' : 'Change nickname'} onBack={goBack}>
      <SheetScrollView contentContainerStyle={formStyles.content}>
        <Card>
          <Body>Your nickname is shown on leaderboards and to friends. Your email never is.</Body>
          <Field
            label="Nickname"
            testID="nickname-input"
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            placeholder="e.g. charles_runner"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
          />
          <ErrorText>{hint}</ErrorText>
          {creating ? (
            <Pressable
              testID="nickname-age"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: ageConfirmed }}
              onPress={() => setAgeConfirmed((v) => !v)}
              style={styles.check}
            >
              <Ionicons name={ageConfirmed ? 'checkbox' : 'square-outline'} size={22} color={ageConfirmed ? c.brand : c.textMuted} />
              <Text style={[styles.checkText, { color: c.text }]}>I’m 13 or older</Text>
            </Pressable>
          ) : (
            <Body muted>You can change your nickname once a week.</Body>
          )}
          {creating ? <Body muted>If you’re under 13, you can’t create a Teal account. Recording still works without one.</Body> : null}
          {creating ? (
            <>
              <Text style={[styles.checkText, { color: c.text }]}>{TERRITORY_NOTICE_COPY.title}</Text>
              <Body muted>{TERRITORY_NOTICE_COPY.body}</Body>
              <ToggleRow testID="nickname-territory" label="Show my territory" value={territoryOn} onChange={setTerritoryOn} />
            </>
          ) : null}
          <ErrorText>{error}</ErrorText>
          <Button
            testID="nickname-save"
            label={creating ? 'Create account' : 'Save'}
            onPress={() => void submit()}
            busy={busy}
            disabled={!local.ok || (creating && !ageConfirmed) || (!creating && name.trim() === current)}
          />
        </Card>
      </SheetScrollView>
    </SheetPage>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 32 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkText: { fontFamily: fonts.semibold, fontSize: 15 },
});

