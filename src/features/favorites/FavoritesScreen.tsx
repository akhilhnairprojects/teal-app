import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { alertPath, PATHS, pathHref, stopPath } from '@/features/shell/routes';
import { useRateLimitState, HAS_API_KEY } from '@/mbta/api/client';
import { useGlobalData } from '@/mbta/global/globalData';
import { useNow } from '@/mbta/live/usePolling';
import { useStopLiveData } from '@/mbta/live/useStopLiveData';
import { lineOrRouteName } from '@/mbta/rules/lineOrRoute';
import type { RouteCard, RouteCardLeaf } from '@/mbta/rules/routeCardData';
import { useFavorites } from '@/state/favorites';
import { fonts, radius, sheet, usePalette, type Palette } from '@/theme';
import { EmptyState, RouteCardView, RoutePill, SheetFlatList, SheetPage, StatusBanner } from '@/ui';

import { favoriteRouteCards, favoriteRouteIds, favoriteRows, favoriteStopIds, type FavoriteRow } from './favoritesModel';

export function FavoritesScreen() {
  const c = usePalette();
  const s = styles(c);
  const global = useGlobalData();
  const g = global.data;
  const fav = useFavorites();
  const [editing, setEditing] = useState(false);
  const now = useNow(10_000);

  const stopIds = useMemo(() => (g && fav.favorites.length ? favoriteStopIds(g, fav.favorites) : null), [g, fav.favorites]);
  const routeIds = useMemo(() => (g ? favoriteRouteIds(g, fav.favorites) : []), [g, fav.favorites]);
  const live = useStopLiveData(stopIds, routeIds.length ? { routeIds } : undefined);
  const rate = useRateLimitState();

  const cards = useMemo(
    () =>
      favoriteRouteCards({
        global: g,
        favorites: fav.favorites,
        keys: fav.keys,
        schedules: live.schedules,
        predictions: live.predictions.data,
        alerts: live.alerts,
        now,
      }),
    [g, fav.favorites, fav.keys, live.schedules, live.predictions.data, live.alerts, now],
  );
  const rows = useMemo(() => (g ? favoriteRows(g, fav.favorites, now) : []), [g, fav.favorites, now]);
  const unserved = rows.filter((r) => !r.served);

  const header = (
    <View style={s.headerButtons}>
      {fav.favorites.length > 0 && (
        <Pressable onPress={() => setEditing((e) => !e)} accessibilityRole="button" hitSlop={8}>
          <Text style={s.headerAction}>{editing ? 'Done' : 'Edit'}</Text>
        </Pressable>
      )}
      <Pressable onPress={() => router.push(pathHref(PATHS.more))} accessibilityRole="button" accessibilityLabel="More" hitSlop={8}>
        <Ionicons name="ellipsis-horizontal-circle-outline" size={24} color={c.brand} />
      </Pressable>
    </View>
  );

  let body;
  if (!fav.ready || (!g && fav.favorites.length > 0)) {
    body = <ActivityIndicator style={s.spinner} color={c.brand} />;
  } else if (fav.favorites.length === 0) {
    body = (
      <EmptyState
        icon="star-outline"
        title="No favorites yet"
        message="Open a stop, pick a direction, and tap the star to keep it here."
        action={{ label: 'Find a stop', onPress: () => router.push(pathHref(PATHS.search)) }}
      />
    );
  } else if (editing) {
    body = (
      <SheetFlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={s.list}
        renderItem={({ item }) => <FavoriteEditRow row={item} onRemove={() => void fav.remove(item.favorite)} />}
      />
    );
  } else {
    const banner = rate.limited ? (
      <StatusBanner kind="rateLimited" resetAt={rate.resetAt} hasApiKey={HAS_API_KEY} />
    ) : live.predictions.stale ? (
      <StatusBanner kind="stale" onRetry={() => void live.predictions.refresh()} />
    ) : null;
    body = (
      <SheetFlatList<RouteCard>
        data={cards ?? []}
        keyExtractor={(card) => card.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={banner}
        renderItem={({ item }) =>
          g ? (
            <RouteCardView
              card={item}
              now={now}
              global={g}
              showStopHeaders
              onLeafPress={(leaf: RouteCardLeaf) =>
                router.push(stopPath(leaf.stop.id, { routeId: leaf.lineOrRoute.id, directionId: leaf.direction.id }))
              }
              onAlertPress={(id) => router.push(alertPath(id))}
            />
          ) : null
        }
        ListFooterComponent={
          unserved.length ? (
            <View style={s.unserved}>
              {unserved.map((r) => (
                <FavoriteEditRow key={r.key} row={r} onRemove={() => void fav.remove(r.favorite)} />
              ))}
            </View>
          ) : null
        }
      />
    );
  }

  return (
    <SheetPage title="Favorites" right={header}>
      {body}
    </SheetPage>
  );
}

function FavoriteEditRow({ row, onRemove }: { row: FavoriteRow; onRemove: () => void }) {
  const c = usePalette();
  const s = styles(c);
  const title = row.stopName ?? 'Unknown stop';
  const subtitle = row.served
    ? [row.lineOrRoute ? lineOrRouteName(row.lineOrRoute) : null, row.directionText].filter(Boolean).join(' · ')
    : 'No longer served';
  return (
    <View style={s.editRow}>
      {row.lineOrRoute ? <RoutePill lineOrRoute={row.lineOrRoute} size="medium" type="fixed" /> : <Ionicons name="help-circle-outline" size={24} color={c.textMuted} />}
      <View style={s.editText}>
        <Text style={s.editTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[s.editSubtitle, !row.served && { color: c.warning }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${title} from favorites`}
        hitSlop={10}
        testID={`remove-${row.key}`}
      >
        <Ionicons name="remove-circle" size={24} color={c.danger} />
      </Pressable>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    headerAction: { fontFamily: fonts.bold, fontSize: 15, color: c.brand },
    spinner: { marginTop: 32 },
    list: { paddingHorizontal: sheet.horizontalPadding, paddingBottom: 32, gap: 12 },
    unserved: { gap: 12 },
    editRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    editText: { flex: 1, gap: 2 },
    editTitle: { fontFamily: fonts.bold, fontSize: 15, color: c.text },
    editSubtitle: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
  });
