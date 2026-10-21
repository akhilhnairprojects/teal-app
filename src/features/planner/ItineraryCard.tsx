import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GlobalData } from '@/mbta/global/globalData';
import { formatClock } from '@/mbta/time/eastern';
import type { Itinerary, Leg } from '@/planner/types';
import { fonts, radius, usePalette, type Palette } from '@/theme';
import { RoutePill } from '@/ui';

import { dockBikesText, dockParkingText, durationText, kindLabel, leaveText, tagLabel } from './format';

function LegChip({ leg, g, c }: { leg: Leg; g: GlobalData | null; c: Palette }) {
  if (leg.mode === 'transit') {
    const route = g?.routes[leg.routeId];
    return route ? <RoutePill route={route} size="small" /> : <Ionicons name="train" size={14} color={c.text} />;
  }
  return <Ionicons name={leg.mode === 'bike' ? 'bicycle' : 'walk'} size={16} color={leg.mode === 'bike' ? c.brand : c.textMuted} />;
}

/** One option in the results list: modes, door-to-door time, leave/arrive clock times, tags and a key notice. */
export function ItineraryCard({
  itinerary: i,
  global: g,
  now,
  selected,
  onPress,
}: {
  itinerary: Itinerary;
  global: GlobalData | null;
  now: number;
  selected: boolean;
  onPress(): void;
}) {
  const c = usePalette();
  const s = styles(c);
  const shown = i.legs.filter((l) => l.mode !== 'walk' || i.legs.length === 1);
  const bike = i.legs.find((l) => l.mode === 'bike');
  const warning = i.notices.find((n) => n.severity === 'warning');
  return (
    <Pressable
      testID={`itinerary-${i.kind}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${kindLabel(i.kind)}, ${durationText(i, now)}, arrive ${formatClock(i.arriveTime)}`}
      style={({ pressed }) => [s.card, selected && { borderColor: c.brand, borderWidth: 2 }, pressed && { opacity: 0.85 }]}
    >
      <View style={s.top}>
        <View style={s.chips}>
          {shown.map((l, idx) => (
            <View key={idx} style={s.chipWrap}>
              {idx > 0 ? <Ionicons name="chevron-forward" size={12} color={c.textMuted} /> : null}
              <LegChip leg={l} g={g} c={c} />
            </View>
          ))}
          <Text style={s.kind}>{kindLabel(i.kind)}</Text>
        </View>
        <Text style={s.duration}>{durationText(i, now)}</Text>
      </View>
      <Text style={s.times}>
        {leaveText(i.departTime, now)} · arrive {formatClock(i.arriveTime)}
      </Text>
      {bike && bike.mode === 'bike' ? (
        <Text style={s.meta} numberOfLines={1}>
          {dockBikesText(bike.fromDock)} at start · {dockParkingText(bike.toDock)}
        </Text>
      ) : null}
      {i.tags.length > 0 ? (
        <View style={s.tags}>
          {i.tags.map((t) => (
            <View
              key={t}
              style={[s.tag, (t === 'weatherRisk' || t === 'disrupted') && { backgroundColor: c.surfaceMuted, borderColor: c.warning }]}
            >
              <Text style={[s.tagText, (t === 'weatherRisk' || t === 'disrupted') && { color: c.warning }]}>{tagLabel(t)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {warning ? (
        <View style={s.warning}>
          <Ionicons name="alert-circle" size={14} color={c.warning} />
          <Text style={s.warningText} numberOfLines={2}>
            {warning.text}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 14,
      gap: 6,
    },
    top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    chips: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
    chipWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    kind: { fontFamily: fonts.semibold, fontSize: 13, color: c.textMuted, marginLeft: 4 },
    duration: { fontFamily: fonts.extrabold, fontSize: 20, color: c.text, fontVariant: ['tabular-nums'] },
    times: { fontFamily: fonts.medium, fontSize: 14, color: c.text, fontVariant: ['tabular-nums'] },
    meta: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: c.brandSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: c.brandSoft },
    tagText: { fontFamily: fonts.semibold, fontSize: 12, color: c.brandDeep },
    warning: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    warningText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: c.warning },
  });
