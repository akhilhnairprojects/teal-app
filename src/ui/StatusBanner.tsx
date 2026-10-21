import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useNow } from '@/mbta/live/usePolling';
import { fonts, radius, usePalette } from '@/theme';

export type StatusBannerProps =
  | { kind: 'stale'; onRetry?: () => void }
  | { kind: 'rateLimited'; resetAt: number | null; hasApiKey: boolean }
  | { kind: 'offline'; onRetry?: () => void }
  | { kind: 'fallbackLocation'; placeName: string; reason?: string };

/** Text for a banner, exported for tests and non-visual surfaces. */
export function statusBannerText(p: StatusBannerProps, now: number): string {
  switch (p.kind) {
    case 'stale':
      return 'Live times may be out of date';
    case 'offline':
      return 'You’re offline. Showing the last update.';
    case 'rateLimited': {
      const secs = p.resetAt ? Math.max(0, Math.ceil((p.resetAt - now) / 1000)) : null;
      const retry = secs !== null ? `retrying in ${secs}s` : 'retrying soon';
      return p.hasApiKey ? `Live times paused · ${retry}` : `Live times paused · ${retry} · add an API key for faster updates`;
    }
    case 'fallbackLocation':
      return p.reason ? `Showing ${p.placeName} · ${p.reason}` : `Showing ${p.placeName}`;
  }
}

/** Compact banner for stale data, rate limiting, offline, or a fallback location. */
export function StatusBanner(props: StatusBannerProps & { right?: ReactNode }) {
  const c = usePalette();
  const now = useNow(props.kind === 'rateLimited' ? 1_000 : 30_000);
  const icon: keyof typeof Ionicons.glyphMap =
    props.kind === 'stale'
      ? 'time-outline'
      : props.kind === 'rateLimited'
        ? 'pause-circle-outline'
        : props.kind === 'offline'
          ? 'cloud-offline-outline'
          : 'location-outline';
  const tone = props.kind === 'fallbackLocation' ? c.textMuted : c.warning;
  const onRetry = 'onRetry' in props ? props.onRetry : undefined;
  return (
    <View style={[styles.banner, { backgroundColor: c.surface, borderColor: c.border }]} accessibilityRole="alert">
      <Ionicons name={icon} size={16} color={tone} />
      <Text style={[styles.text, { color: c.text }]}>{statusBannerText(props, now)}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.action, { color: c.brand }]}>Refresh</Text>
        </Pressable>
      )}
      {props.right}
    </View>
  );
}

/** Centered empty state with an optional call to action. */
export function EmptyState({
  icon = 'train-outline',
  title,
  message,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}) {
  const c = usePalette();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: c.brandSoft }]}>
        <Ionicons name={icon} size={22} color={c.brandDeep} />
      </View>
      <Text style={[styles.emptyTitle, { color: c.text }]}>{title}</Text>
      {message ? <Text style={[styles.emptyMessage, { color: c.textMuted }]}>{message}</Text> : null}
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" style={[styles.cta, { backgroundColor: c.brand }]}>
          <Text style={[styles.ctaText, { color: c.onBrand }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  text: { flex: 1, fontFamily: fonts.medium, fontSize: 13 },
  action: { fontFamily: fonts.bold, fontSize: 13 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 24 },
  emptyIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, textAlign: 'center' },
  emptyMessage: { fontFamily: fonts.medium, fontSize: 14, textAlign: 'center' },
  cta: { marginTop: 8, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 10 },
  ctaText: { fontFamily: fonts.bold, fontSize: 14 },
});
