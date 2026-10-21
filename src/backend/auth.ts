/**
 * Accounts (spec §1, §4): email one-time code sign-in, then a nickname. `AuthState` is a module store
 * read with `useSyncExternalStore` (the mapCenter.ts pattern). Auth starts the first time anything
 * reads it: it restores the saved session, listens for Supabase auth events and loads the profile.
 * Never logs emails or tokens.
 */
import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';

import { wipeLocalUserData } from '@/activity/store';
import { readCache, removeCache, writeCache } from '@/lib/cache';
import { registerForPush, unregisterPush } from '@/notifications';

import { getSupabase } from './client';
import { fail, ok, toBackendError, type Result } from './errors';
import { bool, int, isObj, str, timestamp, uuid } from './parse';
import { rpc } from './rpc';

export type MyProfile = {
  id: string;
  nickname: string;
  color: number;
  inviteCode: string;
  territoryOptIn: boolean;
  /**
   * Whether this account has acknowledged the territory notice (B1). The server claims no squares
   * until it has, even though territory is on by default (Addendum D).
   */
  territoryNoticeSeen: boolean;
  notifyOvertake: boolean;
  notifySessions: boolean;
  notifyFriendRequests: boolean;
  createdAt: string;
};

export type AuthState =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'needsProfile'; userId: string }
  | { status: 'signedIn'; userId: string; profile: MyProfile };

/** Seconds before another code can be requested (Supabase's default per-address limit). */
export const RESEND_AFTER_MS = 60_000;

const PROFILE_KEY = 'teal.profile.v1';
const PROFILE_VERSION = 1;

/** Nicknames the server also reserves (private.reserved_nicknames). */
export const RESERVED_NICKNAMES: readonly string[] = [
  'admin', 'administrator', 'teal', 'support', 'moderator', 'mod', 'staff', 'system',
  'official', 'mbta', 'bluebikes', 'null', 'undefined', 'anonymous', 'deleted', 'everyone',
];

export const NICKNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$/;

// --- parsing -----------------------------------------------------------------------------

/** `get_my_profile` jsonb → MyProfile. */
export function parseMyProfile(v: unknown): MyProfile | null {
  if (!isObj(v)) return null;
  const id = uuid(v.id);
  const nickname = str(v.nickname);
  const color = int(v.color);
  const inviteCode = str(v.invite_code);
  const territoryOptIn = bool(v.territory_opt_in);
  // A profile cached before the notice existed lacks the field: treat it as unseen (shows the notice again).
  const territoryNoticeSeen = v.territory_notice_seen === undefined ? false : bool(v.territory_notice_seen);
  const notifyOvertake = bool(v.notify_overtake);
  const notifySessions = bool(v.notify_sessions);
  const notifyFriendRequests = bool(v.notify_friend_requests);
  const createdAt = timestamp(v.created_at);
  if (!id || !nickname || color === null || color < 0 || color > 11 || !inviteCode || territoryOptIn === null || territoryNoticeSeen === null) return null;
  if (notifyOvertake === null || notifySessions === null || notifyFriendRequests === null || !createdAt) return null;
  return { id, nickname, color, inviteCode, territoryOptIn, territoryNoticeSeen, notifyOvertake, notifySessions, notifyFriendRequests, createdAt };
}

// --- store -------------------------------------------------------------------------------

let state: AuthState = { status: 'loading' };
let started = false;
let seq = 0;
/** Bumped on reset so callbacks from an earlier start are ignored. */
let generation = 0;
const listeners = new Set<(s: AuthState) => void>();
let unsubscribeSupabase: (() => void) | null = null;
let unsubscribeAppState: (() => void) | null = null;

function setState(next: AuthState) {
  const prev = state;
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  state = next;
  listeners.forEach((l) => l(next));
  const signedInNow = next.status === 'signedIn' && (prev.status !== 'signedIn' || prev.userId !== next.userId);
  if (signedInNow) void registerForPush().catch(() => {});
}

async function cachedProfile(userId: string): Promise<MyProfile | null> {
  const hit = await readCache<MyProfile>(PROFILE_KEY, PROFILE_VERSION);
  const p = hit ? parseMyProfile(toWire(hit.value)) : null;
  return p && p.id === userId ? p : null;
}

const toWire = (p: MyProfile) => ({
  id: p.id,
  nickname: p.nickname,
  color: p.color,
  invite_code: p.inviteCode,
  territory_opt_in: p.territoryOptIn,
  territory_notice_seen: p.territoryNoticeSeen,
  notify_overtake: p.notifyOvertake,
  notify_sessions: p.notifySessions,
  notify_friend_requests: p.notifyFriendRequests,
  created_at: p.createdAt,
});

function setProfile(profile: MyProfile) {
  void writeCache(PROFILE_KEY, PROFILE_VERSION, profile);
  setState({ status: 'signedIn', userId: profile.id, profile });
}

/**
 * Resolve the state for a session: signed out, or the profile (needsProfile when there is none). When
 * the profile can't be fetched (offline), a cached profile for the same user keeps the user signed in.
 */
async function applySession(userId: string | null): Promise<AuthState> {
  const mine = ++seq;
  if (!userId) {
    setState({ status: 'signedOut' });
    return state;
  }
  const r = await rpc('get_my_profile');
  if (mine !== seq) return state;
  if (r.ok) {
    const profile = r.value === null ? null : parseMyProfile(r.value);
    if (profile) setProfile(profile);
    else setState({ status: 'needsProfile', userId });
    return state;
  }
  const cached = await cachedProfile(userId);
  if (mine !== seq) return state;
  if (cached) setState({ status: 'signedIn', userId, profile: cached });
  else if (r.error.code === 'not_authenticated') setState({ status: 'signedOut' });
  else if (state.status === 'loading' || state.status === 'signedOut') setState({ status: 'loading' });
  return state;
}

function sessionUserId(session: unknown): string | null {
  if (!isObj(session) || !isObj(session.user)) return null;
  return str(session.user.id);
}

function ensureStarted() {
  if (started) return;
  started = true;
  const sb = getSupabase();
  if (!sb) {
    setState({ status: 'unavailable' });
    return;
  }
  const gen = generation;
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    // Supabase advises not awaiting other Supabase calls inside this callback; defer the work.
    if (event === 'INITIAL_SESSION') return; // handled by getSession below
    setTimeout(() => {
      if (gen === generation) void applySession(sessionUserId(session));
    }, 0);
  });
  unsubscribeSupabase = () => data.subscription.unsubscribe();
  void sb.auth
    .getSession()
    .then(({ data: d }) => applySession(sessionUserId(d.session)))
    .catch(() => setState({ status: 'signedOut' }));
  // Retry a profile that couldn't load (offline at launch) when the app comes back.
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active' && state.status === 'loading') void refreshProfile();
  });
  unsubscribeAppState = () => sub.remove();
}

/** Re-read the session and profile (e.g. after coming back online). */
export async function refreshProfile(): Promise<AuthState> {
  ensureStarted();
  const sb = getSupabase();
  if (!sb) return state;
  try {
    const { data } = await sb.auth.getSession();
    return await applySession(sessionUserId(data.session));
  } catch {
    return state;
  }
}

export function getAuthState(): AuthState {
  ensureStarted();
  return state;
}

export function subscribeAuth(l: (s: AuthState) => void): () => void {
  ensureStarted();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const subscribeStore = (l: () => void) => subscribeAuth(() => l());

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribeStore, getAuthState, getAuthState);
}

/** Test helper: stop listening and return to the initial state. */
export function resetAuthForTests(): void {
  unsubscribeSupabase?.();
  unsubscribeAppState?.();
  unsubscribeSupabase = null;
  unsubscribeAppState = null;
  started = false;
  seq++;
  generation++;
  state = { status: 'loading' };
  listeners.clear();
}

// --- sign-in -----------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Digits only, so a code pasted with spaces or dashes still works. */
export const normalizeCode = (code: string): string => code.replace(/\D/g, '');

/** Email a 6-digit sign-in code (creates the account on first use). */
export async function requestEmailCode(email: string): Promise<Result<{ resendAfterMs: number }>> {
  const sb = getSupabase();
  if (!sb) return fail('not_configured');
  const address = normalizeEmail(email);
  if (!EMAIL_RE.test(address)) return fail('invalid_payload');
  try {
    const { error } = await sb.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
    if (error) return { ok: false, error: toBackendError(error) };
    return ok({ resendAfterMs: RESEND_AFTER_MS });
  } catch (e) {
    return { ok: false, error: toBackendError(e) };
  }
}

/** Verify the emailed code; on success the session is saved and the resulting state returned. */
export async function verifyEmailCode(email: string, code: string): Promise<Result<AuthState>> {
  const sb = getSupabase();
  if (!sb) return fail('not_configured');
  const token = normalizeCode(code);
  if (token.length !== 6) return fail('otp_invalid');
  try {
    const { data, error } = await sb.auth.verifyOtp({ email: normalizeEmail(email), token, type: 'email' });
    if (error) return { ok: false, error: toBackendError(error) };
    ensureStarted();
    const userId = data.session?.user.id ?? data.user?.id ?? null;
    if (!userId) return fail('otp_invalid');
    return ok(await applySession(userId));
  } catch (e) {
    return { ok: false, error: toBackendError(e) };
  }
}

// --- profile -----------------------------------------------------------------------------

/** Local nickname check, before the server's (which also applies the banned-terms list). */
export function validateNicknameLocally(n: string): { ok: true } | { ok: false; reason: 'length' | 'chars' | 'reserved' } {
  const name = n.trim();
  if (name.length < 3 || name.length > 20) return { ok: false, reason: 'length' };
  if (!NICKNAME_PATTERN.test(name)) return { ok: false, reason: 'chars' };
  if (RESERVED_NICKNAMES.includes(name.toLowerCase())) return { ok: false, reason: 'reserved' };
  return { ok: true };
}

/** Create the profile (first time, needs the 13+ confirmation) or rename. */
export async function claimNickname(nickname: string, o: { ageConfirmed: boolean }): Promise<Result<MyProfile>> {
  if (!validateNicknameLocally(nickname).ok) return fail('nickname_invalid');
  const r = await rpc('claim_nickname', { p_nickname: nickname.trim(), p_age_confirmed: o.ageConfirmed });
  if (!r.ok) return r;
  const profile = parseMyProfile(r.value);
  if (!profile) return fail('unknown');
  setProfile(profile);
  return ok(profile);
}

type SettingsPatch = Partial<
  Pick<MyProfile, 'color' | 'territoryOptIn' | 'territoryNoticeSeen' | 'notifyOvertake' | 'notifySessions' | 'notifyFriendRequests'>
>;

/**
 * Update color, territory participation (opt-out deletes your cells), the territory-notice
 * acknowledgement (only `true` is recorded) or notification toggles.
 */
export async function updateMySettings(p: SettingsPatch): Promise<Result<MyProfile>> {
  const body: Record<string, unknown> = {};
  if (p.color !== undefined) body.color = p.color;
  if (p.territoryOptIn !== undefined) body.territory_opt_in = p.territoryOptIn;
  if (p.territoryNoticeSeen !== undefined) body.territory_notice_seen = p.territoryNoticeSeen;
  if (p.notifyOvertake !== undefined) body.notify_overtake = p.notifyOvertake;
  if (p.notifySessions !== undefined) body.notify_sessions = p.notifySessions;
  if (p.notifyFriendRequests !== undefined) body.notify_friend_requests = p.notifyFriendRequests;
  const r = await rpc('set_my_settings', { p: body });
  if (!r.ok) return r;
  const profile = parseMyProfile(r.value);
  if (!profile) return fail('unknown');
  setProfile(profile);
  return ok(profile);
}

// --- sign-out and deletion ---------------------------------------------------------------

export async function signOut(): Promise<void> {
  await unregisterPush().catch(() => {});
  await removeCache(PROFILE_KEY);
  const sb = getSupabase();
  seq++;
  try {
    await sb?.auth.signOut();
  } catch {
    // Offline: the local session is still cleared below.
  }
  setState(sb ? { status: 'signedOut' } : { status: 'unavailable' });
}

/** Delete the account on the server, then this device's data, then sign out. */
export async function deleteMyAccount(): Promise<Result<void>> {
  const r = await rpc('delete_my_account');
  if (!r.ok) return r;
  await unregisterPush().catch(() => {});
  await wipeLocalUserData();
  await signOut();
  return ok(undefined);
}
