import AsyncStorage from '@react-native-async-storage/async-storage';

import { mockSession, mockSupabase } from '@/backend/testing/mockSupabase';

import {
  claimNickname,
  deleteMyAccount,
  getAuthState,
  normalizeCode,
  requestEmailCode,
  resetAuthForTests,
  signOut,
  subscribeAuth,
  updateMySettings,
  validateNicknameLocally,
  verifyEmailCode,
  type AuthState,
} from '../auth';
import { backendError, toBackendError } from '../errors';
import { rpc } from '../rpc';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());
jest.mock('@/notifications', () => ({
  registerForPush: jest.fn(async () => 'noProjectId'),
  unregisterPush: jest.fn(async () => {}),
}));

const { registerForPush, unregisterPush } = jest.requireMock('@/notifications') as { registerForPush: jest.Mock; unregisterPush: jest.Mock };

const ME = '11111111-1111-4111-8111-111111111111';
const PROFILE = {
  id: ME,
  nickname: 'Ana',
  color: 4,
  created_at: '2026-10-20T14:00:00+00:00',
  invite_code: 'ABCDEFGH',
  territory_opt_in: true,
  notify_overtake: true,
  notify_sessions: true,
  notify_friend_requests: true,
};

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Wait (bounded) until the auth state has `status`. */
async function waitFor(status: AuthState['status']): Promise<AuthState> {
  for (let i = 0; i < 50 && getAuthState().status !== status; i++) await flush();
  expect(getAuthState().status).toBe(status);
  return getAuthState();
}

beforeEach(async () => {
  resetAuthForTests();
  mockSupabase.reset();
  registerForPush.mockClear();
  unregisterPush.mockClear();
  await AsyncStorage.clear();
});

describe('error mapping', () => {
  it('maps server, auth and network errors to codes with user-safe copy', () => {
    expect(toBackendError({ code: 'P0001', message: 'nickname_taken' })).toMatchObject({ code: 'nickname_taken', retryable: false });
    expect(toBackendError({ code: 'P0001', message: 'rate_limited' })).toMatchObject({ code: 'rate_limited', retryable: true });
    expect(toBackendError({ code: 'P0001', message: 'something internal' }).code).toBe('unknown');
    expect(toBackendError(new TypeError('Network request failed')).code).toBe('offline');
    expect(toBackendError({ message: 'TypeError: Network request failed', code: '' }).code).toBe('offline');
    expect(toBackendError({ __isAuthError: true, name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' }).code).toBe(
      'otp_expired',
    );
    expect(toBackendError({ __isAuthError: true, name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit' })).toMatchObject({
      code: 'email_rate_limited',
      message: 'Too many sign-in emails right now. Try again later.',
    });
    expect(toBackendError({ __isAuthError: true, name: 'AuthApiError', status: 400, code: 'validation_failed' }).code).toBe('otp_invalid');
    expect(toBackendError({ __isAuthError: true, name: 'AuthRetryableFetchError', status: 0 }).code).toBe('offline');
    expect(toBackendError({ code: 'PGRST301', message: 'JWT expired' }).code).toBe('not_authenticated');
    expect(toBackendError(null).code).toBe('unknown');
    expect(toBackendError(backendError('overlap')).code).toBe('overlap');
  });

  it('never surfaces the raw server message', () => {
    expect(toBackendError({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }).message).toBe(
      'Something went wrong. Try again.',
    );
  });

  it('rpc maps a thrown fetch failure to offline and a missing client to not_configured', async () => {
    mockSupabase.onRpc('get_my_profile', () => {
      throw new TypeError('Network request failed');
    });
    expect(await rpc('get_my_profile')).toEqual({ ok: false, error: expect.objectContaining({ code: 'offline' }) });
    mockSupabase.configured = false;
    expect(await rpc('get_my_profile')).toEqual({ ok: false, error: expect.objectContaining({ code: 'not_configured' }) });
  });
});

describe('auth state', () => {
  it('is unavailable without a configured backend', () => {
    mockSupabase.configured = false;
    expect(getAuthState()).toEqual({ status: 'unavailable' });
  });

  it('restores a saved session with a profile, and registers for push once signed in', async () => {
    mockSupabase.setSession(mockSession(ME));
    mockSupabase.onRpc('get_my_profile', () => ({ data: PROFILE }));
    const s = await waitFor('signedIn');
    expect(s).toMatchObject({ userId: ME, profile: { nickname: 'Ana', inviteCode: 'ABCDEFGH' } });
    expect(registerForPush).toHaveBeenCalledTimes(1);
  });

  it('asks for a nickname when the session has no profile', async () => {
    mockSupabase.setSession(mockSession(ME));
    mockSupabase.onRpc('get_my_profile', () => ({ data: null }));
    expect(await waitFor('needsProfile')).toEqual({ status: 'needsProfile', userId: ME });
  });

  it('keeps a cached profile when the session restores offline', async () => {
    mockSupabase.setSession(mockSession(ME));
    mockSupabase.onRpc('get_my_profile', () => ({ data: PROFILE }));
    await waitFor('signedIn');
    resetAuthForTests();
    mockSupabase.onRpc('get_my_profile', () => {
      throw new TypeError('Network request failed');
    });
    expect(await waitFor('signedIn')).toMatchObject({ profile: { nickname: 'Ana' } });
  });

  it('follows sign-out events from Supabase and notifies subscribers', async () => {
    mockSupabase.setSession(mockSession(ME));
    mockSupabase.onRpc('get_my_profile', () => ({ data: PROFILE }));
    const seen: string[] = [];
    subscribeAuth((s) => seen.push(s.status));
    await waitFor('signedIn');
    mockSupabase.emitAuth('SIGNED_OUT', null);
    await waitFor('signedOut');
    expect(seen).toEqual(['signedIn', 'signedOut']);
  });
});

describe('sign-in with an email code', () => {
  beforeEach(async () => {
    getAuthState();
    await waitFor('signedOut');
  });

  it('requests a code with shouldCreateUser and a 60 s resend delay', async () => {
    const r = await requestEmailCode('  Ana@Example.com ');
    expect(r).toEqual({ ok: true, value: { resendAfterMs: 60_000 } });
    expect(mockSupabase.raw.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'ana@example.com', options: { shouldCreateUser: true } });
    expect((await requestEmailCode('not an email')).ok).toBe(false);
  });

  it('maps the free-plan email rate limit', async () => {
    mockSupabase.raw.auth.signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: { __isAuthError: true, name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit', message: 'rate' },
    });
    const r = await requestEmailCode('ana@example.com');
    expect(!r.ok && r.error.code).toBe('email_rate_limited');
  });

  it('accepts a code pasted with spaces and returns the new state', async () => {
    mockSupabase.raw.auth.verifyOtp.mockResolvedValueOnce({ data: { session: mockSession(ME) }, error: null });
    mockSupabase.onRpc('get_my_profile', () => ({ data: null }));
    expect(normalizeCode(' 123 456 ')).toBe('123456');
    const r = await verifyEmailCode('ana@example.com', '123 456');
    expect(mockSupabase.raw.auth.verifyOtp).toHaveBeenCalledWith({ email: 'ana@example.com', token: '123456', type: 'email' });
    expect(r).toEqual({ ok: true, value: { status: 'needsProfile', userId: ME } });
  });

  it('maps invalid and expired codes', async () => {
    expect(await verifyEmailCode('ana@example.com', '12345')).toEqual({ ok: false, error: expect.objectContaining({ code: 'otp_invalid' }) });
    mockSupabase.raw.auth.verifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: { __isAuthError: true, name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' },
    });
    const r = await verifyEmailCode('ana@example.com', '123456');
    expect(!r.ok && r.error.code).toBe('otp_expired');
  });
});

describe('profile', () => {
  beforeEach(async () => {
    mockSupabase.setSession(mockSession(ME));
    mockSupabase.onRpc('get_my_profile', () => ({ data: null }));
    getAuthState();
    await waitFor('needsProfile');
  });

  it('validates nicknames locally', () => {
    expect(validateNicknameLocally('ab')).toEqual({ ok: false, reason: 'length' });
    expect(validateNicknameLocally('_ana')).toEqual({ ok: false, reason: 'chars' });
    expect(validateNicknameLocally('ana runs')).toEqual({ ok: false, reason: 'chars' });
    expect(validateNicknameLocally('Admin')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateNicknameLocally(' ana.runs-2 ')).toEqual({ ok: true });
  });

  it('claims a nickname and signs in; maps nickname_taken (also for a case-only clash)', async () => {
    mockSupabase.rpcError('claim_nickname', 'nickname_taken');
    const taken = await claimNickname('ANA', { ageConfirmed: true });
    expect(!taken.ok && taken.error).toMatchObject({ code: 'nickname_taken', message: 'That nickname is taken.' });
    mockSupabase.onRpc('claim_nickname', (args) => ({ data: { ...PROFILE, nickname: args.p_nickname } }));
    const r = await claimNickname(' Ana ', { ageConfirmed: true });
    expect(mockSupabase.raw.rpc).toHaveBeenLastCalledWith('claim_nickname', { p_nickname: 'Ana', p_age_confirmed: true });
    expect(r.ok).toBe(true);
    expect(getAuthState()).toMatchObject({ status: 'signedIn', profile: { nickname: 'Ana' } });
  });

  it('rejects invalid nicknames before calling the server', async () => {
    const r = await claimNickname('x', { ageConfirmed: true });
    expect(!r.ok && r.error.code).toBe('nickname_invalid');
    expect(mockSupabase.raw.rpc).not.toHaveBeenCalledWith('claim_nickname', expect.anything());
  });

  it('sends settings in the server shape (territory opt-out included)', async () => {
    mockSupabase.onRpc('set_my_settings', () => ({ data: { ...PROFILE, territory_opt_in: false } }));
    const r = await updateMySettings({ territoryOptIn: false, color: 2 });
    expect(mockSupabase.raw.rpc).toHaveBeenLastCalledWith('set_my_settings', { p: { color: 2, territory_opt_in: false } });
    expect(r.ok && r.value.territoryOptIn).toBe(false);
  });
});

describe('sign-out and deletion', () => {
  beforeEach(async () => {
    mockSupabase.setSession(mockSession(ME));
    mockSupabase.onRpc('get_my_profile', () => ({ data: PROFILE }));
    getAuthState();
    await waitFor('signedIn');
  });

  it('signs out after removing the push token', async () => {
    await signOut();
    expect(unregisterPush).toHaveBeenCalled();
    expect(mockSupabase.raw.auth.signOut).toHaveBeenCalled();
    expect(getAuthState().status).toBe('signedOut');
  });

  it('deletes the account, then wipes local activity and auth keys, then signs out', async () => {
    await AsyncStorage.multiSet([
      ['teal.activities.v1', '{}'],
      ['teal.activity.x.pts.v1', '[]'],
      ['teal.rec.inprogress.v1', '{}'],
      ['sb-project-auth-token', '{}'],
      ['teal.units.v1', '{}'],
    ]);
    mockSupabase.onRpc('delete_my_account', () => ({ data: null }));
    expect(await deleteMyAccount()).toEqual({ ok: true, value: undefined });
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(['teal.units.v1']);
    expect(getAuthState().status).toBe('signedOut');
  });

  it('keeps local data when the server deletion fails', async () => {
    await AsyncStorage.setItem('teal.activities.v1', '{}');
    mockSupabase.onRpc('delete_my_account', () => {
      throw new TypeError('Network request failed');
    });
    const r = await deleteMyAccount();
    expect(!r.ok && r.error.code).toBe('offline');
    expect(await AsyncStorage.getItem('teal.activities.v1')).toBe('{}');
  });
});
