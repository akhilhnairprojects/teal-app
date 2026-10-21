/**
 * Web stand-in for the map (react-native-maps has no web support): the cached rail shapes and
 * stations drawn as an inline SVG in the Teal palette, with no tiles. Fits the rail network (or the
 * overlay's `fitTo` points) into the area above the sheet.
 */
import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { stopPath, tripPath } from '@/features/shell/routes';
import { useGlobalData, useRailShapes } from '@/mbta/global/globalData';
import { useVehicles } from '@/mbta/live/useVehicles';
import { boundsOf, type Bounds, type LatLng } from '@/lib/geo';
import { useActiveMapOverlay } from '@/state/mapOverlay';
import { usePalette } from '@/theme';

import { DIMMED_OPACITY, expandRouteIds, mapStations, shapeLines, type TealMapProps } from './mapModel';

export type { TealMapProps };

const PAD = 24;
/** Smallest span drawn, so a single stop or short trip isn't zoomed absurdly far in. */
const MIN_SPAN_DEG = 0.01;

type Projection = (p: LatLng) => { x: number; y: number };

function projection(b: Bounds, box: { left: number; top: number; width: number; height: number }): Projection {
  const midLat = (b.minLatitude + b.maxLatitude) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const latSpan = Math.max(b.maxLatitude - b.minLatitude, MIN_SPAN_DEG);
  const lonSpan = Math.max((b.maxLongitude - b.minLongitude) * k, MIN_SPAN_DEG);
  const scale = Math.min(box.width / lonSpan, box.height / latSpan);
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const midLon = (b.minLongitude + b.maxLongitude) / 2;
  return (p) => ({ x: cx + (p.longitude - midLon) * k * scale, y: cy - (p.latitude - midLat) * scale });
}

const pointsAttr = (coords: LatLng[], project: Projection) =>
  coords
    .map((c) => {
      const { x, y } = project(c);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

export function TealMap({ bottomInset, topInset }: TealMapProps) {
  const c = usePalette();
  const { width, height } = useWindowDimensions();
  const global = useGlobalData().data;
  const shapes = useRailShapes();
  const overlay = useActiveMapOverlay();

  const emphasis = useMemo(() => expandRouteIds(global, overlay?.routeIds), [global, overlay?.routeIds]);
  const lines = useMemo(() => shapeLines(global, shapes, emphasis), [global, shapes, emphasis]);
  const stations = useMemo(() => (global ? mapStations(global) : []), [global]);
  const vehicleRoutes = overlay?.showVehicles && emphasis.length ? emphasis : null;
  const vehicles = useVehicles(vehicleRoutes, vehicleRoutes ? (overlay?.directionId ?? null) : null);

  const fitTo = overlay?.fitTo?.length ? overlay.fitTo : null;
  const project = useMemo(() => {
    const all = fitTo ?? [...lines.flatMap((l) => l.coordinates), ...stations.map((s) => s.latLng)];
    const b = boundsOf(all);
    if (!b) return null;
    const visibleHeight = Math.max(80, height - bottomInset - topInset - PAD * 2);
    return projection(b, { left: PAD, top: topInset + PAD, width: Math.max(80, width - PAD * 2), height: visibleHeight });
  }, [fitTo, lines, stations, width, height, bottomInset, topInset]);

  const focusStopId = overlay?.focusStopId ?? null;
  const itinerary = overlay?.itinerary ?? null;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.surfaceMuted }]} testID="teal-map">
      {project ? (
        <svg width={width} height={height} role="img" aria-label="Rail map" style={{ display: 'block' }}>
          {lines.map((l) => (
            <polyline
              key={l.key}
              points={pointsAttr(l.coordinates, project)}
              fill="none"
              stroke={l.color}
              strokeOpacity={l.dimmed ? DIMMED_OPACITY : 1}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {itinerary?.legs.map((leg, i) => (
            <polyline
              key={`leg-${i}`}
              points={pointsAttr(leg.coordinates, project)}
              fill="none"
              stroke={leg.mode === 'walk' ? c.textMuted : leg.mode === 'bike' ? c.brand : leg.color}
              strokeWidth={leg.mode === 'transit' ? 6 : 5}
              strokeDasharray={leg.mode === 'walk' ? '2 8' : undefined}
              strokeLinecap="round"
            />
          ))}
          {stations.map((s) => {
            const { x, y } = project(s.latLng);
            const focused = s.id === focusStopId;
            return (
              <circle
                key={s.id}
                cx={x}
                cy={y}
                r={focused ? 7 : s.transfer ? 4.5 : 3.5}
                fill={s.transfer || focused ? c.surface : (s.color ?? c.surface)}
                stroke={focused ? c.brand : s.transfer ? c.text : c.surface}
                strokeWidth={focused ? 3 : 1.5}
                style={{ cursor: 'pointer' }}
                onClick={() => router.push(stopPath(s.id))}
              >
                <title>{s.name}</title>
              </circle>
            );
          })}
          {itinerary?.markers.map((m, i) => {
            const { x, y } = project(m.latLng);
            return (
              <circle
                key={`marker-${i}`}
                cx={x}
                cy={y}
                r={6}
                fill={m.kind === 'destination' ? c.brandDeep : c.surface}
                stroke={c.brand}
                strokeWidth={2}
              >
                <title>{m.label}</title>
              </circle>
            );
          })}
          {(vehicleRoutes ? (vehicles.data ?? []) : []).map((v) => {
            const { x, y } = project({ latitude: v.latitude, longitude: v.longitude });
            const route = v.routeId ? global?.routes[v.routeId] : undefined;
            return (
              <circle
                key={`vehicle-${v.id}`}
                cx={x}
                cy={y}
                r={v.id === overlay?.selectedVehicleId ? 8 : 6}
                fill={route?.color ?? '#555555'}
                stroke="#FFFFFF"
                strokeWidth={2}
                style={{ cursor: v.tripId ? 'pointer' : 'default' }}
                onClick={() => {
                  if (v.tripId) router.push(tripPath(v.tripId, { vehicleId: v.id }));
                }}
              />
            );
          })}
        </svg>
      ) : null}
    </View>
  );
}
