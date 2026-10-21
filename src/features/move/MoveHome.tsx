import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { recorder } from '@/activity/recorder';
import { attachUnownedActivities, countUnownedActivities } from '@/activity/sync';
import { useAuth } from '@/backend/auth';
import {
  accountPath,
  activitiesPath,
  friendsPath,
  inboxPath,
  leaderboardsPath,
  parkPath,
  recordPath,
  territoryPath,
} from '@/features/shell/routes';
import { formStyles } from '@/features/account/formUi';
import { fetchInbox } from '@/social/inbox';
import { fonts, radius, usePalette, type Palette } from '@/theme';
import { SheetScrollView } from '@/ui';

export type MoveRow = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; href: Href };

/** The Move hub's entries (spec §3.2), in order. */
export const MOVE_ROWS: readonly MoveRow[] = [
  { key: 'record-run', label: 'Record a run', icon: 'walk', href: recordPath({ kind: 'run' }) },
  { key: 'record-bike', label: 'Record a Bluebike ride', icon: 'bicycle', href: recordPath({ kind: 'bike' }) },
  { key: 'park', label: 'Find a dock', icon: 'locate', href: parkPath() },
  { key: 'leaderboards', label: 'Leaderboards', icon: 'trophy', href: leaderboardsPath() },
  { key: 'friends', label: 'Friends & groups', icon: 'people', href: friendsPath() },
  { key: 'territory', label: 'Territory', icon: 'grid', href: territoryPath() },
  { key: 'activities', label: 'My activities', icon: 'list', href: activitiesPath() },
  { key: 'inbox', label: 'Inbox', icon: 'mail', href: inboxPath() },
  { key: 'account', label: 'Account', icon: 'person-circle', href: accountPath() },
];

export const MOVE_WEB_COPY = {
  title: 'In the iPhone app',
  body: 'Recording runs and Bluebike rides, leaderboards, friends, bike parking and territory are available in the Teal iPhone app.',
} as const;

type Recovery = { kind: 'run' | 'bike'; startedAt: number; points: number } | null;

export function MoveHome() {
  const c = usePalette();
  const s = styles(c);
  if (Platform.OS === 'web') {
    return (
      <SheetScrollView contentContainerStyle={formStyles.content}>
        <View style={s.card} testID="move-web-panel">
          <Ionicons name="phone-portrait-outline" size={22} color={c.brandDeep} />
          <Text style={s.title}>{MOVE_WEB_COPY.title}</Text>
          <Text style={s.body}>{MOVE_WEB_COPY.body}</Text>
        </View>
      </SheetScrollView>
    );
  }
  return <MoveHomeNative />;
}

function MoveHomeNative() {
  const c = usePalette();
  const s = styles(c);
  const auth = useAuth();
  const [recovery, setRecovery] = useState<Recovery>(null);
  const [unowned, setUnowned] = useState(0);
  const [unread, setUnread] = useState(0);
  const signedIn = auth.status === 'signedIn';

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void recorder.pendingRecovery().then((r) => {
        if (!cancelled) setRecovery(r);
      });
      if (signedIn) {
        void countUnownedActivities().then((n) => {
          if (!cancelled) setUnowned(n);
        });
        void fetchInbox(50).then((r) => {
          if (!cancelled && r.ok) setUnread(r.value.filter((i) => i.readAt === null).length);
        });
      }
      return () => {
        cancelled = true;
      };
    }, [signedIn]),
  );

  const recover = async (action: 'resume' | 'save' | 'discard', kind: 'run' | 'bike') => {
    setRecovery(null);
    await recorder.recover(action);
    if (action === 'resume') router.push(recordPath({ kind }));
  };

  return (
    <SheetScrollView contentContainerStyle={formStyles.content}>
      {recovery ? (
        <View style={s.card} testID="move-recovery">
          <Text style={s.title}>Resume or save your unfinished {recovery.kind === 'run' ? 'run' : 'ride'}?</Text>
          <Text style={s.body}>Teal closed while you were recording. {recovery.points} points were saved.</Text>
          <View style={s.actions}>
            <Action label="Resume" onPress={() => void recover('resume', recovery.kind)} primary />
            <Action label="Save" onPress={() => void recover('save', recovery.kind)} />
            <Action label="Discard" onPress={() => void recover('discard', recovery.kind)} />
          </View>
        </View>
      ) : null}
      {signedIn && unowned > 0 ? (
        <View style={s.card} testID="move-upload-unowned">
          <Text style={s.title}>
            Upload {unowned} {unowned === 1 ? 'activity' : 'activities'} recorded before you signed in?
          </Text>
          <View style={s.actions}>
            <Action
              label="Upload"
              primary
              onPress={() => {
                setUnowned(0);
                void attachUnownedActivities();
              }}
            />
            <Action label="Not now" onPress={() => setUnowned(0)} />
          </View>
        </View>
      ) : null}
      <View style={s.list}>
        {MOVE_ROWS.map((row, i) => (
          <Pressable
            key={row.key}
            testID={`move-row-${row.key}`}
            accessibilityRole="button"
            accessibilityLabel={row.key === 'inbox' && unread > 0 ? `${row.label}, ${unread} unread` : row.label}
            onPress={() => router.push(row.href)}
            style={({ pressed }) => [s.row, i > 0 && s.divider, pressed && { opacity: 0.7 }]}
          >
            <View style={s.icon}>
              <Ionicons name={row.icon} size={18} color={c.brandDeep} />
            </View>
            <Text style={s.rowLabel}>{row.label}</Text>
            {row.key === 'inbox' && unread > 0 ? (
              <View style={s.badge}>
                <Text style={s.badgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            ) : null}
            {row.key === 'account' && auth.status === 'signedIn' ? <Text style={s.muted}>{auth.profile.nickname}</Text> : null}
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </Pressable>
        ))}
      </View>
      <Text style={s.footnote}>Recording and bike parking work without an account.</Text>
    </SheetScrollView>
  );
}

function Action({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [actionStyles.button, { backgroundColor: primary ? c.brand : c.surfaceMuted }, pressed && { opacity: 0.8 }]}
    >
      <Text style={[actionStyles.text, { color: primary ? c.onBrand : c.text }]}>{label}</Text>
    </Pressable>
  );
}

const actionStyles = StyleSheet.create({
  button: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  text: { fontFamily: fonts.bold, fontSize: 14 },
});

const styles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: 14, gap: 8 },
    title: { fontFamily: fonts.bold, fontSize: 16, color: c.text },
    body: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: c.textMuted },
    actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    list: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' },
    rowLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    muted: { fontFamily: fonts.medium, fontSize: 14, color: c.textMuted },
    badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' },
    badgeText: { fontFamily: fonts.bold, fontSize: 12, color: c.onBrand },
    footnote: { fontFamily: fonts.medium, fontSize: 12, color: c.textMuted, textAlign: 'center', marginTop: 8 },
  });
