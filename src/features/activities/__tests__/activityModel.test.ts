import { easternInstant } from '@/mbta/time/eastern';

import { activityWhen, claimLine, effortRows, notCountedReason, shareConfirmCopy, shortDay, splitUnitM, syncChip } from '../activityModel';

describe('syncChip', () => {
  it('maps each sync state to a chip', () => {
    expect(syncChip({ syncState: 'local', flags: [] })).toEqual({ label: 'Saved on this phone', tone: 'muted' });
    expect(syncChip({ syncState: 'pending', flags: [] }).label).toBe('Waiting to sync');
    expect(syncChip({ syncState: 'syncing', flags: [] }).label).toBe('Syncing…');
    expect(syncChip({ syncState: 'synced', flags: [] })).toEqual({ label: 'Synced', tone: 'ok' });
    expect(syncChip({ syncState: 'remote', flags: ['session_mismatch'] }).label).toBe('Synced');
  });

  it('says why a flagged, ineligible or rejected activity is not counted', () => {
    expect(syncChip({ syncState: 'synced', flags: ['vehicle'] })).toEqual({ label: 'Not counted: part of it looked like a vehicle', tone: 'warning' });
    expect(syncChip({ syncState: 'remote', flags: ['implausible_effort'] }).label).toBe('Not counted: a pace faster than is plausible');
    expect(syncChip({ syncState: 'synced', flags: ['sparse'] }).label).toBe('Not counted: too few GPS points');
    expect(syncChip({ syncState: 'synced', flags: ['too_short'] }).label).toBe('Not counted: shorter than 200 m');
    expect(syncChip({ syncState: 'synced', flags: [], leaderboardEligible: false }).label).toBe('Not counted: uploaded after its leaderboard closed');
    expect(syncChip({ syncState: 'rejected', flags: [], lastError: 'overlap' }).label).toBe('Not counted: it overlaps another activity');
    expect(syncChip({ syncState: 'rejected', flags: [], lastError: 'invalid_time' }).label).toBe('Not counted: its times don’t add up');
    expect(notCountedReason({ syncState: 'pending', flags: ['vehicle'] })).toBeNull();
  });
});

describe('formatting', () => {
  it('keeps efforts labeled 1K/5K/10K in miles', () => {
    const rows = effortRows(
      [
        { distanceM: 5000, durationMs: 1_250_000, startOffsetMs: 0 },
        { distanceM: 1000, durationMs: 250_000, startOffsetMs: 0 },
      ],
      'mi',
    );
    expect(rows).toEqual([
      { key: '1000', label: '1K', time: '4:10', pace: '6:42 /mi' },
      { key: '5000', label: '5K', time: '20:50', pace: '6:42 /mi' },
    ]);
    expect(splitUnitM('mi')).toBeCloseTo(1609.344);
    expect(splitUnitM('km')).toBe(1000);
  });

  it('formats dates in Eastern time', () => {
    expect(activityWhen(easternInstant(2026, 10, 20, 7, 5))).toBe('Tue, Oct 20 · 7:05 AM');
    expect(shortDay('2026-10-19')).toBe('Oct 19');
  });

  it('asks before sharing a route, never before unsharing', () => {
    const copy = shareConfirmCopy(true)!;
    expect(copy.title).toBe('Show this route on featured runs?');
    expect(copy.body).toContain('Start and finish (~200–300 m) are hidden. Shown to signed-in Teal users');
    expect(copy.body).toContain('general area');
    expect(shareConfirmCopy(false)).toBeNull();
  });

  it('describes a territory claim', () => {
    expect(claimLine(null)).toBeNull();
    expect(claimLine({ cellsClaimed: 0, cellsStolen: 0 })).toBeNull();
    expect(claimLine({ cellsClaimed: 1, cellsStolen: 0 })).toBe('Territory: claimed 1 square');
    expect(claimLine({ cellsClaimed: 42, cellsStolen: 5 })).toBe('Territory: claimed 42 squares (5 taken from others)');
  });
});
