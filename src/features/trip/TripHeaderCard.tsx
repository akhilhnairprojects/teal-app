import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CarCrowdingDiagram, CrowdingBadge } from '@/ui';
import { formatClock } from '@/mbta/time/eastern';
import type { Vehicle } from '@/mbta/model/types';
import { stopTimeOf } from '@/mbta/rules/tripInstantDisplay';
import { fonts, radius, usePalette } from '@/theme';

import type { TripCrowding } from './crowding';
import { trackNumber } from './tripDetailsStopList';
import { headerText, type TripHeaderSpec } from './tripHeaderSpec';

/**
 * Vehicle status ("Next stop Park Street"), track, crowding with the least-crowded car, and the
 * Follow toggle for a vehicle on this trip.
 */
export function TripHeaderCard({
  spec,
  vehicle,
  crowding,
  accent,
  following,
  onToggleFollow,
}: {
  spec: TripHeaderSpec | null;
  vehicle: Vehicle | null;
  crowding: TripCrowding | null;
  accent: string;
  following: boolean;
  onToggleFollow?: () => void;
}) {
  const c = usePalette();
  const { status, stopName } = headerText(spec);
  const entry = spec?.kind === 'vehicleOnTrip' || spec?.kind === 'scheduled' ? spec.entry : null;
  const track = entry ? trackNumber(entry) : null;
  const scheduledAt = spec?.kind === 'scheduled' ? stopTimeOf(spec.entry.schedule ?? spec.entry.prediction) : null;
  const canFollow = spec?.kind === 'vehicleOnTrip' && vehicle !== null && onToggleFollow !== undefined;
  const icon: keyof typeof Ionicons.glyphMap =
    spec?.kind === 'vehicleOnTrip' ? 'train' : spec?.kind === 'scheduled' ? 'time-outline' : 'help-circle-outline';

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, borderLeftColor: accent }]}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: c.surfaceMuted }]}>
          <Ionicons name={icon} size={18} color={c.text} />
        </View>
        <View style={styles.body} accessible accessibilityLabel={[status, stopName].filter(Boolean).join(' ')}>
          <Text style={[styles.status, { color: c.textMuted }]}>{status}</Text>
          {stopName ? (
            <Text style={[styles.stop, { color: c.text }]} numberOfLines={2}>
              {stopName}
            </Text>
          ) : null}
          {scheduledAt !== null ? <Text style={[styles.meta, { color: c.textMuted }]}>at {formatClock(scheduledAt)}</Text> : null}
          {track ? <Text style={[styles.meta, { color: c.textMuted }]}>Track {track}</Text> : null}
        </View>
        {canFollow ? (
          <Pressable
            onPress={onToggleFollow}
            accessibilityRole="switch"
            accessibilityState={{ checked: following }}
            accessibilityLabel="Follow this train on the map"
            style={[styles.follow, { backgroundColor: following ? c.brand : c.surfaceMuted }]}
          >
            <Ionicons name={following ? 'navigate' : 'navigate-outline'} size={14} color={following ? c.onBrand : c.text} />
            <Text style={[styles.followText, { color: following ? c.onBrand : c.text }]}>{following ? 'Following' : 'Follow'}</Text>
          </Pressable>
        ) : null}
      </View>

      {crowding ? (
        <View style={[styles.crowding, { borderTopColor: c.border }]}>
          <CrowdingBadge level={crowding.level} />
          {crowding.hint && crowding.recommendation ? (
            <View
              style={[styles.hint, { backgroundColor: c.brandSoft }]}
              accessible
              accessibilityLabel={`${crowding.recommendation.label}, least crowded. Car 1 is at the front.`}
            >
              <Ionicons name="people-outline" size={16} color={c.brandDeep} />
              <Text style={[styles.hintText, { color: c.brandDeep }]}>{crowding.hint}</Text>
              <Text style={[styles.hintMeta, { color: c.brandDeep }]}>
                of {crowding.recommendation.carCount} · least crowded
              </Text>
            </View>
          ) : null}
          {crowding.hasCars && vehicle ? <CarCrowdingDiagram carriages={vehicle.carriages} recommendation={crowding.recommendation} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 4, padding: 14, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  status: { fontFamily: fonts.semibold, fontSize: 13 },
  stop: { fontFamily: fonts.bold, fontSize: 18 },
  meta: { fontFamily: fonts.medium, fontSize: 13 },
  follow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  followText: { fontFamily: fonts.bold, fontSize: 13 },
  crowding: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  hintText: { fontFamily: fonts.extrabold, fontSize: 16 },
  hintMeta: { fontFamily: fonts.medium, fontSize: 13 },
});
