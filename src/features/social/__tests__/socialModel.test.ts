import type { Friend } from '@/social/friends';
import type { GroupSession, SessionResult } from '@/social/sessions';

import { canControlSession, dayLabel, friendSections, inviteShareMessage, isSelfInvite, liveRows, resultDetail, sortedResults } from '../socialModel';

const friend = (nickname: string, status: Friend['status'], weekRunM: number | null): Friend => ({
  userId: `id-${nickname}`,
  nickname,
  color: 1,
  status,
  since: '2026-10-01T00:00:00Z',
  weekRunM,
});

it('shares the code first, then the link', () => {
  const msg = inviteShareMessage('K7M2P9QX', 'exp://host/--/friend/K7M2P9QX');
  expect(msg.indexOf('K7M2P9QX')).toBeLessThan(msg.indexOf('exp://'));
});

it('splits requests and ranks friends by weekly running distance', () => {
  const s = friendSections([friend('cy', 'friends', 3000), friend('bo', 'incoming', null), friend('al', 'friends', null), friend('di', 'friends', 9000), friend('ed', 'outgoing', null)]);
  expect(s.friends.map((f) => f.nickname)).toEqual(['di', 'cy', 'al']);
  expect(s.incoming.map((f) => f.nickname)).toEqual(['bo']);
  expect(s.outgoing.map((f) => f.nickname)).toEqual(['ed']);
});

it('recognises my own code or nickname', () => {
  const me = { inviteCode: 'ABCDEFGH', nickname: 'Ana' };
  expect(isSelfInvite({ code: 'abcdefgh' }, me)).toBe(true);
  expect(isSelfInvite({ nickname: 'ANA' }, me)).toBe(true);
  expect(isSelfInvite({ nickname: 'bo' }, me)).toBe(false);
});

const session: GroupSession = {
  id: 's',
  groupId: 'g',
  title: 'Long run',
  kind: 'run',
  status: 'live',
  createdBy: 'me',
  startsAt: null,
  startedAt: null,
  endedAt: null,
  participants: [
    { userId: 'me', nickname: 'me', color: 0, joinedAt: '2026-10-20T14:00:00Z' },
    { userId: 'bo', nickname: 'bo', color: 1, joinedAt: '2026-10-20T14:00:00Z' },
    { userId: 'al', nickname: 'al', color: 2, joinedAt: '2026-10-20T14:00:00Z' },
  ],
};

it('session control is for the creator or the group owner', () => {
  expect(canControlSession(session, 'me', 'member')).toBe(true);
  expect(canControlSession(session, 'bo', 'member')).toBe(false);
  expect(canControlSession(session, 'bo', 'owner')).toBe(true);
});

it('live rows: furthest first, then not started by name, with presence', () => {
  const rows = liveRows(session, [{ userId: 'bo', distanceM: 900, elapsedMs: 1, state: 'recording', at: 1 }, { userId: 'me', distanceM: 1200, elapsedMs: 1, state: 'paused', at: 1 }], ['al']);
  expect(rows.map((r) => r.userId)).toEqual(['me', 'bo', 'al']);
  expect(rows[2]).toMatchObject({ here: true, progress: null });
});

it('results: counted by distance, then flagged, then none; detail copy', () => {
  const r = (userId: string, activityStatus: SessionResult['activityStatus'], distanceM: number | null): SessionResult => ({
    userId,
    nickname: userId,
    color: 0,
    activityStatus,
    distanceM,
    movingMs: distanceM ? 1_500_000 : null,
    elapsedMs: null,
    best1kMs: distanceM ? 250_000 : null,
    best5kMs: null,
  });
  const rows = sortedResults([r('a', null, null), r('b', 'flagged', 9000), r('c', 'valid', 5000), r('d', 'valid', 6000)]);
  expect(rows.map((x) => x.userId)).toEqual(['d', 'c', 'b', 'a']);
  expect(resultDetail(rows[0])).toBe('Moving 25:00 · 1K 4:10');
  expect(resultDetail(rows[2])).toBe('Not counted');
  expect(resultDetail(rows[3])).toBe('No activity yet');
});

it('day labels', () => {
  const now = new Date(2026, 9, 20, 12).getTime();
  expect(dayLabel(new Date(2026, 9, 20, 8).toISOString(), now)).toBe('Today');
  expect(dayLabel(new Date(2026, 9, 19, 23).toISOString(), now)).toBe('Yesterday');
  expect(dayLabel(new Date(2026, 9, 3, 8).toISOString(), now)).toBe('Oct 3');
});
