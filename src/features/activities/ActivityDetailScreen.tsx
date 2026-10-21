import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatDistanceM, formatDurationMs, formatPace, useUnits } from '@/activity/format';
import { recentPath, splits as computeSplits } from '@/activity/metrics';
import {
  deleteActivity,
  fetchMyTrack,
  getLocalActivity,
  getLocalPoints,
  setActivitySharing,
  updateLocalActivity,
  useActivities,
  type LocalActivity,
} from '@/activity/store';
import { syncPending } from '@/activity/sync';
import type { LatLng, Split, TrackPoint } from '@/activity/types';
import { useAuth } from '@/backend/auth';
import { Body, Button, Card, ErrorText, formStyles, SectionTitle, ToggleRow } from '@/features/account/formUi';
import { formatSpeed, RECORD_COPY } from '@/features/record/recordModel';
import { activityPath, goBack, signInPath } from '@/features/shell/routes';
import { decodePolyline } from '@/lib/polyline';
import { useMapOverlay, type MapOverlay } from '@/state/mapOverlay';
import { fetchActivityClaim } from '@/territory/api';
import { fonts, radius, usePalette, type Palette } from '@/theme';
import { EmptyState, SheetPage, SheetScrollView } from '@/ui';

import { activityTitle, activityWhen, chipForItem, claimLine, effortRows, shareConfirmCopy, splitUnitM, toneColor } from './activityModel';

const OVERLAY_OWNER = 'activity-detail';
const TRACK_MAX_POINTS = 500;

/** One activity: stats, splits, efforts, its track on the map, sharing, delete and retry (spec §5 G2). */
export function ActivityDetailScreen({ id }: { id: string }) {
  return (
    <SheetPage title="Activity" onBack={goBack}>
      <DetailBody id={id} />
    </SheetPage>
  );
}

function DetailBody({ id }: { id: string }) {
  const c = usePalette();
  const s = styles(c);
  const [units] = useUnits();
  const auth = useAuth();
  const { ready, items } = useActivities();
  const item = items.find((i) => i.localId === id || i.serverId === id) ?? null;
  const localId = item?.localId ?? null;
  const serverId = item?.serverId ?? null;
  const kind = item ? item.kind : null;

  const [remoteTrack, setRemoteTrack] = useState<LatLng[] | null>(null);
  const [traceExpired, setTraceExpired] = useState(false);
  const [claim, setClaim] = useState<string | null>(null);
  const [confirmShare, setConfirmShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The local record changes as it syncs; reload it whenever the list does. State is keyed by id so a
  // missing or changed id never shows another activity's data.
  const [loadedLocal, setLoadedLocal] = useState<{ id: string; value: LocalActivity | null } | null>(null);
  const [loadedPoints, setLoadedPoints] = useState<{ id: string; value: TrackPoint[] | null } | null>(null);
  const local = localId && loadedLocal?.id === localId ? loadedLocal.value : null;
  // undefined while loading; null when there are no local points.
  const points = !localId ? null : loadedPoints?.id === localId ? loadedPoints.value : undefined;

  useEffect(() => {
    if (!localId) return;
    let cancelled = false;
    void getLocalActivity(localId).then((value) => {
      if (!cancelled) setLoadedLocal({ id: localId, value });
    });
    return () => {
      cancelled = true;
    };
  }, [localId, items]);

  useEffect(() => {
    if (!localId) return;
    let cancelled = false;
    void getLocalPoints(localId).then((value) => {
      if (!cancelled) setLoadedPoints({ id: localId, value });
    });
    return () => {
      cancelled = true;
    };
  }, [localId]);

  // Without local points (pruned after 30 days, or recorded on another device) fetch the stored trace.
  useEffect(() => {
    if (points !== null || !serverId) return;
    let cancelled = false;
    void fetchMyTrack(serverId).then((r) => {
      if (cancelled || !r.ok) return;
      if (r.value) setRemoteTrack(r.value);
      else setTraceExpired(true);
    });
    return () => {
      cancelled = true;
    };
  }, [points, serverId]);

  useEffect(() => {
    if (!serverId || kind !== 'run') return;
    let cancelled = false;
    void fetchActivityClaim(serverId).then((r) => {
      if (!cancelled && r.ok) setClaim(claimLine(r.value));
    });
    return () => {
      cancelled = true;
    };
  }, [serverId, kind]);

  const preview = local ? local.previewPolyline : null;
  const track = useMemo<LatLng[]>(() => {
    if (points && points.length >= 2) return recentPath(points, TRACK_MAX_POINTS);
    if (remoteTrack && remoteTrack.length >= 2) return thin(remoteTrack, TRACK_MAX_POINTS);
    if (preview) return decodePolyline(preview, 5);
    return [];
  }, [points, remoteTrack, preview]);

  const overlay = useMemo<MapOverlay | null>(
    () => (track.length >= 2 ? { tracks: [{ id: `activity:${id}`, coordinates: track, color: c.brand, width: 5 }], fitTo: track } : null),
    [track, id, c.brand],
  );
  useMapOverlay(OVERLAY_OWNER, overlay);

  const splitList: Split[] = points && kind ? computeSplits(points, kind, splitUnitM(units)) : [];

  if (!item) {
    return ready ? <EmptyState icon="walk-outline" title="Activity not found" message="It may have been deleted." /> : null;
  }

  const chip = chipForItem(item, local);
  const elapsedMs = local?.sync.server?.elapsedMs ?? local?.metrics.elapsedMs ?? null;
  const avg = item.distanceM > 0 && item.movingMs > 0 ? item.movingMs / 1000 / (item.distanceM / 1000) : null;
  const efforts = item.kind === 'run' && local ? effortRows(local.metrics.efforts, units) : [];
  const unsynced = item.syncState === 'local' || item.syncState === 'pending' || item.syncState === 'syncing';
  const shareRoute = local?.sync.server?.shareRoute ?? local?.shareRoute ?? false;
  const canShare = item.kind === 'run' && local !== null && item.syncState !== 'rejected' && item.syncState !== 'syncing';
  const copy = shareConfirmCopy(true)!;

  const applyShare = async (on: boolean) => {
    setConfirmShare(false);
    setError(null);
    setBusy(true);
    if (serverId) {
      const r = await setActivitySharing(serverId, on);
      if (!r.ok) setError(r.error.message);
    } else if (localId) {
      await updateLocalActivity(localId, (a) => ({ ...a, shareRoute: on }));
    }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const r = await deleteActivity({ localId, serverId });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    goBack();
  };

  return (
    <SheetScrollView contentContainerStyle={formStyles.content}>
      <Card testID="activity-summary">
        <Text style={s.title}>{activityTitle(item.kind)}</Text>
        <Body muted>{activityWhen(item.startedAt)}</Body>
        <Text style={[s.chip, { color: toneColor(c, chip.tone) }]} testID="activity-chip">
          {chip.label}
        </Text>
        <View style={s.grid}>
          <Stat label="Distance" value={formatDistanceM(item.distanceM, units)} />
          <Stat label="Moving" value={formatDurationMs(item.movingMs)} />
          {elapsedMs !== null ? <Stat label="Elapsed" value={formatDurationMs(elapsedMs)} /> : null}
          <Stat label={item.kind === 'run' ? 'Avg pace' : 'Avg speed'} value={item.kind === 'run' ? formatPace(avg, units) : formatSpeed(avg, units)} />
        </View>
        {unsynced ? <Body muted>Numbers are from this phone and may change slightly after upload.</Body> : null}
        {claim ? <Body>{claim}</Body> : null}
      </Card>

      {efforts.length > 0 ? (
        <>
          <SectionTitle>Best efforts</SectionTitle>
          <Card testID="activity-efforts">
            {efforts.map((e) => (
              <View key={e.key} style={s.line}>
                <Text style={s.lineLabel}>{e.label}</Text>
                <Text style={s.lineValue}>{e.time}</Text>
                <Text style={s.lineMuted}>{e.pace}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {splitList.length > 0 ? (
        <>
          <SectionTitle>{units === 'mi' ? 'Splits per mile' : 'Splits per km'}</SectionTitle>
          <Card testID="activity-splits">
            {splitList.map((sp) => (
              <View key={sp.index} style={s.line}>
                <Text style={s.lineLabel}>{sp.distanceM < splitUnitM(units) - 1 ? `${sp.index + 1} (${formatDistanceM(sp.distanceM, units)})` : String(sp.index + 1)}</Text>
                <Text style={s.lineValue}>{formatDurationMs(sp.durationMs)}</Text>
                <Text style={s.lineMuted}>
                  {item.kind === 'run'
                    ? formatPace(sp.durationMs / 1000 / (sp.distanceM / 1000), units)
                    : formatSpeed(sp.durationMs / 1000 / (sp.distanceM / 1000), units)}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {traceExpired ? <Body muted>The full route for this activity is no longer stored{track.length >= 2 ? '; the map shows a simplified preview' : ''}.</Body> : null}

      {canShare ? (
        <Card testID="activity-share">
          <ToggleRow
            label={RECORD_COPY.shareLabel}
            detail={RECORD_COPY.shareDetail}
            value={shareRoute}
            disabled={busy}
            onChange={(on) => (on ? setConfirmShare(true) : void applyShare(false))}
            testID="activity-share-toggle"
          />
          {confirmShare ? (
            <View style={s.confirm} testID="activity-share-confirm">
              <Text style={s.confirmTitle}>{copy.title}</Text>
              <Body muted>{copy.body}</Body>
              <Button label={copy.confirm} onPress={() => void applyShare(true)} testID="activity-share-yes" />
              <Button label="Cancel" kind="secondary" onPress={() => setConfirmShare(false)} />
            </View>
          ) : null}
        </Card>
      ) : null}

      <ErrorText>{error}</ErrorText>

      {item.syncState === 'pending' && auth.status === 'signedIn' ? (
        <Button label="Retry upload" kind="secondary" onPress={() => void syncPending('manual')} testID="activity-retry" />
      ) : null}
      {item.syncState === 'local' && auth.status === 'signedOut' ? (
        <Button label="Sign in to upload" kind="secondary" onPress={() => router.push(signInPath({ next: String(activityPath(id)) }))} />
      ) : null}

      {confirmDelete ? (
        <Card testID="activity-delete-confirm">
          <Body>Delete this activity from this phone{serverId ? ' and from Teal' : ''}? This can’t be undone.</Body>
          <Button label="Delete" kind="danger" busy={busy} onPress={() => void remove()} testID="activity-delete-yes" />
          <Button label="Cancel" kind="secondary" onPress={() => setConfirmDelete(false)} />
        </Card>
      ) : (
        <Button label="Delete activity" kind="danger" onPress={() => setConfirmDelete(true)} testID="activity-delete" />
      )}
    </SheetScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const c = usePalette();
  const s = styles(c);
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/** At most `max` points, evenly decimated, keeping both ends (map overlays are capped at 500). */
function thin(path: LatLng[], max: number): LatLng[] {
  if (path.length <= max) return path;
  const out: LatLng[] = [];
  for (let k = 0; k < max; k++) out.push(path[Math.round((k * (path.length - 1)) / (max - 1))]);
  return out;
}

const styles = (c: Palette) =>
  StyleSheet.create({
    title: { fontFamily: fonts.bold, fontSize: 20, color: c.text },
    chip: { fontFamily: fonts.semibold, fontSize: 13 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    stat: { flexGrow: 1, flexBasis: '45%', backgroundColor: c.surfaceMuted, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
    statLabel: { fontFamily: fonts.semibold, fontSize: 12, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
    statValue: { fontFamily: fonts.extrabold, fontSize: 22, color: c.text, fontVariant: ['tabular-nums'] },
    line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    lineLabel: { width: 96, fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    lineValue: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: c.text, fontVariant: ['tabular-nums'] },
    lineMuted: { fontFamily: fonts.medium, fontSize: 14, color: c.textMuted, fontVariant: ['tabular-nums'] },
    confirm: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: 10 },
    confirmTitle: { fontFamily: fonts.bold, fontSize: 15, color: c.text },
  });
