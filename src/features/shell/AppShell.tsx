import BottomSheet from '@gorhom/bottom-sheet';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { startSyncTriggers } from '@/activity/sync';
import { startBackend } from '@/backend/client';
import { setUserLocation } from '@/features/map/mapCenter';
import { TealMap } from '@/features/map/TealMap';
import { useLocation } from '@/hooks/useLocation';
import { configureNotifications, useNotificationRouting } from '@/notifications';
import { startInboxWatcher } from '@/social/inboxWatcher';
import { useSheetDetentRequests, type SheetDetent } from '@/state/sheet';
import { sheet, usePalette } from '@/theme';

import { ActiveModePills } from './ActiveModePills';
import { SheetChrome } from './SheetChrome';

const DETENT_INDEX: Record<SheetDetent, number> = { collapsed: 0, half: 1, full: 2 };

/** Pixel height of a snap point ('50%' of the window, or a number). */
function snapHeight(point: number | string, windowHeight: number): number {
  return typeof point === 'number' ? point : (parseFloat(point) / 100) * windowHeight;
}

/**
 * Full-screen map with a draggable bottom sheet that hosts the route stack (§2.2). The shell owns
 * the one-shot device location (shared with Nearby and the map via `mapCenter`) and snaps the
 * sheet when a screen calls `requestSheetDetent`. It also starts the backend session, activity
 * sync and notification routing once, and shows the active-mode pills above the sheet content.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const location = useLocation();
  useEffect(() => setUserLocation(location), [location]);

  // Accounts, sync and notifications (spec §3.2). Each is a no-op on web or without a backend.
  useEffect(() => {
    configureNotifications();
    const stopBackend = startBackend();
    const stopSync = startSyncTriggers();
    // Friend alerts as local notifications while Teal is open (remote push needs an EAS project).
    const stopInbox = startInboxWatcher();
    return () => {
      stopInbox();
      stopSync();
      stopBackend();
    };
  }, []);
  useNotificationRouting();

  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => [...sheet.snapPoints], []);
  const [index, setIndex] = useState<number>(sheet.initialIndex);
  useSheetDetentRequests((d) => sheetRef.current?.snapToIndex(DETENT_INDEX[d]));

  // At full height the map is hidden; keep the half-sheet inset so the camera doesn't jump.
  const bottomInset = Math.round(snapHeight(snapPoints[index <= 0 ? 0 : 1], height));

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <TealMap bottomInset={bottomInset} topInset={insets.top} />
      <BottomSheet
        ref={sheetRef}
        index={sheet.initialIndex}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        topInset={insets.top}
        onChange={(i: number) => {
          if (i >= 0) setIndex(i);
        }}
        backgroundStyle={{ backgroundColor: c.background, borderRadius: sheet.cornerRadius }}
        handleIndicatorStyle={{ backgroundColor: c.textMuted, width: sheet.grabberWidth, height: sheet.grabberHeight, opacity: 0.5 }}
        style={[styles.sheet, { shadowColor: '#000' }]}
      >
        <View style={styles.content} testID="sheet-content">
          <ActiveModePills />
          <SheetChrome />
          <View style={styles.content}>{children}</View>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  sheet: { shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, elevation: 12 },
  content: { flex: 1 },
});
