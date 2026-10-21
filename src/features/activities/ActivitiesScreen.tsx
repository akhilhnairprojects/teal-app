import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDistanceM, formatDurationMs, useUnits } from '@/activity/format';
import { getActivityIndex, useActivities, type ActivityListItem, type LocalActivity } from '@/activity/store';
import { syncPending, useSyncStatus } from '@/activity/sync';
import { useAuth } from '@/backend/auth';
import { backendError } from '@/backend/errors';
import { Body, Button, formStyles } from '@/features/account/formUi';
import { MOVE_WEB_COPY } from '@/features/move/MoveHome';
import { activityPath, goBack, PATHS, recordPath, signInPath } from '@/features/shell/routes';
import { fonts, radius, usePalette, type Palette } from '@/theme';
import { EmptyState, SheetFlatList, SheetPage } from '@/ui';

import { activityTitle, activityWhen, chipForItem, toneColor } from './activityModel';

/** My activities (spec §5 G2): local recordings and synced ones from other devices, newest first. */
export function ActivitiesScreen() {
  return (
    <SheetPage title="My activities" onBack={goBack}>
      {/* No accounts or recording on web (decision O7). */}
      {Platform.OS === 'web' ? (
        <EmptyState icon="phone-portrait-outline" title={MOVE_WEB_COPY.title} message={MOVE_WEB_COPY.body} />
      ) : (
        <ActivitiesBody />
      )}
    </SheetPage>
  );
}

function ActivitiesBody() {
  const c = usePalette();
  const s = styles(c);
  const [units] = useUnits();
  const auth = useAuth();
  const { ready, items, refresh } = useActivities();
  const status = useSyncStatus();
  const [refreshing, setRefreshing] = useState(false);
  const signedIn = auth.status === 'signedIn';

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // The local index holds the reject reason and eligibility; it is current whenever `items` changes.
  const localById = new Map<string, LocalActivity>(getActivityIndex().map((a) => [a.localId, a]));

  const onRefresh = async () => {
    setRefreshing(true);
    if (signedIn) await syncPending('manual');
    await refresh();
    setRefreshing(false);
  };

  const header = (
    <View style={s.header}>
      {!signedIn && auth.status !== 'unavailable' ? (
        <View style={s.note} testID="activities-signed-out">
          <Body muted>Activities are saved on this phone. Sign in to upload them and appear on leaderboards.</Body>
          <Button label="Sign in" kind="secondary" onPress={() => router.push(signInPath({ next: PATHS.activities }))} />
        </View>
      ) : null}
      {signedIn && status.pending > 0 ? (
        <View style={s.note} testID="activities-pending">
          <Body muted>
            {status.syncing ? 'Uploading…' : `${status.pending} waiting to sync`}
            {status.lastError && !status.syncing ? ` · ${backendError(status.lastError).message}` : ''}
          </Body>
          <Button label="Sync now" kind="secondary" busy={status.syncing} onPress={() => void syncPending('manual')} testID="activities-sync-now" />
        </View>
      ) : null}
    </View>
  );

  return (
    <SheetFlatList<ActivityListItem>
      data={items}
      keyExtractor={(i) => i.localId ?? i.serverId ?? String(i.startedAt)}
      contentContainerStyle={formStyles.content}
      ListHeaderComponent={header}
      ListEmptyComponent={
        ready ? (
          <EmptyState
            icon="walk-outline"
            title="No activities yet"
            message="Record a run or a Bluebike ride. It’s saved here, even without an account."
            action={{ label: 'Record a run', onPress: () => router.push(recordPath({ kind: 'run' })) }}
          />
        ) : null
      }
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      renderItem={({ item }) => {
        const chip = chipForItem(item, item.localId ? localById.get(item.localId) : null);
        const id = item.localId ?? item.serverId;
        return (
          <Pressable
            testID={`activity-row-${id}`}
            accessibilityRole="button"
            onPress={() => id && router.push(activityPath(id))}
            style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
          >
            <View style={s.icon}>
              <Ionicons name={item.kind === 'run' ? 'walk' : 'bicycle'} size={18} color={c.brandDeep} />
            </View>
            <View style={s.main}>
              <Text style={s.title}>
                {activityTitle(item.kind)} · {formatDistanceM(item.distanceM, units)}
              </Text>
              <Text style={s.sub}>
                {activityWhen(item.startedAt)} · {formatDurationMs(item.movingMs)} moving
              </Text>
              <Text style={[s.chip, { color: toneColor(c, chip.tone) }]}>{chip.label}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </Pressable>
        );
      }}
    />
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    header: { gap: 10 },
    note: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: 14, gap: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 12,
    },
    icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' },
    main: { flex: 1, gap: 2 },
    title: { fontFamily: fonts.bold, fontSize: 16, color: c.text },
    sub: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    chip: { fontFamily: fonts.semibold, fontSize: 12 },
  });
