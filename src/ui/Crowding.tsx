import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { Carriage } from '@/mbta/model/types';
import { crowdingLevel, crowdingText, type CarRecommendation, type CrowdingLevel } from '@/mbta/rules/vehicle';
import { fonts, radius, usePalette, type Palette } from '@/theme';

const FILLED: Record<CrowdingLevel, number> = { notCrowded: 1, someCrowding: 2, crowded: 3 };

function levelColor(c: Palette, l: CrowdingLevel | null): string {
  if (l === 'crowded') return c.danger;
  if (l === 'someCrowding') return c.warning;
  if (l === 'notCrowded') return c.brand;
  return c.border;
}

/** Whole-vehicle crowding: three person glyphs plus text, or "Crowding not available". */
export function CrowdingBadge({ level }: { level: CrowdingLevel | null }) {
  const c = usePalette();
  const label = level ? crowdingText(level) : 'Crowding not available';
  return (
    <View style={styles.badge} accessible accessibilityLabel={label}>
      <View style={styles.people}>
        {[1, 2, 3].map((i) => (
          <Ionicons
            key={i}
            name={level && i <= FILLED[level] ? 'person' : 'person-outline'}
            size={12}
            color={level ? levelColor(c, level) : c.textMuted}
          />
        ))}
      </View>
      <Text style={[styles.badgeText, { color: level ? c.text : c.textMuted }]}>{label}</Text>
    </View>
  );
}

/**
 * Per-car crowding, front car (sequence 1) on the left, with the recommended car(s) outlined.
 * `compact` drops the legend for list rows.
 */
export function CarCrowdingDiagram({
  carriages,
  recommendation,
  compact = false,
}: {
  carriages: Carriage[];
  recommendation: CarRecommendation | null;
  compact?: boolean;
}) {
  const c = usePalette();
  const cars = [...carriages].sort((a, b) => a.sequence - b.sequence);
  if (cars.length === 0) return null;
  const best = new Set(recommendation?.bestSequences ?? []);
  return (
    <View style={styles.diagram} accessible accessibilityLabel={recommendation ? recommendation.label : 'Train crowding by car'}>
      <View style={styles.cars}>
        {cars.map((car) => {
          const level = crowdingLevel(car.occupancyStatus);
          const isBest = best.has(car.sequence);
          return (
            <View
              key={car.sequence}
              style={[
                styles.car,
                { backgroundColor: levelColor(c, level), borderColor: isBest ? c.text : 'transparent' },
                car.sequence === cars[0].sequence && styles.front,
              ]}
            >
              <Text style={[styles.carText, { color: level ? c.onBrand : c.textMuted }]}>{car.sequence}</Text>
            </View>
          );
        })}
      </View>
      {!compact && (
        <Text style={[styles.legend, { color: c.textMuted }]}>
          {recommendation ? `${recommendation.label} · Car 1 = front` : 'Car 1 = front'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  people: { flexDirection: 'row' },
  badgeText: { fontFamily: fonts.semibold, fontSize: 13 },
  diagram: { gap: 6 },
  cars: { flexDirection: 'row', gap: 4 },
  car: { flex: 1, height: 22, borderRadius: 4, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  front: { borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.sm },
  carText: { fontFamily: fonts.bold, fontSize: 11 },
  legend: { fontFamily: fonts.medium, fontSize: 12 },
});
