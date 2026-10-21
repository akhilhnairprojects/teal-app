import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useUnits } from '@/activity/format';
import { periodLabel, periodStart, type PeriodKind } from '@/activity/periods';
import { Body, Button, Card, ErrorText, formStyles, SectionTitle } from '@/features/account/formUi';
import { SignInGate } from '@/features/account/SignInGate';
import { goBack, leaderboardsPath, recordPath, type LeaderboardScopeParam } from '@/features/shell/routes';
import { useNow } from '@/mbta/live/usePolling';
import {
  BOARD_META,
  fetchChampions,
  fetchFeaturedRuns,
  fetchLeaderboard,
  type BoardId,
  type BoardScope,
  type Champion,
  type FeaturedRun,
  type Leaderboard,
  type LeaderboardRow,
} from '@/social/leaderboards';
import { useMapOverlay, type MapOverlay } from '@/state/mapOverlay';
import { OWNER_COLORS } from '@/territory/api';
import { fonts, radius, usePalette, type Palette } from '@/theme';
import { SheetPage, SheetScrollView } from '@/ui';

import {
  BOARD_CHIPS,
  boardQueryKey,
  championsTitle,
  createTimedCache,
  emptyBoardText,
  featuredCardText,
  formatBoardValue,
  previousPeriodStart,
  resetCountdown,
  ROUTE_NOT_SHARED,
  SCOPE_CHIPS,
  scopeKey,
  splitMyRow,
} from './leaderboardModel';

const OVERLAY_OWNER = 'leaderboards';

// Shared across visits so refocusing or flipping chips back within 60 s doesn't refetch (review S4).
const boards = createTimedCache<Leaderboard>();
const featured = createTimedCache<FeaturedRun[]>();
const champions = createTimedCache<Champion[]>();

/** Test helper. */
export function resetLeaderboardCachesForTests(): void {
  boards.clear();
  featured.clear();
  champions.clear();
}

export type LeaderboardsScreenParams = {
  board: BoardId | null;
  period: PeriodKind | null;
  scope: LeaderboardScopeParam | null;
};

function initialScope(p: LeaderboardsScreenParams): BoardScope {
  if (p.scope === 'friends') return { kind: 'friends' };
  return { kind: 'global' };
}

/** Weekly and monthly boards, featured runs and last period's champions (spec §5 G2). Signed-in only. */
export function LeaderboardsScreen({ params }: { params: LeaderboardsScreenParams }) {
  return (
    <SheetPage title="Leaderboards" onBack={goBack}>
      <SignInGate next={String(leaderboardsPath())}>
        <Boards params={params} />
      </SignInGate>
    </SheetPage>
  );
}

type Load<T> = { value: T | null; loading: boolean; error: string | null };

function Boards({ params }: { params: LeaderboardsScreenParams }) {
  const c = usePalette();
  const s = styles(c);
  const [units] = useUnits();
  const now = useNow(60_000);
  const [period, setPeriod] = useState<PeriodKind>(params.period ?? 'week');
  const [board, setBoard] = useState<BoardId>(params.board ?? 'run_distance');
  const [scope, setScope] = useState<BoardScope>(() => initialScope(params));
  const [selected, setSelected] = useState<string | null>(null);
  // The period follows the clock, so a rollover while the screen is open moves to the new period.
  const start = periodStart(period, now);
  const prevStart = previousPeriodStart(period, start);

  const [lb, setLb] = useState<Load<Leaderboard>>({ value: null, loading: true, error: null });
  const [runs, setRuns] = useState<FeaturedRun[]>([]);
  const [champs, setChamps] = useState<Champion[]>([]);

  const key = boardQueryKey({ board, period, periodStart: start, scope });
  const periodKey = `${period}|${start}`;
  const prevKey = `${period}|${prevStart}`;

  const loadBoard = useCallback(() => {
    let cancelled = false;
    const t = Date.now();
    const hit = boards.fresh(key, t);
    if (hit) {
      setLb({ value: hit, loading: false, error: null });
      return () => {};
    }
    setLb({ value: boards.last(key), loading: true, error: null });
    void fetchLeaderboard({ board, period, periodStart: start, scope }).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        boards.set(key, r.value, Date.now());
        setLb({ value: r.value, loading: false, error: null });
      } else {
        setLb((cur) => ({ value: cur.value, loading: false, error: r.error.message }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key, board, period, start, scope, setLb]);

  const loadExtras = useCallback(() => {
    let cancelled = false;
    const t = Date.now();
    const f = featured.fresh(periodKey, t);
    if (f) setRuns(f);
    else {
      setRuns(featured.last(periodKey) ?? []);
      void fetchFeaturedRuns(period, start).then((r) => {
        if (cancelled || !r.ok) return;
        featured.set(periodKey, r.value, Date.now());
        setRuns(r.value);
      });
    }
    const ch = champions.fresh(prevKey, t);
    if (ch) setChamps(ch);
    else {
      setChamps(champions.last(prevKey) ?? []);
      void fetchChampions(period, prevStart).then((r) => {
        if (cancelled || !r.ok) return;
        champions.set(prevKey, r.value, Date.now());
        setChamps(r.value);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [periodKey, prevKey, period, start, prevStart, setRuns, setChamps]);

  // Refresh on focus and whenever the query changes; the caches enforce the 60 s minimum.
  useFocusEffect(loadBoard);
  useFocusEffect(loadExtras);

  const selectedRun = runs.find((r) => r.activityId === selected) ?? null;
  const overlay = useMemo<MapOverlay | null>(() => {
    if (!selectedRun?.route) return null;
    return {
      tracks: [{ id: `featured:${selectedRun.activityId}`, coordinates: selectedRun.route, color: OWNER_COLORS[selectedRun.color] ?? c.brand, width: 5 }],
      fitTo: selectedRun.route,
    };
  }, [selectedRun, c.brand]);
  useMapOverlay(OVERLAY_OWNER, overlay);

  const chips = SCOPE_CHIPS;
  const boardChamps = champs.filter((ch) => ch.board === board).sort((a, b) => a.rank - b.rank).slice(0, 3);
  const split = lb.value && lb.value.board === board ? splitMyRow(lb.value) : null;

  return (
    <SheetScrollView contentContainerStyle={formStyles.content}>
      <View style={s.segment} accessibilityRole="tablist">
        {(['week', 'month'] as const).map((p) => (
          <Pressable
            key={p}
            testID={`lb-period-${p}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: period === p }}
            onPress={() => {
              setPeriod(p);
              setSelected(null);
            }}
            style={[s.segmentItem, period === p && s.segmentOn]}
          >
            <Text style={[s.segmentText, period === p && s.segmentTextOn]}>{p === 'week' ? 'Week' : 'Month'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.periodRow}>
        <Text style={s.periodLabel} testID="lb-period-label">
          {periodLabel(period, start)}
        </Text>
        <Text style={s.reset}>{resetCountdown(period, start, now)}</Text>
      </View>

      {runs.length > 0 ? (
        <>
          <SectionTitle>Featured runs</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip} testID="lb-featured">
            {runs.map((run) => {
              const t = featuredCardText(run, units);
              const on = run.activityId === selected;
              return (
                <Pressable
                  key={run.activityId}
                  testID={`lb-featured-${run.activityId}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setSelected(on ? null : run.activityId)}
                  style={[s.card, on && { borderColor: c.brand, borderWidth: 2 }]}
                >
                  <View style={s.cardTop}>
                    <View style={[s.dot, { backgroundColor: OWNER_COLORS[run.color] ?? c.brand }]} />
                    <Text style={s.cardHeadline}>{t.headline}</Text>
                  </View>
                  <Text style={s.cardDetail} numberOfLines={1}>
                    {t.detail}
                  </Text>
                  {on && !run.route ? <Text style={s.cardNote}>{ROUTE_NOT_SHARED}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {BOARD_CHIPS.map((b) => (
          <Chip key={b.board} label={b.label} on={board === b.board} onPress={() => setBoard(b.board)} testID={`lb-board-${b.board}`} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {chips.map((ch) => (
          <Chip key={ch.key} label={ch.label} on={scopeKey(scope) === ch.key} onPress={() => setScope(ch.scope)} testID={`lb-scope-${ch.key}`} />
        ))}
      </ScrollView>

      <Card testID="lb-board">
        <Text style={s.boardTitle}>{BOARD_META[board].label}</Text>
        {lb.loading && !split ? <ActivityIndicator color={c.brand} /> : null}
        <ErrorText>{lb.error}</ErrorText>
        {split && split.rows.length === 0 && !split.pinned ? (
          <View style={s.empty}>
            <Body muted>{emptyBoardText(board, period)}</Body>
            <Button
              label={board === 'bike_distance' ? 'Record a ride' : 'Record a run'}
              kind="secondary"
              onPress={() => router.push(recordPath({ kind: board === 'bike_distance' ? 'bike' : 'run' }))}
            />
          </View>
        ) : null}
        {split?.rows.map((row) => <Row key={`${row.rank}:${row.userId}`} row={row} board={board} units={units} />)}
        {split?.pinned ? (
          <>
            <Text style={s.gap}>⋯</Text>
            <Row row={split.pinned} board={board} units={units} />
          </>
        ) : null}
      </Card>

      {boardChamps.length > 0 ? (
        <>
          <SectionTitle>{championsTitle(period)}</SectionTitle>
          <Card testID="lb-champions">
            {boardChamps.map((ch) => (
              <View key={`${ch.rank}:${ch.userId}`} style={s.row}>
                <Text style={s.rank}>{ch.rank}</Text>
                <View style={[s.dot, { backgroundColor: OWNER_COLORS[ch.color] ?? c.brand }]} />
                <Text style={s.name} numberOfLines={1}>
                  {ch.nickname}
                </Text>
                <Text style={s.value}>{formatBoardValue(board, ch.value, units)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      <Body muted>Boards show the date of each effort, never the time of day. Bluebike rides are ranked by distance only.</Body>
    </SheetScrollView>
  );
}

function Row({ row, board, units }: { row: LeaderboardRow; board: BoardId; units: 'mi' | 'km' }) {
  const c = usePalette();
  const s = styles(c);
  return (
    <View style={[s.row, row.isMe && s.meRow]} testID={row.isMe ? 'lb-row-me' : undefined}>
      <Text style={s.rank}>{row.rank}</Text>
      <View style={[s.dot, { backgroundColor: OWNER_COLORS[row.color] ?? c.brand }]} />
      <Text style={[s.name, row.isMe && { fontFamily: fonts.bold }]} numberOfLines={1}>
        {row.nickname}
        {row.isMe ? ' (you)' : ''}
      </Text>
      <Text style={s.value}>{formatBoardValue(board, row.value, units)}</Text>
    </View>
  );
}

function Chip({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  const c = usePalette();
  const s = styles(c);
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    segment: { flexDirection: 'row', backgroundColor: c.surfaceMuted, borderRadius: radius.pill, padding: 3 },
    segmentItem: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center' },
    segmentOn: { backgroundColor: c.surface },
    segmentText: { fontFamily: fonts.semibold, fontSize: 14, color: c.textMuted },
    segmentTextOn: { color: c.text },
    periodRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    periodLabel: { fontFamily: fonts.bold, fontSize: 17, color: c.text },
    reset: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    strip: { gap: 8 },
    card: {
      width: 168,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 12,
      gap: 4,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cardHeadline: { fontFamily: fonts.extrabold, fontSize: 17, color: c.text, fontVariant: ['tabular-nums'] },
    cardDetail: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    cardNote: { fontFamily: fonts.semibold, fontSize: 12, color: c.warning },
    chips: { gap: 8 },
    chip: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: c.surfaceMuted },
    chipOn: { backgroundColor: c.brand },
    chipText: { fontFamily: fonts.semibold, fontSize: 14, color: c.text },
    chipTextOn: { color: c.onBrand },
    boardTitle: { fontFamily: fonts.bold, fontSize: 16, color: c.text },
    empty: { gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm },
    meRow: { backgroundColor: c.brandSoft },
    rank: { width: 28, fontFamily: fonts.bold, fontSize: 15, color: c.textMuted, fontVariant: ['tabular-nums'] },
    dot: { width: 10, height: 10, borderRadius: 5 },
    name: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    value: { fontFamily: fonts.bold, fontSize: 15, color: c.text, fontVariant: ['tabular-nums'] },
    gap: { textAlign: 'center', color: c.textMuted, fontFamily: fonts.bold },
  });
