import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { BikeStation } from '@/data/bluebikes';
import { formatDistance, walkMinutes } from '@/lib/geo';
import { fonts, radius, usePalette, type Palette } from '@/theme';

export function BikeStationCard({ station }: { station: BikeStation }) {
  const c = usePalette();
  const s = styles(c);
  const notice = !station.isRenting
    ? 'Not renting bikes right now'
    : !station.isReturning
      ? 'Not accepting returns right now'
      : null;

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.name} numberOfLines={1}>
            {station.name}
          </Text>
          <Text style={s.meta}>
            {walkMinutes(station.distanceMeters)} min walk · {formatDistance(station.distanceMeters)}
          </Text>
        </View>
        {station.rentalUrl && (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${station.name} in the Bluebikes app`}
            onPress={() => Linking.openURL(station.rentalUrl!)}
            style={({ pressed }) => [s.open, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.openText}>Unlock</Text>
            <Ionicons name="open-outline" size={14} color={c.onBrand} />
          </Pressable>
        )}
      </View>

      <View style={s.stats}>
        <Stat c={c} value={station.classicBikes} label="Classic" icon="bicycle" />
        <View style={s.divider} />
        <Stat c={c} value={station.ebikes} label="E-bike" icon="flash" />
        <View style={s.divider} />
        <Stat c={c} value={station.openDocks} label="Open docks" icon="log-in-outline" />
      </View>

      {notice && (
        <View style={s.notice}>
          <Ionicons name="alert-circle" size={14} color={c.warning} />
          <Text style={s.noticeText}>{notice}</Text>
        </View>
      )}
    </View>
  );
}

function Stat({
  c,
  value,
  label,
  icon,
}: {
  c: Palette;
  value: number;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const empty = value === 0;
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text
        style={{
          fontFamily: fonts.extrabold,
          fontSize: 28,
          color: empty ? c.textMuted : c.text,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon} size={12} color={empty ? c.textMuted : c.brand} />
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.textMuted }}>{label}</Text>
      </View>
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
      padding: 16,
      gap: 14,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    name: { fontFamily: fonts.bold, fontSize: 17, color: c.text },
    meta: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    open: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: c.brand,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.pill,
    },
    openText: { fontFamily: fonts.bold, fontSize: 13, color: c.onBrand },
    stats: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceMuted,
      borderRadius: radius.md,
      paddingVertical: 10,
    },
    divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: c.border },
    notice: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    noticeText: { fontFamily: fonts.semibold, fontSize: 13, color: c.warning },
  });
