import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { Route } from '@/mbta/model/types';
import type { LineOrRoute } from '@/mbta/rules/lineOrRoute';
import { routePillSpec } from '@/mbta/rules/routePill';
import { fonts } from '@/theme';

export type PillSize = 'small' | 'medium' | 'large';

const HEIGHT: Record<PillSize, number> = { small: 16, medium: 24, large: 24 };
const FONT: Record<PillSize, number> = { small: 12, medium: 16, large: 16 };

/** Route or line badge in the route's own colors (MA §4 pill rules). */
export function RoutePill({
  lineOrRoute,
  route,
  size = 'medium',
  type = 'fixed',
  context,
}: {
  lineOrRoute?: LineOrRoute;
  route?: Route;
  size?: PillSize;
  type?: 'fixed' | 'flex';
  context?: 'searchStation' | 'default';
}) {
  const target = lineOrRoute ?? route;
  if (!target) return null;
  const spec = routePillSpec(target, { type, context });
  const height = spec.shape === 'circle' && size === 'large' ? 32 : HEIGHT[size];
  const width = spec.shape === 'circle' ? height : spec.width === 'fixed' ? (height + 1) * 2 : undefined;
  const label = spec.text?.toUpperCase() ?? '';
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={target && 'kind' in target && target.kind === 'line' ? target.line.longName : (route?.longName ?? label)}
      style={[
        styles.pill,
        {
          height,
          minWidth: width,
          width: spec.shape === 'circle' ? height : undefined,
          paddingHorizontal: spec.width === 'flex' && spec.shape !== 'circle' ? 8 : 0,
          backgroundColor: spec.color,
          borderRadius: spec.shape === 'rectangle' ? 4 : height / 2,
        },
      ]}
    >
      {spec.icon ? (
        <Ionicons name={spec.icon === 'bus' ? 'bus' : 'boat'} size={FONT[size]} color={spec.textColor} />
      ) : (
        <Text numberOfLines={1} style={[styles.text, { color: spec.textColor, fontSize: FONT[size] - (label.length > 3 ? 2 : 0) }]}>
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  text: { fontFamily: fonts.extrabold, letterSpacing: 0.2, fontVariant: ['tabular-nums'] },
});
