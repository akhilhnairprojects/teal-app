import {
  backToMyLocation,
  getNearbyPosition,
  getRecenterSeq,
  MIN_PAN_METERS,
  noteMapTouchMove,
  noteProgrammaticMove,
  onMapRegionSettled,
  resetMapCenter,
  setUserLocation,
} from '../mapCenter';

const ME = { latitude: 42.3564, longitude: -71.0624 };
// ~1.1 km north of ME.
const PANNED = { latitude: 42.3664, longitude: -71.0624 };

beforeEach(() => {
  resetMapCenter();
  setUserLocation({ status: 'ready', coords: ME, source: 'device' });
});

describe('mapCenter', () => {
  it('starts locating, then follows the device location', () => {
    resetMapCenter();
    expect(getNearbyPosition()).toEqual({ status: 'locating' });
    setUserLocation({ status: 'ready', coords: ME, source: 'fallback', reason: 'Location permission is off' });
    expect(getNearbyPosition()).toEqual({ status: 'ready', position: ME, source: 'fallback', reason: 'Location permission is off' });
  });

  it('ignores programmatic camera moves', () => {
    onMapRegionSettled(PANNED);
    expect(getNearbyPosition()).toMatchObject({ source: 'device', position: ME });

    noteMapTouchMove();
    noteProgrammaticMove(); // the app animated the camera after the touch
    onMapRegionSettled(PANNED);
    expect(getNearbyPosition()).toMatchObject({ source: 'device' });
  });

  it('switches to the map center after a user pan', () => {
    noteMapTouchMove();
    onMapRegionSettled(PANNED);
    expect(getNearbyPosition()).toEqual({ status: 'ready', position: PANNED, source: 'map' });

    // The gesture flag is consumed: a later programmatic settle doesn't move it again.
    onMapRegionSettled(ME);
    expect(getNearbyPosition()).toMatchObject({ source: 'map', position: PANNED });
  });

  it('honors the provider gesture flag when present', () => {
    onMapRegionSettled(PANNED, true);
    expect(getNearbyPosition()).toMatchObject({ source: 'map' });
    backToMyLocation();
    noteMapTouchMove();
    onMapRegionSettled(PANNED, false);
    expect(getNearbyPosition()).toMatchObject({ source: 'device' });
  });

  it('ignores pans shorter than the jitter threshold', () => {
    noteMapTouchMove();
    const tiny = { latitude: ME.latitude + (MIN_PAN_METERS / 2) / 111_000, longitude: ME.longitude };
    onMapRegionSettled(tiny);
    expect(getNearbyPosition()).toMatchObject({ source: 'device' });
  });

  it('"Back to my location" resets the source and requests a re-center', () => {
    noteMapTouchMove();
    onMapRegionSettled(PANNED);
    const seq = getRecenterSeq();
    backToMyLocation();
    expect(getNearbyPosition()).toMatchObject({ source: 'device', position: ME });
    expect(getRecenterSeq()).toBe(seq + 1);
  });

  it('keeps the map center when a new device fix arrives', () => {
    noteMapTouchMove();
    onMapRegionSettled(PANNED);
    setUserLocation({ status: 'ready', coords: { latitude: 42.35, longitude: -71.06 }, source: 'device' });
    expect(getNearbyPosition()).toMatchObject({ source: 'map', position: PANNED });
  });
});
