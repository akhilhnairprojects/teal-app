import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import MapView, { type Details, type Region } from 'react-native-maps';

import { stopPath, tripPath } from '@/features/shell/routes';
import { TerritoryLayer, type TerritoryRegion } from '@/features/territory/TerritoryLayer';
import { useGlobalData, useRailShapes } from '@/mbta/global/globalData';
import { useVehicles } from '@/mbta/live/useVehicles';
import type { Vehicle } from '@/mbta/model/types';
import { PARK_STREET, type LatLng } from '@/lib/geo';
import { useActiveMapOverlay } from '@/state/mapOverlay';
import { usePalette } from '@/theme';

import { ItineraryLayer } from './layers/ItineraryLayer';
import { RailShapesLayer } from './layers/RailShapesLayer';
import { StationsLayer } from './layers/StationsLayer';
import { TrackLayer } from './layers/TrackLayer';
import { VehiclesLayer } from './layers/VehiclesLayer';
import {
  backToMyLocation,
  noteMapTouchMove,
  noteProgrammaticMove,
  onMapRegionSettled,
  useRecenterSeq,
  useUserLocation,
} from './mapCenter';
import { expandRouteIds, mapStations, shapeLines, STATION_ZOOM_LIMIT, visibleStations, type TealMapProps } from './mapModel';

export type { TealMapProps };

const INITIAL_DELTA = 0.035;
const INITIAL_REGION: Region = { ...PARK_STREET, latitudeDelta: INITIAL_DELTA, longitudeDelta: INITIAL_DELTA };
const ANIMATION_MS = 450;
const FIT_PADDING = 48;

/**
 * Full-screen Apple Map behind the sheet: rail shapes and stations from global data, plus whatever
 * the focused screen declares through `useMapOverlay` (route emphasis, live vehicles, a focused
 * stop, an itinerary). Taps navigate the sheet.
 */
export function TealMap({ bottomInset, topInset }: TealMapProps) {
  const c = usePalette();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { height } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);

  const global = useGlobalData().data;
  const shapes = useRailShapes();
  const overlay = useActiveMapOverlay();
  const user = useUserLocation();
  const recenterSeq = useRecenterSeq();

  const emphasis = useMemo(() => expandRouteIds(global, overlay?.routeIds), [global, overlay?.routeIds]);
  const lines = useMemo(() => shapeLines(global, shapes, emphasis), [global, shapes, emphasis]);
  const stations = useMemo(() => (global ? mapStations(global) : []), [global]);
  const [zoomedOut, setZoomedOut] = useState(INITIAL_DELTA > STATION_ZOOM_LIMIT);
  // The settled region, for layers that fetch by viewport (territory).
  const [region, setRegion] = useState<TerritoryRegion | null>(null);
  const followUser = overlay?.followUser === true;
  const lastRegion = useRef<TerritoryRegion | null>(null);
  const wantsRegion = Boolean(overlay?.territory);
  useEffect(() => {
    if (wantsRegion) setRegion(lastRegion.current);
  }, [wantsRegion]);
  const focusStopId = overlay?.focusStopId ?? null;
  const shownStations = useMemo(
    () => visibleStations(stations, zoomedOut ? Infinity : 0, focusStopId),
    [stations, zoomedOut, focusStopId],
  );

  // Vehicles only when a screen asks for them (stop and trip pages) [MA §3.5].
  const vehicleRoutes = overlay?.showVehicles && emphasis.length ? emphasis : null;
  const vehicles = useVehicles(vehicleRoutes, vehicleRoutes ? (overlay?.directionId ?? null) : null);
  const vehicleList = vehicleRoutes ? (vehicles.data ?? []) : [];
  const selectedVehicleId = overlay?.selectedVehicleId ?? null;

  const animateTo = useCallback((center: LatLng) => {
    noteProgrammaticMove();
    mapRef.current?.animateCamera({ center }, { duration: ANIMATION_MS });
  }, []);

  // Center on the device once its first fix arrives; the fallback is already the initial region.
  const centeredOnUser = useRef(false);
  useEffect(() => {
    if (centeredOnUser.current || user.status !== 'ready' || user.source !== 'device') return;
    centeredOnUser.current = true;
    animateTo(user.coords);
  }, [user, animateTo]);

  // "Back to my location".
  useEffect(() => {
    if (recenterSeq === 0) return;
    animateTo(user.status === 'ready' ? user.coords : PARK_STREET);
    // Only a new request re-centers; later location fixes don't move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterSeq, animateTo]);

  // Fit to an itinerary or other requested points.
  const fitKey = overlay?.fitTo?.length ? JSON.stringify(overlay.fitTo) : null;
  useEffect(() => {
    if (!fitKey) return;
    const points = JSON.parse(fitKey) as LatLng[];
    noteProgrammaticMove();
    if (points.length === 1) {
      mapRef.current?.animateCamera({ center: points[0] }, { duration: ANIMATION_MS });
      return;
    }
    mapRef.current?.fitToCoordinates(points, {
      edgePadding: { top: FIT_PADDING, right: FIT_PADDING, bottom: FIT_PADDING, left: FIT_PADDING },
      animated: true,
    });
  }, [fitKey]);

  // Center on a newly focused stop (unless the screen asked for a fit).
  const focusLatLng = focusStopId && global?.stops[focusStopId] ? global.stops[focusStopId] : null;
  const focusKey = focusLatLng && !fitKey ? `${focusLatLng.latitude},${focusLatLng.longitude}` : null;
  useEffect(() => {
    if (!focusKey) return;
    const [latitude, longitude] = focusKey.split(',').map(Number);
    animateTo({ latitude, longitude });
  }, [focusKey, animateTo]);

  // Follow mode: re-center on the selected vehicle at each update.
  const followed = selectedVehicleId ? vehicleList.find((v) => v.id === selectedVehicleId) : undefined;
  const followKey = followed ? `${followed.latitude},${followed.longitude}` : null;
  useEffect(() => {
    if (!followKey) return;
    const [latitude, longitude] = followKey.split(',').map(Number);
    animateTo({ latitude, longitude });
  }, [followKey, animateTo]);

  const onRegionChangeComplete = useCallback(
    (region: Region, details?: Details) => {
      setZoomedOut(region.latitudeDelta > STATION_ZOOM_LIMIT);
      lastRegion.current = {
        latitude: region.latitude,
        longitude: region.longitude,
        latitudeDelta: region.latitudeDelta,
        longitudeDelta: region.longitudeDelta,
      };
      // Re-render for the region only while a viewport-fetching layer is shown.
      if (wantsRegion) setRegion(lastRegion.current);
      // The region spans the whole view; Nearby uses the center of the part above the sheet.
      const shift = height > 0 ? (region.latitudeDelta * (bottomInset - topInset)) / 2 / height : 0;
      onMapRegionSettled({ latitude: region.latitude + shift, longitude: region.longitude }, details?.isGesture);
    },
    [bottomInset, topInset, height, wantsRegion],
  );

  const openStation = useCallback((id: string) => router.push(stopPath(id)), []);
  const openVehicle = useCallback((v: Vehicle) => {
    if (v.tripId) router.push(tripPath(v.tripId, { vehicleId: v.id }));
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} onTouchMove={noteMapTouchMove}>
      <MapView
        ref={mapRef}
        testID="teal-map"
        style={StyleSheet.absoluteFill}
        initialRegion={INITIAL_REGION}
        userInterfaceStyle={scheme}
        showsUserLocation={followUser || (user.status === 'ready' && user.source === 'device')}
        followsUserLocation={followUser}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        mapPadding={{ top: topInset, right: 0, bottom: bottomInset, left: 0 }}
        onRegionChangeComplete={onRegionChangeComplete}
      >
        {overlay?.territory ? (
          <TerritoryLayer month={overlay.territory.month} region={region} highlightUserId={overlay.territory.highlightUserId ?? null} />
        ) : null}
        <RailShapesLayer lines={lines} />
        <StationsLayer stations={shownStations} focusStopId={focusStopId} palette={c} scheme={scheme} onPress={openStation} />
        {overlay?.itinerary ? <ItineraryLayer itinerary={overlay.itinerary} palette={c} /> : null}
        {overlay?.tracks?.length ? <TrackLayer tracks={overlay.tracks} /> : null}
        <VehiclesLayer vehicles={vehicleList} global={global} selectedVehicleId={selectedVehicleId} onPress={openVehicle} />
      </MapView>
      <Pressable
        testID="map-recenter"
        accessibilityRole="button"
        accessibilityLabel="Back to my location"
        onPress={backToMyLocation}
        style={({ pressed }) => [
          styles.recenter,
          { top: topInset + 12, backgroundColor: c.surface, borderColor: c.border, shadowColor: '#000' },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Ionicons name="locate" size={20} color={c.brand} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  recenter: {
    position: 'absolute',
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
