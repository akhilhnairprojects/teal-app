/** Friends (spec §2.4 Social). The invite code is the primary way to add a friend (decision O5). */
import * as Linking from 'expo-linking';

import { fail, ok, type Result } from '@/backend/errors';
import { int, isObj, listOf, nullable, numeric, oneOf, str, timestamp, uuid } from '@/backend/parse';
import { rpc } from '@/backend/rpc';
import { friendInvitePath, INVITE_CODE_PATTERN } from '@/features/shell/routes';

export type Friend = {
  userId: string;
  nickname: string;
  color: number;
  status: 'friends' | 'incoming' | 'outgoing';
  since: string;
  /** This ET week's eligible running distance (friends only). */
  weekRunM: number | null;
};

const statusOf = oneOf<Friend['status']>(['friends', 'incoming', 'outgoing']);

export function parseFriend(v: unknown): Friend | null {
  if (!isObj(v)) return null;
  const userId = uuid(v.user_id);
  const nickname = str(v.nickname);
  const color = int(v.color);
  const status = statusOf(v.status);
  const since = timestamp(v.since);
  const weekRunM = nullable(v.week_run_m, numeric);
  if (!userId || !nickname || color === null || !status || !since || weekRunM === undefined) return null;
  return { userId, nickname, color, status, since, weekRunM };
}

export async function listFriends(): Promise<Result<Friend[]>> {
  const r = await rpc('list_friends');
  if (!r.ok) return r;
  const rows = listOf(r.value, parseFriend);
  return rows ? ok(rows) : fail('unknown');
}

/**
 * By nickname: a request. By invite code: accepted at once (sharing your code is consent). An
 * unknown, blocked or own nickname/code comes back as the value 'not_found' (so the server's rate
 * limit counts the miss) and becomes the `not_found` error here.
 */
export async function sendFriendRequest(t: { nickname: string } | { code: string }): Promise<Result<'requested' | 'accepted'>> {
  const args = 'code' in t ? { p_code: t.code.trim().toUpperCase() } : { p_nickname: t.nickname.trim() };
  const r = await rpc('send_friend_request', args);
  if (!r.ok) return r;
  if (r.value === 'not_found') return fail('not_found');
  return r.value === 'requested' || r.value === 'accepted' ? ok(r.value) : fail('unknown');
}

const voidResult = (r: Result<unknown>): Result<void> => (r.ok ? ok(undefined) : r);

export async function respondFriendRequest(userId: string, accept: boolean): Promise<Result<void>> {
  return voidResult(await rpc('respond_friend_request', { p_other: userId, p_accept: accept }));
}

export async function removeFriend(userId: string): Promise<Result<void>> {
  return voidResult(await rpc('remove_friend', { p_other: userId }));
}

/** Block: removes any friendship; the blocked user then can't find you (it looks like not_found). */
export async function blockUser(userId: string): Promise<Result<void>> {
  return voidResult(await rpc('block_user', { p_other: userId }));
}

export async function rotateInviteCode(): Promise<Result<string>> {
  const r = await rpc('rotate_invite_code');
  if (!r.ok) return r;
  const code = str(r.value);
  return code ? ok(code) : fail('unknown');
}

/** A link that adds me as a friend. In Expo Go it is an exp:// link that works only on the same dev server. */
export function friendInviteLink(code: string): string {
  return Linking.createURL(String(friendInvitePath(code)).replace(/^\//, ''));
}

const NICKNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$/;

/**
 * Accepts an invite link (anything containing `/friend/<CODE>`), a code, or a nickname. An 8-character
 * input is read as a code only when typed in capitals from the code alphabet; otherwise as a nickname.
 */
export function parseInviteInput(s: string): { code: string } | { nickname: string } | null {
  const input = s.trim();
  if (!input) return null;
  const link = /\/friend\/([A-Za-z0-9]{8})(?:[/?#]|$)/.exec(input);
  if (link) {
    const code = link[1].toUpperCase();
    return INVITE_CODE_PATTERN.test(code) ? { code } : null;
  }
  if (INVITE_CODE_PATTERN.test(input)) return { code: input };
  const nickname = input.replace(/^@/, '');
  return NICKNAME_RE.test(nickname) ? { nickname } : null;
}
