import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomSheetFlatList, BottomSheetScrollView, useBottomSheetInternal } from '@gorhom/bottom-sheet';
import type { ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View, type FlatListProps, type ScrollViewProps } from 'react-native';

import { fonts, sheet, usePalette } from '@/theme';

/** True when rendered inside the gorhom BottomSheet (falls back to plain lists elsewhere). */
function useInSheet(): boolean {
  return useBottomSheetInternal(true) !== null;
}

/** The only scroll container pages should use, so sheet drags and inner scrolling cooperate. */
export function SheetScrollView(props: ScrollViewProps & { children?: ReactNode }) {
  const inSheet = useInSheet();
  const Component = (inSheet ? BottomSheetScrollView : ScrollView) as typeof ScrollView;
  return <Component keyboardShouldPersistTaps="handled" {...props} />;
}

export function SheetFlatList<T>(props: FlatListProps<T>) {
  const inSheet = useInSheet();
  const Component = (inSheet ? BottomSheetFlatList : FlatList) as unknown as typeof FlatList<T>;
  return <Component keyboardShouldPersistTaps="handled" {...props} />;
}

/** Page chrome inside the sheet: optional back chevron, title and a right-side slot. */
export function SheetPage({
  title,
  onBack,
  right,
  children,
}: {
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  const c = usePalette();
  const showHeader = title !== undefined || onBack !== undefined || right !== undefined;
  return (
    <View style={styles.page}>
      {showHeader && (
        <View style={styles.header}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={[styles.back, { backgroundColor: c.surfaceMuted }]}
            >
              <Ionicons name="chevron-back" size={20} color={c.text} />
            </Pressable>
          ) : null}
          <Text style={[styles.title, { color: c.text }]} numberOfLines={1} accessibilityRole="header">
            {title ?? ''}
          </Text>
          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
      )}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: {
    minHeight: sheet.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: sheet.horizontalPadding,
  },
  back: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 20 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: { flex: 1 },
});
