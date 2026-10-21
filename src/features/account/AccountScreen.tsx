import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { setUnits, useUnits } from '@/activity/format';
import { deleteMyAccount, signOut, updateMySettings, type MyProfile } from '@/backend/auth';
import { goBack, movePath, nicknamePath, PATHS } from '@/features/shell/routes';
import { ensureNotificationPermission, pushAvailabilityText, registerForPush, usePushAvailability } from '@/notifications';
import { TERRITORY_EXPLANATION, TerritoryNotice } from '@/features/territory/TerritoryNotice';
import { OWNER_COLORS } from '@/territory/api';
import { fonts, radius, usePalette } from '@/theme';
import { SheetPage, SheetScrollView } from '@/ui';

import { Body, Button, Card, ErrorText, Field, formStyles, SectionTitle, ToggleRow } from './formUi';
import { SignInGate } from './SignInGate';

export { TERRITORY_EXPLANATION };

/** The typed word that confirms "Delete my data". */
export const DELETE_CONFIRM_WORD = 'DELETE';

type NotifyKey = 'notifyOvertake' | 'notifySessions' | 'notifyFriendRequests';

export function AccountScreen() {
  return (
    <SheetPage title="Account" onBack={goBack}>
      <SignInGate next={PATHS.account}>{(profile) => <AccountBody profile={profile} />}</SignInGate>
    </SheetPage>
  );
}

function AccountBody({ profile }: { profile: MyProfile }) {
  const c = usePalette();
  const [units] = useUnits();
  const push = usePushAvailability();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  // Territory is on but the notice hasn't been acknowledged yet (no squares are claimed until it is).
  const showNotice = profile.territoryOptIn && !profile.territoryNoticeSeen;

  const save = async (patch: Parameters<typeof updateMySettings>[0]) => {
    setSaving(true);
    setError(null);
    const r = await updateMySettings(patch);
    setSaving(false);
    if (!r.ok) setError(r.error.message);
  };

  const setNotify = async (key: NotifyKey, on: boolean) => {
    if (on && (await ensureNotificationPermission()) === 'granted') void registerForPush();
    await save({ [key]: on });
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    const r = await deleteMyAccount();
    setDeleting(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    router.replace(movePath());
  };

  return (
    <SheetScrollView contentContainerStyle={formStyles.content}>
      <Card testID="account-profile">
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: OWNER_COLORS[profile.color] ?? c.brand }]} />
          <Text style={[styles.nickname, { color: c.text }]} numberOfLines={1}>
            {profile.nickname}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push(nicknamePath())} hitSlop={8}>
            <Text style={[styles.link, { color: c.brand }]}>Change</Text>
          </Pressable>
        </View>
        <Body muted>Your invite code: {profile.inviteCode}</Body>
      </Card>

      <ErrorText>{error}</ErrorText>

      <SectionTitle>Color</SectionTitle>
      <Card>
        <View style={styles.swatches} accessibilityRole="radiogroup">
          {OWNER_COLORS.map((hex, i) => (
            <Pressable
              key={hex}
              testID={`account-color-${i}`}
              accessibilityRole="radio"
              accessibilityLabel={`Color ${i + 1}`}
              accessibilityState={{ selected: profile.color === i, disabled: saving }}
              disabled={saving}
              onPress={() => void save({ color: i })}
              style={[styles.swatch, { backgroundColor: hex, borderColor: profile.color === i ? c.text : 'transparent' }]}
            />
          ))}
        </View>
      </Card>

      <SectionTitle>Units</SectionTitle>
      <Card>
        <View style={[styles.segment, { backgroundColor: c.surfaceMuted }]}>
          {(['mi', 'km'] as const).map((u) => (
            <Pressable
              key={u}
              testID={`account-units-${u}`}
              accessibilityRole="button"
              accessibilityState={{ selected: units === u }}
              onPress={() => setUnits(u)}
              style={[styles.segmentItem, units === u && { backgroundColor: c.surface }]}
            >
              <Text style={[styles.segmentText, { color: units === u ? c.text : c.textMuted }]}>{u === 'mi' ? 'Miles' : 'Kilometers'}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <Card>
        <ToggleRow
          testID="account-notify-overtake"
          label="A friend passes you"
          detail="When a friend’s weekly running distance passes yours (at most once a week each)."
          value={profile.notifyOvertake}
          disabled={saving}
          onChange={(v) => void setNotify('notifyOvertake', v)}
        />
        <ToggleRow
          testID="account-notify-sessions"
          label="Group sessions start"
          value={profile.notifySessions}
          disabled={saving}
          onChange={(v) => void setNotify('notifySessions', v)}
        />
        <ToggleRow
          testID="account-notify-friends"
          label="Friend requests"
          value={profile.notifyFriendRequests}
          disabled={saving}
          onChange={(v) => void setNotify('notifyFriendRequests', v)}
        />
        <Body muted>{pushAvailabilityText(push)}</Body>
      </Card>

      <SectionTitle>Territory</SectionTitle>
      <Card>
        <ToggleRow
          testID="account-territory"
          label="Show my territory"
          value={profile.territoryOptIn}
          disabled={saving}
          onChange={(v) => void save({ territoryOptIn: v })}
        />
        {showNotice ? null : <Body muted>{TERRITORY_EXPLANATION}</Body>}
      </Card>
      {showNotice ? <TerritoryNotice testID="account-territory-notice" /> : null}

      <SectionTitle>Account</SectionTitle>
      <Card>
        <Button testID="account-sign-out" kind="secondary" label="Sign out" onPress={() => void signOut()} />
      </Card>
      <Card testID="account-delete">
        <Text style={[styles.dangerTitle, { color: c.danger }]}>Delete my data</Text>
        <Body muted>
          Deletes your account, activities, friends, groups and territory from Teal’s server, and every activity stored on this phone. This
          can’t be undone. Type {DELETE_CONFIRM_WORD} to confirm.
        </Body>
        <Field
          label="Confirmation"
          testID="account-delete-confirm"
          value={confirm}
          onChangeText={setConfirm}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={DELETE_CONFIRM_WORD}
        />
        <Button
          testID="account-delete-button"
          kind="danger"
          label="Delete my data"
          onPress={() => void remove()}
          busy={deleting}
          disabled={confirm.trim() !== DELETE_CONFIRM_WORD}
        />
      </Card>
    </SheetScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  nickname: { flex: 1, fontFamily: fonts.bold, fontSize: 20 },
  link: { fontFamily: fonts.bold, fontSize: 14 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 3 },
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, gap: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.pill },
  segmentText: { fontFamily: fonts.semibold, fontSize: 14 },
  dangerTitle: { fontFamily: fonts.bold, fontSize: 15 },
});
