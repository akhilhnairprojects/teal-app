import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { alertPath, goBack, stopFilterParams, tripPath, type StopFilter } from '@/features/shell/routes';
import { HAS_API_KEY, useRateLimitState } from '@/mbta/api/client';
import { useGlobalData } from '@/mbta/global/globalData';
import { useStopLiveData } from '@/mbta/live/useStopLiveData';
import { useNow } from '@/mbta/live/usePolling';
import { noPredictionsStatus } from '@/mbta/rules/leafFormat';
import { allRoutes, sortRoute } from '@/mbta/rules/lineOrRoute';
import { formatLeaf, routeCardsForStopList, type RouteCardLeaf } from '@/mbta/rules/routeCardData';
import { noTripsText } from '@/mbta/rules/upcomingFormat';
import { upcomingStopId, upcomingStopSequence } from '@/mbta/rules/upcomingTrip';
import { formatClock } from '@/mbta/time/eastern';
import { useFavorites } from '@/state/favorites';
import { useMapOverlay, type MapOverlay } from '@/state/mapOverlay';
import { recordStopVisit } from '@/state/recents';
import { EmptyState, RouteCardView, SheetPage, SheetScrollView, StatusBanner } from '@/ui';
import { fonts, sheet, usePalette } from '@/theme';

import { DepartureTiles } from './DepartureTiles';
import { StopAlertCards, stopAlertCards } from './StopAlertCards';
import { RouteFilterPills, StopFilteredHeader } from './StopFilteredHeader';
import { favoriteFor, normalizeFilter, selectFiltered, stopPageStopIds } from './stopFilter';
import { tileDataFor, type TileData } from './tileData';

const setFilter = (f: StopFilter | null) => router.setParams(stopFilterParams(f));

/**
 * Stop details. Unfiltered: every route card at the stop. Filtered (route + direction params):
 * the direction picker, departure tiles with no row limit, and the leaf's alert cards.
 */
export function StopDetailsScreen({ stopId, filter: rawFilter }: { stopId: string; filter: StopFilter | null }) {
  const c = usePalette();
  const now = useNow(10_000);
  const rate = useRateLimitState();
  const { data: g, status: globalStatus } = useGlobalData();
  const favorites = useFavorites();

  const ids = useMemo(() => (g ? stopPageStopIds(g, stopId) : null), [g, stopId]);
  const filter = useMemo(() => (g ? normalizeFilter(g, rawFilter) : null), [g, rawFilter]);
  const parentId = ids?.parentId ?? null;
  const stop = parentId && g ? g.stops[parentId] : null;

  useEffect(() => {
    if (parentId) void recordStopVisit(parentId);
  }, [parentId]);

  // Unfiltered live data for the whole stop, so switching filters doesn't refetch.
  const live = useStopLiveData(ids?.liveIds ?? null);
  const cards = useMemo(
    () =>
      g && ids
        ? routeCardsForStopList({
            stopIds: ids.allIds,
            global: g,
            sortByDistanceFrom: null,
            schedules: live.schedules,
            predictions: live.predictions.data,
            alerts: live.alerts,
            now,
            context: filter ? 'stopDetailsFiltered' : 'stopDetailsUnfiltered',
          })
        : null,
    [g, ids, live.schedules, live.predictions.data, live.alerts, now, filter],
  );
  const selected = useMemo(() => selectFiltered(cards, filter), [cards, filter]);

  const overlay = useMemo<MapOverlay | null>(() => {
    if (!parentId) return null;
    if (!selected) return { focusStopId: parentId };
    return {
      routeIds: allRoutes(selected.card.lineOrRoute).map((r) => r.id),
      directionId: filter!.directionId,
      showVehicles: true,
      focusStopId: parentId,
    };
  }, [parentId, selected, filter]);
  useMapOverlay('stop-details', overlay);

  if (!g || !ids || !stop) {
    const missing = g !== null || globalStatus === 'error';
    return (
      <SheetPage title="Stop" onBack={goBack}>
        {missing ? (
          <EmptyState
            icon="location-outline"
            title={g ? 'We couldn’t find this stop' : 'Couldn’t load stations'}
            message={g ? 'Teal covers subway and Mattapan stations.' : 'Check your connection and try again.'}
            action={{ label: 'Back', onPress: goBack }}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={c.brand} />
          </View>
        )}
      </SheetPage>
    );
  }

  const fav = filter ? favoriteFor(g, parentId!, filter) : null;
  const onLeafPress = (leaf: RouteCardLeaf) => setFilter({ routeId: leaf.lineOrRoute.id, directionId: leaf.direction.id });
  const onAlertPress = (id: string) => router.push(alertPath(id));
  const onTilePress = (t: TileData) =>
    router.push(
      tripPath(t.upcoming.trip.id, {
        stopId: upcomingStopId(t.upcoming) ?? parentId,
        stopSequence: upcomingStopSequence(t.upcoming),
        vehicleId: t.upcoming.vehicle?.id ?? t.upcoming.prediction?.vehicleId ?? null,
      }),
    );

  const banner = rate.limited ? (
    <StatusBanner kind="rateLimited" resetAt={rate.resetAt} hasApiKey={HAS_API_KEY} />
  ) : live.predictions.stale ? (
    <StatusBanner kind="stale" onRetry={() => void live.predictions.refresh()} />
  ) : null;

  return (
    <SheetPage title={stop.name} onBack={goBack}>
      <SheetScrollView contentContainerStyle={styles.content}>
        {cards && cards.length > 1 ? (
          <RouteFilterPills
            routes={cards.map((card) => card.lineOrRoute)}
            selectedId={filter?.routeId ?? null}
            onSelect={(id) => {
              const card = cards.find((x) => x.id === id);
              const dir = filter?.directionId ?? card?.stops[0]?.leaves[0]?.direction.id ?? 0;
              setFilter(id === filter?.routeId ? null : { routeId: id, directionId: dir });
            }}
          />
        ) : null}
        {banner ? <View style={styles.padded}>{banner}</View> : null}
        {cards === null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={c.brand} />
          </View>
        ) : filter ? (
          selected ? (
            <FilteredBody
              selected={selected}
              filter={filter}
              now={now}
              isFavorite={fav ? favorites.isFavorite(fav) : false}
              onToggleFavorite={() => fav && void favorites.toggle(fav)}
              onTilePress={onTilePress}
              onAlertPress={onAlertPress}
            />
          ) : (
            <EmptyState
              icon="git-branch-outline"
              title="This route doesn’t stop here"
              action={{ label: 'Show all routes', onPress: () => setFilter(null) }}
            />
          )
        ) : cards.length === 0 ? (
          <EmptyState icon="train-outline" title="No rail service at this stop" />
        ) : (
          <View style={[styles.padded, styles.cards]}>
            {cards.map((card) => (
              <RouteCardView
                key={card.id}
                card={card}
                now={now}
                global={g}
                showStopHeaders={false}
                onLeafPress={onLeafPress}
                onAlertPress={onAlertPress}
              />
            ))}
          </View>
        )}
      </SheetScrollView>
    </SheetPage>
  );
}

function FilteredBody({
  selected,
  filter,
  now,
  isFavorite,
  onToggleFavorite,
  onTilePress,
  onAlertPress,
}: {
  selected: NonNullable<ReturnType<typeof selectFiltered>>;
  filter: StopFilter;
  now: number;
  isFavorite: boolean;
  onToggleFavorite(): void;
  onTilePress(t: TileData): void;
  onAlertPress(id: string): void;
}) {
  const c = usePalette();
  const { data: g } = useGlobalData();
  const { card, stopData, leaf } = selected;
  const format = leaf && g ? formatLeaf(leaf, now, g) : null;
  const tiles = format && leaf ? tileDataFor(format, leaf.direction.destination) : [];
  const alertCards = stopAlertCards(leaf, now);
  const route = sortRoute(card.lineOrRoute);

  let empty: string | null = null;
  if (!leaf) empty = 'No departures in this direction';
  else if (tiles.length === 0 && format) {
    if (format.kind === 'single' && format.format.kind === 'loading') empty = 'Loading…';
    else if (format.kind === 'single' && format.format.kind === 'disruption') empty = null;
    else {
      const status = noPredictionsStatus(format);
      empty = status ? noTripsText(status, formatClock) : 'No upcoming departures';
    }
  }

  return (
    <View style={styles.filtered}>
      <StopFilteredHeader
        lineOrRoute={card.lineOrRoute}
        directions={stopData.directions}
        directionId={filter.directionId}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        onSelectDirection={(d) => setFilter({ routeId: filter.routeId, directionId: d })}
        onClear={() => setFilter(null)}
      />
      {tiles.length > 0 ? <DepartureTiles tiles={tiles} onPress={onTilePress} /> : null}
      {empty ? <Text style={[styles.empty, { color: c.textMuted }]}>{empty}</Text> : null}
      <View style={styles.padded}>
        <StopAlertCards cards={alertCards} route={route} onPress={onAlertPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32, gap: 12 },
  padded: { paddingHorizontal: sheet.horizontalPadding },
  cards: { gap: 12 },
  filtered: { gap: 14 },
  loading: { paddingVertical: 32, alignItems: 'center' },
  empty: { fontFamily: fonts.semibold, fontSize: 15, paddingHorizontal: sheet.horizontalPadding },
});
