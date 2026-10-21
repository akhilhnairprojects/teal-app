import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PARK_STREET } from '@/lib/geo';

import { isDemoLink, resetDemoLinkForTests, useLocation, type LocationState } from '../useLocation';

const mockLocation = {
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 42.3601, longitude: -71.0589 } })),
};
// Delegate lazily: the factory runs before `mockLocation` is initialized.
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: () => mockLocation.requestForegroundPermissionsAsync(),
  getLastKnownPositionAsync: () => mockLocation.getLastKnownPositionAsync(),
  getCurrentPositionAsync: () => mockLocation.getCurrentPositionAsync(),
  Accuracy: { Balanced: 3 },
}));

const platform = Platform as { OS: string };
const realOS = platform.OS;
const g = globalThis as { location?: { search: string } };

let seen: LocationState = { status: 'locating' };
function Probe({ onRender }: { onRender: (s: LocationState) => void }) {
  onRender(useLocation());
  return null;
}

async function mountProbe(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<Probe onRender={(s) => (seen = s)} />);
  });
  return r;
}

afterEach(() => {
  platform.OS = realOS;
  delete g.location;
  resetDemoLinkForTests();
  Object.values(mockLocation).forEach((m) => m.mockClear());
});

describe('useLocation', () => {
  it('keeps demo mode after in-app navigation drops ?demo from the URL', async () => {
    platform.OS = 'web';
    g.location = { search: '?demo' };
    resetDemoLinkForTests(); // what module load does at startup
    g.location.search = ''; // router.replace / push rewrote the URL
    expect(isDemoLink()).toBe(true);

    const r = await mountProbe();
    expect(seen).toEqual({ status: 'ready', coords: PARK_STREET, source: 'fallback', reason: 'Demo' });
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    act(() => r.unmount());
  });

  it('is not a demo without ?demo at startup, even if it appears later', async () => {
    platform.OS = 'web';
    g.location = { search: '' };
    resetDemoLinkForTests();
    g.location.search = '?demo';
    expect(isDemoLink()).toBe(false);
  });

  it('never treats native as a demo, and uses the device fix inside Boston', async () => {
    expect(isDemoLink()).toBe(false);
    const r = await mountProbe();
    expect(seen).toEqual({ status: 'ready', coords: { latitude: 42.3601, longitude: -71.0589 }, source: 'device' });
    act(() => r.unmount());
  });

  it('falls back to Park Street outside the Boston area', async () => {
    mockLocation.getCurrentPositionAsync.mockResolvedValueOnce({ coords: { latitude: 40.7128, longitude: -74.006 } });
    const r = await mountProbe();
    expect(seen).toEqual({ status: 'ready', coords: PARK_STREET, source: 'fallback', reason: 'You’re outside the Boston area' });
    act(() => r.unmount());
  });
});
