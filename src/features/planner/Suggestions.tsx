import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { OSM_ATTRIBUTION, type Suggestions as SuggestionData } from '@/geocode';
import type { Place } from '@/planner/types';
import { fonts, radius, usePalette, type Palette } from '@/theme';

/** Station matches first, then OpenStreetMap places (with attribution), plus a "use current location" row for the start. */
export function Suggestions({
  data,
  query,
  current,
  onPick,
  onSubmit,
}: {
  data: SuggestionData;
  query: string;
  /** Offered when editing the start. */
  current: Place | null;
  onPick(p: Place): void;
  onSubmit(): void;
}) {
  const c = usePalette();
  const s = styles(c);
  const row = (p: Place, i: number) => (
    <Pressable
      key={`${p.source}:${p.stopId ?? ''}:${p.name}:${i}`}
      testID={`plan-suggestion-${p.source}`}
      onPress={() => onPick(p)}
      accessibilityRole="button"
      style={({ pressed }) => [s.row, pressed && { backgroundColor: c.surfaceMuted }]}
    >
      <View style={s.icon}>
        <Ionicons name={p.source === 'station' ? 'train' : p.source === 'current' ? 'navigate' : 'location'} size={15} color={c.brandDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>
          {p.name}
        </Text>
        {p.subtitle ? (
          <Text style={s.subtitle} numberOfLines={1}>
            {p.subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
  const trimmed = query.trim();
  const nothing = trimmed.length > 0 && !data.loading && data.stations.length === 0 && data.places.length === 0;
  return (
    <View style={s.card}>
      {current ? row(current, -1) : null}
      {data.stations.map(row)}
      {data.places.map(row)}
      {data.loading ? (
        <View style={s.status}>
          <ActivityIndicator size="small" color={c.brand} />
          <Text style={s.subtitle}>Searching places…</Text>
        </View>
      ) : null}
      {nothing || data.failed ? (
        <Pressable onPress={onSubmit} accessibilityRole="button" style={s.status}>
          <Ionicons name="search" size={14} color={c.brand} />
          <Text style={[s.subtitle, { color: c.brand }]}>{`Look up “${trimmed}”`}</Text>
        </Pressable>
      ) : null}
      {data.places.length > 0 ? <Text style={s.attribution}>{`Places ${OSM_ATTRIBUTION}`}</Text> : null}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
    icon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.brandSoft },
    name: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    subtitle: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    status: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
    attribution: { fontFamily: fonts.medium, fontSize: 11, color: c.textMuted, paddingHorizontal: 14, paddingBottom: 10 },
  });
