import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { formatDistanceM, formatDurationMs, useUnits } from '@/activity/format';
import { useRecorder } from '@/activity/recorder';
import type { MyProfile } from '@/backend/auth';
import { SignInGate } from '@/features/account/SignInGate';
import { goBack, groupPath, recordPath, sessionPath } from '@/features/shell/routes';
import { useAppActive } from '@/mbta/live/usePolling';
import { ensureNotificationPermission, registerForPush } from '@/notifications';
import { listMyGroups } from '@/social/groups';
import { fetchSessionResults, getSession, joinSession, setSessionStatus, type GroupSession, type LiveProgress, type SessionResult } from '@/social/sessions';
import { attachSession, broadcastSessionStatus, followRecorder, getSessionLive, stopFollowing } from '@/social/sessionRuntime';
import { fonts, usePalette } from '@/theme';
import { EmptyState, SheetPage, SheetScrollView } from '@/ui';

import { canControlSession, isParticipant, liveRows, resultDetail, SESSION_STATUS_COPY, sortedResults } from './socialModel';
import { Body, Button, Card, Loading, Notice, PersonRow, SectionTitle, socialStyles, TextLink } from './ui';

/** Re-read the session this often while the page is open (covers a dropped realtime connection). */
export const SESSION_POLL_MS = 15_000;

export function SessionScreen({ sessionId }: { sessionId: string | null }) {
  return (
    <SheetPage title="Run together" onBack={goBack}>
      <SignInGate next={sessionId ? String(sessionPath(sessionId)) : undefined}>
        {(profile) => (sessionId ? <SessionBody sessionId={sessionId} profile={profile} /> : <EmptyState icon="people-outline" title="Session not found" />)}
      </SignInGate>
    </SheetPage>
  );
}

function SessionBody({ sessionId, profile }: { sessionId: string; profile: MyProfile }) {
  const c = usePalette();
  const [units] = useUnits();
  const appActive = useAppActive();
  const rec = useRecorder();
  const [session, setSession] = useState<GroupSession | null | undefined>(undefined);
  const [groupRole, setGroupRole] = useState<'owner' | 'member' | null>(null);
  const [results, setResults] = useState<SessionResult[] | null>(null);
  const [live, setLive] = useState<{ progress: LiveProgress[]; presence: string[] }>({ progress: [], presence: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const load = useCallback(async () => {
    const r = await getSession(sessionId);
    if (!r.ok) {
      if (r.error.code === 'not_found') setSession(null);
      else setError(r.error.message);
      return;
    }
    setSession(r.value);
    setError(null);
    if (r.value.status !== 'open') {
      const res = await fetchSessionResults(sessionId);
      if (res.ok) setResults(res.value);
    }
  }, [sessionId]);

  // Load on focus; poll while focused, in the foreground and not ended.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void load();
      return () => setFocused(false);
    }, [load]),
  );
  const ended = session?.status === 'ended';
  useEffect(() => {
    if (!focused || !appActive || ended) return;
    const t = setInterval(() => void load(), SESSION_POLL_MS);
    return () => clearInterval(t);
  }, [focused, appActive, ended, load]);

  const groupId = session?.groupId ?? null;
  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    void listMyGroups().then((r) => {
      if (!cancelled && r.ok) setGroupRole(r.value.find((g) => g.id === groupId)?.role ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Live channel: progress, presence (who has this page open) and status changes.
  const channelOpen = !!session && session.status !== 'ended';
  useEffect(() => {
    if (!channelOpen) return;
    const refreshLive = () => setLive(getSessionLive(sessionId));
    const detach = attachSession(sessionId, {
      onProgress: refreshLive,
      onPresence: refreshLive,
      onStatus: () => void load(),
    });
    refreshLive();
    return detach;
  }, [channelOpen, sessionId, load]);

  const joined = session ? isParticipant(session, profile.id) : false;
  const status = session?.status;
  // A participant in a live session broadcasts their recording for it (stops by itself on finish).
  useEffect(() => {
    if (joined && status === 'live') followRecorder(sessionId);
    if (status === 'ended') stopFollowing(sessionId);
  }, [joined, status, sessionId]);

  if (session === undefined) return error ? <Notice text={error} /> : <Loading />;
  if (session === null) return <EmptyState icon="people-outline" title="Session not found" message="It may have been removed, or you’re not in its group." />;

  const act = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    try {
      await f();
    } finally {
      setBusy(null);
    }
  };

  const join = () =>
    act('join', async () => {
      const r = await joinSession(sessionId);
      if (!r.ok) return setError(r.error.message);
      // Ask for notifications in context (spec §3.5) so "session starting" alerts can arrive.
      if ((await ensureNotificationPermission()) === 'granted') void registerForPush();
      await load();
    });

  const setStatus = (s: 'live' | 'ended') =>
    act(s, async () => {
      const r = await setSessionStatus(sessionId, s);
      if (!r.ok) return setError(r.error.message);
      broadcastSessionStatus(sessionId, s);
      await load();
    });

  const recordingHere = rec.groupSessionId === sessionId && (rec.phase === 'acquiring' || rec.phase === 'recording' || rec.phase === 'paused');
  const startRecording = () => {
    followRecorder(sessionId);
    router.push(recordPath({ kind: session.kind, sessionId }));
  };

  const controls = canControlSession(session, profile.id, groupRole);
  const rows = liveRows(session, live.progress, live.presence);
  const kindLabel = session.kind === 'run' ? 'Run' : 'Bluebike ride';

  return (
    <SheetScrollView contentContainerStyle={socialStyles.content}>
      <Card testID="session-header">
        <Text style={[styles.title, { color: c.text }]}>{session.title}</Text>
        <Body muted testID="session-status">{`${kindLabel} · ${SESSION_STATUS_COPY[session.status]}`}</Body>
        <TextLink label="Open group" onPress={() => router.push(groupPath(session.groupId))} />
      </Card>
      <Notice text={error} />

      {session.status !== 'ended' ? (
        <Card testID="session-actions">
          {!joined ? (
            <Button label="Join session" onPress={() => void join()} busy={busy === 'join'} testID="session-join" />
          ) : session.status === 'open' ? (
            <Body muted>You’re in. When the session starts, a “Start recording” button appears here.</Body>
          ) : recordingHere ? (
            <Button label="Back to recording" onPress={() => router.push(recordPath({ kind: session.kind, sessionId }))} testID="session-recording" />
          ) : (
            <Button label="Start recording" onPress={startRecording} testID="session-start-recording" />
          )}
          {controls && session.status === 'open' ? (
            <Button label="Start session" kind="secondary" onPress={() => void setStatus('live')} busy={busy === 'live'} testID="session-go-live" />
          ) : null}
          {controls && session.status === 'live' ? (
            <Button label="End session" kind="secondary" onPress={() => void setStatus('ended')} busy={busy === 'ended'} testID="session-end" />
          ) : null}
          <Body muted>Teal shares distance and time with the group while you record, never your location.</Body>
        </Card>
      ) : null}

      {session.status !== 'ended' ? (
        <>
          <SectionTitle>{session.status === 'live' ? 'Live' : 'Who’s in'}</SectionTitle>
          <Card testID="session-live">
            {rows.length === 0 ? (
              <Body muted>No one has joined yet.</Body>
            ) : (
              rows.map((r, i) => (
                <PersonRow
                  key={r.userId}
                  name={`${r.nickname}${r.userId === profile.id ? ' (you)' : ''}`}
                  color={r.color}
                  divider={i > 0}
                  highlight={r.userId === profile.id}
                  detail={
                    r.progress
                      ? `${formatDurationMs(r.progress.elapsedMs)} · ${r.progress.state === 'finished' ? 'finished' : r.progress.state === 'paused' ? 'paused' : 'recording'}`
                      : r.here
                        ? 'Here now'
                        : null
                  }
                  right={r.progress ? <Text style={[styles.value, { color: c.text }]}>{formatDistanceM(r.progress.distanceM, units)}</Text> : null}
                />
              ))
            )}
          </Card>
        </>
      ) : null}

      {results ? (
        <>
          <SectionTitle>Results</SectionTitle>
          <Card testID="session-results">
            {results.length === 0 ? (
              <Body muted>No activities saved for this session yet. Results appear once recordings sync.</Body>
            ) : (
              sortedResults(results).map((r, i) => (
                <PersonRow
                  key={r.userId}
                  name={`${r.nickname}${r.userId === profile.id ? ' (you)' : ''}`}
                  color={r.color}
                  divider={i > 0}
                  highlight={r.userId === profile.id}
                  detail={resultDetail(r)}
                  right={r.distanceM !== null ? <Text style={[styles.value, { color: c.text }]}>{formatDistanceM(r.distanceM, units)}</Text> : null}
                />
              ))
            )}
          </Card>
        </>
      ) : null}
    </SheetScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.bold, fontSize: 20 },
  value: { fontFamily: fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
});
