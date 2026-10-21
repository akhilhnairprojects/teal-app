import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useActiveModes, type ActiveMode } from '@/state/activeModes';
import { fonts, radius, sheet, usePalette } from '@/theme';

/** The path part of an href ('/record?kind=run' → '/record'). */
const pathOf = (href: ActiveMode['href']): string => String(href).split('?')[0];

/**
 * A row of pills for modes running in the background of the UI ("● Recording · 2.4 mi",
 * "Parking → Dock"). Tapping returns to the mode's page; a pill hides on its own page.
 */
export function ActiveModePills() {
  const c = usePalette();
  const pathname = usePathname() || '/';
  const modes = useActiveModes().filter((m) => pathOf(m.href) !== pathname);
  if (modes.length === 0) return null;
  return (
    <View style={styles.row} testID="active-mode-pills">
      {modes.map((m) => (
        <Pressable
          key={m.id}
          testID={`active-mode-${m.id}`}
          accessibilityRole="button"
          accessibilityLabel={m.label}
          onPress={() => router.push(m.href)}
          style={({ pressed }) => [styles.pill, { backgroundColor: c.brand }, pressed && { opacity: 0.8 }]}
        >
          <Text style={[styles.text, { color: c.onBrand }]} numberOfLines={1}>
            {m.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: sheet.horizontalPadding, paddingBottom: 8 },
  pill: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%' },
  text: { fontFamily: fonts.bold, fontSize: 13 },
});
