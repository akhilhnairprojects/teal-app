import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { goBack, goToTab, planPath, stopPath } from '@/features/shell/routes';
import { useGlobalData, type GlobalData } from '@/mbta/global/globalData';
import type { Stop } from '@/mbta/model/types';
import { lineOrRouteName, type LineOrRoute } from '@/mbta/rules/lineOrRoute';
import { recordStopVisit, useRecentStops } from '@/state/recents';
import { fonts, radius, sheet, usePalette, type Palette } from '@/theme';
import { EmptyState, RoutePill, SheetPage, SheetScrollView } from '@/ui';

import { searchResults, stationsOnRoute, useDebouncedValue } from './searchModel';

/** Plan is a tab: switch to it (dismissing Search) rather than pushing a second tab page. */
const planTo = (q: string) => goToTab(planPath({ q }));

function openStop(stop: Stop) {
  void recordStopVisit(stop.id);
  router.push(stopPath(stop.id));
}

export function SearchScreen() {
  const c = usePalette();
  const s = styles(c);
  const params = useLocalSearchParams<{ q?: string }>();
  const [text, setText] = useState(typeof params.q === 'string' ? params.q : '');
  const query = useDebouncedValue(text);
  const global = useGlobalData();
  const recents = useRecentStops();

  // Keep ?q in sync so back/forward and deep links restore the query.
  useEffect(() => {
    if ((params.q ?? '') !== query) router.setParams({ q: query });
  }, [query, params.q]);

  return (
    <SheetPage title="Search" onBack={goBack}>
      <View style={s.field}>
        <Ionicons name="search" size={18} color={c.textMuted} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Station, line, or place"
          placeholderTextColor={c.textMuted}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => text.trim() && planTo(text)}
          style={s.input}
          accessibilityLabel="Search"
        />
        {text ? (
          <Pressable onPress={() => setText('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={c.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {global.data ? (
        <Results g={global.data} query={query} recentIds={recents.stopIds} />
      ) : global.status === 'error' ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn’t load stations" message={global.error ?? undefined} action={{ label: 'Try again', onPress: global.refresh }} />
      ) : (
        <ActivityIndicator style={s.spinner} color={c.brand} accessibilityLabel="Loading stations" />
      )}
    </SheetPage>
  );
}

function Results({ g, query, recentIds }: { g: GlobalData; query: string; recentIds: string[] }) {
  const c = usePalette();
  const s = styles(c);
  const results = useMemo(() => searchResults(g, query, recentIds), [g, query, recentIds]);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (results.kind === 'recents') {
    if (results.recents.length === 0) {
      return <EmptyState icon="search" title="Find a station or line" message="Stations you open show up here." />;
    }
    return (
      <SheetScrollView contentContainerStyle={s.list}>
        <Text style={s.section}>Recent stops</Text>
        {results.recents.map(({ stop, routeIds }) => (
          <StationRow key={stop.id} g={g} stop={stop} routeIds={routeIds} icon="time-outline" />
        ))}
      </SheetScrollView>
    );
  }

  const none = results.routes.length === 0 && results.stations.length === 0;
  return (
    <SheetScrollView contentContainerStyle={s.list}>
      <Pressable style={s.row} onPress={() => planTo(results.query)} accessibilityRole="button">
        <Ionicons name="navigate-circle-outline" size={22} color={c.brand} />
        <Text style={[s.rowTitle, { color: c.brand }]} numberOfLines={1}>
          Plan a trip to ‘{results.query}’
        </Text>
      </Pressable>
      {results.routes.length > 0 && <Text style={s.section}>Lines</Text>}
      {results.routes.map((lr) => (
        <RouteResult key={lr.id} g={g} lr={lr} open={expanded === lr.id} onToggle={() => setExpanded((e) => (e === lr.id ? null : lr.id))} />
      ))}
      {results.stations.length > 0 && <Text style={s.section}>Stations</Text>}
      {results.stations.map((m) => (
        <StationRow key={m.stop.id} g={g} stop={m.stop} routeIds={m.routeIds} icon="location-outline" />
      ))}
      {none && <Text style={s.muted}>No stations or lines match “{results.query}”.</Text>}
    </SheetScrollView>
  );
}

function RouteResult({ g, lr, open, onToggle }: { g: GlobalData; lr: LineOrRoute; open: boolean; onToggle: () => void }) {
  const c = usePalette();
  const s = styles(c);
  const stations = useMemo(() => (open ? stationsOnRoute(g, lr) : []), [g, lr, open]);
  return (
    <View>
      <Pressable style={s.row} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <RoutePill lineOrRoute={lr} size="medium" type="fixed" />
        <Text style={s.rowTitle} numberOfLines={1}>
          {lineOrRouteName(lr)}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.textMuted} />
      </Pressable>
      {open &&
        stations.map((stop) => (
          <Pressable key={stop.id} style={s.subRow} onPress={() => openStop(stop)} accessibilityRole="button">
            <View style={[s.dot, { borderColor: lr.kind === 'line' ? lr.line.color : lr.route.color }]} />
            <Text style={s.subTitle} numberOfLines={1}>
              {stop.name}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}

function StationRow({ g, stop, routeIds, icon }: { g: GlobalData; stop: Stop; routeIds: string[]; icon: keyof typeof Ionicons.glyphMap }) {
  const c = usePalette();
  const s = styles(c);
  return (
    <Pressable style={s.row} onPress={() => openStop(stop)} accessibilityRole="button">
      <Ionicons name={icon} size={20} color={c.textMuted} />
      <Text style={s.rowTitle} numberOfLines={1}>
        {stop.name}
      </Text>
      <View style={s.pills}>
        {routeIds.map((id) => {
          const route = g.routes[id];
          return route ? <RoutePill key={id} route={route} size="small" type="flex" context="searchStation" /> : null;
        })}
      </View>
    </Pressable>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: sheet.horizontalPadding,
      marginBottom: 8,
      paddingHorizontal: 12,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: c.surfaceMuted,
    },
    input: { flex: 1, fontFamily: fonts.medium, fontSize: 16, color: c.text, paddingVertical: 0 },
    spinner: { marginTop: 32 },
    list: { paddingHorizontal: sheet.horizontalPadding, paddingBottom: 32 },
    section: { fontFamily: fonts.bold, fontSize: 13, color: c.textMuted, marginTop: 16, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    pills: { flexDirection: 'row', gap: 4, flexShrink: 0 },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 18 },
    dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, backgroundColor: c.surface },
    subTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: c.text },
    muted: { fontFamily: fonts.medium, fontSize: 14, color: c.textMuted, marginTop: 16, textAlign: 'center' },
  });
