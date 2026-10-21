import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Alert, Route } from '@/mbta/model/types';
import { alertIconName, effectLabel, significanceAt, significanceRank } from '@/mbta/rules/alerts';
import type { RouteCardLeaf } from '@/mbta/rules/routeCardData';
import { AlertIcon } from '@/ui';
import { fonts, radius, usePalette } from '@/theme';

export type StopAlertCard = { alert: Alert; downstream: boolean };

/**
 * Alert cards for a filtered leaf: alerts here at accessibility significance or above (major,
 * secondary, elevator), then downstream alerts not already listed. Major first.
 */
export function stopAlertCards(leaf: RouteCardLeaf | null, now: number): StopAlertCard[] {
  if (!leaf) return [];
  const rank = (a: Alert) => significanceRank(significanceAt(a, now));
  const here = leaf.alertsHere.filter((a) => rank(a) >= significanceRank('accessibility')).sort((a, b) => rank(b) - rank(a));
  const ids = new Set(here.map((a) => a.id));
  const downstream = leaf.alertsDownstream.filter((a) => !ids.has(a.id) && (ids.add(a.id), true));
  return [...here.map((alert) => ({ alert, downstream: false })), ...downstream.map((alert) => ({ alert, downstream: true }))];
}

export function StopAlertCards({ cards, route, onPress }: { cards: StopAlertCard[]; route: Route | null; onPress(alertId: string): void }) {
  const c = usePalette();
  if (cards.length === 0) return null;
  return (
    <View style={styles.list}>
      {cards.map(({ alert, downstream }) => (
        <Pressable
          key={alert.id}
          onPress={() => onPress(alert.id)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.card, { backgroundColor: pressed ? c.surfaceMuted : c.surface, borderColor: c.border }]}
        >
          <AlertIcon iconName={alertIconName(alert, route)} size={20} />
          <View style={styles.body}>
            <Text style={[styles.effect, { color: c.text }]}>
              {effectLabel(alert.effect)}
              {downstream ? <Text style={[styles.downstream, { color: c.textMuted }]}> · Later on this trip</Text> : null}
            </Text>
            {alert.header ? (
              <Text style={[styles.header, { color: c.textMuted }]} numberOfLines={3}>
                {alert.header}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  body: { flex: 1, gap: 2 },
  effect: { fontFamily: fonts.bold, fontSize: 15 },
  downstream: { fontFamily: fonts.medium, fontSize: 13 },
  header: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
