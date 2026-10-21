import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GlobalData } from '@/mbta/global/globalData';
import { directionLabel } from '@/mbta/rules/direction';
import type { LeafFormat } from '@/mbta/rules/leafFormat';
import { lineOrRouteColors, lineOrRouteName } from '@/mbta/rules/lineOrRoute';
import { formatLeaf, type RouteCard, type RouteCardLeaf } from '@/mbta/rules/routeCardData';
import { effectLabel } from '@/mbta/rules/alerts';
import { noTripsText, type UpcomingFormat } from '@/mbta/rules/upcomingFormat';
import { formatClock } from '@/mbta/time/eastern';
import { formatDistance } from '@/lib/geo';
import { fonts, radius, usePalette, type Palette } from '@/theme';

import { AlertIcon } from './AlertIcon';
import { DepartureText } from './DepartureText';
import { RoutePill } from './RoutePill';

type Props = {
  card: RouteCard;
  now: number;
  global: GlobalData;
  onLeafPress(leaf: RouteCardLeaf): void;
  onAlertPress?(alertId: string): void;
  showStopHeaders: boolean;
  renderLeafAccessory?(leaf: RouteCardLeaf): ReactNode;
};

/** A route card: Line/Route header, then per stop, one row per direction (MBTA Go hierarchy). */
export function RouteCardView({ card, now, global, onLeafPress, onAlertPress, showStopHeaders, renderLeafAccessory }: Props) {
  const c = usePalette();
  const s = styles(c);
  const { color } = lineOrRouteColors(card.lineOrRoute);
  return (
    <View style={s.card}>
      <View style={[s.header, { borderLeftColor: color }]}>
        <RoutePill lineOrRoute={card.lineOrRoute} size="medium" type="fixed" />
        <Text style={s.routeName} numberOfLines={1}>
          {lineOrRouteName(card.lineOrRoute)}
        </Text>
      </View>
      {card.stops.map((stopData) => (
        <View key={stopData.stop.id}>
          {showStopHeaders && (
            <View style={s.stopHeader}>
              <Text style={s.stopName} numberOfLines={1}>
                {stopData.stop.name}
              </Text>
              {stopData.distanceMeters !== null && <Text style={s.distance}>{formatDistance(stopData.distanceMeters)}</Text>}
              {stopData.elevatorAlerts.length > 0 && (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Elevator closed"
                  onPress={() => onAlertPress?.(stopData.elevatorAlerts[0].id)}
                >
                  <AlertIcon iconName="alert-borderless-elevator" size={15} color={c.textMuted} />
                </Pressable>
              )}
            </View>
          )}
          {stopData.leaves.map((leaf) => (
            <LeafRow
              key={`${leaf.direction.id}`}
              leaf={leaf}
              format={formatLeaf(leaf, now, global)}
              onPress={() => onLeafPress(leaf)}
              onAlertPress={onAlertPress}
              accessory={renderLeafAccessory?.(leaf)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function FormatView({ format, onAlertPress }: { format: UpcomingFormat; onAlertPress?: (id: string) => void }) {
  const c = usePalette();
  const s = styles(c);
  switch (format.kind) {
    case 'loading':
      return <Text style={s.muted}>Loading…</Text>;
    case 'disruption':
      return (
        <Pressable style={s.inline} onPress={() => onAlertPress?.(format.alert.id)} accessibilityRole="button">
          <AlertIcon iconName={format.iconName} size={15} />
          <Text style={s.disruption}>{effectLabel(format.alert.effect)}</Text>
        </Pressable>
      );
    case 'noTrips':
      return (
        <View style={s.inline}>
          {format.secondaryAlert && <AlertIcon iconName={format.secondaryAlert.iconName} size={14} />}
          <Text style={s.muted}>{noTripsText(format.noTrips, formatClock)}</Text>
        </View>
      );
    case 'some':
      return (
        <View style={s.inline}>
          {format.secondaryAlert && (
            <Pressable hitSlop={6} onPress={() => onAlertPress?.(format.secondaryAlert!.alertId)} accessibilityLabel="Service alert">
              <AlertIcon iconName={format.secondaryAlert.iconName} size={14} />
            </Pressable>
          )}
          <View style={s.trips}>
            {format.trips.map((t) => (
              <DepartureText key={t.id} display={t.format} size="medium" />
            ))}
          </View>
        </View>
      );
  }
}

function LeafRow({
  leaf,
  format,
  onPress,
  onAlertPress,
  accessory,
}: {
  leaf: RouteCardLeaf;
  format: LeafFormat;
  onPress: () => void;
  onAlertPress?: (id: string) => void;
  accessory?: ReactNode;
}) {
  const c = usePalette();
  const s = styles(c);
  const label = directionLabel(leaf.direction);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.leaf, pressed && { backgroundColor: c.surfaceMuted }]} accessibilityRole="button">
      <View style={s.leafBody}>
        {format.kind === 'single' ? (
          <>
            <View style={s.inline}>
              {format.route && <RoutePill route={format.route} size="small" type="fixed" />}
              <Text style={s.direction} numberOfLines={1}>
                {format.headsign && format.headsign !== leaf.direction.destination ? format.headsign : label}
              </Text>
            </View>
            <FormatView format={format.format} onAlertPress={onAlertPress} />
          </>
        ) : (
          <>
            <View style={s.inline}>
              {format.secondaryAlert && <AlertIcon iconName={format.secondaryAlert.iconName} size={14} />}
              <Text style={s.direction} numberOfLines={1}>
                {label}
              </Text>
            </View>
            {format.rows.map((row) => (
              <View key={row.id} style={s.branchRow}>
                <View style={s.inline}>
                  {row.route && <RoutePill route={row.route} size="small" type="fixed" />}
                  <Text style={s.headsign} numberOfLines={1}>
                    {row.headsign}
                  </Text>
                </View>
                <FormatView format={row.format} onAlertPress={onAlertPress} />
              </View>
            ))}
          </>
        )}
      </View>
      {accessory}
      <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
    </Pressable>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderLeftWidth: 4,
      backgroundColor: c.surfaceMuted,
    },
    routeName: { flex: 1, fontFamily: fonts.bold, fontSize: 16, color: c.text },
    stopHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10 },
    stopName: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: c.text },
    distance: { fontFamily: fonts.medium, fontSize: 12, color: c.textMuted },
    leaf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    leafBody: { flex: 1, gap: 6 },
    inline: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
    direction: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14, color: c.textMuted },
    headsign: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    branchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    trips: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    muted: { fontFamily: fonts.medium, fontSize: 14, color: c.textMuted },
    disruption: { fontFamily: fonts.bold, fontSize: 14, color: c.danger },
  });
