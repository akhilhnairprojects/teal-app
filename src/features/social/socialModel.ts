/** Pure helpers behind the social screens (kept out of the components so they are unit-tested). */
import { formatDurationMs } from '@/activity/format';
import type { MyProfile } from '@/backend/auth';
import type { Friend } from '@/social/friends';
import type { GroupSession, LiveProgress, SessionResult } from '@/social/sessions';

/** Text for the share sheet: the code first (links only open on the same Expo dev server, decision O5). */
export function inviteShareMessage(code: string, link: string): string {
  return `Add me as a friend on Teal: open Move → Friends & groups and enter my code ${code}.\n${link}`;
}

export function groupShareMessage(name: string, code: string, link: string): string {
  return `Join my Teal group “${name}”: open Move → Friends & groups and enter the code ${code}.\n${link}`;
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

/** Who may start or end a session: its creator or the group's owner (the server checks too). */
export function canControlSession(s: Pick<GroupSession, 'createdBy'>, me: string, groupRole: 'owner' | 'member' | null): boolean {
  return s.createdBy === me || groupRole === 'owner';
}

export function isParticipant(s: Pick<GroupSession, 'participants'>, me: string): boolean {
  return s.participants.some((p) => p.userId === me);
}

export type LiveRow = {
  userId: string;
  nickname: string;
  color: number;
  here: boolean;
  progress: LiveProgress | null;
};

/** Participants with their latest live progress: furthest first, then those not started, by name. */
export function liveRows(s: Pick<GroupSession, 'participants'>, progress: readonly LiveProgress[], presence: readonly string[]): LiveRow[] {
  const latest = new Map(progress.map((p) => [p.userId, p]));
  const here = new Set(presence);
  return s.participants
    .map((p) => ({ userId: p.userId, nickname: p.nickname, color: p.color, here: here.has(p.userId), progress: latest.get(p.userId) ?? null }))
    .sort((a, b) => (b.progress?.distanceM ?? -1) - (a.progress?.distanceM ?? -1) || a.nickname.localeCompare(b.nickname));
}

/** Results ordered for display: counted runs by distance, then flagged, then no activity. */
export function sortedResults(rows: readonly SessionResult[]): SessionResult[] {
  const rank = (r: SessionResult) => (r.activityStatus === 'valid' ? 0 : r.activityStatus === 'flagged' ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || (b.distanceM ?? 0) - (a.distanceM ?? 0) || a.nickname.localeCompare(b.nickname));
}

/** 'Moving 25:00 · 1K 4:10 · 5K 21:30', or why a run doesn't count. */
export function resultDetail(r: SessionResult): string {
  if (r.activityStatus === null) return 'No activity yet';
  if (r.activityStatus === 'flagged') return 'Not counted';
  const parts: string[] = [];
  if (r.movingMs !== null) parts.push(`Moving ${formatDurationMs(r.movingMs)}`);
  if (r.best1kMs !== null) parts.push(`1K ${formatDurationMs(r.best1kMs)}`);
  if (r.best5kMs !== null) parts.push(`5K ${formatDurationMs(r.best5kMs)}`);
  return parts.join(' · ');
}

export const SESSION_STATUS_COPY: Record<GroupSession['status'], string> = {
  open: 'Lobby · waiting to start',
  live: 'Live now',
  ended: 'Ended',
};

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
