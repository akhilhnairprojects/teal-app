import AsyncStorage from '@react-native-async-storage/async-storage';

import { mockSupabase } from '@/backend/testing/mockSupabase';

import {
  getPushAvailability,
  haptic,
  notificationHref,
  notifyLocal,
  pushAvailabilityText,
  pushGate,
  registerForPush,
  resetNotificationsForTests,
  scheduleLocal,
  unregisterPush,
  type PushEnvironment,
} from '..';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('expo-device', () => ({ __esModule: true, isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'storeClient', expoConfig: { extra: { eas: { projectId: 'proj-123' } } }, easConfig: null },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));

// Module mocks are created when first imported (before this file's constants), so read them back here.
const mockDevice = jest.requireMock('expo-device') as { isDevice: boolean };
const mockConstants = (jest.requireMock('expo-constants') as { default: { expoConfig: { extra?: unknown } | null; easConfig: { projectId?: string } | null } })
  .default;

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[abc123]' })),
  scheduleNotificationAsync: jest.fn(async () => 'notif-1'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
}));

const N = jest.requireMock('expo-notifications') as Record<string, jest.Mock>;
const H = jest.requireMock('expo-haptics') as Record<string, jest.Mock>;

const env = (o: Partial<PushEnvironment>): PushEnvironment => ({ os: 'ios', isDevice: true, executionEnvironment: 'storeClient', projectId: 'p', ...o });

beforeEach(async () => {
  resetNotificationsForTests();
  mockSupabase.reset();
  Object.values(N).forEach((f) => typeof f === 'function' && 'mockClear' in f && f.mockClear());
  mockDevice.isDevice = true;
  mockConstants.expoConfig = { extra: { eas: { projectId: 'proj-123' } } };
  mockConstants.easConfig = null;
  await AsyncStorage.clear();
});

describe('PushAvailability', () => {
  it('follows the spec matrix', () => {
    expect(pushGate(env({ os: 'web' }))).toBe('web');
    expect(pushGate(env({ isDevice: false }))).toBe('simulator');
    expect(pushGate(env({ os: 'android', executionEnvironment: 'storeClient' }))).toBe('expoGoAndroid');
    expect(pushGate(env({ os: 'android', executionEnvironment: 'standalone' }))).toBeNull();
    expect(pushGate(env({ projectId: null }))).toBe('noProjectId');
    expect(pushGate(env({}))).toBeNull(); // iOS Expo Go with a projectId can get a token
    for (const a of ['available', 'noProjectId', 'expoGoAndroid', 'simulator', 'web', 'permissionDenied', 'error', null] as const) {
      expect(pushAvailabilityText(a).length).toBeGreaterThan(10);
    }
    expect(pushAvailabilityText('noProjectId')).toBe('Push alerts need an Expo project (eas init). You’ll still see alerts while Teal is open.');
  });

  it('registers the token with the server when permitted', async () => {
    mockSupabase.onRpc('register_push_token', () => ({ data: null }));
    expect(await registerForPush()).toBe('available');
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
    expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('register_push_token', { p_token: 'ExponentPushToken[abc123]', p_platform: 'ios' });
    expect(getPushAvailability()).toBe('available');

    mockSupabase.onRpc('unregister_push_token', () => ({ data: null }));
    await unregisterPush();
    expect(mockSupabase.raw.rpc).toHaveBeenLastCalledWith('unregister_push_token', { p_token: 'ExponentPushToken[abc123]' });
  });

  it('never prompts while registering, and reports a denied permission', async () => {
    N.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true, status: 'undetermined' });
    expect(await registerForPush()).toBe('permissionDenied');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('stops at the static gates and reports errors', async () => {
    mockConstants.expoConfig = { extra: {} };
    expect(await registerForPush()).toBe('noProjectId');
    mockConstants.easConfig = { projectId: 'from-eas' };
    N.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('offline'));
    expect(await registerForPush()).toBe('error');
    mockDevice.isDevice = false;
    expect(await registerForPush()).toBe('simulator');
  });
});

describe('local notifications and haptics', () => {
  it('shows now, schedules for later and never in the past', async () => {
    await notifyLocal({ title: 'Dock full', body: 'Now heading to Main St', url: '/park' });
    expect(N.scheduleNotificationAsync).toHaveBeenLastCalledWith({
      content: { title: 'Dock full', body: 'Now heading to Main St', data: { url: '/park' } },
      trigger: null,
    });
    const at = Date.now() + 600_000;
    expect(await scheduleLocal({ title: 't', body: 'b', at })).toBe('notif-1');
    expect(N.scheduleNotificationAsync).toHaveBeenLastCalledWith({ content: { title: 't', body: 'b', data: {} }, trigger: { type: 'date', date: at } });
    N.scheduleNotificationAsync.mockRejectedValueOnce(new Error('nope'));
    expect(await scheduleLocal({ title: 't', body: 'b', at })).toBeNull();
  });

  it('maps haptic kinds', () => {
    haptic('warning');
    haptic('light');
    expect(H.notificationAsync).toHaveBeenCalledWith('warning');
    expect(H.impactAsync).toHaveBeenCalledWith('light');
  });
});

describe('tap routing', () => {
  it('routes only known Teal paths', () => {
    expect(notificationHref('/friends')).toBe('/friends');
    expect(notificationHref('/inbox')).toBe('/inbox');
    expect(notificationHref('/session/abc')).toBe('/session/abc');
    expect(notificationHref('/leaderboards?board=run_5k')).toBe('/leaderboards?board=run_5k');
    expect(notificationHref('/park?toName=x')).toBe('/park?toName=x');
    expect(notificationHref('/territory')).toBe('/territory');
    expect(notificationHref('/session/')).toBeNull();
    expect(notificationHref('/friendsX')).toBeNull();
    expect(notificationHref('https://evil.example/friends')).toBeNull();
    expect(notificationHref('//evil.example')).toBeNull();
    expect(notificationHref('/account')).toBeNull();
    expect(notificationHref(42)).toBeNull();
  });
});
