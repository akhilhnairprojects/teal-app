import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiveDot } from '@/components/LiveDot';
import { backToMyLocation } from '@/features/map/mapCenter';
import { alertPath, goToTab, PATHS, pathHref, stopPath } from '@/features/shell/routes';
import { HAS_API_KEY, useRateLimitState } from '@/mbta/api/client';
import type { RouteCardLeaf } from '@/mbta/rules/routeCardData';
import { EmptyState, RouteCardView, SheetScrollView, StatusBanner } from '@/ui';
import { fonts, radius, sheet, usePalette, type Palette } from '@/theme';

import { BikesSection } from './BikesSection';
import { liveLabel } from './liveLabel';
import { useNearbyCards } from './useNearbyCards';

const FALLBACK_PLACE = 'Park Street';

export function NearbyScreen() {
  const c = usePalette();
  const s = styles(c);
  const insets = useSafeAreaInsets();
  const { position, global, stopIds, cards, predictions, now } = useNearbyCards();
  const rateLimit = useRateLimitState();

  const openLeaf = (leaf: RouteCardLeaf) =>
    router.push(stopPath(leaf.stop.id, { routeId: leaf.lineOrRoute.id, directionId: leaf.direction.id }));
  const openAlert = (id: string) => router.push(alertPath(id));

  const banner = rateLimit.limited ? (
    <StatusBanner kind="rateLimited" resetAt={rateLimit.resetAt} hasApiKey={HAS_API_KEY} />
  ) : predictions.stale ? (
    <StatusBanner kind="stale" onRetry={() => void predictions.refresh()} />
  ) : predictions.error?.kind === 'network' && !predictions.data ? (
    <StatusBanner kind="offline" onRetry={() => void predictions.refresh()} />
  ) : null;

  let body;
  if (!global.data && global.status === 'error') {
    body = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn’t load stations"
        message={global.error ?? undefined}
        action={{ label: 'Try again', onPress: global.refresh }}
      />
    );
  } else if (!cards) {
    body = <SkeletonCards c={c} />;
  } else if (cards.length === 0 && stopIds !== null) {
    body = (
      <EmptyState
        icon="train-outline"
        title="No T stations nearby"
        message="There’s no subway or Green Line stop within 2 miles. Try planning a trip instead."
        action={{ label: 'Plan a trip', onPress: () => goToTab(pathHref(PATHS.plan)) }}
      />
    );
  } else {
    body = cards.map((card) => (
      <RouteCardView key={card.id} card={card} now={now} global={global.data!} onLeafPress={openLeaf} onAlertPress={openAlert} showStopHeaders />
    ));
  }

  return (
    <SheetScrollView testID="nearby-scroll" contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}>
      <View style={s.header}>
        <Text style={s.title} accessibilityRole="header">
          Nearby
        </Text>
        <View style={s.liveBadge} testID="nearby-live-badge">
          {predictions.updatedAt ? <LiveDot color={c.live} size={7} /> : null}
          <Text style={s.liveText}>{liveLabel(predictions.updatedAt, now)}</Text>
        </View>
      </View>

      {position.status === 'locating' ? (
        <Text style={s.muted}>Finding you…</Text>
      ) : position.source === 'map' ? (
        <View style={s.mapRow}>
          <Text style={s.muted}>Showing the map area</Text>
          <Pressable onPress={backToMyLocation} accessibilityRole="button" hitSlop={8} testID="nearby-back-to-me">
            <Text style={s.link}>Back to my location</Text>
          </Pressable>
        </View>
      ) : position.source === 'fallback' ? (
        <StatusBanner kind="fallbackLocation" placeName={FALLBACK_PLACE} reason={position.reason} />
      ) : null}

      {banner}
      {body}

      {position.status === 'ready' ? <BikesSection at={position.position} /> : null}

      <View style={s.footer}>
        <Text style={s.footerText}>Transit data: MBTA/MassDOT. Not affiliated with or endorsed by the MBTA.</Text>
        <Text style={s.footerText}>Bike data: Bluebikes GBFS feed (Lyft). Unlock and pay in the Bluebikes app.</Text>
      </View>
    </SheetScrollView>
  );
}

function SkeletonCards({ c }: { c: Palette }) {
  return (
    <View style={{ gap: 12 }} testID="nearby-skeleton" accessibilityLabel="Loading nearby stations">
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ height: 112, borderRadius: radius.lg, backgroundColor: c.surface, opacity: 0.7 - i * 0.15 }}>
          <View style={{ height: 40, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: c.surfaceMuted }} />
        </View>
      ))}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { paddingHorizontal: sheet.horizontalPadding, paddingTop: 4, gap: 12 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontFamily: fonts.bold, fontSize: 20, color: c.text },
    liveBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.surface,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    liveText: { fontFamily: fonts.semibold, fontSize: 12, color: c.textMuted },
    muted: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    mapRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    link: { fontFamily: fonts.bold, fontSize: 13, color: c.brand },
    footer: { gap: 4, paddingTop: 8 },
    footerText: { fontFamily: fonts.medium, fontSize: 11, color: c.textMuted, textAlign: 'center' },
  });
