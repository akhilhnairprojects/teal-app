/**
 * Copy and display rules for the record screen (spec §1 Expo Go limits, §5 G2). Pure, so the
 * wording and the numbers shown while recording are unit-tested without a recorder.
 */
import { formatDistanceM, formatDurationMs, formatPace, METERS_PER_MILE, type Units } from '@/activity/format';
import type { RecorderSnapshot, RecorderWarning } from '@/activity/recorder';
import type { ActivityKind, LiveStats } from '@/activity/types';

export const RECORD_COPY = {
  firstStartTitle: 'Keep Teal open while you record',
  firstStartBody:
    'Keep Teal open while you record. In this version, iPhone pauses GPS when Teal is in the background or the phone locks. We’ll keep your screen on.',
  battery: 'Recording uses GPS and keeps the screen on, so expect noticeable battery use.',
  firstStartConfirm: 'Got it, start',
  screenOnChip: 'Screen on · keep Teal open',
  vehicle: 'This looks like a vehicle. Fast stretches won’t count toward your distance.',
  poorGps: 'Weak GPS. Move to open sky, or start anyway.',
  startAnyway: 'Start anyway',
  acquiring: 'Finding GPS…',
  permissionDenied: 'Teal needs location access to record.',
  servicesOff: 'Location Services are off. Turn them on in Settings to record.',
  gpsStopped: 'GPS isn’t running, so this recording is paused. Tap Resume to try again.',
  openSettings: 'Open Settings',
  holdToFinish: 'Hold to finish',
  autoPaused: 'Auto-paused',
  findDock: 'Find a dock',
  shareLabel: 'Show route on featured runs',
  shareDetail: 'Start and finish (~200–300 m) are hidden. Shown to signed-in Teal users.',
  tooShort: 'Too short to save. Recordings need at least 100 m and 1 minute.',
  savedSignedIn: 'Saved. Numbers may change slightly once Teal checks them on upload.',
  savedSignedOut: 'Saved on this phone. Sign in to upload it and appear on leaderboards.',
} as const;

/** "Paused for 4 min while Teal was in the background. That stretch isn't counted." */
export function backgroundGapText(gapMs: number): string {
  const secs = Math.max(1, Math.round(gapMs / 1000));
  const span = secs < 60 ? `${secs} s` : `${Math.round(secs / 60)} min`;
  return `Paused for ${span} while Teal was in the background. That stretch isn’t counted.`;
}

/** Speed for display only (bike rides are never ranked by speed): '12.4 mph' / '20.0 km/h'. */
export function formatSpeed(secPerKm: number | null, u: Units): string {
  const unit = u === 'mi' ? 'mph' : 'km/h';
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm <= 0) return `– ${unit}`;
  const kmh = 3600 / secPerKm;
  const value = u === 'mi' ? kmh / (METERS_PER_MILE / 1000) : kmh;
  return `${value.toFixed(1)} ${unit}`;
}

export type BigStat = { key: string; label: string; value: string };

/** The four big numbers: time and distance, then pace (run) or speed (bike), current and average. */
export function bigStats(kind: ActivityKind, stats: LiveStats, u: Units): BigStat[] {
  const out: BigStat[] = [
    { key: 'time', label: 'Time', value: formatDurationMs(stats.elapsedMs) },
    { key: 'distance', label: 'Distance', value: formatDistanceM(stats.distanceM, u) },
  ];
  if (kind === 'run') {
    out.push({ key: 'pace', label: 'Pace', value: formatPace(stats.autoPaused ? null : stats.currentPaceSecPerKm, u) });
    out.push({ key: 'avg', label: 'Avg pace', value: formatPace(stats.avgPaceSecPerKm, u) });
  } else {
    out.push({ key: 'speed', label: 'Speed', value: formatSpeed(stats.autoPaused ? null : stats.currentPaceSecPerKm, u) });
    out.push({ key: 'avg', label: 'Avg speed', value: formatSpeed(stats.avgPaceSecPerKm, u) });
  }
  return out;
}

export const GPS_LABEL: Record<LiveStats['gpsQuality'], string> = {
  good: 'GPS good',
  fair: 'GPS fair',
  poor: 'GPS weak',
  none: 'No GPS',
};

export type RecordBanner =
  | { key: 'backgroundGap'; text: string }
  | { key: 'vehicleSegment'; text: string }
  | { key: 'poorGps'; text: string }
  | { key: 'permissionDenied'; text: string; settings: true }
  | { key: 'servicesOff'; text: string; settings: true }
  | { key: 'gpsStopped'; text: string };

/** Warning banners in priority order (`foregroundOnly` is the always-on chip, not a banner). */
export function recordBanners(s: Pick<RecorderSnapshot, 'warnings' | 'backgroundGapMs' | 'phase'>): RecordBanner[] {
  const has = (w: RecorderWarning) => s.warnings.includes(w);
  const out: RecordBanner[] = [];
  if (has('permissionDenied')) out.push({ key: 'permissionDenied', text: RECORD_COPY.permissionDenied, settings: true });
  if (has('servicesOff')) out.push({ key: 'servicesOff', text: RECORD_COPY.servicesOff, settings: true });
  if (has('gpsStopped') && s.phase === 'paused') out.push({ key: 'gpsStopped', text: RECORD_COPY.gpsStopped });
  if (has('backgroundGap') && s.backgroundGapMs > 0) out.push({ key: 'backgroundGap', text: backgroundGapText(s.backgroundGapMs) });
  if (has('vehicleSegment')) out.push({ key: 'vehicleSegment', text: RECORD_COPY.vehicle });
  if (has('poorGps') && s.phase === 'acquiring') out.push({ key: 'poorGps', text: RECORD_COPY.poorGps });
  return out;
}

/** True while a recording owns the recorder (the kind toggle and Start are hidden). */
export const isActivePhase = (phase: RecorderSnapshot['phase']): boolean =>
  phase === 'acquiring' || phase === 'recording' || phase === 'paused';

export const kindLabel = (k: ActivityKind): string => (k === 'run' ? 'Run' : 'Bluebike ride');

export const RECORD_INTRO_KEY = 'teal.recordIntro.v1';
