import type { Friend } from '@/social/friends';

import { dayLabel, friendSections, inviteShareMessage, isSelfInvite } from '../socialModel';

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

it('day labels', () => {
  const now = new Date(2026, 9, 20, 12).getTime();
  expect(dayLabel(new Date(2026, 9, 20, 8).toISOString(), now)).toBe('Today');
  expect(dayLabel(new Date(2026, 9, 19, 23).toISOString(), now)).toBe('Yesterday');
  expect(dayLabel(new Date(2026, 9, 3, 8).toISOString(), now)).toBe('Oct 3');
});
