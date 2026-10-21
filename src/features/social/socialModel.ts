/** Pure helpers behind the social screens (kept out of the components so they are unit-tested). */
import type { MyProfile } from '@/backend/auth';
import type { Friend } from '@/social/friends';

/** Text for the share sheet: the code first (links only open on the same Expo dev server, decision O5). */
export function inviteShareMessage(code: string, link: string): string {
  return `Add me as a friend on Teal: open Move → Friends and enter my code ${code}.\n${link}`;
}

export type FriendSections = { incoming: Friend[]; friends: Friend[]; outgoing: Friend[] };

/** Requests and friends, with friends ordered by this week's running distance (most first). */
export function friendSections(list: readonly Friend[]): FriendSections {
  const byName = (a: Friend, b: Friend) => a.nickname.localeCompare(b.nickname);
  return {
    incoming: list.filter((f) => f.status === 'incoming').sort(byName),
    friends: list
      .filter((f) => f.status === 'friends')
      .sort((a, b) => (b.weekRunM ?? 0) - (a.weekRunM ?? 0) || byName(a, b)),
    outgoing: list.filter((f) => f.status === 'outgoing').sort(byName),
  };
}

/** True when an add-friend input points at me (my own code or nickname). */
export function isSelfInvite(t: { code: string } | { nickname: string }, me: Pick<MyProfile, 'inviteCode' | 'nickname'>): boolean {
  if ('code' in t) return t.code.toUpperCase() === me.inviteCode.toUpperCase();
  return t.nickname.toLowerCase() === me.nickname.toLowerCase();
}

export const ADD_FRIEND_COPY = {
  invalid: 'Enter an 8-character invite code, an invite link, or a nickname.',
  self: 'That’s you. Share your code with a friend instead.',
  accepted: 'You’re now friends.',
  requested: 'Friend request sent.',
  notFound: 'No one found with that code or nickname.',
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Today', 'Yesterday' or 'Oct 19' in the phone's time zone. */
export function dayLabel(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const startOf = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const days = Math.round((startOf(new Date(now)) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
