import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';

import type { ItineraryOverlay } from '@/state/mapOverlay';
import type { Palette } from '@/theme';

const MARKER_ICON: Record<ItineraryOverlay['markers'][number]['kind'], keyof typeof Ionicons.glyphMap> = {
  origin: 'ellipse',
  destination: 'flag',
  dock: 'bicycle',
  station: 'train',
};

/** A planned trip: dashed walking, brand-colored bike and route-colored transit legs, plus markers. */
export function ItineraryLayer({ itinerary, palette }: { itinerary: ItineraryOverlay; palette: Palette }) {
  return (
    <>
      {itinerary.legs.map((leg, i) =>
        leg.coordinates.length < 2 ? null : (
          <Polyline
            key={`leg:${i}:${leg.mode}`}
            coordinates={leg.coordinates}
            strokeColor={leg.mode === 'walk' ? palette.textMuted : leg.mode === 'bike' ? palette.brand : leg.color}
            strokeWidth={leg.mode === 'transit' ? 6 : 5}
            lineDashPattern={leg.mode === 'walk' ? [2, 8] : undefined}
            lineCap="round"
            lineJoin="round"
            zIndex={50}
          />
        ),
      )}
      {itinerary.markers.map((m, i) => (
        <Marker
          key={`marker:${i}:${m.kind}:${m.latLng.latitude},${m.latLng.longitude}`}
          coordinate={m.latLng}
          anchor={{ x: 0.5, y: 0.5 }}
          title={m.label}
          tracksViewChanges={false}
          zIndex={60}
        >
          <View
            style={[
              styles.marker,
              {
                backgroundColor: m.kind === 'destination' ? palette.brandDeep : palette.surface,
                borderColor: m.kind === 'destination' ? palette.surface : palette.brand,
              },
            ]}
          >
            <Ionicons
              name={MARKER_ICON[m.kind]}
              size={m.kind === 'origin' ? 8 : 13}
              color={m.kind === 'destination' ? palette.surface : palette.brand}
            />
          </View>
        </Marker>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  marker: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
