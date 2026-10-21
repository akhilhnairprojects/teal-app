import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/manrope';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppShell } from '@/features/shell/AppShell';
import { GlobalDataProvider } from '@/mbta/global/GlobalDataProvider';
import { usePalette } from '@/theme';

/** Tab-row routes swap in place; everything else slides in from the right. */
const TOP_LEVEL_ROUTES = new Set(['index', 'plan', 'favorites', 'move']);

/** Every route renders inside the bottom sheet, over the map (§2.2). */
export default function RootLayout() {
  const c = usePalette();
  const dark = useColorScheme() === 'dark';
  // Without a theme, the navigator paints React Navigation's light default (#F2F2F2) behind
  // every screen, which shows through the sheet in dark mode. Screens stay transparent so the
  // sheet's own background shows; the rest follows Teal's palette.
  const navTheme = useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark,
      colors: {
        ...base.colors,
        background: 'transparent',
        card: c.surface,
        text: c.text,
        border: c.border,
        primary: c.brand,
        notification: c.danger,
      },
    };
  }, [dark, c]);
  const [loaded, error] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  // Render with system fonts if the font files fail, rather than blocking the app.
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: c.background }} />;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <GlobalDataProvider>
          <StatusBar style="auto" />
          <ThemeProvider value={navTheme}>
            <AppShell>
              <Stack
                screenOptions={({ route }) => ({
                  headerShown: false,
                  contentStyle: { backgroundColor: 'transparent' },
                  animation: TOP_LEVEL_ROUTES.has(route.name) ? 'none' : 'slide_from_right',
                })}
              />
            </AppShell>
          </ThemeProvider>
        </GlobalDataProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
