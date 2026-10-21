/** Groups (spec §2.4 Social): up to 50 members; up to 10 groups per person. */
import { fail, ok, type Result } from '@/backend/errors';
import { int, isObj, listOf, oneOf, str, timestamp, uuid } from '@/backend/parse';
import { rpc } from '@/backend/rpc';

export type Group = { id: string; name: string; role: 'owner' | 'member'; memberCount: number; inviteCode: string; createdAt: string };
export type GroupMember = { userId: string; nickname: string; color: number; role: 'owner' | 'member'; joinedAt: string };

const roleOf = oneOf<'owner' | 'member'>(['owner', 'member']);

export function parseGroup(v: unknown): Group | null {
  if (!isObj(v)) return null;
  const id = uuid(v.id);
  const name = str(v.name);
  const role = roleOf(v.role);
  const memberCount = int(v.member_count);
  const inviteCode = str(v.invite_code);
  const createdAt = timestamp(v.created_at);
  if (!id || !name || !role || memberCount === null || !inviteCode || !createdAt) return null;
  return { id, name, role, memberCount, inviteCode, createdAt };
}

export function parseGroupMember(v: unknown): GroupMember | null {
  if (!isObj(v)) return null;
  const userId = uuid(v.user_id);
  const nickname = str(v.nickname);
  const color = int(v.color);
  const role = roleOf(v.role);
  const joinedAt = timestamp(v.joined_at);
  if (!userId || !nickname || color === null || !role || !joinedAt) return null;
  return { userId, nickname, color, role, joinedAt };
}

const voidResult = (r: Result<unknown>): Result<void> => (r.ok ? ok(undefined) : r);
const idResult = (r: Result<unknown>): Result<string> => {
  if (!r.ok) return r;
  const id = uuid(r.value);
  return id ? ok(id) : fail('unknown');
};

export async function listMyGroups(): Promise<Result<Group[]>> {
  const r = await rpc('list_my_groups');
  if (!r.ok) return r;
  const rows = listOf(r.value, parseGroup);
  return rows ? ok(rows) : fail('unknown');
}

/** Create a group; returns its id. */
export async function createGroup(name: string): Promise<Result<string>> {
  return idResult(await rpc('create_group', { p_name: name.trim() }));
}

/** Join by invite code; returns the group id. An unknown code is a null value (the miss is rate limited). */
export async function joinGroup(code: string): Promise<Result<string>> {
  const r = await rpc('join_group', { p_code: code.trim().toUpperCase() });
  if (r.ok && r.value === null) return fail('not_found');
  return idResult(r);
}

/** Leave; an owner hands the group to the longest-standing member (or deletes it when alone). */
export async function leaveGroup(id: string): Promise<Result<void>> {
  return voidResult(await rpc('leave_group', { p_group: id }));
}

export async function getGroupMembers(id: string): Promise<Result<GroupMember[]>> {
  const r = await rpc('get_group_members', { p_group: id });
  if (!r.ok) return r;
  const rows = listOf(r.value, parseGroupMember);
  return rows ? ok(rows) : fail('unknown');
}

export async function removeGroupMember(groupId: string, userId: string): Promise<Result<void>> {
  return voidResult(await rpc('remove_group_member', { p_group: groupId, p_user: userId }));
}

export async function rotateGroupCode(groupId: string): Promise<Result<string>> {
  const r = await rpc('rotate_group_code', { p_group: groupId });
  if (!r.ok) return r;
  const code = str(r.value);
  return code ? ok(code) : fail('unknown');
}
