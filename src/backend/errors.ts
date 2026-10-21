/**
 * The one mapping from Supabase/network failures to Teal's error codes (spec §4). Server RPCs raise
 * SQLSTATE P0001 with a stable code in MESSAGE; Auth errors carry their own codes; a failed fetch is
 * a TypeError. Every API module returns `Result<T>` so screens never see raw errors.
 */

export type BackendErrorCode =
  | 'not_configured'
  | 'offline'
  | 'not_authenticated'
  | 'no_profile'
  | 'rate_limited'
  | 'email_rate_limited'
  | 'otp_invalid'
  | 'otp_expired'
  | 'nickname_invalid'
  | 'nickname_taken'
  | 'nickname_too_soon'
  | 'age_required'
  | 'name_invalid'
  | 'not_found'
  | 'not_member'
  | 'forbidden'
  | 'limit_reached'
  | 'invalid_payload'
  | 'invalid_time'
  | 'overlap'
  | 'trace_expired'
  | 'unknown';

export type BackendError = { code: BackendErrorCode; message: string /* user-safe copy */; retryable: boolean };

export type Result<T> = { ok: true; value: T } | { ok: false; error: BackendError };

/** User-facing copy for each code. */
export const ERROR_COPY: Record<BackendErrorCode, string> = {
  not_configured: 'Accounts aren’t set up in this build.',
  offline: 'You’re offline. Try again when you have a connection.',
  not_authenticated: 'Please sign in again.',
  no_profile: 'Pick a nickname to finish setting up your account.',
  rate_limited: 'You’re doing that a lot. Try again later.',
  email_rate_limited: 'Too many sign-in emails right now. Try again later.',
  otp_invalid: 'That code didn’t work. Check it and try again.',
  otp_expired: 'That code has expired or is wrong. Request a new one.',
  nickname_invalid: 'Use 3–20 letters, numbers, dots, dashes or underscores, starting with a letter or number.',
  nickname_taken: 'That nickname is taken.',
  nickname_too_soon: 'You can change your nickname once a week.',
  age_required: 'You must be 13 or older to create an account.',
  name_invalid: 'That name isn’t allowed. Try another.',
  not_found: 'We couldn’t find that.',
  not_member: 'You’re not a member of that group.',
  forbidden: 'You don’t have permission to do that.',
  limit_reached: 'You’ve reached the limit for that.',
  invalid_payload: 'Something about that request wasn’t right.',
  invalid_time: 'This activity’s times don’t add up, so it can’t be counted.',
  overlap: 'This activity overlaps another one you recorded.',
  trace_expired: 'The full route for this activity is no longer stored.',
  unknown: 'Something went wrong. Try again.',
};

const RETRYABLE: ReadonlySet<BackendErrorCode> = new Set(['offline', 'rate_limited', 'email_rate_limited', 'unknown']);

/** Codes the server raises as P0001 MESSAGE. */
const SERVER_CODES: ReadonlySet<string> = new Set<BackendErrorCode>([
  'not_authenticated',
  'no_profile',
  'nickname_invalid',
  'nickname_taken',
  'nickname_too_soon',
  'age_required',
  'name_invalid',
  'rate_limited',
  'not_found',
  'not_member',
  'forbidden',
  'limit_reached',
  'invalid_payload',
  'invalid_time',
  'overlap',
  'trace_expired',
]);

export function backendError(code: BackendErrorCode): BackendError {
  return { code, message: ERROR_COPY[code], retryable: RETRYABLE.has(code) };
}

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(code: BackendErrorCode): Result<T> => ({ ok: false, error: backendError(code) });

const field = (e: object, k: string): unknown => (e as Record<string, unknown>)[k];
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function isBackendError(e: unknown): e is BackendError {
  return typeof e === 'object' && e !== null && typeof field(e, 'code') === 'string' && typeof field(e, 'retryable') === 'boolean';
}

/** Supabase Auth error code → ours (null when it is not an Auth error we recognise). */
function authCode(e: object): BackendErrorCode | null {
  const isAuth = field(e, '__isAuthError') === true || str(field(e, 'name'))?.startsWith('Auth') === true;
  if (!isAuth) return null;
  const code = str(field(e, 'code'));
  const status = field(e, 'status');
  const name = str(field(e, 'name'));
  if (name === 'AuthRetryableFetchError') return 'offline';
  if (code === 'over_email_send_rate_limit') return 'email_rate_limited';
  if (code === 'over_request_rate_limit' || status === 429) return 'rate_limited';
  // Supabase answers an expired *and* a wrong code with `otp_expired` ("Token has expired or is invalid").
  if (code === 'otp_expired') return 'otp_expired';
  if (code === 'validation_failed' || code === 'bad_jwt' || code === 'invalid_credentials') return 'otp_invalid';
  if (code === 'session_not_found' || code === 'session_expired' || code === 'refresh_token_not_found') return 'not_authenticated';
  if (code === 'email_provider_disabled' || code === 'signup_disabled') return 'not_configured';
  if (code === 'email_address_invalid') return 'invalid_payload';
  if (status === 403 || status === 401) return 'otp_invalid';
  return 'unknown';
}

/**
 * Map anything thrown or returned by supabase-js (PostgrestError, AuthError, fetch TypeError) to a
 * BackendError. Never includes the raw server message in user copy.
 */
export function toBackendError(e: unknown): BackendError {
  if (isBackendError(e)) return e;
  if (e instanceof TypeError) return backendError('offline'); // fetch: "Network request failed"
  if (typeof e !== 'object' || e === null) return backendError('unknown');

  const auth = authCode(e);
  if (auth) return backendError(auth);

  const code = str(field(e, 'code'));
  const message = str(field(e, 'message'))?.trim() ?? '';
  if (code === 'P0001' && SERVER_CODES.has(message)) return backendError(message as BackendErrorCode);
  if (code === 'PGRST301' || code === 'PGRST302') return backendError('not_authenticated'); // JWT expired/missing
  if (code === '42501') return backendError('forbidden');
  if (code === 'PGRST202') return backendError('not_configured'); // function not found: migrations missing
  // supabase-js wraps fetch failures as { message: 'TypeError: Network request failed', code: '' }.
  if (/network request failed|failed to fetch|fetch failed|load failed/i.test(message)) return backendError('offline');
  return backendError('unknown');
}
