import AsyncStorage from '@react-native-async-storage/async-storage';

import { bikeAdvisory, fetchWeather, NWS_CONTACT, parseHourly, parsePoints, parseWindMph, resetWeatherCache, summarizeWeather, type HourlyPeriod } from '../nws';

const NOW = Date.parse('2026-10-19T12:10:00-04:00');

/** The observed `forecastHourly` period shape (2026-10-19, Boston). */
const hourly = (periods: { start: string; pop: number | null; temp: number; wind: string; short: string }[]) => ({
  type: 'Feature',
  properties: {
    units: 'us',
    periods: periods.map((p, i) => ({
      number: i + 1,
      name: '',
      startTime: p.start,
      endTime: p.start.replace(/T(\d\d)/, (_, h) => `T${String(Number(h) + 1).padStart(2, '0')}`),
      isDaytime: true,
      temperature: p.temp,
      temperatureUnit: 'F',
      temperatureTrend: '',
      probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: p.pop },
      windSpeed: p.wind,
      windDirection: 'NW',
      icon: 'https://api.weather.gov/icons/land/day/few?size=small',
      shortForecast: p.short,
      detailedForecast: '',
    })),
  },
});

const period = (o: Partial<HourlyPeriod>): HourlyPeriod => ({
  startTime: NOW,
  endTime: NOW + 3_600_000,
  temperatureF: 60,
  shortForecast: 'Sunny',
  precipProbability: 0,
  windMph: 5,
  ...o,
});

describe('NWS parsing', () => {
  it('reads forecastHourly from /points', () => {
    expect(parsePoints({ properties: { forecastHourly: 'https://api.weather.gov/gridpoints/BOX/71,90/forecast/hourly' } })).toBe(
      'https://api.weather.gov/gridpoints/BOX/71,90/forecast/hourly',
    );
    expect(parsePoints({ properties: {} })).toBeNull();
    expect(parsePoints(null)).toBeNull();
  });

  it('parses the observed period shape (windSpeed "1 mph", probabilityOfPrecipitation.value)', () => {
    const [p] = parseHourly(hourly([{ start: '2026-10-19T12:00:00-04:00', pop: 3, temp: 58, wind: '1 mph', short: 'Mostly Sunny' }]));
    expect(p).toEqual({
      startTime: Date.parse('2026-10-19T12:00:00-04:00'),
      endTime: Date.parse('2026-10-19T13:00:00-04:00'),
      temperatureF: 58,
      shortForecast: 'Mostly Sunny',
      precipProbability: 3,
      windMph: 1,
    });
    expect(parseHourly({ properties: { periods: [{ startTime: 'nope' }] } })).toEqual([]);
  });

  it('parses wind ranges, km/h and Celsius values', () => {
    expect(parseWindMph('5 to 10 mph')).toBe(10);
    expect(parseWindMph('32 km/h')).toBe(20);
    expect(parseWindMph(null)).toBeNull();
    const [p] = parseHourly({
      properties: { periods: [{ startTime: '2026-10-19T12:00:00-04:00', endTime: '2026-10-19T13:00:00-04:00', temperature: { value: 10, unitCode: 'wmoUnit:degC' } }] },
    });
    expect(p.temperatureF).toBe(50);
    expect(p.precipProbability).toBeNull();
  });
});

describe('bike advisory', () => {
  it('avoid at ≥ 60% precipitation or thunder / snow / sleet / freezing / ice', () => {
    expect(bikeAdvisory([period({ precipProbability: 70, shortForecast: 'Rain' })])).toEqual({ advisory: 'avoid', reason: '70% chance of precipitation' });
    expect(bikeAdvisory([period({ shortForecast: 'Chance Snow Showers', precipProbability: 20 })]).advisory).toBe('avoid');
    expect(bikeAdvisory([period({}), period({ shortForecast: 'Slight Chance Thunderstorms' })]).advisory).toBe('avoid');
  });

  it('caution for 30% precipitation, rain words, wind ≥ 20 mph, ≤ 28°F or ≥ 92°F', () => {
    expect(bikeAdvisory([period({ precipProbability: 30 })]).advisory).toBe('caution');
    expect(bikeAdvisory([period({ shortForecast: 'Patchy Drizzle', precipProbability: 10 })])).toEqual({ advisory: 'caution', reason: 'Patchy Drizzle' });
    expect(bikeAdvisory([period({ windMph: 22 })])).toEqual({ advisory: 'caution', reason: 'Windy (22 mph)' });
    expect(bikeAdvisory([period({ temperatureF: 25 })])).toEqual({ advisory: 'caution', reason: 'Cold (25°F)' });
    expect(bikeAdvisory([period({ temperatureF: 95 })]).advisory).toBe('caution');
    expect(bikeAdvisory([period({})])).toEqual({ advisory: 'ok', reason: null });
  });

  it('summarizes the first two periods that have not ended', () => {
    const periods = [
      period({ startTime: NOW - 2 * 3_600_000, endTime: NOW - 3_600_000, precipProbability: 90, shortForecast: 'Rain' }),
      period({ precipProbability: 10, temperatureF: 61, windMph: 3 }),
      period({ startTime: NOW + 3_600_000, endTime: NOW + 7_200_000, precipProbability: 40, windMph: 9 }),
      period({ startTime: NOW + 7_200_000, endTime: NOW + 10_800_000, precipProbability: 100, shortForecast: 'Heavy Rain' }),
    ];
    expect(summarizeWeather(periods, NOW)).toEqual({
      fetchedAt: NOW,
      temperatureF: 61,
      shortForecast: 'Sunny',
      precipProbability: 40,
      windMph: 9,
      bikeAdvisory: 'caution',
      reason: '40% chance of precipitation',
    });
    expect(summarizeWeather([], NOW)).toBeNull();
  });
});

describe('fetchWeather', () => {
  const realFetch = globalThis.fetch;
  beforeEach(async () => {
    resetWeatherCache();
    await AsyncStorage.clear();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

  it('follows /points to the hourly forecast, identifies itself with the project URL, and caches', async () => {
    const hourlyUrl = 'https://api.weather.gov/gridpoints/BOX/71,90/forecast/hourly';
    const fetchMock = jest.fn(async (url: string) =>
      url.includes('/points/')
        ? ok({ properties: { forecastHourly: hourlyUrl } })
        : ok(hourly([{ start: '2026-10-19T12:00:00-04:00', pop: 70, temp: 55, wind: '12 mph', short: 'Rain' }])),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const w = await fetchWeather({ latitude: 42.35639, longitude: -71.0624 }, { now: NOW });
    expect(w).toMatchObject({ bikeAdvisory: 'avoid', precipProbability: 70, temperatureF: 55, windMph: 12 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.weather.gov/points/42.356,-71.062');
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['User-Agent']).toContain(NWS_CONTACT);
    expect(headers['User-Agent']).not.toMatch(/@/);

    await fetchWeather({ latitude: 42.35639, longitude: -71.0624 }, { now: NOW + 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when NWS fails', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    await expect(fetchWeather({ latitude: 42.35, longitude: -71.06 }, { now: NOW })).resolves.toBeNull();
    globalThis.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(fetchWeather({ latitude: 42.36, longitude: -71.06 }, { now: NOW })).resolves.toBeNull();
  });
});
