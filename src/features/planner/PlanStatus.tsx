import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PlanNotice, WeatherSnapshot } from '@/planner/types';
import { fonts, radius, usePalette, type Palette } from '@/theme';

import { bikeAdvisoryText, weatherText } from './format';

/** Current weather with the bike advisory, credited to the National Weather Service. */
export function WeatherRow({ weather }: { weather: WeatherSnapshot }) {
  const c = usePalette();
  const s = styles(c);
  const tone = weather.bikeAdvisory === 'ok' ? c.brand : c.warning;
  return (
    <View style={s.row} accessible accessibilityLabel={`${weatherText(weather)}. ${bikeAdvisoryText(weather)}.`}>
      <Ionicons name={weather.bikeAdvisory === 'ok' ? 'partly-sunny-outline' : 'rainy-outline'} size={18} color={tone} />
      <View style={{ flex: 1 }}>
        <Text style={s.text}>{weatherText(weather)}</Text>
        <Text style={[s.sub, { color: tone }]}>{bikeAdvisoryText(weather)}</Text>
      </View>
      <Text style={s.credit}>NWS</Text>
    </View>
  );
}

/** Plan-level notices; alert notices open the alert page. */
export function NoticeList({ notices, onAlertPress }: { notices: PlanNotice[]; onAlertPress(id: string): void }) {
  const c = usePalette();
  const s = styles(c);
  if (notices.length === 0) return null;
  return (
    <View style={s.list}>
      {notices.map((n, i) => {
        const tone = n.severity === 'warning' ? c.warning : c.textMuted;
        const body = (
          <>
            <Ionicons name={n.kind === 'alert' ? 'warning' : n.severity === 'warning' ? 'alert-circle' : 'information-circle'} size={15} color={tone} />
            <Text style={[s.text, { flex: 1 }]}>{n.text}</Text>
            {n.alertId ? <Ionicons name="chevron-forward" size={14} color={c.textMuted} /> : null}
          </>
        );
        const alertId = n.alertId;
        return alertId ? (
          <Pressable key={`${n.kind}:${i}`} onPress={() => onAlertPress(alertId)} accessibilityRole="button" style={s.notice}>
            {body}
          </Pressable>
        ) : (
          <View key={`${n.kind}:${i}`} style={s.notice}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    text: { fontFamily: fonts.medium, fontSize: 14, color: c.text },
    sub: { fontFamily: fonts.semibold, fontSize: 12 },
    credit: { fontFamily: fonts.medium, fontSize: 11, color: c.textMuted },
    list: { gap: 6 },
    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
  });
