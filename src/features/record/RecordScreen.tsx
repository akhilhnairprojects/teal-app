import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDistanceM, formatDurationMs, formatPace, useUnits } from '@/activity/format';
import { recorder, useRecorder } from '@/activity/recorder';
import { getLocalPoints, type LocalActivity } from '@/activity/store';
import type { ActivityKind } from '@/activity/types';
import { updateMySettings, useAuth, type MyProfile } from '@/backend/auth';
import { Body, Button, Card, ErrorText, formStyles, ToggleRow } from '@/features/account/formUi';
import { MOVE_WEB_COPY } from '@/features/move/MoveHome';
import { activityPath, goBack, parkPath, signInPath } from '@/features/shell/routes';
import { TERRITORY_NOTICE_COPY, TerritoryNotice } from '@/features/territory/TerritoryNotice';
import { readCache, writeCache } from '@/lib/cache';
import { useMapOverlay, type MapOverlay } from '@/state/mapOverlay';
import { previewClaim, previewClaimText } from '@/territory/preview';
import { fonts, radius, usePalette, type Palette } from '@/theme';
import { EmptyState, SheetPage, SheetScrollView } from '@/ui';

import { bigStats, GPS_LABEL, isActivePhase, kindLabel, RECORD_COPY, RECORD_INTRO_KEY, recordBanners, formatSpeed } from './recordModel';

const OVERLAY_OWNER = 'record';

type Outcome = { saved: LocalActivity } | { discarded: true };

/**
 * Record a run or a Bluebike ride (spec §5 G2). Expo Go records only while Teal is open, so the
 * first start explains it, a chip stays on screen while recording, and background gaps are reported.
 */
export function RecordScreen({ initialKind, sessionId }: { initialKind: ActivityKind | null; sessionId: string | null }) {
  if (Platform.OS === 'web') {
    return (
      <SheetPage title="Record" onBack={goBack}>
        <EmptyState icon="phone-portrait-outline" title={MOVE_WEB_COPY.title} message={MOVE_WEB_COPY.body} />
      </SheetPage>
    );
  }
  return <RecordNative initialKind={initialKind} sessionId={sessionId} />;
}

function RecordNative({ initialKind, sessionId }: { initialKind: ActivityKind | null; sessionId: string | null }) {
  const snap = useRecorder();
  const active = isActivePhase(snap.phase);
  const title = active && snap.kind ? `Recording · ${kindLabel(snap.kind)}` : 'Record';
  return (
    <SheetPage title={title} onBack={goBack}>
      <RecordBody initialKind={initialKind} sessionId={sessionId} />
    </SheetPage>
  );
}

function RecordBody({ initialKind, sessionId }: { initialKind: ActivityKind | null; sessionId: string | null }) {
  const c = usePalette();
  const s = styles(c);
  const snap = useRecorder();
  const auth = useAuth();
  const [units] = useUnits();
  const [kind, setKind] = useState<ActivityKind>(initialKind ?? 'run');
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ wasPaused: boolean } | null>(null);
  const [share, setShare] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [recovery, setRecovery] = useState<{ kind: ActivityKind; points: number } | null>(null);

  const active = isActivePhase(snap.phase);
  const shownKind: ActivityKind = active && snap.kind ? snap.kind : kind;
  const profile = auth.status === 'signedIn' ? auth.profile : null;
  // Before the first run is saved (and synced), a signed-in user who hasn't seen the territory
  // notice sees it on the finish review (review B1). Saving after seeing it records it.
  const territoryNotice = shownKind === 'run' && profile !== null && profile.territoryOptIn && !profile.territoryNoticeSeen;
  // A recording that ended elsewhere (e.g. discarded from another screen) closes the finish review.
  const reviewing = active ? review : null;

  useEffect(() => {
    let cancelled = false;
    void readCache<boolean>(RECORD_INTRO_KEY, 1).then((hit) => {
      if (!cancelled) setIntroSeen(hit?.value === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const path = snap.recentPath;
  const showSaved = outcome !== null && 'saved' in outcome;
  const overlay = useMemo<MapOverlay>(() => {
    const tracks = path.length >= 2 ? [{ id: 'recording', coordinates: path, color: c.brand, width: 5 }] : [];
    return showSaved ? { tracks, fitTo: path.length >= 2 ? path : null } : { tracks, followUser: true };
  }, [path, c.brand, showSaved]);
  useMapOverlay(OVERLAY_OWNER, overlay);

  // An unfinished recording blocks a new start, so offer to resolve it here too (review N27).
  const idle = snap.phase === 'idle';
  useEffect(() => {
    if (!idle) return;
    let live = true;
    void recorder.pendingRecovery().then((r) => {
      if (live) setRecovery(r ? { kind: r.kind, points: r.points } : null);
    });
    return () => {
      live = false;
    };
  }, [idle]);

  const recover = async (action: 'resume' | 'save' | 'discard') => {
    setRecovery(null);
    setError(null);
    const r = await recorder.recover(action);
    if (!r.ok) setError(r.error.message);
  };

  const doStart = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setShare(false);
    setReview(null);
    const r = await recorder.start({ kind, groupSessionId: sessionId });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
  };

  const start = () => {
    if (introSeen) void doStart();
    else setShowIntro(true);
  };

  const confirmIntro = async () => {
    setShowIntro(false);
    setIntroSeen(true);
    await writeCache(RECORD_INTRO_KEY, 1, true);
    await doStart();
  };

  const openReview = () => {
    const wasPaused = snap.phase === 'paused';
    if (snap.phase === 'recording') recorder.pause();
    setShare(false);
    setReview({ wasPaused });
  };

  const resume = async () => {
    setError(null);
    const r = await recorder.resume();
    if (!r.ok) setError(r.error.message);
  };

  const keepGoing = () => {
    if (reviewing && !reviewing.wasPaused) void resume();
    setReview(null);
  };

  const save = async () => {
    setBusy(true);
    // Recorded before the activity syncs, so a loop in this run can claim squares.
    if (territoryNotice) await updateMySettings({ territoryNoticeSeen: true });
    const r = await recorder.finish({ shareRoute: share });
    setBusy(false);
    setReview(null);
    setOutcome('discarded' in r ? { discarded: true } : { saved: r });
  };

  const discard = async () => {
    setReview(null);
    await recorder.discard();
  };

  const banners = recordBanners(snap);
  const stats = bigStats(shownKind, snap.stats, units);

  return (
    <SheetScrollView contentContainerStyle={formStyles.content}>
      {banners.map((b) => (
        <View key={b.key} style={s.banner} accessibilityRole="alert" testID={`record-banner-${b.key}`}>
          <Text style={s.bannerText}>{b.text}</Text>
          {'settings' in b ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void Linking.openSettings()}>
              <Text style={s.link}>{RECORD_COPY.openSettings}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {recovery && !active ? (
        <Card testID="record-recovery">
          <Text style={s.cardTitle}>Resume or save your unfinished {recovery.kind === 'run' ? 'run' : 'ride'}?</Text>
          <Body muted>Teal closed while you were recording. {recovery.points} points were saved.</Body>
          <Button label="Resume" onPress={() => void recover('resume')} testID="record-recovery-resume" />
          <Button label="Save" kind="secondary" onPress={() => void recover('save')} testID="record-recovery-save" />
          <Button label="Discard" kind="danger" onPress={() => void recover('discard')} testID="record-recovery-discard" />
        </Card>
      ) : null}

      {outcome && !active ? (
        <OutcomeCard outcome={outcome} units={units} signedIn={auth.status === 'signedIn'} profile={profile} onAgain={() => setOutcome(null)} />
      ) : null}

      {!active && !outcome ? (
        <>
          <View style={s.segment} accessibilityRole="tablist">
            {(['run', 'bike'] as const).map((k) => (
              <Pressable
                key={k}
                testID={`record-kind-${k}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: kind === k }}
                onPress={() => setKind(k)}
                style={[s.segmentItem, kind === k && s.segmentOn]}
              >
                <Text style={[s.segmentText, kind === k && s.segmentTextOn]}>{k === 'run' ? 'Run' : 'Bluebike'}</Text>
              </Pressable>
            ))}
          </View>
          {showIntro ? (
            <Card testID="record-intro">
              <Text style={s.cardTitle}>{RECORD_COPY.firstStartTitle}</Text>
              <Body>{RECORD_COPY.firstStartBody}</Body>
              <Body muted>{RECORD_COPY.battery}</Body>
              <Button label={RECORD_COPY.firstStartConfirm} onPress={() => void confirmIntro()} testID="record-intro-confirm" />
            </Card>
          ) : (
            <Button label={`Start ${kind === 'run' ? 'run' : 'ride'}`} onPress={start} busy={busy} disabled={introSeen === null} testID="record-start" />
          )}
          {banners.length === 0 ? <ErrorText>{error}</ErrorText> : null}
          <Body muted>Teal records only while it’s open on screen. {RECORD_COPY.battery}</Body>
          {kind === 'bike' ? <Button label={RECORD_COPY.findDock} kind="secondary" onPress={() => router.push(parkPath())} testID="record-find-dock" /> : null}
        </>
      ) : null}

      {active ? (
        <>
          {snap.warnings.includes('foregroundOnly') ? (
            <View style={s.chip} testID="record-screen-on-chip">
              <Text style={s.chipText}>{RECORD_COPY.screenOnChip}</Text>
            </View>
          ) : null}
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: gpsColor(c, snap.stats.gpsQuality) }]} />
            <Text style={s.statusText} testID="record-gps">
              {GPS_LABEL[snap.stats.gpsQuality]}
            </Text>
            {snap.phase === 'acquiring' ? <Text style={s.statusText}> · {RECORD_COPY.acquiring}</Text> : null}
            {snap.phase === 'paused' ? <Text style={[s.statusText, { color: c.warning }]}> · Paused</Text> : null}
            {snap.phase === 'recording' && snap.stats.autoPaused ? (
              <Text style={[s.statusText, { color: c.warning }]}> · {RECORD_COPY.autoPaused}</Text>
            ) : null}
          </View>
          {snap.phase === 'paused' ? <ErrorText>{error}</ErrorText> : null}
          <View style={s.grid} testID="record-stats">
            {stats.map((st) => (
              <View key={st.key} style={s.tile}>
                <Text style={s.tileLabel}>{st.label}</Text>
                <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit>
                  {st.value}
                </Text>
              </View>
            ))}
          </View>

          {reviewing ? (
            <Card testID="record-review">
              <Text style={s.cardTitle}>Finish this {shownKind === 'run' ? 'run' : 'ride'}?</Text>
              {shownKind === 'run' ? (
                <ToggleRow label={RECORD_COPY.shareLabel} detail={RECORD_COPY.shareDetail} value={share} onChange={setShare} testID="record-share" />
              ) : null}
              {territoryNotice ? <TerritoryNotice testID="record-territory-notice" note={TERRITORY_NOTICE_COPY.saveNote} /> : null}
              <Button label="Save" onPress={() => void save()} busy={busy} testID="record-save" />
              <Button label="Keep going" kind="secondary" onPress={keepGoing} testID="record-keep-going" />
              <Button label="Discard" kind="danger" onPress={() => void discard()} testID="record-discard" />
            </Card>
          ) : (
            <View style={s.controls}>
              <View style={s.control}>
                {snap.phase === 'acquiring' ? (
                  <Button label={RECORD_COPY.startAnyway} kind="secondary" onPress={() => void resume()} testID="record-start-anyway" />
                ) : snap.phase === 'paused' ? (
                  <Button label="Resume" onPress={() => void resume()} testID="record-resume" />
                ) : (
                  <Button label="Pause" kind="secondary" onPress={() => recorder.pause()} testID="record-pause" />
                )}
              </View>
              <View style={s.control}>
                {snap.phase === 'acquiring' ? (
                  <Button label="Cancel" kind="secondary" onPress={() => void recorder.discard()} testID="record-cancel" />
                ) : (
                  <HoldButton label={RECORD_COPY.holdToFinish} onHold={openReview} testID="record-finish" />
                )}
              </View>
            </View>
          )}
          {shownKind === 'bike' ? <Button label={RECORD_COPY.findDock} kind="secondary" onPress={() => router.push(parkPath())} testID="record-find-dock" /> : null}
        </>
      ) : null}
    </SheetScrollView>
  );
}

/**
 * The territory estimate for a saved run (spec G4 preview, the server's claim rules), or null.
 * Signed out, territory off, or the notice not yet seen: the server claims nothing, so no estimate.
 */
function useClaimPreviewText(a: LocalActivity | null, profile: MyProfile | null): string | null {
  const [text, setText] = useState<{ id: string; text: string | null } | null>(null);
  const optedIn = profile !== null && profile.territoryOptIn && profile.territoryNoticeSeen;
  const id = a && a.kind === 'run' && a.metrics.isLoop && optedIn ? a.localId : null;
  useEffect(() => {
    if (!id) return;
    let live = true;
    void getLocalPoints(id).then((points) => {
      if (live && points) setText({ id, text: previewClaimText(previewClaim(points, { optedIn: true })) });
    });
    return () => {
      live = false;
    };
  }, [id]);
  return id && text?.id === id ? text.text : null;
}

function OutcomeCard({
  outcome,
  units,
  signedIn,
  profile,
  onAgain,
}: {
  outcome: Outcome;
  units: 'mi' | 'km';
  signedIn: boolean;
  profile: MyProfile | null;
  onAgain: () => void;
}) {
  const c = usePalette();
  const s = styles(c);
  const claimText = useClaimPreviewText('saved' in outcome ? outcome.saved : null, profile);
  if ('discarded' in outcome) {
    return (
      <Card testID="record-discarded">
        <Body>{RECORD_COPY.tooShort}</Body>
        <Button label="OK" kind="secondary" onPress={onAgain} />
      </Card>
    );
  }
  const a = outcome.saved;
  const m = a.metrics;
  const avg = m.distanceM > 0 && m.movingMs > 0 ? m.movingMs / 1000 / (m.distanceM / 1000) : null;
  return (
    <Card testID="record-saved">
      <Text style={s.cardTitle}>{a.kind === 'run' ? 'Run saved' : 'Ride saved'}</Text>
      <View style={s.grid}>
        <Tile label="Distance" value={formatDistanceM(m.distanceM, units)} />
        <Tile label="Time" value={formatDurationMs(m.elapsedMs)} />
        <Tile label={a.kind === 'run' ? 'Avg pace' : 'Avg speed'} value={a.kind === 'run' ? formatPace(avg, units) : formatSpeed(avg, units)} />
      </View>
      <Body muted>{signedIn ? RECORD_COPY.savedSignedIn : RECORD_COPY.savedSignedOut}</Body>
      {claimText ? (
        <Text style={s.claim} testID="record-claim-preview">
          {claimText}
        </Text>
      ) : null}
      <Button label="View activity" onPress={() => router.replace(activityPath(a.localId))} testID="record-view-activity" />
      {!signedIn ? <Button label="Sign in" kind="secondary" onPress={() => router.push(signInPath({ next: '/activities' }))} /> : null}
      <Button label="Record another" kind="secondary" onPress={onAgain} testID="record-again" />
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  const c = usePalette();
  const s = styles(c);
  return (
    <View style={s.tile}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/** Finish needs a long press so a pocket tap can't end a run. */
function HoldButton({ label, onHold, testID }: { label: string; onHold: () => void; testID?: string }) {
  const c = usePalette();
  const [pressing, setPressing] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Press and hold to finish recording"
      delayLongPress={800}
      onLongPress={() => {
        setPressing(false);
        onHold();
      }}
      onPressIn={() => setPressing(true)}
      onPressOut={() => setPressing(false)}
      style={[holdStyles.button, { backgroundColor: pressing ? c.brandDeep : c.danger }]}
    >
      <Text style={[holdStyles.text, { color: c.onBrand }]}>{label}</Text>
    </Pressable>
  );
}

const holdStyles = StyleSheet.create({
  button: { borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  text: { fontFamily: fonts.bold, fontSize: 15 },
});

function gpsColor(c: Palette, q: 'good' | 'fair' | 'poor' | 'none'): string {
  return q === 'good' ? c.live : q === 'fair' ? c.warning : q === 'poor' ? c.danger : c.textMuted;
}

const styles = (c: Palette) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    bannerText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: c.text },
    link: { fontFamily: fonts.bold, fontSize: 13, color: c.brand },
    segment: { flexDirection: 'row', backgroundColor: c.surfaceMuted, borderRadius: radius.pill, padding: 3 },
    segmentItem: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center' },
    segmentOn: { backgroundColor: c.surface },
    segmentText: { fontFamily: fonts.semibold, fontSize: 14, color: c.textMuted },
    segmentTextOn: { color: c.text },
    cardTitle: { fontFamily: fonts.bold, fontSize: 17, color: c.text },
    chip: { alignSelf: 'flex-start', backgroundColor: c.brandSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
    chipText: { fontFamily: fonts.bold, fontSize: 13, color: c.brandDeep },
    statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
    statusText: { fontFamily: fonts.semibold, fontSize: 13, color: c.textMuted },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tile: {
      flexGrow: 1,
      flexBasis: '45%',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    tileLabel: { fontFamily: fonts.semibold, fontSize: 12, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
    tileValue: { fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 36, color: c.text, fontVariant: ['tabular-nums'] },
    claim: { fontFamily: fonts.semibold, fontSize: 14, color: c.brandDeep },
    controls: { flexDirection: 'row', gap: 8 },
    control: { flex: 1 },
  });
