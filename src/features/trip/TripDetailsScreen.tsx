import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { alertPath, goBack, stopPath, type TripPageParams } from '@/features/shell/routes';
import { HAS_API_KEY, useRateLimitState } from '@/mbta/api/client';
import { useNow } from '@/mbta/live/usePolling';
import { lineOrRouteFor, lineOrRouteName, resolveParentStop } from '@/mbta/rules/lineOrRoute';
import { useMapOverlay, type MapOverlay } from '@/state/mapOverlay';
import { EmptyState, RoutePill, SheetPage, SheetScrollView, StatusBanner } from '@/ui';
import { fonts, sheet, usePalette } from '@/theme';

import { tripCrowding } from './crowding';
import { TripHeaderCard } from './TripHeaderCard';
import { TripStopList } from './TripStopList';
import { splitForTarget, type StopListEntry } from './tripDetailsStopList';
import { headerStops, tripHeaderSpec } from './tripHeaderSpec';
import { useTripDetails } from './useTripDetails';

/** Trip details: vehicle header with crowding, then the stop list around the target stop. */
export function TripDetailsScreen({ params }: { params: TripPageParams | null }) {
  const c = usePalette();
  const now = useNow(10_000);
  const rate = useRateLimitState();
  const { global: g, trip, route, list, vehicle, predictions, status, retry } = useTripDetails(params);
  const [following, setFollowing] = useState(false);
  const targetStopId = params?.stopId ?? null;
  const targetSequence = params?.stopSequence ?? null;

  const lineOrRoute = g && route ? lineOrRouteFor(g, route) : null;
  const header = useMemo(() => {
    if (!g || !list || !trip) return null;
    const { terminalStop, vehicleStop } = headerStops(g, list, vehicle);
    return tripHeaderSpec(trip.id, list, terminalStop, vehicle, vehicleStop, g);
  }, [g, list, trip, vehicle]);
  const crowding = trip && header?.kind === 'vehicleOnTrip' ? tripCrowding(vehicle, trip.id, header.atTerminal) : null;
  const split = useMemo(
    () => (list ? splitForTarget(list, targetStopId ?? '', targetSequence, g) : null),
    [list, targetStopId, targetSequence, g],
  );

  const targetParentId = useMemo(() => {
    const s = targetStopId && g ? g.stops[targetStopId] : undefined;
    return s && g ? resolveParentStop(g.stops, s).id : null;
  }, [targetStopId, g]);
  const followId = following && header?.kind === 'vehicleOnTrip' ? header.vehicle.id : null;
  const overlay = useMemo<MapOverlay | null>(
    () =>
      trip
        ? { routeIds: [trip.routeId], directionId: trip.directionId, showVehicles: true, selectedVehicleId: followId, focusStopId: targetParentId }
        : null,
    [trip, followId, targetParentId],
  );
  useMapOverlay('trip-details', overlay);

  const onStopPress = (e: StopListEntry) => {
    if (!g || !lineOrRoute || !trip) return;
    router.push(stopPath(resolveParentStop(g.stops, e.stop).id, { routeId: lineOrRoute.id, directionId: trip.directionId }));
  };
  const onAlertPress = (id: string) => router.push(alertPath(id));

  const title = trip?.headsign ? `To ${trip.headsign}` : 'Trip';
  const accent = route?.color ?? c.brand;

  if (status === 'notFound' || status === 'error' || !params) {
    return (
      <SheetPage title="Trip" onBack={goBack}>
        <EmptyState
          icon="help-circle-outline"
          title={status === 'error' ? 'Couldn’t load this trip' : 'We couldn’t find this trip'}
          message={status === 'error' ? 'Check your connection and try again.' : 'It may have finished or been removed from today’s schedule.'}
          action={status === 'error' ? { label: 'Try again', onPress: retry } : { label: 'Back', onPress: goBack }}
        />
      </SheetPage>
    );
  }

  const truncating = split?.isTruncatedByLastAlert ? split.followingStops[split.followingStops.length - 1]?.disruption?.alert.id : null;

  return (
    <SheetPage title={title} onBack={goBack} right={lineOrRoute && route ? <RoutePill route={route} size="medium" type="flex" /> : undefined}>
      <SheetScrollView contentContainerStyle={styles.content}>
        {lineOrRoute ? <Text style={[styles.subtitle, { color: c.textMuted }]}>{lineOrRouteName(lineOrRoute)}</Text> : null}
        {rate.limited ? (
          <StatusBanner kind="rateLimited" resetAt={rate.resetAt} hasApiKey={HAS_API_KEY} />
        ) : predictions.stale ? (
          <StatusBanner kind="stale" onRetry={() => void predictions.refresh()} />
        ) : null}
        {status === 'loading' || !list || !trip || !route || !split ? (
          <View style={styles.loading}>
            <ActivityIndicator color={c.brand} />
            <Text style={[styles.loadingText, { color: c.textMuted }]}>Loading trip…</Text>
          </View>
        ) : (
          <>
            <TripHeaderCard
              spec={header}
              vehicle={vehicle}
              crowding={crowding}
              accent={accent}
              following={following}
              onToggleFollow={() => setFollowing((f) => !f)}
            />
            {list.stops.length === 0 && !split.firstStop ? (
              <EmptyState icon="list-outline" title="No stop times yet" message="Predictions for this trip aren’t available right now." />
            ) : (
              <TripStopList
                split={split}
                trip={trip}
                route={route}
                now={now}
                accent={accent}
                truncatingAlertId={truncating ?? null}
                onStopPress={onStopPress}
                onAlertPress={onAlertPress}
              />
            )}
          </>
        )}
      </SheetScrollView>
    </SheetPage>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: sheet.horizontalPadding, paddingBottom: 32, gap: 12 },
  subtitle: { fontFamily: fonts.semibold, fontSize: 14, marginTop: -6 },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  loadingText: { fontFamily: fonts.medium, fontSize: 14 },
});
