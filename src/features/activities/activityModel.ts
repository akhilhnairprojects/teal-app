/**
 * Display rules for the activity history (spec §5 G2): sync chips, "Not counted" reasons, titles,
 * efforts and the share-toggle confirmation copy. Pure and unit-tested.
 */
import { formatDurationMs, formatPace, METERS_PER_MILE, type Units } from '@/activity/format';
import type { ActivityListItem, LocalActivity } from '@/activity/store';
import type { ActivityKind, Effort } from '@/activity/types';
import type { BackendErrorCode } from '@/backend/errors';
import { easternParts, formatClock } from '@/mbta/time/eastern';
import type { Palette } from '@/theme';

export type ChipTone = 'muted' | 'ok' | 'warning';
export type SyncChip = { label: string; tone: ChipTone };

/** Server flags that keep an activity off the boards, with the reason shown to its owner. */
export const FLAG_REASONS: Readonly<Record<string, string>> = {
  vehicle: 'part of it looked like a vehicle',
  implausible_effort: 'a pace faster than is plausible',
  sparse: 'too few GPS points',
  too_short: 'shorter than 200 m',
};

const REJECT_REASONS: Partial<Record<BackendErrorCode, string>> = {
  invalid_time: 'its times don’t add up',
  overlap: 'it overlaps another activity',
  invalid_payload: 'the recording was incomplete',
};

/** The first reason an activity doesn't count, or null when it counts (or isn't checked yet). */
export function notCountedReason(o: {
  syncState: ActivityListItem['syncState'];
  flags: readonly string[];
  lastError?: BackendErrorCode | null;
  leaderboardEligible?: boolean | null;
}): string | null {
  if (o.syncState === 'rejected') return REJECT_REASONS[o.lastError ?? 'invalid_payload'] ?? 'it couldn’t be uploaded';
  if (o.syncState !== 'synced' && o.syncState !== 'remote') return null;
  for (const f of o.flags) if (FLAG_REASONS[f]) return FLAG_REASONS[f];
  if (o.leaderboardEligible === false) return 'uploaded after its leaderboard closed';
  return null;
}

/**
 * The chip next to an activity: "Saved on this phone" (signed out), "Waiting to sync",
 * "Syncing…", "Synced", or "Not counted: ⟨reason⟩".
 */
export function syncChip(o: {
  syncState: ActivityListItem['syncState'];
  flags: readonly string[];
  lastError?: BackendErrorCode | null;
  leaderboardEligible?: boolean | null;
}): SyncChip {
  const reason = notCountedReason(o);
  if (reason) return { label: `Not counted: ${reason}`, tone: 'warning' };
  switch (o.syncState) {
    case 'local':
      return { label: 'Saved on this phone', tone: 'muted' };
    case 'pending':
      return { label: 'Waiting to sync', tone: 'muted' };
    case 'syncing':
      return { label: 'Syncing…', tone: 'muted' };
    default:
      return { label: 'Synced', tone: 'ok' };
  }
}

export function toneColor(c: Palette, t: ChipTone): string {
  return t === 'ok' ? c.live : t === 'warning' ? c.warning : c.textMuted;
}

/** The chip for a list item, using the local record (when there is one) for the reject reason and eligibility. */
export function chipForItem(item: ActivityListItem, local: LocalActivity | null | undefined): SyncChip {
  return syncChip({
    syncState: item.syncState,
    flags: item.flags,
    lastError: local?.sync.lastError ?? null,
    leaderboardEligible: local?.sync.server?.leaderboardEligible ?? null,
  });
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Tue, Oct 20 · 7:05 AM' in Eastern time (only the owner sees this). */
export function activityWhen(ms: number): string {
  const p = easternParts(ms);
  return `${DOW[p.dow]}, ${MON[p.mo - 1]} ${p.d} · ${formatClock(ms)}`;
}

/** 'Oct 19' for a 'YYYY-MM-DD' day (boards and featured cards show the date, never the time). */
export function shortDay(day: string): string {
  const [, mo, d] = day.split('-').map(Number);
  return mo >= 1 && mo <= 12 && d ? `${MON[mo - 1]} ${d}` : day;
}

export const activityTitle = (kind: ActivityKind): string => (kind === 'run' ? 'Run' : 'Bluebike ride');

/** Efforts stay labeled 1K/5K/10K whatever the units. */
export const effortLabel = (d: Effort['distanceM']): string => `${d / 1000}K`;

export type EffortRow = { key: string; label: string; time: string; pace: string };

export function effortRows(efforts: readonly Effort[], u: Units): EffortRow[] {
  return [...efforts]
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((e) => ({
      key: String(e.distanceM),
      label: effortLabel(e.distanceM),
      time: formatDurationMs(e.durationMs),
      pace: formatPace(e.durationMs / 1000 / (e.distanceM / 1000), u),
    }));
}

/** Split length in metres for the units: a mile or a kilometre. */
export const splitUnitM = (u: Units): number => (u === 'mi' ? METERS_PER_MILE : 1000);

/** Confirmation copy before sharing a route; unsharing needs no confirmation. */
export function shareConfirmCopy(share: boolean): { title: string; body: string; confirm: string } | null {
  if (!share) return null;
  return {
    title: 'Show this route on featured runs?',
    body:
      'Start and finish (~200–300 m) are hidden. Shown to signed-in Teal users with your nickname and the date. The gap can still hint at the general area where you started. You can turn it off any time.',
    confirm: 'Share route',
  };
}

/** One line for a territory claim, or null when nothing was claimed. */
export function claimLine(c: { cellsClaimed: number; cellsStolen: number } | null): string | null {
  if (!c || c.cellsClaimed <= 0) return null;
  const squares = `${c.cellsClaimed} ${c.cellsClaimed === 1 ? 'square' : 'squares'}`;
  return c.cellsStolen > 0 ? `Territory: claimed ${squares} (${c.cellsStolen} taken from others)` : `Territory: claimed ${squares}`;
}
