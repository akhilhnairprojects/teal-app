import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { goBack, goToTab, planPath, stopPath } from '@/features/shell/routes';
import { fetchAlert } from '@/mbta/api/endpoints';
import { useGlobalData } from '@/mbta/global/globalData';
import { useAlerts } from '@/mbta/live/useAlerts';
import { useNow } from '@/mbta/live/usePolling';
import type { Alert } from '@/mbta/model/types';
import { alertIconName, effectLabel } from '@/mbta/rules/alerts';
import { AlertIcon, EmptyState, RoutePill, SheetPage, SheetScrollView } from '@/ui';
import { fonts, radius, sheet, usePalette } from '@/theme';

import { affectedStops, alertHasEnded, alertRoutes, causeLabel, formatPeriod, periodsToShow, safeWebUrl } from './alertDetails';

type Fetched = { id: string; alert: Alert | null; failed: boolean };

/**
 * The alert from the shared alerts poller, else one `/alerts/{id}` call (expired alerts fall
 * out of the poller's list). Null alert = it no longer exists.
 */
function useAlert(alertId: string): { alert: Alert | null; status: 'loading' | 'ready' | 'ended' | 'error'; retry(): void } {
  const alerts = useAlerts();
  const shared = alerts.byId[alertId] ?? null;
  const listSettled = alerts.data !== null || alerts.error !== null;
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [attempt, setAttempt] = useState(0);
  const needFetch = !shared && listSettled;

  useEffect(() => {
    if (!needFetch) return;
    const controller = new AbortController();
    fetchAlert(alertId, { signal: controller.signal, priority: 'foreground' })
      .then((alert) => !controller.signal.aborted && setFetched({ id: alertId, alert, failed: false }))
      .catch(() => !controller.signal.aborted && setFetched({ id: alertId, alert: null, failed: true }));
    return () => controller.abort();
  }, [alertId, needFetch, attempt]);

  const f = fetched?.id === alertId ? fetched : null;
  const alert = shared ?? f?.alert ?? null;
  const status = alert ? 'ready' : !f ? 'loading' : f.failed ? 'error' : 'ended';
  return { alert, status, retry: () => setAttempt((n) => n + 1) };
}

/** Alert details: effect with route pills, cause, periods in Eastern time, stops, description. */
export function AlertDetailsScreen({ alertId }: { alertId: string }) {
  const c = usePalette();
  const now = useNow(60_000);
  const { data: g } = useGlobalData();
  const { alert, status, retry } = useAlert(alertId);

  const routes = useMemo(() => (alert && g ? alertRoutes(alert, g) : []), [alert, g]);
  const stops = useMemo(() => (alert && g ? affectedStops(alert, g) : []), [alert, g]);

  if (!alert) {
    return (
      <SheetPage title="Alert" onBack={goBack}>
        {status === 'loading' ? (
          <View style={styles.loading}>
            <ActivityIndicator color={c.brand} />
          </View>
        ) : status === 'error' ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn’t load this alert" action={{ label: 'Try again', onPress: retry }} />
        ) : (
          <EmptyState icon="checkmark-circle-outline" title="This alert has ended" action={{ label: 'Back', onPress: goBack }} />
        )}
      </SheetPage>
    );
  }

  const cause = causeLabel(alert.cause);
  const { periods, more } = periodsToShow(alert, now);
  const ended = alertHasEnded(alert, now);
  const url = safeWebUrl(alert.url);
  const firstRoute = routes[0] ?? null;

  return (
    <SheetPage title={effectLabel(alert.effect)} onBack={goBack}>
      <SheetScrollView contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <AlertIcon iconName={alertIconName(alert, firstRoute)} size={28} />
          {routes.length > 0 ? (
            <View style={styles.pills}>
              {routes.map((r) => (
                <RoutePill key={r.id} route={r} size="medium" type="flex" />
              ))}
            </View>
          ) : null}
        </View>
        {ended ? (
          <View style={[styles.note, { backgroundColor: c.surfaceMuted }]}>
            <Ionicons name="checkmark-circle-outline" size={16} color={c.textMuted} />
            <Text style={[styles.noteText, { color: c.text }]}>This alert has ended</Text>
          </View>
        ) : null}
        {alert.header ? <Text style={[styles.header, { color: c.text }]}>{alert.header}</Text> : null}

        {cause ? (
          <Section title="Cause">
            <Text style={[styles.body, { color: c.text }]}>{cause}</Text>
          </Section>
        ) : null}

        {periods.length > 0 ? (
          <Section title={periods.length === 1 ? 'When' : 'When (Eastern time)'}>
            {periods.map((p) => (
              <Text key={`${p.start}-${p.end}`} style={[styles.body, { color: c.text }]}>
                {formatPeriod(p)}
              </Text>
            ))}
            {more > 0 ? <Text style={[styles.muted, { color: c.textMuted }]}>{`and ${more} more`}</Text> : null}
          </Section>
        ) : null}

        {stops.length > 0 ? (
          <Section title={stops.length === 1 ? 'Affected stop' : `Affected stops (${stops.length})`}>
            <View style={[styles.stops, { borderColor: c.border, backgroundColor: c.surface }]}>
              {stops.map((s, i) => (
                <Pressable
                  key={s.id}
                  onPress={() => router.push(stopPath(s.id))}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.stopRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                    pressed && { backgroundColor: c.surfaceMuted },
                  ]}
                >
                  <Text style={[styles.stopName, { color: c.text }]}>{s.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
                </Pressable>
              ))}
            </View>
          </Section>
        ) : null}

        {alert.description ? (
          <Section title="Details">
            {/* Text keeps the alert's own line breaks. */}
            <Text style={[styles.body, { color: c.text }]} selectable>
              {alert.description}
            </Text>
          </Section>
        ) : null}

        {url ? (
          <Pressable onPress={() => void Linking.openURL(url)} accessibilityRole="link" style={styles.link}>
            <Ionicons name="open-outline" size={16} color={c.brand} />
            <Text style={[styles.linkText, { color: c.brand }]} numberOfLines={1}>
              {url.replace(/^https?:\/\//, '')}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => goToTab(planPath())}
          accessibilityRole="button"
          style={({ pressed }) => [styles.plan, { backgroundColor: pressed ? c.brandDeep : c.brand }]}
        >
          <Ionicons name="navigate-outline" size={16} color={c.onBrand} />
          <Text style={[styles.planText, { color: c.onBrand }]}>Plan around this</Text>
        </Pressable>
      </SheetScrollView>
    </SheetPage>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const c = usePalette();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: c.textMuted }]} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: sheet.horizontalPadding, paddingBottom: 32, gap: 16 },
  loading: { paddingVertical: 32, alignItems: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, padding: 10 },
  noteText: { fontFamily: fonts.semibold, fontSize: 14 },
  header: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 24 },
  section: { gap: 6 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  muted: { fontFamily: fonts.medium, fontSize: 13 },
  stops: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  stopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  stopName: { fontFamily: fonts.semibold, fontSize: 15 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14 },
  plan: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.pill, paddingVertical: 12 },
  planText: { fontFamily: fonts.bold, fontSize: 15 },
});
