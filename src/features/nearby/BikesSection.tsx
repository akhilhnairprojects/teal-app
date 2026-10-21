import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { BikeStationCard } from '@/components/BikeStationCard';
import { fetchNearestBikeStations } from '@/data/bluebikes';
import { usePolling } from '@/mbta/live/usePolling';
import type { LatLng } from '@/lib/geo';
import { fonts, usePalette } from '@/theme';

/** The Bluebikes feed advertises a 60 s TTL. */
const BIKES_INTERVAL_MS = 60_000;
export const NEARBY_BIKE_COUNT = 3;

/** Compact Bluebikes section: the nearest stations, refreshed while Nearby is focused. */
export function BikesSection({ at }: { at: LatLng }) {
  const c = usePalette();
  // ~10 m rounding, so jitter doesn't refetch but walking distances stay accurate.
  const point = `${at.latitude.toFixed(4)},${at.longitude.toFixed(4)}`;
  const key = `bikes:${point}`;
  const fetcher = useCallback(
    (signal: AbortSignal) => {
      const [latitude, longitude] = point.split(',').map(Number);
      return fetchNearestBikeStations({ latitude, longitude }, NEARBY_BIKE_COUNT, signal);
    },
    [point],
  );
  const bikes = usePolling(key, fetcher, { intervalMs: BIKES_INTERVAL_MS });

  return (
    <View style={styles.section} testID="nearby-bikes">
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: c.brandSoft }]}>
          <Ionicons name="bicycle" size={16} color={c.brandDeep} />
        </View>
        <Text style={[styles.title, { color: c.text }]}>Bluebikes</Text>
      </View>
      {bikes.data ? (
        bikes.data.map((st) => <BikeStationCard key={st.id} station={st} />)
      ) : bikes.error ? (
        <Text style={[styles.note, { color: c.textMuted }]}>Couldn’t load Bluebikes stations right now.</Text>
      ) : (
        <ActivityIndicator color={c.brand} style={styles.loading} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 18 },
  note: { fontFamily: fonts.medium, fontSize: 13 },
  loading: { paddingVertical: 16 },
});
