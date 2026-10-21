import { usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, usePalette } from '@/theme';

import { goToTab, PATHS, pathHref } from './routes';

/**
 * The four top-level pages. Labels only: with four segments at 375 pt, icon + "Favorites" no longer
 * fits a segment (spec §3.2 drops the icons in that case).
 */
export const SHEET_TABS: readonly {
  key: string;
  label: string;
  path: typeof PATHS.nearby | typeof PATHS.plan | typeof PATHS.favorites | typeof PATHS.move;
}[] = [
  { key: 'nearby', label: 'Nearby', path: PATHS.nearby },
  { key: 'plan', label: 'Plan', path: PATHS.plan },
  { key: 'favorites', label: 'Favorites', path: PATHS.favorites },
  { key: 'move', label: 'Move', path: PATHS.move },
];

/** Segmented control for the top-level sheet pages; switching replaces the current route (`goToTab`). */
export function SheetTabs() {
  const c = usePalette();
  const pathname = usePathname() || '/';
  return (
    <View style={[styles.row, { backgroundColor: c.surfaceMuted }]} accessibilityRole="tablist">
      {SHEET_TABS.map((tab) => {
        const active = pathname === tab.path;
        return (
          <Pressable
            key={tab.key}
            testID={`sheet-tab-${tab.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            onPress={() => {
              if (!active) goToTab(pathHref(tab.path));
            }}
            style={[styles.tab, active && [styles.active, { backgroundColor: c.surface, shadowColor: c.text }]]}
          >
            <Text style={[styles.label, { color: active ? c.text : c.textMuted }]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, gap: 3 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  active: { shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  label: { fontFamily: fonts.semibold, fontSize: 14 },
});
