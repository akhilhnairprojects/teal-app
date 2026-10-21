import * as Location from 'expo-location';

import { buildNetwork } from '@/planner/__fixtures__/network';

import { nominatimUrl, parseNominatim, resetFallbackGeocoders, searchNominatim } from '../fallback';
import { resolveTypedPlace, stationPlaces, withoutStationDuplicates } from '../index';
import { parsePhoton, photonUrl, resetPhotonCache, searchPhoton } from '../photon';

jest.mock('expo-location', () => ({ geocodeAsync: jest.fn() }));

const feature = (name: string | undefined, lon: number, lat: number, extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { name, osm_key: 'leisure', osm_value: 'stadium', city: 'Boston', ...extra },
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const realFetch = globalThis.fetch;

beforeEach(() => {
  resetPhotonCache();
  resetFallbackGeocoders();
  (Location.geocodeAsync as jest.Mock).mockReset();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('photon', () => {
  it('builds a bounded, biased typeahead query', () => {
    const url = photonUrl('fenway park', { latitude: 42.3555, longitude: -71.0605 });
    expect(url).toBe('https://photon.komoot.io/api/?q=fenway%20park&limit=5&lang=en&bbox=-71.3,42.2,-70.85,42.5&lat=42.3555&lon=-71.0605');
    expect(photonUrl('x')).not.toContain('lat=');
  });

  it('parses GeoJSON features inside the Boston box', () => {
    const places = parsePhoton({
      type: 'FeatureCollection',
      features: [
        feature('Fenway Park', -71.0971, 42.3465, { street: 'Jersey Street', housenumber: '4', district: 'Fenway' }),
        feature('Fenway Park', -71.0971, 42.3465),
        feature(undefined, -71.06, 42.35, { street: 'Tremont Street', housenumber: '120' }),
        feature('Far away', -73.9, 40.7),
        { geometry: { coordinates: ['bad'] } },
      ],
    });
    expect(places).toEqual([
      { name: 'Fenway Park', latLng: { latitude: 42.3465, longitude: -71.0971 }, source: 'photon', subtitle: '4 Jersey Street, Fenway, Boston' },
      { name: '120 Tremont Street', latLng: { latitude: 42.35, longitude: -71.06 }, source: 'photon', subtitle: 'Boston' },
    ]);
  });

  it('needs 3 characters and caches by query', async () => {
    const fetchMock = jest.fn(async () => ok({ features: [feature('Fenway Park', -71.0971, 42.3465)] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await searchPhoton('fe')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    await searchPhoton('fenway', { bias: { latitude: 42.3555, longitude: -71.0605 } });
    await searchPhoton('fenway', { bias: { latitude: 42.3561, longitude: -71.0611 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('nominatim (web submit fallback)', () => {
  it('builds one bounded jsonv2 search', () => {
    expect(nominatimUrl('Fenway Park')).toBe(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&countrycodes=us&viewbox=-71.3,42.5,-70.85,42.2&q=Fenway%20Park',
    );
  });

  it('parses the first result', () => {
    expect(parseNominatim([{ lat: '42.3465', lon: '-71.0971', name: 'Fenway Park', display_name: 'Fenway Park, 4, Jersey Street, Boston' }], 'fenway')).toEqual({
      name: 'Fenway Park',
      latLng: { latitude: 42.3465, longitude: -71.0971 },
      source: 'nominatim',
      subtitle: '4, Jersey Street',
    });
    expect(parseNominatim([], 'x')).toBeNull();
    expect(parseNominatim({}, 'x')).toBeNull();
  });

  it('spaces requests at least 1 s apart and caches', async () => {
    jest.useFakeTimers();
    try {
      let clock = 1_000_000;
      const fetchMock = jest.fn(async () => ok([{ lat: '42.35', lon: '-71.06', name: 'A' }]));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      await searchNominatim('first', { now: () => clock });
      const second = searchNominatim('second', { now: () => clock });
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      clock += 1000;
      await jest.advanceTimersByTimeAsync(1000);
      await second;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await searchNominatim('first', { now: () => clock });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('destination resolution', () => {
  it('matches MBTA stations first, with their routes as subtitle', () => {
    const g = buildNetwork().global;
    const [park] = stationPlaces(g, 'park');
    expect(park).toMatchObject({ name: 'Park Street', source: 'station', stopId: 'place-pktrm' });
    expect(park.subtitle).toContain('Red Line');
    expect(stationPlaces(null, 'park')).toEqual([]);
  });

  it('drops Photon results that duplicate a station', () => {
    const g = buildNetwork().global;
    const stations = stationPlaces(g, 'harvard');
    const remote = [
      { name: 'Harvard Station', latLng: { latitude: 42.3735, longitude: -71.119 }, source: 'photon' as const },
      { name: 'Harvard Stadium', latLng: { latitude: 42.3667, longitude: -71.1253 }, source: 'photon' as const },
    ];
    expect(withoutStationDuplicates(stations, remote).map((p) => p.name)).toEqual(['Harvard Stadium']);
  });

  it('on submit: station, then Photon, then the device geocoder when Photon is down', async () => {
    const g = buildNetwork().global;
    expect(await resolveTypedPlace('kenmore', g)).toMatchObject({ stopId: 'place-kencl' });

    globalThis.fetch = jest.fn(async () => ok({ features: [feature('Fenway Park', -71.0971, 42.3465)] })) as unknown as typeof fetch;
    expect(await resolveTypedPlace('fenway park', g)).toMatchObject({ name: 'Fenway Park', source: 'photon' });

    globalThis.fetch = jest.fn(async () => {
      throw new Error('photon down');
    }) as unknown as typeof fetch;
    (Location.geocodeAsync as jest.Mock).mockResolvedValue([
      { latitude: 40.7, longitude: -74 },
      { latitude: 42.3601, longitude: -71.0549 },
    ]);
    expect(await resolveTypedPlace('1 city hall square', g)).toEqual({
      name: '1 city hall square',
      latLng: { latitude: 42.3601, longitude: -71.0549 },
      source: 'apple',
    });

    (Location.geocodeAsync as jest.Mock).mockRejectedValue(new Error('nope'));
    expect(await resolveTypedPlace('nowhere at all', g)).toBeNull();
  });
});
