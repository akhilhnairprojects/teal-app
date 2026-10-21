import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AlertIcon, DepartureText, RoutePill } from '@/ui';
import { fonts, radius, sheet, usePalette } from '@/theme';

import { tripCrowding } from '../trip/crowding';
import type { TileData } from './tileData';

/**
 * The least-crowded-car hint for a tile's vehicle, when it serves this trip and has car data.
 * Tiles don't know the trip's first stop, so the terminal rule is left to the trip page [ours].
 */
export function tileCarHint(t: TileData): string | null {
  return tripCrowding(t.upcoming.vehicle, t.upcoming.trip.id, false)?.hint ?? null;
}

/** Horizontal row of departure tiles (filtered stop details); a tap opens the trip. */
export function DepartureTiles({ tiles, onPress }: { tiles: TileData[]; onPress(t: TileData): void }) {
  const c = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {tiles.map((t) => {
        const trip = t.formatted.trips[0];
        const hint = tileCarHint(t);
        return (
          <Pressable
            key={t.id}
            onPress={() => onPress(t)}
            accessibilityRole="button"
            accessibilityHint="Opens trip details"
            style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? c.surfaceMuted : c.surface, borderColor: c.border }]}
          >
            <View style={styles.top}>
              {t.route ? <RoutePill route={t.route} size="small" type="fixed" /> : null}
              {t.headsign ? (
                <Text style={[styles.headsign, { color: c.text }]} numberOfLines={1}>
                  {t.headsign}
                </Text>
              ) : null}
              {t.formatted.secondaryAlert ? <AlertIcon iconName={t.formatted.secondaryAlert.iconName} size={13} /> : null}
            </View>
            {trip ? <DepartureText display={trip.format} size="large" /> : null}
            {hint ? (
              <View style={[styles.hint, { backgroundColor: c.brandSoft }]}>
                <Ionicons name="people-outline" size={12} color={c.brandDeep} />
                <Text style={[styles.hintText, { color: c.brandDeep }]}>{hint}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: sheet.horizontalPadding },
  tile: { minWidth: 120, maxWidth: 200, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headsign: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  hintText: { fontFamily: fonts.bold, fontSize: 12 },
});
