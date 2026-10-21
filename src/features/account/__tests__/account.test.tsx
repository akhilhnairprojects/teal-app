import { Text } from 'react-native';
import { act, type ReactTestRenderer } from 'react-test-renderer';

import { textOf, waitForText, waitUntil, withScreen } from '@/mbta/testing/render';
import { getActiveModes, resetActiveModes, setActiveMode } from '@/state/activeModes';

import { ActiveModePills } from '@/features/shell/ActiveModePills';
import { MOVE_ROWS, MoveHome } from '@/features/move/MoveHome';
import { TERRITORY_NOTICE_COPY } from '@/features/territory/TerritoryNotice';

import { AccountScreen, DELETE_CONFIRM_WORD } from '../AccountScreen';
import { NicknameScreen } from '../NicknameScreen';
import { afterSignIn, SignInScreen } from '../SignInScreen';
import { GATE_COPY, SignInGate } from '../SignInGate';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  const Icon = () => <RNText>{''}</RNText>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

const mockPathname = { current: '/leaderboards' };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  const { Text: RNText } = jest.requireActual('react-native');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
    usePathname: () => mockPathname.current,
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
    Redirect: ({ href }: { href: string }) => <RNText>{`redirect:${href}`}</RNText>,
  };
});

jest.mock('@/backend/config', () => ({ BACKEND_CONFIGURED: true }));
jest.mock('expo-apple-authentication', () => {
  const { Pressable } = jest.requireActual('react-native');
  return {
    AppleAuthenticationButton: (p: { testID?: string; onPress: () => void }) => <Pressable testID={p.testID} onPress={p.onPress} />,
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 0, BLACK: 2 },
  };
});

const ME = '11111111-1111-4111-8111-111111111111';
const PROFILE = {
  id: ME,
  nickname: 'Ana',
  color: 2,
  inviteCode: 'ABCDEFGH',
  territoryOptIn: true,
  territoryNoticeSeen: true,
  notifyOvertake: true,
  notifySessions: true,
  notifyFriendRequests: false,
  createdAt: '2026-10-20T14:00:00Z',
};
const mockAuthState: { current: Record<string, unknown> } = { current: { status: 'signedOut' } };
jest.mock('@/backend/auth', () => ({
  useAuth: () => mockAuthState.current,
  getAuthState: () => mockAuthState.current,
  subscribeAuth: () => () => {},
  requestEmailCode: jest.fn(async () => ({ ok: true, value: { resendAfterMs: 60_000 } })),
  verifyEmailCode: jest.fn(async () => ({ ok: true, value: { status: 'needsProfile', userId: '11111111-1111-4111-8111-111111111111' } })),
  normalizeCode: (c: string) => c.replace(/\D/g, ''),
  appleSignInAvailable: jest.fn(async () => true),
  signInWithApple: jest.fn(async () => ({ ok: true, value: { status: 'needsProfile', userId: '11111111-1111-4111-8111-111111111111' } })),
  signInWithGoogle: jest.fn(async () => ({ ok: false, error: { code: 'sign_in_cancelled', message: 'Sign-in was cancelled.', retryable: false } })),
  claimNickname: jest.fn(async () => ({ ok: false, error: { code: 'nickname_taken', message: 'That nickname is taken.', retryable: false } })),
  validateNicknameLocally: jest.requireActual('@/backend/auth').validateNicknameLocally,
  updateMySettings: jest.fn(async () => ({ ok: true, value: {} })),
  signOut: jest.fn(async () => {}),
  deleteMyAccount: jest.fn(async () => ({ ok: true, value: undefined })),
}));
jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());
jest.mock('@/notifications', () => ({
  ensureNotificationPermission: jest.fn(async () => 'granted'),
  registerForPush: jest.fn(async () => 'noProjectId'),
  usePushAvailability: () => 'noProjectId',
  pushAvailabilityText: () => 'Push alerts need an Expo project (eas init).',
}));
const mockRecovery: { current: unknown } = { current: null };
jest.mock('@/activity/recorder', () => ({
  recorder: { pendingRecovery: jest.fn(async () => mockRecovery.current), recover: jest.fn(async () => {}) },
}));
jest.mock('@/activity/sync', () => ({
  countUnownedActivities: jest.fn(async () => 2),
  attachUnownedActivities: jest.fn(async () => 2),
}));
jest.mock('@/social/inbox', () => ({
  fetchInbox: jest.fn(async () => ({ ok: true, value: [{ readAt: null }, { readAt: null }, { readAt: 'x' }] })),
}));

const { router } = jest.requireMock('expo-router') as { router: Record<'push' | 'replace', jest.Mock> };
const auth = jest.requireMock('@/backend/auth') as Record<string, jest.Mock>;
const recorderMock = jest.requireMock('@/activity/recorder') as { recorder: Record<string, jest.Mock> };
const syncMock = jest.requireMock('@/activity/sync') as Record<string, jest.Mock>;

const press = (r: ReactTestRenderer, testID: string) => act(() => r.root.findByProps({ testID }).props.onPress());

beforeEach(() => {
  mockPathname.current = '/leaderboards';
  mockAuthState.current = { status: 'signedOut' };
  mockRecovery.current = null;
  router.push.mockClear();
  router.replace.mockClear();
  Object.values(auth).forEach((f) => typeof f?.mockClear === 'function' && f.mockClear());
  resetActiveModes();
});

describe('SignInGate', () => {
  const child = <Text>secret board</Text>;

  it('explains when accounts are unavailable', async () => {
    mockAuthState.current = { status: 'unavailable' };
    await withScreen(<SignInGate>{child}</SignInGate>, async (r) => {
      expect(textOf(r)).toContain(GATE_COPY.unavailableTitle);
      expect(textOf(r)).not.toContain('secret board');
    });
  });

  it('offers sign-in that returns to this page', async () => {
    await withScreen(<SignInGate>{child}</SignInGate>, async (r) => {
      const button = r.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function')[0];
      act(() => button.props.onPress());
      expect(router.push).toHaveBeenCalledWith('/account/sign-in?next=%2Fleaderboards');
    });
  });

  it('sends a new account to the nickname screen and shows children when signed in', async () => {
    mockAuthState.current = { status: 'needsProfile', userId: ME };
    await withScreen(<SignInGate>{child}</SignInGate>, async (r) => expect(textOf(r)).toContain('redirect:/account/nickname'));
    mockAuthState.current = { status: 'signedIn', userId: ME, profile: PROFILE };
    await withScreen(<SignInGate>{(p) => <Text>{`hi ${p.nickname}`}</Text>}</SignInGate>, async (r) => expect(textOf(r)).toContain('hi Ana'));
  });
});

describe('SignInScreen', () => {
  it('sends the code, then verifies a pasted code and continues to the nickname screen', async () => {
    await withScreen(<SignInScreen next="/leaderboards" />, async (r) => {
      press(r, 'sign-in-show-email');
      act(() => r.root.findByProps({ testID: 'sign-in-email' }).props.onChangeText('ana@example.com'));
      press(r, 'sign-in-send');
      await waitForText(r, 'Enter the code we sent to ana@example.com');
      expect(textOf(r)).toMatch(/Resend code in \d+s/);
      const code = r.root.findByProps({ testID: 'sign-in-code' });
      expect(code.props.textContentType).toBe('oneTimeCode');
      act(() => code.props.onChangeText('123 456'));
      press(r, 'sign-in-verify');
      await waitUntil(() => router.replace.mock.calls.length > 0);
      expect(auth.verifyEmailCode).toHaveBeenCalledWith('ana@example.com', '123 456');
      expect(router.replace).toHaveBeenCalledWith('/account/nickname?next=%2Fleaderboards');
    });
  });

  it('shows the friendly email rate-limit message', async () => {
    auth.requestEmailCode.mockResolvedValueOnce({
      ok: false,
      error: { code: 'email_rate_limited', message: 'Too many sign-in emails right now. Try again later.', retryable: true },
    });
    await withScreen(<SignInScreen next={null} />, async (r) => {
      press(r, 'sign-in-show-email');
      act(() => r.root.findByProps({ testID: 'sign-in-email' }).props.onChangeText('ana@example.com'));
      press(r, 'sign-in-send');
      await waitForText(r, 'Too many sign-in emails right now. Try again later.');
    });
  });

  it('leads with Apple and Google, hides email until asked', async () => {
    await withScreen(<SignInScreen next="/leaderboards" />, async (r) => {
      await waitUntil(() => r.root.findAllByProps({ testID: 'sign-in-apple' }).length > 0);
      expect(r.root.findAllByProps({ testID: 'sign-in-google' }).length).toBeGreaterThan(0);
      expect(r.root.findAllByProps({ testID: 'sign-in-email' })).toHaveLength(0);
      press(r, 'sign-in-apple');
      await waitUntil(() => router.replace.mock.calls.length > 0);
      expect(auth.signInWithApple).toHaveBeenCalled();
      expect(router.replace).toHaveBeenCalledWith('/account/nickname?next=%2Fleaderboards');
    });
  });

  it('stays quiet when Google sign-in is cancelled', async () => {
    await withScreen(<SignInScreen next={null} />, async (r) => {
      press(r, 'sign-in-google');
      await waitUntil(() => auth.signInWithGoogle.mock.calls.length > 0);
      await act(async () => {});
      expect(textOf(r)).not.toContain('Sign-in was cancelled.');
      expect(router.replace).not.toHaveBeenCalled();
    });
  });

  it('routes after sign-in', () => {
    expect(afterSignIn({ status: 'signedIn', userId: ME, profile: PROFILE }, null)).toBe('/account');
    expect(afterSignIn({ status: 'signedIn', userId: ME, profile: PROFILE }, '/friends')).toBe('/friends');
  });
});

describe('NicknameScreen', () => {
  it('validates locally, requires the 13+ box and shows server errors', async () => {
    mockAuthState.current = { status: 'needsProfile', userId: ME };
    await withScreen(<NicknameScreen next={null} />, async (r) => {
      act(() => r.root.findByProps({ testID: 'nickname-input' }).props.onChangeText('a b'));
      expect(textOf(r)).toContain('Start with a letter or number');
      act(() => r.root.findByProps({ testID: 'nickname-input' }).props.onChangeText('ana'));
      expect(r.root.findByProps({ testID: 'nickname-save' }).props.disabled).toBe(true);
      press(r, 'nickname-age');
      expect(r.root.findByProps({ testID: 'nickname-save' }).props.disabled).toBe(false);
      press(r, 'nickname-save');
      await waitForText(r, 'That nickname is taken.');
      expect(auth.claimNickname).toHaveBeenCalledWith('ana', { ageConfirmed: true });
    });
  });

  it('shows the territory notice to a new account and records the choice, including Turn off (review B1)', async () => {
    mockAuthState.current = { status: 'needsProfile', userId: ME };
    auth.claimNickname.mockImplementationOnce(async () => ({ ok: true, value: PROFILE }));
    auth.updateMySettings.mockClear();
    await withScreen(<NicknameScreen next={null} />, async (r) => {
      expect(textOf(r)).toContain(TERRITORY_NOTICE_COPY.title);
      expect(textOf(r)).toContain('Your squares outline the area you looped');
      const toggle = r.root.findAll((n) => n.props.testID === 'nickname-territory' && typeof n.props.onValueChange === 'function')[0];
      expect(toggle.props.value).toBe(true); // on by default (Addendum D)
      act(() => toggle.props.onValueChange(false));
      act(() => r.root.findByProps({ testID: 'nickname-input' }).props.onChangeText('ana'));
      press(r, 'nickname-age');
      press(r, 'nickname-save');
      await waitUntil(() => auth.updateMySettings.mock.calls.length > 0);
      expect(auth.updateMySettings).toHaveBeenCalledWith({ territoryNoticeSeen: true, territoryOptIn: false });
    });
  });

  it('does not show the territory notice when renaming', async () => {
    mockAuthState.current = { status: 'signedIn', userId: ME, profile: PROFILE };
    await withScreen(<NicknameScreen next={null} />, async (r) => {
      expect(textOf(r)).not.toContain(TERRITORY_NOTICE_COPY.title);
    });
  });
});

describe('AccountScreen', () => {
  it('shows the profile and only deletes after typing DELETE', async () => {
    mockAuthState.current = { status: 'signedIn', userId: ME, profile: PROFILE };
    await withScreen(<AccountScreen />, async (r) => {
      expect(textOf(r)).toContain('Ana');
      expect(textOf(r)).toContain('Push alerts need an Expo project');
      expect(textOf(r)).toContain('Your squares outline the area you looped');
      expect(r.root.findByProps({ testID: 'account-delete-button' }).props.disabled).toBe(true);
      act(() => r.root.findByProps({ testID: 'account-delete-confirm' }).props.onChangeText(DELETE_CONFIRM_WORD));
      press(r, 'account-delete-button');
      await waitUntil(() => router.replace.mock.calls.length > 0);
      expect(auth.deleteMyAccount).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith('/move');
    });
  });

  it('turns territory off through the server', async () => {
    mockAuthState.current = { status: 'signedIn', userId: ME, profile: PROFILE };
    await withScreen(<AccountScreen />, async (r) => {
      const toggle = r.root.findAll((n) => n.props.testID === 'account-territory' && typeof n.props.onValueChange === 'function')[0];
      await act(async () => toggle.props.onValueChange(false));
      expect(auth.updateMySettings).toHaveBeenCalledWith({ territoryOptIn: false });
    });
  });
});

describe('MoveHome and active modes', () => {
  it('lists the hub rows in order and navigates', async () => {
    await withScreen(<MoveHome />, async (r) => {
      expect(MOVE_ROWS.map((x) => x.label)).toEqual([
        'Record a run',
        'Record a Bluebike ride',
        'Find a dock',
        'Leaderboards',
        'Friends',
        'Territory',
        'My activities',
        'Inbox',
        'Account',
      ]);
      press(r, 'move-row-record-run');
      expect(router.push).toHaveBeenCalledWith('/record?kind=run');
      press(r, 'move-row-park');
      expect(router.push).toHaveBeenCalledWith('/park');
    });
  });

  it('offers to recover an unfinished recording and to upload signed-out activities', async () => {
    mockRecovery.current = { kind: 'run', startedAt: 1, points: 420 };
    mockAuthState.current = { status: 'signedIn', userId: ME, profile: PROFILE };
    await withScreen(<MoveHome />, async (r) => {
      await waitForText(r, 'Resume or save your unfinished run?', 'Upload 2 activities recorded before you signed in?');
      expect(r.root.findByProps({ testID: 'move-row-inbox' }).props.accessibilityLabel).toBe('Inbox, 2 unread');
      const upload = r.root.findAll((n) => n.props.accessibilityRole === 'button' && textOf(n).startsWith('Upload'))[0];
      act(() => upload.props.onPress());
      expect(syncMock.attachUnownedActivities).toHaveBeenCalled();
      const save = r.root.findAll((n) => n.props.accessibilityRole === 'button' && textOf(n) === 'Save')[0];
      await act(async () => save.props.onPress());
      expect(recorderMock.recorder.recover).toHaveBeenCalledWith('save');
    });
  });

  it('shows active-mode pills except on the mode’s own page', async () => {
    setActiveMode({ id: 'recording', label: '● Recording · 2.40 mi', href: '/record?kind=run' as never });
    mockPathname.current = '/';
    await withScreen(<ActiveModePills />, async (r) => {
      expect(textOf(r)).toContain('● Recording · 2.40 mi');
      press(r, 'active-mode-recording');
      expect(router.push).toHaveBeenCalledWith('/record?kind=run');
    });
    mockPathname.current = '/record';
    await withScreen(<ActiveModePills />, async (r) => expect(textOf(r)).toBe(''));
    expect(getActiveModes()).toHaveLength(1);
  });
});
