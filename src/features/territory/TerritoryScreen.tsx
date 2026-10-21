/**
 * Territory page (spec G4): draws the month's territory on the map (through the overlay; the layer
 * fetches its own cells), and lists this month's standings, my square count, the reset date, last
 * month's champions, a legend and how to claim. Territory is on by default; when the user has opted
 * out, a card explains what turning it on shows (Addendum D). No account is needed: signed out, the
 * page shows the squares claimed by the runs on this phone.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { periodLabel, periodStart, shiftPeriod } from '@/activity/periods';
import { updateMySettings, useAuth, type MyProfile } from '@/backend/auth';
import { Body, Button, Card, ErrorText, SectionTitle, formStyles } from '@/features/account/formUi';
import { accountPath, goBack } from '@/features/shell/routes';
import { useNow } from '@/mbta/live/usePolling';
import { useMapOverlay, type MapOverlay } from '@/state/mapOverlay';
import { fetchTerritoryChampions, fetchTerritoryStandings, type TerritoryStanding } from '@/territory/api';
import { LOCAL_OWNER_COLOR, LOCAL_OWNER_ID, useLocalTerritory } from '@/territory/local';
import { useTerritoryShown } from '@/territory/useTerritory';
import { fonts, radius, usePalette } from '@/theme';
import { SheetPage, SheetScrollView } from '@/ui';

import { ownerColor, TERRITORY_FILL_ALPHA, withAlpha } from './ownerColor';
import { TerritoryNotice } from './TerritoryNotice';

/** Copy, exported for tests. */
export const TERRITORY_COPY = {
  title: 'Territory',
  howTo:
    'How to claim: finish a run within 75 m of where you started; the squares inside your loop become yours, except those within 300 m of your start and finish; later loops steal squares.',
  optedOutTitle: 'Your territory is off',
  optedOutBody:
    'Turn it on to claim the areas you loop this month. Your squares are shown to signed-in Teal users under your nickname and outline the area you looped, so they show roughly where you ran (to about 50 m). Squares within 300 m of your start and finish are never claimed.',
  turnOn: 'Turn on territory',
  onNote: 'Your squares are shown to signed-in Teal users under your nickname and show roughly where you looped. You can turn territory off in Account.',
  openAccount: 'Account settings',
  truncated: 'Zoom in to see all territory',
  legend: 'Each square is about 50 m across, filled with its owner’s color. Squares with an outline are yours. Zoomed out, each block of 4×4 squares shows its main owner.',
  noStandings: 'No territory claimed yet this month. Run a loop to be the first.',
  standingsError: 'Couldn’t load standings.',
  you: 'you',
  localNote: 'Worked out on this phone from the loops you run. Nothing is uploaded or shown to anyone else.',
  localLegend: 'Each square is about 50 m across. Your squares are filled and outlined.',
  monthly: 'Everyone starts fresh on the 1st of each month (Eastern time). The top 10 are kept as champions.',
  localMonthly: 'Your territory starts fresh on the 1st of each month (Eastern time).',
} as const;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Resets Nov 1' for the month starting on `monthStart` ('YYYY-MM-01'). */
export function resetLabel(monthStart: string): string {
  const next = shiftPeriod('month', monthStart, 1);
  return `Resets ${MONTHS_SHORT[Number(next.slice(5, 7)) - 1]} 1`;
}

export const squaresLabel = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'square' : 'squares'}`;

/** Refetch standings on focus at most this often. */
const REFRESH_MIN_MS = 60_000;

export function TerritoryScreen({ month }: { month: string | null }) {
  const auth = useAuth();
  return (
    <SheetPage title={TERRITORY_COPY.title} onBack={goBack}>
      {auth.status === 'signedIn' ? <TerritoryBody profile={auth.profile} monthParam={month} /> : <LocalTerritoryBody monthParam={month} />}
    </SheetPage>
  );
}

/** The month shown: the link's, or the current ET month (a rollover while open moves to the new one). */
function useShownMonth(monthParam: string | null) {
  const now = useNow(60_000);
  const currentMonth = periodStart('month', now);
  const month = monthParam ?? currentMonth;
  return { month, currentMonth, isCurrent: month === currentMonth };
}

/** Signed out: this phone's own squares, no standings. */
function LocalTerritoryBody({ monthParam }: { monthParam: string | null }) {
  const c = usePalette();
  const { month, isCurrent } = useShownMonth(monthParam);
  const overlay = useMemo<MapOverlay>(() => ({ territory: { month, highlightUserId: null } }), [month]);
  useMapOverlay('territory', overlay);
  const local = useLocalTerritory(month, true);
  const color = ownerColor(LOCAL_OWNER_COLOR, LOCAL_OWNER_ID);

  return (
    <SheetScrollView contentContainerStyle={formStyles.content}>
      <Card testID="territory-summary">
        <View style={styles.summaryRow}>
          <Text style={[styles.month, { color: c.text }]}>{periodLabel('month', month)}</Text>
          {isCurrent ? <Text style={[styles.reset, { color: c.textMuted }]}>{resetLabel(month)}</Text> : null}
        </View>
        <View style={styles.summaryRow}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={[styles.mine, { color: c.text }]} testID="territory-mine">
            {isCurrent ? 'You hold ' : 'You held '}
            {squaresLabel(local.cells.length)}
          </Text>
          {local.loading ? <ActivityIndicator color={c.brand} /> : null}
        </View>
        <Body muted>{TERRITORY_COPY.localNote}</Body>
      </Card>

      <SectionTitle>Legend</SectionTitle>
      <Card testID="territory-legend">
        <View style={styles.legendRow}>
          <View style={[styles.swatch, { backgroundColor: withAlpha(color, TERRITORY_FILL_ALPHA), borderColor: c.text, borderWidth: 1.5 }]} />
        </View>
        <Body muted>{TERRITORY_COPY.localLegend}</Body>
      </Card>

      <SectionTitle>How it works</SectionTitle>
      <Card>
        <Body>{TERRITORY_COPY.howTo}</Body>
        <Body muted>{TERRITORY_COPY.localMonthly}</Body>
      </Card>
    </SheetScrollView>
  );
}

type Load<T> = { status: 'loading' | 'ready' | 'error'; data: T | null };

function TerritoryBody({ profile, monthParam }: { profile: MyProfile; monthParam: string | null }) {
  const c = usePalette();
  const { month, currentMonth, isCurrent } = useShownMonth(monthParam);
  const lastMonth = shiftPeriod('month', currentMonth, -1);

  const overlay = useMemo<MapOverlay>(() => ({ territory: { month, highlightUserId: null } }), [month]);
  useMapOverlay('territory', overlay);
  const shown = useTerritoryShown();

  const [standings, setStandings] = useState<Load<TerritoryStanding[]>>({ status: 'loading', data: null });
  const [champions, setChampions] = useState<Load<TerritoryStanding[]>>({ status: 'loading', data: null });
  const fetched = useRef<{ key: string; at: number } | null>(null);

  const load = useCallback(
    async (force: boolean) => {
      const key = `${month}|${lastMonth}`;
      const prev = fetched.current;
      if (!force && prev && prev.key === key && Date.now() - prev.at < REFRESH_MIN_MS) return;
      fetched.current = { key, at: Date.now() };
      if (!prev || prev.key !== key) {
        setStandings({ status: 'loading', data: null });
        setChampions({ status: 'loading', data: null });
      }
      const [s, ch] = await Promise.all([fetchTerritoryStandings(month), fetchTerritoryChampions(lastMonth)]);
      if (fetched.current?.key !== key) return; // the month changed while loading
      setStandings(s.ok ? { status: 'ready', data: s.value } : (v) => ({ status: 'error', data: v.data }));
      setChampions(ch.ok ? { status: 'ready', data: ch.value } : (v) => ({ status: 'error', data: v.data }));
    },
    [month, lastMonth],
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );
  // The month can change while focused (rollover); load() itself skips unchanged, fresh data.
  useEffect(() => {
    void load(false);
  }, [load]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnOn = async () => {
    setSaving(true);
    setError(null);
    // The card above explains what is shown, so turning it on here also records the notice.
    const r = await updateMySettings({ territoryOptIn: true, territoryNoticeSeen: true });
    setSaving(false);
    if (!r.ok) setError(r.error.message);
    else void load(true);
  };

  const mine = standings.data?.find((s) => s.isMe)?.cells ?? 0;
  const top = standings.data?.filter((s) => s.rank <= 10 || s.isMe) ?? [];

  return (
    <SheetScrollView contentContainerStyle={formStyles.content}>
      {profile.territoryOptIn && !profile.territoryNoticeSeen ? <TerritoryNotice /> : null}
      {profile.territoryOptIn ? null : (
        <Card testID="territory-opted-out">
          <Text style={[styles.cardTitle, { color: c.text }]}>{TERRITORY_COPY.optedOutTitle}</Text>
          <Body muted>{TERRITORY_COPY.optedOutBody}</Body>
          <Button testID="territory-turn-on" label={TERRITORY_COPY.turnOn} onPress={() => void turnOn()} busy={saving} />
        </Card>
      )}
      <ErrorText>{error}</ErrorText>

      {shown.truncated ? (
        <View testID="territory-truncated" style={[styles.notice, { backgroundColor: c.surface, borderColor: c.border }]} accessibilityRole="alert">
          <Text style={[styles.noticeText, { color: c.warning }]}>{TERRITORY_COPY.truncated}</Text>
        </View>
      ) : null}

      <Card testID="territory-summary">
        <View style={styles.summaryRow}>
          <Text style={[styles.month, { color: c.text }]}>{periodLabel('month', month)}</Text>
          {isCurrent ? <Text style={[styles.reset, { color: c.textMuted }]}>{resetLabel(month)}</Text> : null}
        </View>
        <View style={styles.summaryRow}>
          <View style={[styles.dot, { backgroundColor: ownerColor(profile.color, profile.id) }]} />
          <Text style={[styles.mine, { color: c.text }]}>
            {isCurrent ? 'You hold ' : 'You held '}
            {squaresLabel(mine)}
          </Text>
          {shown.loading || standings.status === 'loading' ? <ActivityIndicator color={c.brand} /> : null}
        </View>
        {profile.territoryOptIn ? <Body muted>{TERRITORY_COPY.onNote}</Body> : null}
      </Card>

      <SectionTitle>{isCurrent ? 'This month' : 'Standings'}</SectionTitle>
      <Card testID="territory-standings">
        {standings.status === 'error' && !standings.data ? <Body muted>{TERRITORY_COPY.standingsError}</Body> : null}
        {standings.status === 'ready' && top.length === 0 ? <Body muted>{TERRITORY_COPY.noStandings}</Body> : null}
        {top.map((s) => (
          <StandingRow key={s.userId} s={s} />
        ))}
      </Card>

      <SectionTitle>{`${periodLabel('month', lastMonth)} champions`}</SectionTitle>
      <Card testID="territory-champions">
        {champions.status === 'loading' ? <ActivityIndicator color={c.brand} /> : null}
        {champions.status !== 'loading' && !champions.data?.length ? (
          <Body muted>{`No champions recorded for ${periodLabel('month', lastMonth)}.`}</Body>
        ) : null}
        {champions.data?.map((s) => (
          <StandingRow key={s.userId} s={s} />
        ))}
      </Card>

      <SectionTitle>Legend</SectionTitle>
      <Card testID="territory-legend">
        <View style={styles.legendRow}>
          <View style={[styles.swatch, { backgroundColor: withAlpha(ownerColor(1, ''), TERRITORY_FILL_ALPHA) }]} />
          <View style={[styles.swatch, { backgroundColor: withAlpha(ownerColor(3, ''), TERRITORY_FILL_ALPHA) }]} />
          <View
            style={[
              styles.swatch,
              { backgroundColor: withAlpha(ownerColor(profile.color, profile.id), TERRITORY_FILL_ALPHA), borderColor: c.text, borderWidth: 1.5 },
            ]}
          />
        </View>
        <Body muted>{TERRITORY_COPY.legend}</Body>
      </Card>

      <SectionTitle>How it works</SectionTitle>
      <Card>
        <Body>{TERRITORY_COPY.howTo}</Body>
        <Body muted>{TERRITORY_COPY.monthly}</Body>
        <Button testID="territory-account" kind="secondary" label={TERRITORY_COPY.openAccount} onPress={() => router.push(accountPath())} />
      </Card>
    </SheetScrollView>
  );
}

function StandingRow({ s }: { s: TerritoryStanding }) {
  const c = usePalette();
  return (
    <View style={styles.row} testID={s.isMe ? 'territory-row-me' : 'territory-row'}>
      <Text style={[styles.rank, { color: c.textMuted }]}>{s.rank}</Text>
      <View style={[styles.dot, { backgroundColor: ownerColor(s.color, s.userId) }]} />
      <Text style={[styles.name, { color: c.text }, s.isMe && { fontFamily: fonts.bold }]} numberOfLines={1}>
        {s.isMe ? `${s.nickname} (${TERRITORY_COPY.you})` : s.nickname}
      </Text>
      <Text style={[styles.value, { color: c.text }]}>{squaresLabel(s.cells)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontFamily: fonts.bold, fontSize: 16 },
  notice: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  noticeText: { fontFamily: fonts.semibold, fontSize: 14 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  month: { flex: 1, fontFamily: fonts.bold, fontSize: 18 },
  reset: { fontFamily: fonts.semibold, fontSize: 13 },
  mine: { flex: 1, fontFamily: fonts.semibold, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  rank: { width: 24, fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { flex: 1, fontFamily: fonts.medium, fontSize: 15 },
  value: { fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  legendRow: { flexDirection: 'row', gap: 8 },
  swatch: { width: 22, height: 22, borderRadius: 4 },
});
