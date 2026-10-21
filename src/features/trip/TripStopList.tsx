import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AlertIcon, DepartureText, RoutePill } from '@/ui';
import { effectLabel } from '@/mbta/rules/alerts';
import type { Route, Trip } from '@/mbta/model/types';
import { fonts, radius, usePalette } from '@/theme';

import { activeElevatorAlerts, formatEntry, trackNumber, type StopListEntry, type TargetSplit } from './tripDetailsStopList';

type RowHandlers = { onStopPress(e: StopListEntry): void; onAlertPress(alertId: string): void };

function StopRow({
  entry,
  trip,
  route,
  now,
  accent,
  target,
  last,
  onStopPress,
  onAlertPress,
}: { entry: StopListEntry; trip: Trip; route: Route; now: number; accent: string; target: boolean; last: boolean } & RowHandlers) {
  const c = usePalette();
  const format = formatEntry(entry, trip, now, route);
  const track = trackNumber(entry);
  const elevator = activeElevatorAlerts(entry, now)[0];
  return (
    <Pressable
      onPress={() => onStopPress(entry)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, target && { backgroundColor: c.brandSoft }, pressed && { backgroundColor: c.surfaceMuted }]}
    >
      <View style={styles.rail}>
        <View style={[styles.line, { backgroundColor: accent }, last && styles.lineEnd]} />
        <View style={[styles.dot, { borderColor: accent, backgroundColor: target ? accent : c.surface }]} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.name, { color: c.text }, target && styles.targetName]} numberOfLines={1}>
            {entry.stop.name}
          </Text>
          {elevator ? (
            <Pressable hitSlop={8} onPress={() => onAlertPress(elevator.id)} accessibilityRole="button" accessibilityLabel="Elevator closed">
              <AlertIcon iconName="alert-borderless-elevator" size={14} color={c.textMuted} />
            </Pressable>
          ) : null}
        </View>
        {track ? <Text style={[styles.meta, { color: c.textMuted }]}>Track {track}</Text> : null}
        {entry.routes.length > 0 ? (
          <View style={styles.pills}>
            {entry.routes.map((r) => (
              <RoutePill key={r.id} route={r} size="small" type="flex" />
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.time}>
        {format?.kind === 'disruption' ? (
          <Pressable style={styles.inline} onPress={() => onAlertPress(format.alert.id)} accessibilityRole="button">
            <AlertIcon iconName={format.iconName} size={14} />
            <Text style={[styles.disruption, { color: c.danger }]}>{effectLabel(format.alert.effect)}</Text>
          </Pressable>
        ) : format?.kind === 'some' && format.trips[0] ? (
          <DepartureText display={format.trips[0].format} size="small" />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The trip's stops split around the target stop: the first stop, then the stops before the
 * target (collapsed behind a toggle), the target, and the stops after it.
 */
export function TripStopList({
  split,
  trip,
  route,
  now,
  accent,
  truncatingAlertId,
  ...handlers
}: { split: TargetSplit; trip: Trip; route: Route; now: number; accent: string; truncatingAlertId: string | null } & RowHandlers) {
  const c = usePalette();
  const [expanded, setExpanded] = useState(false);
  const collapsed = split.collapsedStops ?? [];
  const row = (e: StopListEntry, target = false, last = false) => (
    <StopRow
      key={`${e.stop.id}-${e.stopSequence}`}
      entry={e}
      trip={trip}
      route={route}
      now={now}
      accent={accent}
      target={target}
      last={last}
      {...handlers}
    />
  );
  const following = split.followingStops;
  return (
    <View style={[styles.list, { backgroundColor: c.surface, borderColor: c.border }]}>
      {split.firstStop ? row(split.firstStop) : null}
      {collapsed.length > 0 ? (
        <>
          <Pressable
            onPress={() => setExpanded((x) => !x)}
            style={styles.toggle}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
          >
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={c.textMuted} />
            <Text style={[styles.toggleText, { color: c.textMuted }]}>
              {collapsed.length === 1 ? '1 stop away' : `${collapsed.length} stops away`}
            </Text>
          </Pressable>
          {expanded ? collapsed.map((e) => row(e)) : null}
        </>
      ) : null}
      {split.targetStop ? row(split.targetStop, true, following.length === 0) : null}
      {following.map((e, i) => row(e, false, i === following.length - 1))}
      {split.isTruncatedByLastAlert ? (
        <Pressable
          style={[styles.truncated, { borderTopColor: c.border }]}
          onPress={() => truncatingAlertId && handlers.onAlertPress(truncatingAlertId)}
          accessibilityRole="button"
        >
          <Ionicons name="alert-circle-outline" size={16} color={c.danger} />
          <Text style={[styles.truncatedText, { color: c.text }]}>Service doesn’t run past this stop. See the alert for details.</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'stretch', paddingRight: 14, minHeight: 52 },
  rail: { width: 36, alignItems: 'center' },
  line: { position: 'absolute', top: 0, bottom: 0, width: 4 },
  lineEnd: { bottom: '50%' },
  dot: { marginTop: 18, width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  body: { flex: 1, paddingVertical: 12, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15 },
  targetName: { fontFamily: fonts.extrabold },
  meta: { fontFamily: fonts.medium, fontSize: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  time: { justifyContent: 'center', alignItems: 'flex-end', paddingLeft: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  disruption: { fontFamily: fonts.bold, fontSize: 13 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 36, paddingVertical: 10 },
  toggleText: { fontFamily: fonts.semibold, fontSize: 13 },
  truncated: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  truncatedText: { flex: 1, fontFamily: fonts.medium, fontSize: 13 },
});
