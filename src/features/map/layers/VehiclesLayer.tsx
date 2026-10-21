import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { GlobalData } from '@/mbta/global/globalData';
import type { Vehicle } from '@/mbta/model/types';

/** Live vehicles as route-colored dots with an arrow rotated to the vehicle's bearing. */
export function VehiclesLayer({
  vehicles,
  global,
  selectedVehicleId,
  onPress,
}: {
  vehicles: Vehicle[];
  global: GlobalData | null;
  selectedVehicleId: string | null;
  onPress(v: Vehicle): void;
}) {
  return (
    <>
      {vehicles.map((v) => {
        const route = v.routeId ? global?.routes[v.routeId] : undefined;
        const selected = v.id === selectedVehicleId;
        const size = selected ? 30 : 24;
        return (
          <Marker
            key={v.id}
            identifier={`vehicle:${v.id}`}
            coordinate={{ latitude: v.latitude, longitude: v.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={selected ? 40 : 30}
            onPress={() => onPress(v)}
            accessibilityLabel={`${route?.longName ?? 'Vehicle'} ${v.label ?? ''}`.trim()}
          >
            <View
              style={[
                styles.vehicle,
                { width: size, height: size, borderRadius: size / 2, backgroundColor: route?.color ?? '#555555' },
                selected && styles.selected,
              ]}
            >
              <View style={{ transform: [{ rotate: `${v.bearing ?? 0}deg` }] }}>
                <Ionicons name={v.bearing === null ? 'ellipse' : 'arrow-up'} size={v.bearing === null ? 8 : 14} color={route?.textColor ?? '#FFFFFF'} />
              </View>
            </View>
          </Marker>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  vehicle: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  selected: { borderWidth: 3 },
});
