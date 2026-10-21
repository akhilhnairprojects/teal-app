import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, type ReactTestRenderer } from 'react-test-renderer';

import type { RecorderSnapshot } from '@/activity/recorder';
import { textOf, waitForText, waitUntil, withScreen } from '@/mbta/testing/render';
import { getActiveMapOverlay, resetMapOverlays } from '@/state/mapOverlay';

import { TERRITORY_NOTICE_COPY } from '@/features/territory/TerritoryNotice';

import { RecordScreen } from '../RecordScreen';
import { RECORD_COPY } from '../recordModel';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  const Icon = () => <RNText>{''}</RNText>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), dismissAll: jest.fn(), canDismiss: jest.fn(() => false) },
    usePathname: () => '/record',
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  };
});

const mockAuthState: { current: Record<string, unknown> } = { current: { status: 'signedOut' } };
jest.mock('@/backend/auth', () => ({
  useAuth: () => mockAuthState.current,
  getAuthState: () => mockAuthState.current,
  subscribeAuth: () => () => {},
  updateMySettings: jest.fn(async () => ({ ok: true, value: {} })),
}));
const auth = jest.requireMock('@/backend/auth') as { updateMySettings: jest.Mock };

const IDLE: RecorderSnapshot = {
  phase: 'idle',
  voided: null,
  kind: null,
  localId: null,
  startedAt: null,
  stats: {
    elapsedMs: 0,
    movingMs: 0,
    distanceM: 0,
    excludedM: 0,
    currentPaceSecPerKm: null,
    avgPaceSecPerKm: null,
    autoPaused: false,
    gpsQuality: 'none',
    vehicleSuspected: false,
  },
  recentPath: [],
  groupSessionId: null,
  backgroundGapMs: 0,
  warnings: [],
};

const mockSnap: { current: RecorderSnapshot; listeners: Set<() => void> } = { current: IDLE, listeners: new Set() };
jest.mock('@/activity/recorder', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  const subscribe = (l: () => void) => {
    mockSnap.listeners.add(l);
    return () => mockSnap.listeners.delete(l);
  };
  return {
    useRecorder: () => useSyncExternalStore(subscribe, () => mockSnap.current, () => mockSnap.current),
    recorder: {
      start: jest.fn(async () => ({ ok: true, value: undefined })),
      pause: jest.fn(),
      resume: jest.fn(async () => ({ ok: true, value: undefined })),
      finish: jest.fn(async () => ({ discarded: 'tooShort' })),
      discard: jest.fn(async () => {}),
      pendingRecovery: jest.fn(async () => null),
      recover: jest.fn(async () => ({ ok: true, value: undefined })),
      dismissVoided: jest.fn(),
    },
  };
});

const { recorder } = jest.requireMock('@/activity/recorder') as { recorder: Record<string, jest.Mock> };
const { router } = jest.requireMock('expo-router') as { router: Record<string, jest.Mock> };

function setSnap(s: Partial<RecorderSnapshot>) {
  act(() => {
    mockSnap.current = { ...IDLE, ...s, stats: { ...IDLE.stats, ...s.stats } };
    mockSnap.listeners.forEach((l) => l());
  });
}

const press = (r: ReactTestRenderer, testID: string) =>
  act(async () => {
    await r.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function')[0].props.onPress();
  });

const PATH = [
  { latitude: 42.35, longitude: -71.06 },
  { latitude: 42.351, longitude: -71.06 },
];

beforeEach(async () => {
  mockSnap.current = IDLE;
  mockSnap.listeners.clear();
  mockAuthState.current = { status: 'signedOut' };
  Object.values(recorder).forEach((f) => f.mockClear());
  router.push.mockClear();
  router.replace.mockClear();
  resetMapOverlays();
  await AsyncStorage.clear();
});

describe('RecordScreen', () => {
  it('warns while too fast, and explains a run deleted for speed', async () => {
    await withScreen(<RecordScreen initialKind="run" sessionId={null} />, async (r) => {
      setSnap({ phase: 'recording', kind: 'run', warnings: ['tooFast'] });
      await waitForText(r, 'the run will be deleted');
      setSnap({ voided: { kind: 'run', at: 0 } });
      await waitForText(r, 'Run deleted', 'won’t count on leaderboards or territory');
      expect(r.root.findAllByProps({ testID: 'record-start' })).toHaveLength(0);
      await press(r, 'record-voided-ok');
      expect(recorder.dismissVoided).toHaveBeenCalled();
    });
  });

  it('explains the Expo Go limits on the first start, then starts the chosen kind', async () => {
    await withScreen(<RecordScreen initialKind="bike" sessionId="s1" />, async (r) => {
      await waitUntil(() => r.root.findAllByProps({ testID: 'record-start' }).some((n) => n.props.disabled === false));
      expect(textOf(r)).toContain('Teal records only while it’s open on screen.');
      expect(textOf(r)).toContain(RECORD_COPY.findDock);
      await press(r, 'record-start');
      await waitForText(r, RECORD_COPY.firstStartBody, RECORD_COPY.battery);
      expect(recorder.start).not.toHaveBeenCalled();
      await press(r, 'record-intro-confirm');
      await waitUntil(() => recorder.start.mock.calls.length > 0);
      expect(recorder.start).toHaveBeenCalledWith({ kind: 'bike', groupSessionId: 's1' });
    });
    // The intro is remembered.
    await withScreen(<RecordScreen initialKind="run" sessionId={null} />, async (r) => {
      await waitUntil(() => r.root.findAllByProps({ testID: 'record-start' }).some((n) => n.props.disabled === false));
      await press(r, 'record-start');
      await waitUntil(() => recorder.start.mock.calls.length > 1);
      expect(recorder.start).toHaveBeenLastCalledWith({ kind: 'run', groupSessionId: null });
    });
  });

  it('shows live run stats, the screen-on chip, banners and the live track', async () => {
    await withScreen(<RecordScreen initialKind="run" sessionId={null} />, async (r) => {
      setSnap({
        phase: 'recording',
        kind: 'run',
        stats: { ...IDLE.stats, elapsedMs: 600_000, distanceM: 1609.344, currentPaceSecPerKm: 300, avgPaceSecPerKm: 372.8, gpsQuality: 'good' },
        recentPath: PATH,
        backgroundGapMs: 240_000,
        warnings: ['foregroundOnly', 'backgroundGap'],
      });
      await waitForText(r, '10:00', '1.00 mi', '8:03 /mi', RECORD_COPY.screenOnChip, 'GPS good');
      expect(textOf(r)).toContain('Paused for 4 min while Teal was in the background.');
      expect(textOf(r)).toContain(RECORD_COPY.holdToFinish);
      expect(getActiveMapOverlay()).toEqual({ tracks: [expect.objectContaining({ id: 'recording', coordinates: PATH })], followUser: true });
      await press(r, 'record-pause');
      expect(recorder.pause).toHaveBeenCalled();
    });
  });

  it('shows bike speed and a dock button', async () => {
    await withScreen(<RecordScreen initialKind="bike" sessionId={null} />, async (r) => {
      setSnap({ phase: 'recording', kind: 'bike', stats: { ...IDLE.stats, currentPaceSecPerKm: 180, gpsQuality: 'fair' }, warnings: ['vehicleSegment'] });
      await waitForText(r, 'Speed', '12.4 mph', RECORD_COPY.vehicle, 'GPS fair');
      await press(r, 'record-find-dock');
      expect(router.push).toHaveBeenCalledWith('/park');
    });
  });

  it('finishes on a long press with sharing off by default', async () => {
    const saved = {
      localId: 'L1',
      kind: 'run',
      startedAt: 0,
      endedAt: 0,
      ownerUserId: null,
      groupSessionId: null,
      shareRoute: false,
      metrics: { distanceM: 3218.688, excludedM: 0, elapsedMs: 1_500_000, movingMs: 1_440_000, efforts: [], isLoop: false, loopGapM: null, medianDtMs: 1000 },
      previewPolyline: '',
      sync: { state: 'local', attempts: 0, nextAttemptAt: null, lastError: null, server: null },
    };
    recorder.finish.mockImplementationOnce(async () => {
      mockSnap.current = { ...mockSnap.current, phase: 'finished' };
      mockSnap.listeners.forEach((l) => l());
      return saved;
    });
    await withScreen(<RecordScreen initialKind="run" sessionId={null} />, async (r) => {
      setSnap({ phase: 'recording', kind: 'run', recentPath: PATH, warnings: ['foregroundOnly'] });
      await waitForText(r, RECORD_COPY.holdToFinish);
      const hold = r.root.findAll((n) => n.props.testID === 'record-finish' && typeof n.props.onLongPress === 'function')[0];
      expect(hold.props.onPress).toBeUndefined();
      act(() => hold.props.onLongPress());
      expect(recorder.pause).toHaveBeenCalled();
      setSnap({ phase: 'paused', kind: 'run', recentPath: PATH });
      await waitForText(r, 'Finish this run?', RECORD_COPY.shareLabel, RECORD_COPY.shareDetail);
      const toggle = r.root.findAll((n) => n.props.testID === 'record-share' && typeof n.props.onValueChange === 'function')[0];
      expect(toggle.props.value).toBe(false);
      await press(r, 'record-save');
      expect(recorder.finish).toHaveBeenCalledWith({ shareRoute: false });
      await waitForText(r, 'Run saved', '2.00 mi', '25:00', RECORD_COPY.savedSignedOut);
      expect(getActiveMapOverlay()).toEqual({ tracks: [expect.objectContaining({ coordinates: PATH })], fitTo: PATH });
      await press(r, 'record-view-activity');
      expect(router.replace).toHaveBeenCalledWith('/activity/L1');
    });
  });

  it('says when a recording was too short to save, and keeps going on request', async () => {
    await withScreen(<RecordScreen initialKind="run" sessionId={null} />, async (r) => {
      setSnap({ phase: 'recording', kind: 'run' });
      await waitForText(r, RECORD_COPY.holdToFinish);
      act(() => r.root.findAll((n) => n.props.testID === 'record-finish' && typeof n.props.onLongPress === 'function')[0].props.onLongPress());
      await press(r, 'record-keep-going');
      expect(recorder.resume).toHaveBeenCalledTimes(1);
      act(() => r.root.findAll((n) => n.props.testID === 'record-finish' && typeof n.props.onLongPress === 'function')[0].props.onLongPress());
      await press(r, 'record-save');
      setSnap({ phase: 'idle' });
      await waitForText(r, RECORD_COPY.tooShort);
    });
  });

  it('shows the territory notice before the first run is saved, and saving records it first (review B1)', async () => {
    mockAuthState.current = {
      status: 'signedIn',
      userId: 'u1',
      profile: { id: 'u1', nickname: 'ana', color: 1, inviteCode: 'ABCDEFGH', territoryOptIn: true, territoryNoticeSeen: false },
    };
    auth.updateMySettings.mockClear();
    const order: string[] = [];
    auth.updateMySettings.mockImplementationOnce(async () => {
      order.push('notice');
      return { ok: true, value: {} };
    });
    recorder.finish.mockImplementationOnce(async () => {
      order.push('finish');
      return { discarded: 'tooShort' };
    });
    await withScreen(<RecordScreen initialKind="run" sessionId={null} />, async (r) => {
      setSnap({ phase: 'recording', kind: 'run' });
      await waitForText(r, RECORD_COPY.holdToFinish);
      act(() => r.root.findAll((n) => n.props.testID === 'record-finish' && typeof n.props.onLongPress === 'function')[0].props.onLongPress());
      setSnap({ phase: 'paused', kind: 'run' });
      await waitForText(r, TERRITORY_NOTICE_COPY.title, TERRITORY_NOTICE_COPY.saveNote, TERRITORY_NOTICE_COPY.turnOff);
      await press(r, 'record-save');
      expect(auth.updateMySettings).toHaveBeenCalledWith({ territoryNoticeSeen: true });
      expect(order).toEqual(['notice', 'finish']);
    });
  });

  it('shows no territory notice once it has been seen, or for a ride', async () => {
    mockAuthState.current = {
      status: 'signedIn',
      userId: 'u1',
      profile: { id: 'u1', nickname: 'ana', color: 1, inviteCode: 'ABCDEFGH', territoryOptIn: true, territoryNoticeSeen: true },
    };
    await withScreen(<RecordScreen initialKind="run" sessionId={null} />, async (r) => {
      setSnap({ phase: 'recording', kind: 'run' });
      await waitForText(r, RECORD_COPY.holdToFinish);
      act(() => r.root.findAll((n) => n.props.testID === 'record-finish' && typeof n.props.onLongPress === 'function')[0].props.onLongPress());
      await waitForText(r, 'Finish this run?');
      expect(textOf(r)).not.toContain(TERRITORY_NOTICE_COPY.title);
    });
  });

  it('says when GPS stopped, and shows the error when Resume cannot get GPS (review S3)', async () => {
    recorder.resume.mockImplementationOnce(async () => ({
      ok: false,
      error: { code: 'forbidden', message: 'Teal needs location access to record. You can turn it on in Settings.', retryable: false },
    }));
    await withScreen(<RecordScreen initialKind="run" sessionId={null} />, async (r) => {
      setSnap({ phase: 'paused', kind: 'run', warnings: ['gpsStopped', 'permissionDenied'] });
      await waitForText(r, RECORD_COPY.gpsStopped, RECORD_COPY.permissionDenied);
      await press(r, 'record-resume');
      await waitForText(r, 'Teal needs location access to record. You can turn it on in Settings.');
    });
  });

  it('offers to resolve an unfinished recording on the record screen', async () => {
    recorder.pendingRecovery.mockImplementationOnce(async () => ({ kind: 'run', startedAt: 0, points: 42 }));
    await withScreen(<RecordScreen initialKind="run" sessionId={null} />, async (r) => {
      await waitForText(r, 'Resume or save your unfinished run?', '42 points were saved.');
      await press(r, 'record-recovery-save');
      expect(recorder.recover).toHaveBeenCalledWith('save');
    });
  });

  it('links to Settings when location permission is denied', async () => {
    await withScreen(<RecordScreen initialKind="run" sessionId={null} />, async (r) => {
      setSnap({ phase: 'idle', warnings: ['permissionDenied'] });
      await waitForText(r, RECORD_COPY.permissionDenied, RECORD_COPY.openSettings);
    });
  });
});
