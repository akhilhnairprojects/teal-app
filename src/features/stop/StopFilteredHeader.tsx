import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DirectionId } from '@/mbta/model/types';
import { directionLabel, type Direction } from '@/mbta/rules/direction';
import { lineOrRouteName, type LineOrRoute } from '@/mbta/rules/lineOrRoute';
import { RoutePill } from '@/ui';
import { fonts, radius, sheet, usePalette } from '@/theme';

/** Route filter pills for every route at the stop; the selected one is highlighted. */
export function RouteFilterPills({
  routes,
  selectedId,
  onSelect,
}: {
  routes: LineOrRoute[];
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const c = usePalette();
  if (routes.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
      {routes.map((lr) => {
        const selected = lr.id === selectedId;
        return (
          <Pressable
            key={lr.id}
            onPress={() => onSelect(lr.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={lineOrRouteName(lr)}
            style={[styles.pillWrap, { borderColor: selected ? c.text : 'transparent', opacity: selected || selectedId === null ? 1 : 0.6 }]}
          >
            <RoutePill lineOrRoute={lr} size="medium" type="flex" />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Filtered header: route pill and name, favorite star, clear button, then the direction picker. */
export function StopFilteredHeader({
  lineOrRoute,
  directions,
  directionId,
  isFavorite,
  onToggleFavorite,
  onSelectDirection,
  onClear,
}: {
  lineOrRoute: LineOrRoute;
  directions: Direction[];
  directionId: DirectionId;
  isFavorite: boolean;
  onToggleFavorite(): void;
  onSelectDirection(d: DirectionId): void;
  onClear(): void;
}) {
  const c = usePalette();
  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <RoutePill lineOrRoute={lineOrRoute} size="large" type="fixed" />
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {lineOrRouteName(lineOrRoute)}
        </Text>
        <Pressable
          onPress={onToggleFavorite}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityState={{ selected: isFavorite }}
          accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Ionicons name={isFavorite ? 'star' : 'star-outline'} size={22} color={isFavorite ? c.brand : c.textMuted} />
        </Pressable>
        <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button" accessibilityLabel="Show all routes">
          <Ionicons name="close-circle" size={22} color={c.textMuted} />
        </Pressable>
      </View>
      {directions.length > 0 ? (
        <View style={[styles.picker, { backgroundColor: c.surfaceMuted }]} accessibilityRole="tablist">
          {directions.map((d) => {
            const selected = d.id === directionId;
            return (
              <Pressable
                key={d.id}
                onPress={() => onSelectDirection(d.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={[styles.segment, selected && { backgroundColor: c.surface }]}
              >
                {d.name ? <Text style={[styles.dirName, { color: c.textMuted }]}>{`${d.name}bound`}</Text> : null}
                <Text style={[styles.dirDest, { color: selected ? c.text : c.textMuted }]} numberOfLines={1}>
                  {d.destination ?? directionLabel(d)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pills: { gap: 6, paddingHorizontal: sheet.horizontalPadding },
  pillWrap: { borderWidth: 2, borderRadius: radius.pill, padding: 2 },
  wrap: { gap: 10, paddingHorizontal: sheet.horizontalPadding },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontFamily: fonts.bold, fontSize: 17 },
  picker: { flexDirection: 'row', borderRadius: radius.md, padding: 3, gap: 3 },
  segment: { flex: 1, borderRadius: radius.md - 3, paddingVertical: 8, paddingHorizontal: 10 },
  dirName: { fontFamily: fonts.medium, fontSize: 12 },
  dirDest: { fontFamily: fonts.bold, fontSize: 15 },
});
