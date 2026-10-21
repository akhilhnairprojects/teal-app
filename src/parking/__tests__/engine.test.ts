import type { BikeStation } from '@/data/bluebikes';
import { bikeMinutes, walkMinutesDetour, type LatLng } from '@/lib/geo';
import type { Place } from '@/planner/types';

import { dockRisk, evaluateParking, fullnessPenalty, rankDocks, rankDocksAt, rerouteText, travelMinutes } from '../engine';
import { PARKING, type ParkingState } from '../types';

const NOW = Date.UTC(2026, 9, 20, 15, 0, 0);
const DEST: LatLng = { latitude: 42.3601, longitude: -71.0589 };

/** A point `north`/`east` metres from DEST. */
function at(north: number, east = 0): LatLng {
  return {
    latitude: DEST.latitude + north / 111_320,
    longitude: DEST.longitude + east / (111_320 * Math.cos((DEST.latitude * Math.PI) / 180)),
  };
}

function dock(id: string, p: LatLng, o: { docks?: number; returning?: boolean; reportedAt?: number } = {}): BikeStation {
  return {
    id,
    name: `Dock ${id}`,
    location: p,
    distanceMeters: 0,
    capacity: 15,
    classicBikes: 4,
    ebikes: 1,
    openDocks: o.docks ?? 8,
    isRenting: true,
    isReturning: o.returning ?? true,
    rentalUrl: null,
    reportedAt: o.reportedAt ?? NOW - 30_000,
  };
}

const PLACE: Place = { name: 'Destination', latLng: DEST, source: 'map' };

function navigating(over: Partial<ParkingState> = {}): ParkingState {
  return {
    phase: 'navigating',
    destination: PLACE,
    target: null,
    backup: null,
    candidates: [],
    radiusM: PARKING.searchRadiusM,
    lastCheckAt: NOW,
    lastSwitchAt: null,
    error: null,
    ...over,
  };
}

/** Evaluate once with no target to pick the initial one. */
function first(stations: BikeStation[], here: LatLng | null = null, now = NOW) {
  return evaluateParking(navigating({ lastCheckAt: now }), { stations, here, now });
}

describe('rankDocks', () => {
  it('scores ride + walk + fullness + staleness and sorts by score', () => {
    const here = at(-2000);
    const [a] = rankDocksAt([dock('a', at(100), { docks: 2 })], here, DEST, 600, NOW);
    const expected = bikeMinutes(a.rideM) + walkMinutesDetour(100, 1.3) + 2;
    expect(a.scoreMin).toBeCloseTo(expected, 1);
    expect(a.risk).toBe('low');
  });

  it('prefers a 2-dock station 100 m away over a 6-dock station 500 m away when its score is lower', () => {
    const near = dock('near', at(100), { docks: 2 });
    const far = dock('far', at(500), { docks: 6 });
    const ranked = rankDocksAt([far, near], null, DEST, 600, NOW);
    expect(ranked.map((c) => c.station.id)).toEqual(['near', 'far']);
    expect(ranked[0].scoreMin).toBeLessThan(ranked[1].scoreMin);
  });

  it('prefers the roomier dock when the fullness penalty outweighs the shorter walk', () => {
    const tight = dock('tight', at(300), { docks: 2 }); // walk 4.9 + 2
    const roomy = dock('roomy', at(330), { docks: 6 }); // walk 5.4 + 0
    const ranked = rankDocksAt([tight, roomy], null, DEST, 600, NOW);
    expect(ranked.map((c) => c.station.id)).toEqual(['roomy', 'tight']);
  });

  it('accounts for the ride from the rider: a nearer dock to the rider can win', () => {
    const here = at(-1500);
    const behind = dock('behind', at(-300)); // on the way, 300 m short of the destination
    const beyond = dock('beyond', at(250)); // closer to the destination but past it
    const ranked = rankDocksAt([beyond, behind], here, DEST, 600, NOW);
    expect(ranked[0].station.id).toBe('behind');
  });

  it('skips full, closed and out-of-radius stations', () => {
    const ranked = rankDocksAt(
      [dock('full', at(50), { docks: 0 }), dock('closed', at(60), { returning: false }), dock('far', at(900)), dock('ok', at(200))],
      null,
      DEST,
      600,
      NOW,
    );
    expect(ranked.map((c) => c.station.id)).toEqual(['ok']);
  });

  it('adds 2 min when a station has not reported for over 10 minutes', () => {
    const fresh = rankDocksAt([dock('x', at(200))], null, DEST, 600, NOW)[0];
    const stale = rankDocksAt([dock('x', at(200), { reportedAt: NOW - 11 * 60_000 })], null, DEST, 600, NOW)[0];
    expect(stale.scoreMin - fresh.scoreMin).toBeCloseTo(2, 6);
    const ranked = rankDocksAt([dock('stale', at(150), { reportedAt: NOW - 11 * 60_000 }), dock('fresh', at(200))], null, DEST, 600, NOW);
    expect(ranked[0].station.id).toBe('fresh');
  });

  it('without a location ranks by distance to the destination only', () => {
    const ranked = rankDocksAt([dock('b', at(400)), dock('a', at(-150))], null, DEST, 600, NOW);
    expect(ranked.map((c) => [c.station.id, c.rideM])).toEqual([
      ['a', 0],
      ['b', 0],
    ]);
  });

  it('rankDocks uses the current clock for staleness', () => {
    jest.useFakeTimers({ now: NOW });
    try {
      const s = [dock('x', at(200), { reportedAt: NOW - 11 * 60_000 })];
      expect(rankDocks(s, null, DEST, 600)).toEqual(rankDocksAt(s, null, DEST, 600, NOW));
    } finally {
      jest.useRealTimers();
    }
  });

  it('fullness and risk tiers match', () => {
    expect([1, 2, 3, 4].map(fullnessPenalty)).toEqual([4, 2, 1, 0]);
    expect([1, 2, 3, 4].map(dockRisk)).toEqual(['critical', 'low', 'low', 'ok']);
  });
});

describe('evaluateParking', () => {
  it('picks the best dock as target and the next as backup', () => {
    const r = first([dock('a', at(100)), dock('b', at(300))]);
    expect(r.state.target?.station.id).toBe('a');
    expect(r.state.backup?.station.id).toBe('b');
    expect(r.event).toEqual({ kind: 'none' });
    expect(r.state.radiusM).toBe(600);
  });

  it('widens to 1200 m when nothing within 600 m can take a bike', () => {
    const r = first([dock('full', at(100), { docks: 0 }), dock('wide', at(900))]);
    expect(r.state.radiusM).toBe(PARKING.widenRadiusM);
    expect(r.state.target?.station.id).toBe('wide');
  });

  it('reports noDocks when nothing within 1200 m can take a bike', () => {
    const r = first([dock('full', at(100), { docks: 0 }), dock('far', at(1500))]);
    expect(r.event).toEqual({ kind: 'noDocks' });
    expect(r.state.target).toBeNull();
  });

  it('re-routes to the backup at once when the target fills', () => {
    const s0 = first([dock('a', at(100)), dock('b', at(300))]).state;
    const r = evaluateParking(s0, { stations: [dock('a', at(100), { docks: 0 }), dock('b', at(300))], here: null, now: NOW + 45_000 });
    expect(r.event).toMatchObject({ kind: 'rerouted', reason: 'targetFull', from: { station: { id: 'a' } }, to: { station: { id: 'b' } } });
    expect(r.state.target?.station.id).toBe('b');
    expect(r.state.lastSwitchAt).toBe(NOW + 45_000);
  });

  it('re-routes even inside the cooldown when the target stops accepting bikes', () => {
    const s0 = { ...first([dock('a', at(100)), dock('b', at(300))]).state, lastSwitchAt: NOW };
    const r = evaluateParking(s0, { stations: [dock('a', at(100), { returning: false }), dock('b', at(300))], here: null, now: NOW + 10_000 });
    expect(r.event).toMatchObject({ kind: 'rerouted', reason: 'targetClosed' });
  });

  it('reports noDocks when the target fills and there is no other dock', () => {
    const s0 = first([dock('a', at(100))]).state;
    const r = evaluateParking(s0, { stations: [dock('a', at(100), { docks: 0 })], here: null, now: NOW + 45_000 });
    expect(r.event).toEqual({ kind: 'noDocks' });
    expect(r.state.target).toBeNull();
  });

  describe('hysteresis', () => {
    // Target "a" 400 m out (walk 6.5 min); "b" appears 100 m out (walk 1.6 min): a 4.9 min gain.
    const a = dock('a', at(400));
    const b = dock('b', at(100));
    const start = () => ({ ...first([a]).state, lastSwitchAt: NOW });

    it('does not switch within 2 min of the last switch', () => {
      const r = evaluateParking(start(), { stations: [a, b], here: null, now: NOW + 60_000 });
      expect(r.event).toEqual({ kind: 'none' });
      expect(r.state.target?.station.id).toBe('a');
      expect(r.state.backup?.station.id).toBe('b');
    });

    it('switches to a better dock after the cooldown when it gains at least 3 min', () => {
      const r = evaluateParking(start(), { stations: [a, b], here: null, now: NOW + PARKING.switchCooldownMs });
      expect(r.event).toMatchObject({ kind: 'rerouted', reason: 'better', to: { station: { id: 'b' } } });
      expect(r.state.lastSwitchAt).toBe(NOW + PARKING.switchCooldownMs);
    });

    it('never switches for a gain under 3 min', () => {
      const c = dock('c', at(250)); // walk 4.1 min: 2.4 min better than a
      const r = evaluateParking({ ...first([a]).state }, { stations: [a, c], here: null, now: NOW + 10 * 60_000 });
      expect(r.event.kind).toBe('none');
      expect(r.state.target?.station.id).toBe('a');
    });

    it('does not flap back and forth', () => {
      let s = first([a]).state;
      const events: string[] = [];
      for (let k = 1; k <= 10; k++) {
        // b alternates between 2 docks (penalty +2 → gain 2.9) and 4 docks (gain 4.9).
        const stations = [a, dock('b', at(100), { docks: k % 2 ? 4 : 2 })];
        const r = evaluateParking(s, { stations, here: null, now: NOW + k * 45_000 });
        s = r.state;
        events.push(r.event.kind === 'rerouted' ? `${r.event.from.station.id}>${r.event.to.station.id}` : r.event.kind);
      }
      expect(events.filter((e) => e.includes('>'))).toEqual(['a>b']);
    });
  });

  it('fires lowDocks once when the target drops to 1 dock', () => {
    const s0 = first([dock('a', at(100), { docks: 5 })]).state;
    const r1 = evaluateParking(s0, { stations: [dock('a', at(100), { docks: 1 })], here: null, now: NOW + 45_000 });
    expect(r1.event).toMatchObject({ kind: 'lowDocks', dock: { station: { id: 'a' } } });
    const r2 = evaluateParking(r1.state, { stations: [dock('a', at(100), { docks: 1 })], here: null, now: NOW + 90_000 });
    expect(r2.event.kind).toBe('none');
  });

  it('arrives within 35 m of the target and then stays put', () => {
    const stations = [dock('a', at(100)), dock('b', at(300))];
    const s0 = first(stations, at(-1000)).state;
    const r1 = evaluateParking(s0, { stations, here: at(150), now: NOW + 5_000 });
    expect(r1.event.kind).toBe('none');
    const r2 = evaluateParking(r1.state, { stations, here: at(80), now: NOW + 10_000 });
    expect(r2.event).toMatchObject({ kind: 'arrived', dock: { station: { id: 'a' } } });
    expect(r2.state.phase).toBe('arrived');
    const r3 = evaluateParking(r2.state, { stations: [dock('a', at(100), { docks: 0 })], here: at(80), now: NOW + 20_000 });
    expect(r3).toEqual({ state: r2.state, event: { kind: 'none' } });
  });

  it('re-routes rather than arriving when the dock the rider reached is full', () => {
    const s0 = first([dock('a', at(100)), dock('b', at(300))]).state;
    const r = evaluateParking(s0, { stations: [dock('a', at(100), { docks: 0 }), dock('b', at(300))], here: at(100), now: NOW + 5_000 });
    expect(r.event).toMatchObject({ kind: 'rerouted', reason: 'targetFull' });
  });

  it('a rider already at the destination is sent to the nearest open dock', () => {
    const r = first([dock('a', at(20)), dock('b', at(300))], DEST);
    expect(r.event).toMatchObject({ kind: 'arrived', dock: { station: { id: 'a' } } });
  });

  it('reports stale data when the last successful check is over 10 minutes old', () => {
    const s0 = first([dock('a', at(100))]).state;
    const r = evaluateParking({ ...s0, lastCheckAt: NOW }, { stations: [dock('a', at(100))], here: null, now: NOW + 11 * 60_000 });
    expect(r.event).toEqual({ kind: 'staleData', ageMs: 11 * 60_000 });
  });

  it('does nothing without a destination or after the session ended', () => {
    const s = { ...navigating(), destination: null };
    expect(evaluateParking(s, { stations: [dock('a', at(100))], here: null, now: NOW }).event).toEqual({ kind: 'none' });
    const ended = { ...navigating(), phase: 'ended' as const };
    expect(evaluateParking(ended, { stations: [dock('a', at(100))], here: null, now: NOW }).state).toBe(ended);
  });
});

describe('rerouteText', () => {
  it('states the extra minutes', () => {
    const s0 = first([dock('a', at(100)), dock('b', at(300))]).state;
    const r = evaluateParking(s0, { stations: [dock('a', at(100), { docks: 0 }), dock('b', at(300))], here: null, now: NOW });
    if (r.event.kind !== 'rerouted') throw new Error('expected a reroute');
    const delta = Math.round(travelMinutes(r.event.to, null) - travelMinutes(r.event.from, null));
    expect(delta).toBe(3);
    expect(rerouteText(r.event, null)).toBe('Dock full. Now heading to Dock b, +3 min');
  });
});
