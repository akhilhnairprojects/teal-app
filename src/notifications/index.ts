/**
 * Notifications (spec §3.5): the foreground handler, in-context permission, local notifications,
 * Expo push-token registration, tap routing and haptics. Remote push needs an EAS projectId and is
 * unavailable in Android Expo Go; `PushAvailability` says which case applies so the UI can explain it.
 * Never logs tokens.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { rpc } from '@/backend/rpc';
import { readCache, removeCache, writeCache } from '@/lib/cache';

export type PushAvailability = 'available' | 'noProjectId' | 'expoGoAndroid' | 'simulator' | 'web' | 'permissionDenied' | 'error';

const TOKEN_KEY = 'teal.push.token.v1';
const TOKEN_VERSION = 1;

export type PushEnvironment = {
  os: string;
  isDevice: boolean;
  executionEnvironment: string | undefined;
  projectId: string | null;
};

export function currentPushEnvironment(): PushEnvironment {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const fromExtra = typeof extra?.eas?.projectId === 'string' ? extra.eas.projectId : null;
  const fromEas = typeof Constants.easConfig?.projectId === 'string' ? Constants.easConfig.projectId : null;
  return {
    os: Platform.OS,
    isDevice: Device.isDevice,
    executionEnvironment: Constants.executionEnvironment,
    projectId: fromExtra ?? fromEas,
  };
}

/** The static reasons push cannot work here, in the spec's order; null when a token may be possible. */
export function pushGate(env: PushEnvironment): PushAvailability | null {
  if (env.os === 'web') return 'web';
  if (!env.isDevice) return 'simulator';
  if (env.os === 'android' && env.executionEnvironment === ExecutionEnvironment.StoreClient) return 'expoGoAndroid';
  if (!env.projectId) return 'noProjectId';
  return null;
}

/** Copy for Account → Notifications. */
export function pushAvailabilityText(a: PushAvailability | null): string {
  switch (a) {
    case 'available':
      return 'Push alerts are on.';
    case 'noProjectId':
      return 'Push alerts need an Expo project (eas init). You’ll still see alerts while Teal is open.';
    case 'expoGoAndroid':
      return 'Push alerts aren’t available in Expo Go on Android. You’ll still see alerts while Teal is open.';
    case 'simulator':
      return 'Push alerts need a real device. You’ll still see alerts while Teal is open.';
    case 'web':
      return 'Push alerts are available in the iPhone app.';
    case 'permissionDenied':
      return 'Notifications are off for Teal. Turn them on in Settings to get alerts.';
    case 'error':
      return 'Couldn’t set up push alerts. You’ll still see alerts while Teal is open.';
    default:
      return 'Push alerts are set up when you turn on a notification.';
  }
}

// --- availability store ------------------------------------------------------------------

let availability: PushAvailability | null = null;
let registeredToken: string | null = null;
const listeners = new Set<() => void>();

function setAvailability(a: PushAvailability | null) {
  if (a === availability) return;
  availability = a;
  listeners.forEach((l) => l());
}

/** The last registration result, or the static gate when registration has not run. */
export function getPushAvailability(): PushAvailability | null {
  return availability ?? pushGate(currentPushEnvironment());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function usePushAvailability(): PushAvailability | null {
  return useSyncExternalStore(subscribe, getPushAvailability, getPushAvailability);
}

/** Test helper. */
export function resetNotificationsForTests(): void {
  availability = null;
  registeredToken = null;
  configured = false;
}

// --- handler and permission --------------------------------------------------------------

let configured = false;

/** Show banners and list entries while Teal is open; no sound, no badge. */
export function configureNotifications(): void {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
  } catch {
    // Unsupported environment: notifications simply don't show in the foreground.
  }
}

/** Ask for permission in context (a notify toggle, parking, joining a session). */
export async function ensureNotificationPermission(): Promise<'granted' | 'denied'> {
  if (Platform.OS === 'web') return 'denied';
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (!current.canAskAgain) {
      setAvailability('permissionDenied');
      return 'denied';
    }
    const asked = await Notifications.requestPermissionsAsync();
    if (asked.granted) return 'granted';
    setAvailability('permissionDenied');
    return 'denied';
  } catch {
    return 'denied';
  }
}

// --- local notifications -----------------------------------------------------------------

const content = (n: { title: string; body: string; url?: string }) => ({ title: n.title, body: n.body, data: n.url ? { url: n.url } : {} });

/** Show a notification now (used as the foreground fallback when push is unavailable). */
export async function notifyLocal(n: { title: string; body: string; url?: string }): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.scheduleNotificationAsync({ content: content(n), trigger: null });
  } catch {
    // Best effort.
  }
}

/** Schedule a one-off notification at `at` (epoch ms). Returns its id, or null when it couldn't be scheduled. */
export async function scheduleLocal(n: { title: string; body: string; url?: string; at: number }): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: content(n),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: Math.max(n.at, Date.now() + 1000) },
    });
  } catch {
    return null;
  }
}

export async function cancelScheduled(id: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already fired or gone.
  }
}

// --- push registration -------------------------------------------------------------------

/**
 * Register this device's Expo push token with `register_push_token`. Never prompts: when permission
 * has not been granted it reports `permissionDenied` (prompting happens in context through
 * `ensureNotificationPermission`). Called on sign-in and at app start when signed in.
 */
export async function registerForPush(): Promise<PushAvailability> {
  const env = currentPushEnvironment();
  const gate = pushGate(env);
  if (gate) {
    setAvailability(gate);
    return gate;
  }
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      setAvailability('permissionDenied');
      return 'permissionDenied';
    }
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: env.projectId! })).data;
    const r = await rpc('register_push_token', { p_token: token, p_platform: env.os === 'ios' ? 'ios' : 'android' });
    if (!r.ok) {
      setAvailability('error');
      return 'error';
    }
    registeredToken = token;
    await writeCache(TOKEN_KEY, TOKEN_VERSION, token);
    setAvailability('available');
    return 'available';
  } catch {
    setAvailability('error');
    return 'error';
  }
}

/** Remove this device's token from the account (sign-out, account deletion). */
export async function unregisterPush(): Promise<void> {
  const token = registeredToken ?? (await readCache<string>(TOKEN_KEY, TOKEN_VERSION))?.value ?? null;
  registeredToken = null;
  await removeCache(TOKEN_KEY);
  setAvailability(null);
  if (token) await rpc('unregister_push_token', { p_token: token });
}

// --- tap routing -------------------------------------------------------------------------

/** Route prefixes a notification may open (spec §3.5); anything else is ignored. */
export const NOTIFICATION_ROUTE_PREFIXES = ['/friends', '/inbox', '/session/', '/leaderboards', '/park', '/territory'] as const;

/** The href for a notification's `data.url`, or null when it is not a known Teal route. */
export function notificationHref(url: unknown): Href | null {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || /\s/.test(url)) return null;
  for (const prefix of NOTIFICATION_ROUTE_PREFIXES) {
    if (prefix.endsWith('/')) {
      if (url.startsWith(prefix) && url.length > prefix.length) return url as Href;
    } else if (url === prefix || url.startsWith(`${prefix}?`) || url.startsWith(`${prefix}/`)) {
      return url as Href;
    }
  }
  return null;
}

function routeResponse(response: Notifications.NotificationResponse | null | undefined): boolean {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return false;
  const href = notificationHref(response.notification.request.content.data?.url);
  if (!href) return false;
  router.push(href);
  return true;
}

/** Open the route in a tapped notification: the one that launched the app, and any later taps. */
export function useNotificationRouting(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    let sub: { remove(): void } | null = null;
    try {
      void Notifications.getLastNotificationResponseAsync()
        .then((r) => {
          if (!cancelled && routeResponse(r)) void Notifications.clearLastNotificationResponseAsync();
        })
        .catch(() => {});
      sub = Notifications.addNotificationResponseReceivedListener((r) => {
        if (routeResponse(r)) void Notifications.clearLastNotificationResponseAsync().catch(() => {});
      });
    } catch {
      // Notifications unavailable in this environment.
    }
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);
}

// --- haptics -----------------------------------------------------------------------------

export function haptic(kind: 'success' | 'warning' | 'light'): void {
  if (Platform.OS === 'web') return;
  const run =
    kind === 'light'
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  void run.catch(() => {});
}
