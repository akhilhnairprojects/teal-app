import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, sheet, usePalette } from '@/theme';

import { isTopLevelPath, PATHS, pathHref } from './routes';
import { SheetTabs } from './SheetTabs';

/**
 * Sheet header for the top-level pages: wordmark, a search field that opens the Search page,
 * an About button and the tab row. Pushed pages draw their own `SheetPage` header instead [MA §0].
 */
export function SheetChrome() {
  const c = usePalette();
  const pathname = usePathname() || '/';
  if (!isTopLevelPath(pathname)) return null;
  return (
    <View style={styles.chrome} testID="sheet-chrome">
      <View style={styles.row}>
        <Text style={[styles.wordmark, { color: c.brandDeep }]} accessibilityRole="header">
          teal<Text style={{ color: c.brand }}>.</Text>
        </Text>
        <Pressable
          testID="sheet-search"
          accessibilityRole="search"
          accessibilityLabel="Search stations and routes"
          onPress={() => router.push(pathHref(PATHS.search))}
          style={({ pressed }) => [styles.search, { backgroundColor: c.surface, borderColor: c.border }, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="search" size={16} color={c.textMuted} />
          <Text style={[styles.searchText, { color: c.textMuted }]} numberOfLines={1}>
            Search stations or routes
          </Text>
        </Pressable>
        <Pressable
          testID="sheet-more"
          accessibilityRole="button"
          accessibilityLabel="About Teal"
          hitSlop={8}
          onPress={() => router.push(pathHref(PATHS.more))}
          style={[styles.more, { backgroundColor: c.surfaceMuted }]}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={c.text} />
        </Pressable>
      </View>
      <SheetTabs />
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: { paddingHorizontal: sheet.horizontalPadding, paddingBottom: 8, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmark: { fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.8 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchText: { flex: 1, fontFamily: fonts.medium, fontSize: 15 },
  more: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
