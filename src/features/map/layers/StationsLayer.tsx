import { memo } from 'react';
import { View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { Palette } from '@/theme';

import type { MapStation } from '../mapModel';

/**
 * Parent stations as small dots: line-colored, or white with a dark ring at transfers. Markers do
 * not track view changes, so the key changes whenever a marker's look does.
 */
export const StationsLayer = memo(function StationsLayer({
  stations,
  focusStopId,
  palette,
  scheme,
  onPress,
}: {
  stations: MapStation[];
  focusStopId: string | null;
  palette: Palette;
  scheme: string;
  onPress(stationId: string): void;
}) {
  return (
    <>
      {stations.map((s) => {
        const focused = s.id === focusStopId;
        const size = focused ? 18 : s.transfer ? 12 : 10;
        return (
          <Marker
            key={`${s.id}:${focused ? 'f' : ''}:${scheme}`}
            identifier={s.id}
            coordinate={s.latLng}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            zIndex={focused ? 20 : s.transfer ? 11 : 10}
            onPress={() => onPress(s.id)}
            accessibilityLabel={`${s.name} station`}
          >
            <View
              style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: s.transfer ? palette.surface : (s.color ?? palette.surface),
                borderColor: focused ? palette.brand : s.transfer ? palette.text : palette.surface,
                borderWidth: focused ? 4 : 2,
              }}
            />
          </Marker>
        );
      })}
    </>
  );
});
