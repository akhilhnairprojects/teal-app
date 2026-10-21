import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { LiveDot } from '@/components/LiveDot';
import { departureText, type TripInstantDisplay } from '@/mbta/rules/tripInstantDisplay';
import { fonts, usePalette } from '@/theme';

const SIZES = { small: 13, medium: 16, large: 20 } as const;

/** One departure: "5 min" with a bold number, live dot for realtime, struck schedule, "Last". */
export function DepartureText({ display, size = 'medium' }: { display: TripInstantDisplay; size?: keyof typeof SIZES }) {
  const c = usePalette();
  const t = departureText(display);
  if (!t.primary) return null;
  const fontSize = SIZES[size];
  const bold = t.boldPart && t.primary.includes(t.boldPart) ? t.boldPart : null;
  const [before, after] = bold ? [t.primary.slice(0, t.primary.indexOf(bold)), t.primary.slice(t.primary.indexOf(bold) + bold.length)] : [t.primary, ''];
  const muted = display.kind === 'cancelled' || display.kind === 'skipped';
  return (
    <View style={styles.row} accessible accessibilityLabel={t.a11y}>
      {t.realtime && <LiveDot color={c.live} size={6} />}
      {t.icon && <Ionicons name={t.icon === 'bus' ? 'bus' : 'time-outline'} size={fontSize - 2} color={c.textMuted} />}
      <Text style={[styles.text, { fontSize, color: muted ? c.textMuted : c.text }]} numberOfLines={1}>
        {bold ? (
          <>
            {before}
            <Text style={styles.bold}>{bold}</Text>
            {after}
          </>
        ) : (
          before
        )}
      </Text>
      {t.struck && (
        <Text style={[styles.struck, { fontSize: fontSize - 3, color: c.textMuted }]} numberOfLines={1}>
          {t.struck}
        </Text>
      )}
      {t.last && <Text style={[styles.last, { color: c.textMuted, fontSize: fontSize - 4 }]}>Last</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  text: { fontFamily: fonts.medium, fontVariant: ['tabular-nums'] },
  bold: { fontFamily: fonts.extrabold },
  struck: { fontFamily: fonts.medium, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] },
  last: { fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
});
