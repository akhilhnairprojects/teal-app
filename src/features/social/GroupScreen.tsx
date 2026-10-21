import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { formatDistanceM, formatDurationMs, useUnits } from '@/activity/format';
import { periodLabel, type PeriodKind } from '@/activity/periods';
import type { ActivityKind } from '@/activity/types';
import type { MyProfile } from '@/backend/auth';
import { SignInGate } from '@/features/account/SignInGate';
import { goBack, groupPath, joinGroupPath, leaderboardsPath, sessionPath } from '@/features/shell/routes';
import { getGroupMembers, leaveGroup, listMyGroups, removeGroupMember, rotateGroupCode, type Group, type GroupMember } from '@/social/groups';
import { BOARD_META, fetchLeaderboard, type BoardId, type Leaderboard } from '@/social/leaderboards';
import { createSession, type GroupSession } from '@/social/sessions';
import { fonts, radius, usePalette } from '@/theme';
import { EmptyState, SheetPage, SheetScrollView } from '@/ui';

import { listGroupSessions } from './groupSessionsApi';
import { groupShareMessage, SESSION_STATUS_COPY } from './socialModel';
import { Body, Button, Card, Field, Loading, Notice, PersonRow, SectionTitle, socialStyles, TextLink } from './ui';

/** The boards shown on a group page: running only (group runs are the point). */
export const GROUP_BOARDS: readonly BoardId[] = ['run_distance', 'run_1k', 'run_5k', 'run_10k'];
const BOARD_CHIP: Record<string, string> = { run_distance: 'Distance', run_1k: '1K', run_5k: '5K', run_10k: '10K' };

export function GroupScreen({ groupId }: { groupId: string | null }) {
  return (
    <SheetPage title="Group" onBack={goBack}>
      <SignInGate next={groupId ? String(groupPath(groupId)) : undefined}>
        {(profile) =>
          groupId ? <GroupBody groupId={groupId} profile={profile} /> : <EmptyState icon="people-outline" title="Group not found" />
        }
      </SignInGate>
    </SheetPage>
  );
}

const joinLink = (code: string) => Linking.createURL(String(joinGroupPath(code)).replace(/^\//, ''));

function GroupBody({ groupId, profile }: { groupId: string; profile: MyProfile }) {
  const c = usePalette();
  const [units] = useUnits();
  const [group, setGroup] = useState<Group | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [sessions, setSessions] = useState<GroupSession[] | null>(null);
  const [board, setBoard] = useState<BoardId>('run_distance');
  const [period, setPeriod] = useState<PeriodKind>('week');
  const [ranking, setRanking] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ActivityKind>('run');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [g, m, s] = await Promise.all([listMyGroups(), getGroupMembers(groupId), listGroupSessions(groupId)]);
    if (g.ok) setGroup(g.value.find((x) => x.id === groupId) ?? null);
    if (m.ok) setMembers(m.value);
    if (s.ok) setSessions(s.value);
    const failed = [g, m, s].find((r) => !r.ok);
    setError(failed && !failed.ok ? failed.error.message : null);
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadBoard = useCallback(async () => {
    setRanking(null);
    const r = await fetchLeaderboard({ board, period, scope: { kind: 'group', groupId }, limit: 10 });
    if (r.ok) setRanking(r.value);
  }, [board, period, groupId]);

  useFocusEffect(
    useCallback(() => {
      void loadBoard();
    }, [loadBoard]),
  );

  if (group === undefined && !error) return <Loading />;
  if (group === null) return <EmptyState icon="people-outline" title="You’re not in this group" message="Ask a member for the group code to join." />;

  const isOwner = group?.role === 'owner';

  const act = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    try {
      await f();
    } finally {
      setBusy(null);
    }
  };

  const share = () => {
    if (!group) return;
    void Share.share({ message: groupShareMessage(group.name, group.inviteCode, joinLink(group.inviteCode)) }).catch(() => {});
  };

  const rotate = () =>
    act('rotate', async () => {
      const r = await rotateGroupCode(groupId);
      if (!r.ok) return setError(r.error.message);
      setGroup((g) => (g ? { ...g, inviteCode: r.value } : g));
    });

  const removeMember = (m: GroupMember) =>
    Alert.alert(`Remove ${m.nickname}?`, 'They can rejoin only with the group code.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void act(`remove:${m.userId}`, async () => {
            const r = await removeGroupMember(groupId, m.userId);
            if (!r.ok) setError(r.error.message);
            await load();
          }),
      },
    ]);

  const leave = () =>
    Alert.alert(
      'Leave this group?',
      isOwner ? 'The longest-standing member becomes the owner. If you’re the only member, the group is deleted.' : 'You can rejoin with the group code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () =>
            void act('leave', async () => {
              const r = await leaveGroup(groupId);
              if (!r.ok) return setError(r.error.message);
              goBack();
            }),
        },
      ],
    );

  const create = () =>
    act('create', async () => {
      const t = title.trim();
      if (!t) return setError('Give the session a title, like “Saturday long run”.');
      const r = await createSession(groupId, { title: t, kind });
      if (!r.ok) return setError(r.error.message);
      setTitle('');
      setError(null);
      router.push(sessionPath(r.value));
    });

  const meta = BOARD_META[board];
  const formatValue = (v: number) => (meta.unit === 'distance' ? formatDistanceM(v, units) : formatDurationMs(v));
  // My row is pinned below the top 10 when I'm outside it.
  const rows = ranking ? (ranking.me && !ranking.rows.some((r) => r.isMe) ? [...ranking.rows, ranking.me] : ranking.rows) : null;

  return (
    <SheetScrollView contentContainerStyle={socialStyles.content}>
      {group ? (
        <Card testID="group-header">
          <Text style={[styles.name, { color: c.text }]} numberOfLines={2}>
            {group.name}
          </Text>
          <Body muted>
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'} · code{' '}
            <Text selectable style={[styles.code, { color: c.text }]} testID="group-code">
              {group.inviteCode}
            </Text>
          </Body>
          <View style={styles.row}>
            <Button label="Share code" small onPress={share} />
            {isOwner ? <Button label="New code" small kind="secondary" onPress={() => void rotate()} busy={busy === 'rotate'} /> : null}
          </View>
        </Card>
      ) : null}
      <Notice text={error} />

      <SectionTitle right={<TextLink label="Full leaderboard" onPress={() => router.push(leaderboardsPath({ board, period, scope: 'group', groupId }))} />}>
        Group leaderboard
      </SectionTitle>
      <Card testID="group-board">
        <View style={styles.row}>
          {GROUP_BOARDS.map((b) => (
            <Chip key={b} label={BOARD_CHIP[b]} selected={b === board} onPress={() => setBoard(b)} testID={`group-board-${b}`} />
          ))}
          <View style={styles.spacer} />
          {(['week', 'month'] as const).map((p) => (
            <Chip key={p} label={p === 'week' ? 'Week' : 'Month'} selected={p === period} onPress={() => setPeriod(p)} />
          ))}
        </View>
        {ranking ? <Body muted>{`${meta.label} · ${periodLabel(period, ranking.periodStart)}`}</Body> : null}
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Body muted>No counted runs yet. Record a run (or join a session) to get on the board.</Body>
        ) : (
          rows.map((r, i) => (
            <PersonRow
              key={`${r.rank}-${r.userId}`}
              name={`${r.rank}. ${r.nickname}${r.isMe ? ' (you)' : ''}`}
              color={r.color}
              highlight={r.isMe}
              divider={i > 0}
              right={<Text style={[styles.value, { color: c.text }]}>{formatValue(r.value)}</Text>}
            />
          ))
        )}
      </Card>

      <SectionTitle>Run together</SectionTitle>
      <Card testID="group-sessions">
        {!sessions ? (
          error ? null : <Loading />
        ) : sessions.length === 0 ? (
          <Body muted>Start a session, run at the same time, and see everyone’s distance live and the results after.</Body>
        ) : (
          sessions.map((s, i) => (
            <PersonRow
              key={s.id}
              name={s.title}
              detail={`${s.kind === 'run' ? 'Run' : 'Bluebike ride'} · ${SESSION_STATUS_COPY[s.status]}`}
              divider={i > 0}
              onPress={() => router.push(sessionPath(s.id))}
              testID={`group-session-${s.id}`}
              right={<Ionicons name="chevron-forward" size={16} color={c.textMuted} />}
            />
          ))
        )}
        <Field label="Session title" value={title} onChangeText={setTitle} maxLength={60} testID="group-session-title" />
        <View style={styles.row}>
          <Chip label="Run" selected={kind === 'run'} onPress={() => setKind('run')} />
          <Chip label="Bluebike ride" selected={kind === 'bike'} onPress={() => setKind('bike')} />
          <View style={styles.spacer} />
          <Button label="Create session" small onPress={() => void create()} busy={busy === 'create'} disabled={!title.trim()} testID="group-session-create" />
        </View>
      </Card>

      <SectionTitle>Members</SectionTitle>
      <Card testID="group-members">
        {!members ? (
          error ? null : <Loading />
        ) : (
          members.map((m, i) => (
            <PersonRow
              key={m.userId}
              name={`${m.nickname}${m.userId === profile.id ? ' (you)' : ''}`}
              color={m.color}
              detail={m.role === 'owner' ? 'Owner' : null}
              divider={i > 0}
              right={isOwner && m.userId !== profile.id ? <TextLink label="Remove" onPress={() => removeMember(m)} /> : null}
            />
          ))
        )}
      </Card>

      <Button label="Leave group" kind="secondary" onPress={leave} busy={busy === 'leave'} testID="group-leave" />
    </SheetScrollView>
  );
}

function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  const c = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? c.brand : c.surfaceMuted }]}
    >
      <Text style={[styles.chipText, { color: selected ? c.onBrand : c.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: fonts.bold, fontSize: 20 },
  code: { fontFamily: fonts.bold, letterSpacing: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  spacer: { flex: 1 },
  value: { fontFamily: fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
  chip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontFamily: fonts.semibold, fontSize: 13 },
});
