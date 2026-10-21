// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/RouteCardDataTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Results are compared through plain snapshots (ids, directions, flags) instead of Kotlin's
// data-class equality; ordering is asserted exactly.
import type { Route, Stop } from '@/mbta/model/types';
import { createBuilder, type Builder } from '@/mbta/testing/builders';
import { easternInstant } from '@/mbta/time/eastern';
import { rsdKey } from '@/state/rsd';

import { alertsDownstreamForPatterns } from '../alerts';
import { directionFor, type Direction } from '../direction';
import {
  routeCardsForStaticStopList,
  routeCardsForStopList,
  RouteCardListBuilder,
  type RouteCard,
  type RouteCardContext,
  type RouteCardInput,
} from '../routeCardData';

const MIN = 60_000;
const SEC = 1000;
const HOUR = 60 * MIN;

type LeafExpect = {
  dir: number;
  direction: Direction;
  routePatternIds: string[];
  stopIds: string[];
  upcomingTripIds?: string[];
  alertIdsHere?: string[];
  alertIdsDownstream?: string[];
  allDataLoaded: boolean;
  hasSchedulesToday?: boolean;
  subwayServiceStartTime?: number | null;
  context: RouteCardContext;
};

function summarize(cards: RouteCard[] | null) {
  if (!cards) return null;
  return cards.map((c) => ({
    id: c.id,
    stops: c.stops.map((s) => ({
      stopId: s.stop.id,
      leaves: s.leaves.map((l) => ({
        dir: l.direction.id,
        direction: l.direction,
        routePatternIds: l.routePatterns.map((p) => p.id),
        stopIds: [...l.stopIds].sort(),
        upcomingTripIds: l.upcomingTrips.map((t) => t.id),
        alertIdsHere: l.alertsHere.map((a) => a.id),
        alertIdsDownstream: l.alertsDownstream.map((a) => a.id),
        allDataLoaded: l.allDataLoaded,
        hasSchedulesToday: l.hasSchedulesToday,
        subwayServiceStartTime: l.subwayServiceStartTime,
        context: l.context,
      })),
    })),
  }));
}

const leafExpect = (l: LeafExpect) => ({
  upcomingTripIds: [],
  alertIdsHere: [],
  alertIdsDownstream: [],
  hasSchedulesToday: false,
  subwayServiceStartTime: null,
  ...l,
  stopIds: [...l.stopIds].sort(),
});

/** Expected snapshot of one ListBuilder leaf (Kotlin LeafBuilder defaults). */
const builderLeaf = (o: {
  dir: number;
  direction: Direction;
  routePatternIds: string[];
  notSeen?: string[];
  stopIds: string[];
  upcomingTripIds?: string[] | null;
  alertIdsHere?: string[];
  alertIdsDownstream?: string[];
  allDataLoaded: boolean;
  hasSchedulesTodayByPattern?: Record<string, boolean> | null;
  subwayServiceStartTime?: number | null;
  context: RouteCardContext;
}) => ({
  dir: o.dir,
  direction: o.direction,
  routePatternIds: o.routePatternIds,
  patternsNotSeenAtEarlierStops: [...(o.notSeen ?? o.routePatternIds)].sort(),
  stopIds: [...o.stopIds].sort(),
  upcomingTripIds: o.upcomingTripIds ?? null,
  alertIdsHere: o.alertIdsHere ?? [],
  alertIdsDownstream: o.alertIdsDownstream ?? [],
  allDataLoaded: o.allDataLoaded,
  hasSchedulesTodayByPattern: o.hasSchedulesTodayByPattern ?? null,
  subwayServiceStartTime: o.subwayServiceStartTime ?? null,
  context: o.context,
});

const allStopIds = (b: Builder) => Object.keys(b.objects.stops);
const input = (b: Builder, o: Partial<RouteCardInput> & Pick<RouteCardInput, 'stopIds' | 'now' | 'context'>): RouteCardInput => ({
  global: b.global(),
  sortByDistanceFrom: null,
  schedules: null,
  predictions: b.liveDepartures(),
  alerts: Object.values(b.objects.alerts),
  ...o,
});
const posOf = (s: Stop) => ({ latitude: s.latitude, longitude: s.longitude });
const routeIdsOf = (cards: RouteCard[] | null) => (cards ?? []).flatMap((c) => (c.lineOrRoute.kind === 'line' ? c.lineOrRoute.routes : [c.lineOrRoute.route]).map((r) => r.id));

describe('ListBuilder.addStaticStopsData', () => {
  const now = easternInstant(2026, 3, 1, 12, 0);

  it('when there are no new patterns for a stop then it is omitted', () => {
    const b = createBuilder();
    const stop1 = b.stop();
    const stop2 = b.stop();
    const route1 = b.route();
    const rp1 = b.pattern(route1, { representativeTrip: { headsign: 'Harvard', directionId: 0 } });
    const g = b.global({ patternIdsByStop: { [stop1.id]: [rp1.id], [stop2.id]: [rp1.id] } });
    expect(new RouteCardListBuilder(false, 'nearby', now).addStaticStopsData(allStopIds(b), g, null).snapshot()).toEqual([
      {
        id: route1.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [builderLeaf({ dir: 0, direction: directionFor(0, route1), routePatternIds: [rp1.id], stopIds: [stop1.id], allDataLoaded: false, context: 'nearby' })],
          },
        ],
      },
    ]);
  });

  it('when second stop serves a new rp for route served by previous stop then include all rps at second stop', () => {
    const b = createBuilder();
    const stop1 = b.stop();
    const stop2 = b.stop();
    const route1 = b.route();
    const rp1 = b.pattern(route1, { representativeTrip: { headsign: 'Harvard' } });
    const rp2 = b.pattern(route1, { representativeTrip: { headsign: 'Nubian' } });
    const g = b.global({ patternIdsByStop: { [stop1.id]: [rp1.id], [stop2.id]: [rp1.id, rp2.id] } });
    expect(new RouteCardListBuilder(true, 'nearby', now).addStaticStopsData(allStopIds(b), g, null).snapshot()).toEqual([
      {
        id: route1.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [builderLeaf({ dir: 0, direction: directionFor(0, route1), routePatternIds: [rp1.id], stopIds: [stop1.id], allDataLoaded: true, context: 'nearby' })],
          },
          {
            stopId: stop2.id,
            leaves: [
              builderLeaf({
                dir: 0,
                direction: directionFor(0, route1),
                routePatternIds: [rp1.id, rp2.id],
                notSeen: [rp2.id],
                stopIds: [stop2.id],
                allDataLoaded: true,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('groups patterns by direction', () => {
    const b = createBuilder();
    const stop1 = b.stop();
    const route1 = b.route();
    const rp1 = b.pattern(route1, { directionId: 0, representativeTrip: { headsign: 'Harvard' } });
    const rp2 = b.pattern(route1, { directionId: 0, representativeTrip: { headsign: 'Harvard v2' } });
    const rp3 = b.pattern(route1, { directionId: 1, representativeTrip: { headsign: 'Nubian' } });
    const g = b.global({ patternIdsByStop: { [stop1.id]: [rp1.id, rp2.id, rp3.id] } });
    expect(new RouteCardListBuilder(false, 'nearby', now).addStaticStopsData(allStopIds(b), g, null).snapshot()).toEqual([
      {
        id: route1.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [
              builderLeaf({ dir: 0, direction: directionFor(0, route1), routePatternIds: [rp1.id, rp2.id], stopIds: [stop1.id], allDataLoaded: false, context: 'nearby' }),
              builderLeaf({ dir: 1, direction: directionFor(1, route1), routePatternIds: [rp3.id], stopIds: [stop1.id], allDataLoaded: false, context: 'nearby' }),
            ],
          },
        ],
      },
    ]);
  });

  const favoritesSetup = () => {
    const b = createBuilder();
    const [stop1, stop2, stop3] = [b.stop(), b.stop(), b.stop()];
    const route1 = b.route();
    const route2 = b.route();
    const r1 = [
      b.pattern(route1, { directionId: 0, representativeTrip: { headsign: 'Harvard' } }),
      b.pattern(route1, { directionId: 0, representativeTrip: { headsign: 'Harvard v2' } }),
      b.pattern(route1, { directionId: 1, representativeTrip: { headsign: 'Nubian' } }),
    ];
    const r2 = [
      b.pattern(route2, { directionId: 0, representativeTrip: { headsign: 'Harvard' } }),
      b.pattern(route2, { directionId: 0, representativeTrip: { headsign: 'Harvard v2' } }),
      b.pattern(route2, { directionId: 1, representativeTrip: { headsign: 'Alewife' } }),
    ];
    const g = b.global({
      patternIdsByStop: {
        [stop1.id]: [...r1, ...r2].map((p) => p.id),
        [stop2.id]: r2.map((p) => p.id),
        [stop3.id]: r1.map((p) => p.id),
      },
    });
    const favorites = new Set([rsdKey({ routeId: route1.id, stopId: stop3.id, directionId: 0 }), rsdKey({ routeId: route2.id, stopId: stop1.id, directionId: 1 })]);
    return { b, stop1, stop2, stop3, route1, route2, r1, r2, g, favorites };
  };

  it('filters for only favorites when context is favorites', () => {
    const { stop1, stop2, stop3, route1, route2, r1, r2, g, favorites } = favoritesSetup();
    expect(
      new RouteCardListBuilder(false, 'favorites', now).addStaticStopsData([stop1.id, stop2.id, stop3.id], g, null, favorites).snapshot(),
    ).toEqual([
      {
        id: route2.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [builderLeaf({ dir: 1, direction: directionFor(1, route2), routePatternIds: [r2[2].id], stopIds: [stop1.id], allDataLoaded: false, context: 'favorites' })],
          },
        ],
      },
      {
        id: route1.id,
        stops: [
          {
            stopId: stop3.id,
            leaves: [
              builderLeaf({ dir: 0, direction: directionFor(0, route1), routePatternIds: [r1[0].id, r1[1].id], stopIds: [stop3.id], allDataLoaded: false, context: 'favorites' }),
            ],
          },
        ],
      },
    ]);
  });

  it('does not filter for favorites when context is not favorites', () => {
    const { stop1, stop2, stop3, route1, route2, r1, r2, g, favorites } = favoritesSetup();
    const leaves = (route: Route, ps: typeof r1) => [
      builderLeaf({ dir: 0, direction: directionFor(0, route), routePatternIds: [ps[0].id, ps[1].id], stopIds: [stop1.id], allDataLoaded: false, context: 'nearby' }),
      builderLeaf({ dir: 1, direction: directionFor(1, route), routePatternIds: [ps[2].id], stopIds: [stop1.id], allDataLoaded: false, context: 'nearby' }),
    ];
    expect(
      new RouteCardListBuilder(false, 'nearby', now).addStaticStopsData([stop1.id, stop2.id, stop3.id], g, null, favorites).snapshot(),
    ).toEqual([
      { id: route1.id, stops: [{ stopId: stop1.id, leaves: leaves(route1, r1) }] },
      { id: route2.id, stops: [{ stopId: stop1.id, leaves: leaves(route2, r2) }] },
    ]);
  });

  it('when a stop is served by multiple routes it is included for each route', () => {
    const b = createBuilder();
    const stop1 = b.stop();
    const route1 = b.route();
    const route2 = b.route();
    const rp1 = b.pattern(route1, { representativeTrip: { headsign: 'Harvard' } });
    const rp2 = b.pattern(route2, { representativeTrip: { headsign: 'Kenmore' } });
    const g = b.global({ patternIdsByStop: { [stop1.id]: [rp1.id, rp2.id] } });
    expect(new RouteCardListBuilder(false, 'nearby', now).addStaticStopsData(allStopIds(b), g, null).snapshot()).toEqual(
      [
        [route1, rp1],
        [route2, rp2],
      ].map(([route, rp]) => ({
        id: route.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [builderLeaf({ dir: 0, direction: directionFor(0, route as Route), routePatternIds: [rp.id], stopIds: [stop1.id], allDataLoaded: false, context: 'nearby' })],
          },
        ],
      })),
    );
  });

  it('groups by parent station', () => {
    const b = createBuilder();
    const station1 = b.stop({ id: 'station_1' });
    const s1 = b.stop({ parentStationId: station1.id, id: 'stop_1' });
    const s2 = b.stop({ parentStationId: station1.id, id: 'stop_2' });
    const stop2 = b.stop();
    const route1 = b.route();
    const rp1 = b.pattern(route1, { sortOrder: 10, representativeTrip: { headsign: 'Harvard' } });
    const rp2 = b.pattern(route1, { sortOrder: 11, representativeTrip: { headsign: 'Nubian' } });
    const rp3 = b.pattern(route1, { sortOrder: 12, representativeTrip: { headsign: 'Nubian via Allston' } });
    const g = b.global({ patternIdsByStop: { [s1.id]: [rp1.id], [s2.id]: [rp2.id], [stop2.id]: [rp3.id] } });
    expect(new RouteCardListBuilder(false, 'nearby', now).addStaticStopsData(allStopIds(b), g, null).snapshot()).toEqual([
      {
        id: route1.id,
        stops: [
          {
            stopId: station1.id,
            leaves: [
              builderLeaf({
                dir: 0,
                direction: directionFor(0, route1),
                routePatternIds: [rp1.id, rp2.id],
                stopIds: [station1.id, s1.id, s2.id],
                allDataLoaded: false,
                context: 'nearby',
              }),
            ],
          },
          {
            stopId: stop2.id,
            leaves: [builderLeaf({ dir: 0, direction: directionFor(0, route1), routePatternIds: [rp3.id], stopIds: [stop2.id], allDataLoaded: false, context: 'nearby' })],
          },
        ],
      },
    ]);
  });

  it('preserves unscheduled physical platform', () => {
    const b = createBuilder();
    const parent = b.stop({ id: 'place-forhl' });
    const logical = b.stop({ id: '70001', parentStationId: parent.id });
    const physical = b.stop({ id: 'Forest Hills-01', parentStationId: parent.id });
    const route = b.route({ id: 'Orange' });
    const rp = b.pattern(route, { representativeTrip: { headsign: 'Oak Grove' } });
    const g = b.global({ patternIdsByStop: { [logical.id]: [rp.id] } });
    expect(new RouteCardListBuilder(false, 'nearby', now).addStaticStopsData(allStopIds(b), g, null).snapshot()).toEqual([
      {
        id: 'Orange',
        stops: [
          {
            stopId: parent.id,
            leaves: [
              builderLeaf({
                dir: 0,
                direction: directionFor(0, route),
                routePatternIds: [rp.id],
                stopIds: [parent.id, logical.id, physical.id],
                allDataLoaded: false,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('Green Line shuttles are not grouped together', () => {
    const b = createBuilder();
    const stop = b.stop();
    const line = b.line({ id: 'line-Green', sortOrder: 0 });
    const rail = b.route({ lineId: line.id, directionNames: ['West', 'East'], directionDestinations: ['Boston College', 'Government Center'] });
    const shuttle = b.route({ id: 'Shuttle-test', lineId: line.id });
    const railPattern = b.pattern(rail, { typicality: 'typical', representativeTrip: { headsign: 'Boston College' } });
    const shuttlePattern = b.pattern(shuttle, { representativeTrip: { headsign: 'Boston College' } });
    const g = b.global({ patternIdsByStop: { [stop.id]: [railPattern.id, shuttlePattern.id] } });
    expect(new RouteCardListBuilder(false, 'nearby', now).addStaticStopsData(allStopIds(b), g, null).snapshot()).toEqual([
      {
        id: 'line-Green',
        stops: [
          {
            stopId: stop.id,
            leaves: [
              builderLeaf({
                dir: 0,
                direction: { id: 0, name: 'West', destination: 'Boston College' },
                routePatternIds: [railPattern.id],
                stopIds: [stop.id],
                allDataLoaded: false,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
      {
        id: shuttle.id,
        stops: [
          {
            stopId: stop.id,
            leaves: [
              builderLeaf({ dir: 0, direction: directionFor(0, shuttle), routePatternIds: [shuttlePattern.id], stopIds: [stop.id], allDataLoaded: false, context: 'nearby' }),
            ],
          },
        ],
      },
    ]);
  });

  it('Green Line routes all grouped by direction when different child stops', () => {
    const b = createBuilder();
    const parkSt = b.stop({ locationType: 1 });
    const [bWest, cWest, dWest, east] = [1, 2, 3, 4].map(() => b.stop({ parentStationId: parkSt.id }));
    const line = b.line({ id: 'line-Green' });
    const mk = (dest: [string, string]) => b.route({ lineId: line.id, directionNames: ['West', 'East'], directionDestinations: dest });
    const bRoute = mk(['Boston College', 'Government Center']);
    const cRoute = mk(['Cleveland Circle', 'Government Center']);
    const dRoute = mk(['Riverside', 'Union Sq']);
    const bW = b.pattern(bRoute, { typicality: 'typical' });
    const bE = b.pattern(bRoute, { directionId: 1, typicality: 'typical' });
    const cW = b.pattern(cRoute, { typicality: 'typical' });
    const cE = b.pattern(cRoute, { directionId: 1, typicality: 'typical' });
    const dW = b.pattern(dRoute, { typicality: 'typical' });
    const g = b.global({
      patternIdsByStop: { [east.id]: [bE.id, cE.id], [bWest.id]: [bW.id], [cWest.id]: [cW.id], [dWest.id]: [dW.id] },
    });
    const stopIds = [parkSt.id, east.id, bWest.id, cWest.id, dWest.id];
    expect(new RouteCardListBuilder(false, 'nearby', now).addStaticStopsData(allStopIds(b), g, null).snapshot()).toEqual([
      {
        id: 'line-Green',
        stops: [
          {
            stopId: parkSt.id,
            leaves: [
              builderLeaf({ dir: 0, direction: { id: 0, name: 'West', destination: null }, routePatternIds: [bW.id, cW.id, dW.id], stopIds, allDataLoaded: false, context: 'nearby' }),
              builderLeaf({ dir: 1, direction: { id: 1, name: 'East', destination: null }, routePatternIds: [bE.id, cE.id], stopIds, allDataLoaded: false, context: 'nearby' }),
            ],
          },
        ],
      },
    ]);
  });

  it('Green Line routes are grouped together without Government Center direction', () => {
    const b = createBuilder();
    const gov = b.stop({ id: 'place-gover' });
    const nearby = [gov.id];
    const [arl, hay, lake, clmnl, river, park, magoun] = ['place-armnl', 'place-haecl', 'place-lake', 'place-clmnl', 'place-river', 'place-pktrm', 'place-mgngl'].map((id) =>
      b.stop({ id }),
    );
    const line = b.line({ id: 'line-Green' });
    const mk = (id: string, dest: [string, string]) => b.route({ id, lineId: line.id, directionNames: ['West', 'East'], directionDestinations: dest });
    const routeB = mk('Green-B', ['Boston College', 'Government Center']);
    const routeC = mk('Green-C', ['Cleveland Circle', 'Government Center']);
    const routeD = mk('Green-D', ['Riverside', 'Union Square']);
    const p = (route: Route, id: string, directionId: 0 | 1, sortOrder: number, typicality: 'typical' | 'atypical', headsign: string, stops: Stop[]) =>
      b.pattern(route, { id, directionId, sortOrder, typicality, representativeTrip: { headsign, stopIds: stops.map((s) => s.id) } });
    const b1 = p(routeB, 'routeBrp1', 0, 3, 'typical', 'Boston College', [gov, park, arl, lake]);
    const b2 = p(routeB, 'routeBrp2', 1, 4, 'typical', 'Government Center', [lake, arl, park, gov]);
    const c1 = p(routeC, 'routeCrp1', 0, 3, 'typical', 'Cleveland Circle', [gov, park, arl, clmnl]);
    const c2 = p(routeC, 'routeCrp2', 1, 4, 'typical', 'Government Center', [clmnl, arl, park, gov]);
    const c3 = p(routeC, 'routeCrp3', 1, 5, 'atypical', 'Union Square', [clmnl, arl, park, gov, hay, magoun]);
    const d1 = p(routeD, 'routeDrp1', 0, 1, 'typical', 'Riverside', [magoun, hay, gov, park, arl, river]);
    const d2 = p(routeD, 'routeDrp2', 1, 2, 'typical', 'Union Square', [river, arl, park, gov, hay, magoun]);
    const g = b.global();
    expect(new RouteCardListBuilder(false, 'nearby', now).addStaticStopsData(nearby, g, null).snapshot()).toEqual([
      {
        id: 'line-Green',
        stops: [
          {
            stopId: gov.id,
            leaves: [
              builderLeaf({ dir: 0, direction: { id: 0, name: 'West', destination: 'Copley & West' }, routePatternIds: [b1.id, c1.id, d1.id], stopIds: [gov.id], allDataLoaded: false, context: 'nearby' }),
              builderLeaf({
                dir: 1,
                direction: { id: 1, name: 'East', destination: 'North Station & North' },
                routePatternIds: [b2.id, c2.id, c3.id, d2.id],
                stopIds: [gov.id],
                allDataLoaded: false,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });
});

describe('ListBuilder.addUpcomingTrips / addAlerts', () => {
  it('includes predictions filtered to the correct stop and direction', () => {
    const b = createBuilder();
    const stop1 = b.stop();
    const stop2 = b.stop();
    const route1 = b.route();
    const p1 = b.pattern(route1, { sortOrder: 1, representativeTrip: { headsign: 'Harvard' } });
    const trip1 = b.tripFor(p1);
    const p2 = b.pattern(route1, { sortOrder: 2, representativeTrip: { headsign: 'Harvard' } });
    const trip2 = b.tripFor(p2);
    const p3 = b.pattern(route1, { sortOrder: 3, representativeTrip: { headsign: 'Nubian' } });
    const trip3 = b.tripFor(p3);
    const g = b.global({ patternIdsByStop: { [stop1.id]: [p1.id, p2.id], [stop2.id]: [p3.id] } });
    const time = easternInstant(2024, 2, 21, 9, 30, 8);
    const s1p2 = b.prediction({ arrivalTime: time, departureTime: time + 10 * SEC, stopId: stop1.id, trip: trip2 });
    const s1p1 = b.prediction({ arrivalTime: time + 5 * SEC, departureTime: time + 15 * SEC, stopId: stop1.id, trip: trip1 });
    const s2p1 = b.prediction({ arrivalTime: time + 10 * SEC, departureTime: time + 20 * SEC, stopId: stop2.id, trip: trip1 });
    const s2p3 = b.prediction({ arrivalTime: time + 20 * SEC, departureTime: time + 30 * SEC, stopId: stop2.id, trip: trip3 });
    const id = (p: typeof s1p1) => b.upcomingTrip({ prediction: p }).id;
    expect(
      new RouteCardListBuilder(true, 'nearby', time).addStaticStopsData([stop1.id, stop2.id], g, null).addUpcomingTrips(null, b.liveDepartures(), g, []).snapshot(),
    ).toEqual([
      {
        id: route1.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [
              builderLeaf({
                dir: 0,
                direction: directionFor(0, route1),
                routePatternIds: [p1.id, p2.id],
                stopIds: [stop1.id],
                upcomingTripIds: [id(s1p2), id(s1p1)],
                allDataLoaded: false,
                context: 'nearby',
              }),
            ],
          },
          {
            stopId: stop2.id,
            leaves: [
              builderLeaf({
                dir: 0,
                direction: directionFor(0, route1),
                routePatternIds: [p3.id],
                stopIds: [stop2.id],
                upcomingTripIds: [id(s2p1), id(s2p3)],
                allDataLoaded: false,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('sets hasSchedulesToday and subwayServiceStartTime per leaf', () => {
    const b = createBuilder();
    const [stop1, stop2, stop3] = [b.stop(), b.stop(), b.stop()];
    const route = b.route({ type: 1 });
    const p1 = b.pattern(route, { sortOrder: 1, representativeTrip: { headsign: 'Future Schedule' } });
    const p2 = b.pattern(route, { sortOrder: 2, representativeTrip: { headsign: 'Past Schedule' } });
    const p3 = b.pattern(route, { sortOrder: 3, representativeTrip: { headsign: 'No Schedule' } });
    const g = b.global({ patternIdsByStop: { [stop1.id]: [p1.id], [stop2.id]: [p2.id], [stop3.id]: [p3.id] } });
    const now = Date.now();
    const future = b.schedule({ trip: b.tripFor(p1), stopId: stop1.id, departureTime: now + 2 * HOUR });
    const past = b.schedule({ trip: b.tripFor(p2), stopId: stop2.id, departureTime: now - 2 * HOUR });
    expect(
      new RouteCardListBuilder(true, 'nearby', now)
        .addStaticStopsData([stop1.id, stop2.id, stop3.id], g, null)
        .addUpcomingTrips(b.scheduleSet(), b.liveDepartures(), g, [])
        .snapshot(),
    ).toEqual([
      {
        id: route.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [
              builderLeaf({
                dir: 0,
                direction: directionFor(0, route),
                routePatternIds: [p1.id],
                stopIds: [stop1.id],
                upcomingTripIds: [b.upcomingTrip({ schedule: future }).id],
                allDataLoaded: true,
                hasSchedulesTodayByPattern: { [p1.id]: true },
                subwayServiceStartTime: future.departureTime,
                context: 'nearby',
              }),
            ],
          },
          {
            stopId: stop2.id,
            leaves: [
              builderLeaf({
                dir: 0,
                direction: directionFor(0, route),
                routePatternIds: [p2.id],
                stopIds: [stop2.id],
                upcomingTripIds: null,
                allDataLoaded: true,
                hasSchedulesTodayByPattern: { [p2.id]: true },
                subwayServiceStartTime: past.departureTime,
                context: 'nearby',
              }),
            ],
          },
          {
            stopId: stop3.id,
            leaves: [
              builderLeaf({
                dir: 0,
                direction: directionFor(0, route),
                routePatternIds: [p3.id],
                stopIds: [stop3.id],
                upcomingTripIds: null,
                allDataLoaded: true,
                hasSchedulesTodayByPattern: { [p3.id]: false },
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });
});

describe('routeCardsForStopList', () => {
  it('sorts subway routes first', () => {
    const b = createBuilder();
    const busStop = b.stop();
    const subwayStop = b.stop();
    const subwayRoute = b.route({ type: 0 });
    const busRoute = b.route({ type: 3 });
    const subwayRp = b.pattern(subwayRoute, { sortOrder: 2, typicality: 'typical', representativeTrip: { headsign: 'Alewife' } });
    const busRp = b.pattern(busRoute, { sortOrder: 1, typicality: 'typical', representativeTrip: { headsign: 'Nubian' } });
    const time = easternInstant(2024, 2, 22, 12, 8, 19);
    const g = b.global({ patternIdsByStop: { [subwayStop.id]: [subwayRp.id, busRp.id], [busStop.id]: [busRp.id] } });
    expect(summarize(routeCardsForStopList({ ...input(b, { stopIds: [busStop.id, subwayStop.id], now: time, context: 'nearby' }), global: g }))).toEqual([
      {
        id: subwayRoute.id,
        stops: [
          {
            stopId: subwayStop.id,
            leaves: [leafExpect({ dir: 0, direction: directionFor(0, subwayRoute), routePatternIds: [subwayRp.id], stopIds: [subwayStop.id], allDataLoaded: false, context: 'nearby' })],
          },
        ],
      },
      {
        id: busRoute.id,
        stops: [
          {
            stopId: busStop.id,
            leaves: [leafExpect({ dir: 0, direction: directionFor(0, busRoute), routePatternIds: [busRp.id], stopIds: [busStop.id], allDataLoaded: false, context: 'nearby' })],
          },
        ],
      },
    ]);
  });

  it('sorts close bus first then subway then by distance', () => {
    const b = createBuilder();
    const closeBus = b.stop();
    const at = (d: number) => b.stop({ latitude: closeBus.latitude + d, longitude: closeBus.longitude + d });
    const midBus = at(0.05);
    const farBus = at(0.1);
    const closeSubway = at(0.2);
    const farSubway = at(0.3);
    const closeBusRoute = b.route({ type: 3, sortOrder: 5 });
    const midBusRoute = b.route({ type: 3, sortOrder: 4 });
    const farBusRoute = b.route({ type: 3, sortOrder: 3 });
    const closeSubwayRoute = b.route({ type: 0, sortOrder: 2 });
    const farSubwayRoute = b.route({ type: 0, sortOrder: 1 });
    const pat = (r: Route, h: string) => b.pattern(r, { representativeTrip: { headsign: h } });
    const csp = pat(closeSubwayRoute, 'Alewife');
    const fsp = pat(farSubwayRoute, 'Oak Grove');
    const cbp = pat(closeBusRoute, 'Nubian');
    const mbp = pat(midBusRoute, 'Lechmere');
    const fbp = pat(farBusRoute, 'Malden Center');
    const time = easternInstant(2024, 2, 21, 9, 30, 8);
    for (const [route, stop, p] of [
      [closeSubwayRoute, closeSubway, csp],
      [farSubwayRoute, farSubway, fsp],
      [closeBusRoute, closeBus, cbp],
      [midBusRoute, midBus, mbp],
      [farBusRoute, farBus, fbp],
    ] as const) {
      b.prediction({ arrivalTime: time, departureTime: time, routeId: route.id, stopId: stop.id, tripId: p.representativeTripId });
    }
    const g = b.global({
      patternIdsByStop: { [farBus.id]: [fbp.id], [midBus.id]: [mbp.id], [closeBus.id]: [cbp.id], [farSubway.id]: [fsp.id], [closeSubway.id]: [csp.id] },
    });
    const cards = routeCardsForStopList({
      ...input(b, { stopIds: [farBus.id, farSubway.id, midBus.id, closeBus.id, closeSubway.id], now: time, context: 'nearby' }),
      global: g,
      sortByDistanceFrom: posOf(closeBus),
      schedules: b.scheduleSet(),
    });
    expect(routeIdsOf(cards)).toEqual([closeBusRoute.id, closeSubwayRoute.id, farSubwayRoute.id, midBusRoute.id, farBusRoute.id]);
  });

  it('sorts routes with no service today to the bottom', () => {
    const b = createBuilder();
    const closeBus = b.stop();
    const at = (d: number) => b.stop({ latitude: closeBus.latitude + d, longitude: closeBus.longitude + d });
    const midBus = at(0.2);
    const farBus = at(0.4);
    const closeSubway = at(0.1);
    const midSubway = at(0.3);
    const farSubway = at(0.5);
    const closeBusRoute = b.route({ id: 'close-bus', type: 3 });
    const midBusRoute = b.route({ id: 'mid-bus', type: 3 });
    const farBusRoute = b.route({ id: 'far-bus', type: 3 });
    const closeSubwayRoute = b.route({ id: 'close-subway', type: 1 });
    const midSubwayRoute = b.route({ id: 'mid-subway', type: 0 });
    const farSubwayRoute = b.route({ id: 'far-subway', type: 1 });
    const pat = (r: Route, h: string, typicality: 'typical' | 'atypical' = 'typical') => b.pattern(r, { sortOrder: 1, typicality, representativeTrip: { headsign: h } });
    const cbp = pat(closeBusRoute, 'Lincoln Lab');
    const mbp1 = pat(midBusRoute, 'Nubian');
    const mbp2 = pat(midBusRoute, 'Nubian');
    const fbp1 = pat(farBusRoute, 'Malden Center');
    const fbp2 = pat(farBusRoute, 'Malden Center', 'atypical');
    const csp = pat(closeSubwayRoute, 'Alewife');
    const msp = pat(midSubwayRoute, 'Medford/Tufts');
    const fsp = pat(farSubwayRoute, 'Oak Grove');
    const time = easternInstant(2024, 2, 21, 9, 30, 8);
    b.prediction({ arrivalTime: time, departureTime: time, routeId: midBusRoute.id, stopId: midBus.id, tripId: mbp1.representativeTripId });
    b.schedule({ arrivalTime: time, departureTime: time, routeId: midBusRoute.id, stopId: midBus.id, tripId: mbp1.representativeTripId });
    b.schedule({ arrivalTime: time, departureTime: time, routeId: farSubwayRoute.id, stopId: farSubway.id, tripId: fsp.representativeTripId });
    const g = b.global({
      patternIdsByStop: {
        [farBus.id]: [fbp1.id, fbp2.id],
        [midBus.id]: [mbp1.id, mbp2.id],
        [closeBus.id]: [cbp.id],
        [farSubway.id]: [fsp.id],
        [midSubway.id]: [msp.id],
        [closeSubway.id]: [csp.id],
      },
    });
    const cards = routeCardsForStopList({
      ...input(b, { stopIds: [farBus.id, farSubway.id, midSubway.id, closeBus.id, midBus.id, closeSubway.id], now: time, context: 'nearby' }),
      global: g,
      sortByDistanceFrom: posOf(closeBus),
      schedules: b.scheduleSet(),
    });
    expect(routeIdsOf(cards)).toEqual(['close-bus', 'far-subway', 'mid-bus', 'close-subway', 'mid-subway', 'far-bus']);
  });

  it('sorts stops in route card with no service today to the bottom', () => {
    const b = createBuilder();
    const terminal = b.stop();
    const at = (id: string, d: number) => b.stop({ id, latitude: terminal.latitude + d, longitude: terminal.longitude + d });
    const midBus = at('mid-bus', 0.2);
    const farBus = at('far-bus', 0.4);
    const closeSubway = at('close-subway', 0.1);
    const midSubway = at('mid-subway', 0.3);
    const farSubway = at('far-subway', 0.5);
    const predictedBus = b.route({ id: 'predicted-bus', type: 3 });
    const endedBus = b.route({ id: 'bus-service-ended', type: 3 });
    const scheduledSubway = b.route({ id: 'scheduled-subway', type: 1 });
    const predictedSubway = b.route({ id: 'predicted-subway', type: 0 });
    const pat = (r: Route, h: string, stops: Stop[]) => b.pattern(r, { sortOrder: 1, typicality: 'typical', representativeTrip: { headsign: h, stopIds: stops.map((s) => s.id) } });
    const pbp = pat(predictedBus, 'Design Center via South Station', [farBus, terminal]);
    const partial = pat(predictedBus, 'Design Center', [midBus, terminal]);
    const ended = pat(endedBus, 'Nubian', [midBus, terminal]);
    const ssp = pat(scheduledSubway, 'Cleveland Circle', [closeSubway, terminal]);
    const psp = pat(predictedSubway, 'Government Center', [midSubway, farSubway, terminal]);
    const time = easternInstant(2024, 2, 21, 9, 30, 8);
    b.prediction({ arrivalTime: time + 10 * MIN, departureTime: time + 10 * MIN, routeId: predictedBus.id, stopId: farBus.id, tripId: pbp.representativeTripId });
    b.prediction({ arrivalTime: time + 5 * MIN, departureTime: time + 5 * MIN, routeId: predictedSubway.id, stopId: farSubway.id, tripId: psp.representativeTripId });
    b.schedule({ departureTime: time + HOUR, routeId: predictedBus.id, tripId: pbp.representativeTripId, stopId: farBus.id });
    b.schedule({ departureTime: time - HOUR, routeId: predictedBus.id, tripId: partial.representativeTripId, stopId: midBus.id });
    b.schedule({ departureTime: time - HOUR, routeId: endedBus.id, tripId: ended.representativeTripId, stopId: midBus.id });
    b.schedule({ departureTime: time + HOUR, routeId: predictedSubway.id, tripId: psp.representativeTripId, stopId: farSubway.id });
    b.schedule({ departureTime: time + HOUR, routeId: scheduledSubway.id, tripId: ssp.representativeTripId, stopId: closeSubway.id });
    const g = b.global({
      patternIdsByStop: {
        [farBus.id]: [pbp.id],
        [midBus.id]: [ended.id, partial.id],
        [farSubway.id]: [psp.id],
        [midSubway.id]: [psp.id],
        [closeSubway.id]: [ssp.id],
      },
    });
    const cards = routeCardsForStopList({
      ...input(b, { stopIds: [farBus.id, farSubway.id, midSubway.id, midBus.id, closeSubway.id], now: time, context: 'nearby' }),
      global: g,
      sortByDistanceFrom: posOf(terminal),
      schedules: b.scheduleSet(),
    });
    expect(routeIdsOf(cards)).toEqual(['scheduled-subway', 'predicted-subway', 'predicted-bus', 'bus-service-ended']);
    expect(cards?.find((c) => c.id === 'predicted-bus')?.stops.map((s) => s.stop.id)).toEqual([farBus.id, midBus.id]);
  });

  const hideSetup = (deviationMinutes: number | null, stop2Minutes: number) => {
    const b = createBuilder();
    const stop1 = b.stop();
    const stop2 = b.stop();
    const route1 = b.route();
    const typical = b.pattern(route1, { directionId: 0, sortOrder: 1, typicality: 'typical', representativeTrip: { headsign: 'Typical Out' } });
    const deviation = b.pattern(route1, { directionId: 0, sortOrder: 4, typicality: 'deviation', representativeTrip: { headsign: 'Deviation Out' } });
    const g = b.global({ patternIdsByStop: { [stop1.id]: [typical.id], [stop2.id]: [typical.id, deviation.id] } });
    const time = easternInstant(2024, 2, 22, 12, 8, 19);
    const p1 = b.prediction({ departureTime: time, routeId: route1.id, stopId: stop1.id, tripId: typical.representativeTripId });
    const p2 = b.prediction({ departureTime: time + stop2Minutes * MIN, routeId: route1.id, stopId: stop2.id, tripId: typical.representativeTripId });
    const p3 =
      deviationMinutes === null ? null : b.prediction({ departureTime: time + deviationMinutes * MIN, routeId: route1.id, stopId: stop2.id, tripId: deviation.representativeTripId });
    return { b, stop1, stop2, route1, typical, deviation, g, time, p1, p2, p3 };
  };

  it('hides stop that has upcoming service all seen at earlier stop', () => {
    const { b, stop1, route1, typical, g, time, p1 } = hideSetup(null, 121);
    expect(summarize(routeCardsForStopList({ ...input(b, { stopIds: [stop1.id], now: time, context: 'nearby' }), global: g }))).toEqual([
      {
        id: route1.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: directionFor(0, route1),
                routePatternIds: [typical.id],
                stopIds: [stop1.id],
                upcomingTripIds: [b.upcomingTrip({ prediction: p1 }).id],
                allDataLoaded: false,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('shows stop that has nontypical service not seen at earlier stop', () => {
    const { b, stop1, stop2, route1, typical, deviation, g, time, p1, p2, p3 } = hideSetup(100, 118);
    expect(summarize(routeCardsForStopList({ ...input(b, { stopIds: [stop1.id, stop2.id], now: time, context: 'nearby' }), global: g }))).toEqual([
      {
        id: route1.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: directionFor(0, route1),
                routePatternIds: [typical.id],
                stopIds: [stop1.id],
                upcomingTripIds: [b.upcomingTrip({ prediction: p1 }).id],
                allDataLoaded: false,
                context: 'nearby',
              }),
            ],
          },
          {
            stopId: stop2.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: directionFor(0, route1),
                routePatternIds: [typical.id, deviation.id],
                stopIds: [stop2.id],
                upcomingTripIds: [b.upcomingTrip({ prediction: p3! }).id, b.upcomingTrip({ prediction: p2 }).id],
                allDataLoaded: false,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it("doesn't filter future trips in filtered stop details", () => {
    const b = createBuilder();
    const stop1 = b.stop();
    const route1 = b.route();
    const typical = b.pattern(route1, { directionId: 0, sortOrder: 1, typicality: 'typical', representativeTrip: { headsign: 'Typical Out' } });
    const deviation = b.pattern(route1, { directionId: 1, sortOrder: 4, typicality: 'deviation', representativeTrip: { headsign: 'Deviation In' } });
    const g = b.global({ patternIdsByStop: { [stop1.id]: [typical.id, deviation.id] } });
    const time = easternInstant(2024, 2, 22, 12, 8, 19);
    const p1 = b.prediction({ departureTime: time, routeId: route1.id, stopId: stop1.id, tripId: typical.representativeTripId });
    const p2 = b.prediction({ departureTime: time + 400 * MIN, routeId: route1.id, stopId: stop1.id, tripId: deviation.representativeTripId });
    expect(
      summarize(
        routeCardsForStopList({ ...input(b, { stopIds: [stop1.id], now: time, context: 'stopDetailsFiltered' }), global: g, sortByDistanceFrom: posOf(stop1), alerts: [] }),
      ),
    ).toEqual([
      {
        id: route1.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: directionFor(0, route1),
                routePatternIds: [typical.id],
                stopIds: [stop1.id],
                upcomingTripIds: [b.upcomingTrip({ prediction: p1 }).id],
                allDataLoaded: false,
                context: 'stopDetailsFiltered',
              }),
              leafExpect({
                dir: 1,
                direction: directionFor(1, route1),
                routePatternIds: [deviation.id],
                stopIds: [stop1.id],
                upcomingTripIds: [b.upcomingTrip({ prediction: p2 }).id],
                allDataLoaded: false,
                context: 'stopDetailsFiltered',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('includes cancellations in filtered stop details context', () => {
    const b = createBuilder();
    const stop1 = b.stop();
    const route1 = b.route({ type: 3 });
    const typical = b.pattern(route1, { directionId: 0, sortOrder: 1, typicality: 'typical', representativeTrip: { headsign: 'Typical Out' } });
    const g = b.global({ patternIdsByStop: { [stop1.id]: [typical.id] } });
    const time = easternInstant(2024, 2, 22, 12, 8, 19);
    const schedule = b.schedule({ routeId: route1.id, tripId: typical.representativeTripId, stopId: stop1.id, arrivalTime: time, departureTime: time });
    const prediction = b.prediction({ routeId: route1.id, stopId: stop1.id, tripId: typical.representativeTripId, scheduleRelationship: 'CANCELLED' });
    const cards = routeCardsForStopList({
      ...input(b, { stopIds: [stop1.id], now: time, context: 'stopDetailsFiltered' }),
      global: g,
      sortByDistanceFrom: posOf(stop1),
      schedules: b.scheduleSet(),
      alerts: [],
    });
    expect(summarize(cards)).toEqual([
      {
        id: route1.id,
        stops: [
          {
            stopId: stop1.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: directionFor(0, route1),
                routePatternIds: [typical.id],
                stopIds: [stop1.id],
                upcomingTripIds: [b.upcomingTrip({ schedule, prediction }).id],
                allDataLoaded: true,
                hasSchedulesToday: true,
                context: 'stopDetailsFiltered',
              }),
            ],
          },
        ],
      },
    ]);
    expect(cards![0].stops[0].leaves[0].upcomingTrips[0].prediction).toBe(prediction);
  });

  it('groups lines by direction', () => {
    const b = createBuilder();
    const [hynes, gov, boyls, arl, hay, bc, clc, heath, magoun] = [
      'place-hymnl',
      'place-gover',
      'place-boyls',
      'place-armnl',
      'place-haecl',
      'place-lake',
      'place-clmnl',
      'place-hsmnl',
      'place-mgngl',
    ].map((id) => b.stop({ id }));
    const line = b.line({ id: 'line-Green' });
    const mk = (id: string, sortOrder: number) =>
      b.route({ id, sortOrder, lineId: 'line-Green', directionNames: ['West', 'East'], directionDestinations: [`Ignored West ${id}`, `Ignored East ${id}`] });
    const routeB = mk('Green-B', 1);
    const routeC = mk('Green-C', 2);
    const routeE = mk('Green-E', 3);
    const pat = (route: Route, directionId: 0 | 1, headsign: string, stops: Stop[], id?: string) =>
      b.pattern(route, { id, directionId, typicality: 'typical', representativeTrip: { headsign, stopIds: stops.map((s) => s.id) } });
    const b1 = pat(routeB, 0, 'B', [gov, boyls, arl, hynes, bc]);
    const b2 = pat(routeB, 1, 'B', [bc, hynes, arl, boyls, gov]);
    const c1 = pat(routeC, 0, 'C', [gov, boyls, arl, hynes, clc]);
    const c2 = pat(routeC, 1, 'C', [clc, hynes, arl, boyls, gov]);
    const e1 = pat(routeE, 0, 'Heath Street', [magoun, hay, gov, boyls, arl, hynes, heath], 'test-hs');
    const e2 = pat(routeE, 1, 'Medford/Tufts', [heath, hynes, arl, boyls, gov, hay, magoun]);
    const time = easternInstant(2024, 3, 18, 10, 41, 13);
    const sched = (p: typeof b1, minutes: number) => b.schedule({ trip: b.tripFor(p), stopId: hynes.id, stopSequence: 90, departureTime: time + minutes * MIN });
    const [sB1, sB2, sC1, sC2, sE1, sE2] = [sched(b1, 1), sched(b2, 4), sched(c1, 2), sched(c2, 5), sched(e1, 3), sched(e2, 6)];
    const pred = (s: typeof sB1, minutes: number) => b.predictionFor(s, { departureTime: time + minutes * MIN });
    const [pB1, pB2, pC1, pC2, pE1, pE2] = [pred(sB1, 1.5), pred(sB2, 4.5), pred(sC1, 2.3), pred(sC2, 5.3), pred(sE1, 2.3), pred(sE2, 6.3)];
    const g = b.global({ patternIdsByStop: { [hynes.id]: [b1.id, b2.id, c1.id, c2.id, e1.id, e2.id] } });
    const up = (s: typeof sB1, p: typeof pB1) => b.upcomingTrip({ schedule: s, prediction: p }).id;
    expect(line.id).toBe('line-Green');
    expect(
      summarize(
        routeCardsForStopList({
          ...input(b, { stopIds: [hynes.id], now: time, context: 'nearby' }),
          global: g,
          sortByDistanceFrom: posOf(hynes),
          schedules: b.scheduleSet(),
          alerts: [],
        }),
      ),
    ).toEqual([
      {
        id: 'line-Green',
        stops: [
          {
            stopId: hynes.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: { id: 0, name: 'West', destination: 'Kenmore & West' },
                routePatternIds: [b1.id, c1.id, e1.id],
                stopIds: [hynes.id],
                upcomingTripIds: [up(sB1, pB1), up(sC1, pC1), up(sE1, pE1)],
                allDataLoaded: true,
                hasSchedulesToday: true,
                subwayServiceStartTime: sB1.departureTime,
                context: 'nearby',
              }),
              leafExpect({
                dir: 1,
                direction: { id: 1, name: 'East', destination: 'Park St & North' },
                routePatternIds: [b2.id, c2.id, e2.id],
                stopIds: [hynes.id],
                upcomingTripIds: [up(sB2, pB2), up(sC2, pC2), up(sE2, pE2)],
                allDataLoaded: true,
                hasSchedulesToday: true,
                subwayServiceStartTime: sB2.departureTime,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('for line on branch uses branch direction name', () => {
    const b = createBuilder();
    const [bc, southSt, arl, boyls, gov] = ['place-lake', 'place-sougr', 'place-armnl', 'place-boyls', 'place-gover'].map((id) => b.stop({ id }));
    b.stop({ id: 'place-haecl' });
    b.line({ id: 'line-Green' });
    const routeB = b.route({ id: 'Green-B', sortOrder: 1, lineId: 'line-Green', directionNames: ['West', 'East'], directionDestinations: ['Real B West', 'Real B East'] });
    const b1 = b.pattern(routeB, { directionId: 0, typicality: 'typical', representativeTrip: { headsign: 'B', stopIds: [gov, boyls, arl, southSt, bc].map((s) => s.id) } });
    const b2 = b.pattern(routeB, { directionId: 1, typicality: 'typical', representativeTrip: { headsign: 'B', stopIds: [bc, southSt, arl, boyls, gov].map((s) => s.id) } });
    const time = easternInstant(2024, 3, 18, 10, 41, 13);
    const s1 = b.schedule({ trip: b.tripFor(b1), stopId: southSt.id, stopSequence: 90, departureTime: time + MIN });
    const s2 = b.schedule({ trip: b.tripFor(b2), stopId: southSt.id, stopSequence: 90, departureTime: time + 4 * MIN });
    const p1 = b.predictionFor(s1, { departureTime: time + 1.5 * MIN });
    const p2 = b.predictionFor(s2, { departureTime: time + 4.5 * MIN });
    const g = b.global({ patternIdsByStop: { [southSt.id]: [b1.id, b2.id] } });
    expect(
      summarize(
        routeCardsForStopList({
          ...input(b, { stopIds: [southSt.id], now: time, context: 'nearby' }),
          global: g,
          sortByDistanceFrom: posOf(southSt),
          schedules: b.scheduleSet(),
          alerts: [],
        }),
      ),
    ).toEqual([
      {
        id: 'line-Green',
        stops: [
          {
            stopId: southSt.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: { id: 0, name: 'West', destination: 'Real B West' },
                routePatternIds: [b1.id],
                stopIds: [southSt.id],
                upcomingTripIds: [b.upcomingTrip({ schedule: s1, prediction: p1 }).id],
                allDataLoaded: true,
                hasSchedulesToday: true,
                subwayServiceStartTime: s1.departureTime,
                context: 'nearby',
              }),
              leafExpect({
                dir: 1,
                direction: { id: 1, name: 'East', destination: 'Park St & North' },
                routePatternIds: [b2.id],
                stopIds: [southSt.id],
                upcomingTripIds: [b.upcomingTrip({ schedule: s2, prediction: p2 }).id],
                allDataLoaded: true,
                hasSchedulesToday: true,
                subwayServiceStartTime: s2.departureTime,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('north station disruption case', () => {
    const b = createBuilder();
    const north = b.stop({ id: 'place-north', locationType: 1, childStopIds: ['70027', '70026'] });
    const nb = b.stop({ id: '70027', locationType: 0, parentStationId: 'place-north' });
    const sb = b.stop({ id: '70026', locationType: 0, parentStationId: 'place-north' });
    const oakGrove = b.stop({ id: 'place-ogmnl', locationType: 1, childStopIds: ['70036'] });
    const oakGrovePlatform = b.stop({ id: '70036', locationType: 0, parentStationId: 'place-ogmnl' });
    b.stop({ id: 'place-forhl', locationType: 1, childStopIds: ['70001'] });
    b.stop({ id: '70001', locationType: 0, parentStationId: 'place-forhl' });
    const orange = b.route({ id: 'Orange', type: 1 });
    const nbTypical = b.pattern(orange, {
      id: 'Orange-3-1',
      typicality: 'typical',
      directionId: 1,
      representativeTrip: { id: 'canonical-Orange-C1-1', headsign: 'Oak Grove', directionId: 1, stopIds: ['70001', '70027', '70036'] },
    });
    const nbDiversion = b.pattern(orange, {
      id: 'Orange-6-1',
      typicality: 'diversion',
      directionId: 1,
      representativeTrip: { id: '65686489', headsign: 'North Station', directionId: 1, stopIds: ['70001', '70027'] },
    });
    const sbTypical = b.pattern(orange, {
      id: 'Orange-3-0',
      typicality: 'typical',
      directionId: 0,
      representativeTrip: { id: 'canonical-Orange-C1-0', headsign: 'Forest Hills', directionId: 0, stopIds: ['70036', '70026', '70001'] },
    });
    const sbDiversion = b.pattern(orange, {
      id: 'Orange-6-0',
      typicality: 'diversion',
      directionId: 0,
      representativeTrip: { id: '65743311', headsign: 'Forest Hills', directionId: 0, stopIds: ['70026', '70001'] },
    });
    const nbTypicalTrip = b.tripFor(nbTypical, { id: 'northboundTypical' });
    const nbDiversionTrip = b.tripFor(nbDiversion, { id: 'northboundDiversion' });
    const sbDiversionTrip = b.tripFor(sbDiversion);
    const time = easternInstant(2024, 10, 30, 16, 40);
    const nbSchedule = b.schedule({ trip: nbDiversionTrip, stopId: nb.id, stopSequence: 130, arrivalTime: time + 4 * MIN });
    b.prediction({ trip: nbTypicalTrip, stopId: nb.id, stopSequence: 130, arrivalTime: time + 8 * MIN });
    const sbSchedule = b.schedule({ trip: sbDiversionTrip, stopId: sb.id, stopSequence: 60, departureTime: time + 6 * MIN });
    const ent = (activities: string[], stopId: string) => b.entity({ activities, routeId: 'Orange', routeType: 1, stopId });
    const alert = b.alert({
      id: '601685',
      activePeriods: [{ start: easternInstant(2024, 10, 28, 3, 0), end: easternInstant(2024, 11, 2, 3, 0) }],
      cause: 'MAINTENANCE',
      effect: 'SHUTTLE',
      informedEntities: [
        ent(['EXIT', 'RIDE'], sb.id),
        ent(['BOARD', 'RIDE'], nb.id),
        ent(['BOARD', 'EXIT', 'RIDE'], north.id),
        ent(['BOARD', 'EXIT', 'RIDE'], oakGrove.id),
        ent(['BOARD', 'EXIT', 'RIDE'], oakGrovePlatform.id),
      ],
    });
    const cards = routeCardsForStopList({
      ...input(b, { stopIds: [north.id, sb.id, nb.id], now: time, context: 'nearby' }),
      sortByDistanceFrom: posOf(north),
      schedules: b.scheduleSet(),
      alerts: [alert],
    });
    expect(summarize(cards)).toEqual([
      {
        id: 'Orange',
        stops: [
          {
            stopId: north.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: directionFor(0, orange),
                routePatternIds: [sbTypical.id, sbDiversion.id],
                stopIds: [sb.id],
                upcomingTripIds: [b.upcomingTrip({ schedule: sbSchedule }).id],
                allDataLoaded: true,
                hasSchedulesToday: true,
                subwayServiceStartTime: sbSchedule.departureTime,
                context: 'nearby',
              }),
              leafExpect({
                dir: 1,
                direction: directionFor(1, orange),
                routePatternIds: [nbTypical.id, nbDiversion.id],
                stopIds: [nb.id],
                upcomingTripIds: [],
                alertIdsHere: [alert.id],
                allDataLoaded: true,
                hasSchedulesToday: true,
                subwayServiceStartTime: nbSchedule.arrivalTime,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
    expect(cards![0].stops[0].leaves[1].hasSchedulesTodayByPattern).toEqual({ [nbTypical.id]: false, [nbDiversion.id]: true });
  });

  it('filters out direction if it is the typical last stop of subway', () => {
    const b = createBuilder();
    const oakGrove = b.stop({ id: 'place-ogmnl', locationType: 1, childStopIds: ['70036'] });
    const orange = b.route({ id: 'Orange' });
    const nbTypical = b.pattern(orange, {
      id: 'Orange-3-1',
      typicality: 'typical',
      directionId: 1,
      representativeTrip: { id: 'canonical-Orange-C1-1', headsign: 'Oak Grove', directionId: 1, stopIds: ['70001', '70027', '70036'] },
    });
    const sbTypical = b.pattern(orange, {
      id: 'Orange-3-0',
      typicality: 'typical',
      directionId: 0,
      representativeTrip: { id: 'canonical-Orange-C1-0', headsign: 'Forest Hills', directionId: 0, stopIds: ['70036', '70026', '70001'] },
    });
    const g = b.global({ patternIdsByStop: { [oakGrove.id]: [sbTypical.id, nbTypical.id] } });
    const time = easternInstant(2024, 10, 30, 16, 40);
    const nbTrip = b.tripFor(nbTypical);
    const sbTrip = b.tripFor(sbTypical);
    const sched1 = b.schedule({ trip: sbTrip, stopId: oakGrove.id, stopSequence: 90, departureTime: time + MIN });
    b.schedule({ trip: nbTrip, stopId: oakGrove.id, stopSequence: 90, arrivalTime: time + 2 * MIN });
    expect(
      summarize(
        routeCardsForStopList({
          ...input(b, { stopIds: [oakGrove.id], now: time, context: 'nearby' }),
          global: g,
          sortByDistanceFrom: posOf(oakGrove),
          schedules: b.scheduleSet(),
          alerts: [],
        }),
      ),
    ).toEqual([
      {
        id: 'Orange',
        stops: [
          {
            stopId: oakGrove.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: directionFor(0, orange),
                routePatternIds: [sbTypical.id],
                stopIds: [oakGrove.id],
                upcomingTripIds: [b.upcomingTrip({ schedule: sched1 }).id],
                allDataLoaded: true,
                hasSchedulesToday: true,
                subwayServiceStartTime: sched1.departureTime,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('filters out any arrival only', () => {
    const b = createBuilder();
    const longWharf = b.stop({ id: 'Boat-Long' });
    const ferry = b.route({ id: 'Boat-F1', type: 4 });
    const inbound = b.pattern(ferry, {
      id: 'Boat-F1-3-1',
      typicality: 'typical',
      directionId: 1,
      representativeTrip: { id: 'Boat-F1-0730-Hull', headsign: 'Long Wharf', directionId: 1, stopIds: ['Boat-Hull', 'Boat-Long'] },
    });
    const outbound = b.pattern(ferry, {
      id: 'Boat-F1-0-0',
      typicality: 'typical',
      directionId: 0,
      representativeTrip: { id: 'Boat-F1-1100-Long', headsign: 'Hingham', directionId: 0, stopIds: ['Boat-Long', 'Boat-Logan', 'Boat-Hull', 'Boat-Hingham'] },
    });
    const g = b.global({ patternIdsByStop: { [longWharf.id]: [inbound.id, outbound.id] } });
    const time = easternInstant(2024, 10, 30, 16, 40);
    b.schedule({ trip: b.tripFor(inbound), stopId: longWharf.id, stopSequence: 90, arrivalTime: time + 2 * MIN });
    const out = b.schedule({ trip: b.tripFor(outbound), stopId: longWharf.id, stopSequence: 90, departureTime: time + 2 * MIN });
    expect(
      summarize(
        routeCardsForStopList({
          ...input(b, { stopIds: [longWharf.id], now: time, context: 'nearby' }),
          global: g,
          sortByDistanceFrom: posOf(longWharf),
          schedules: b.scheduleSet(),
          alerts: [],
        }),
      ),
    ).toEqual([
      {
        id: 'Boat-F1',
        stops: [
          {
            stopId: longWharf.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: directionFor(0, ferry),
                routePatternIds: [outbound.id],
                stopIds: [longWharf.id],
                upcomingTripIds: [b.upcomingTrip({ schedule: out }).id],
                allDataLoaded: true,
                hasSchedulesToday: true,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('returns alertsHere and downstream alerts', () => {
    const b = createBuilder();
    const route = b.route();
    const [park, alewife, shawmut, ashmont, quincyAdams, braintree] = ['park', 'alewife', 'shawmut', 'ashmont', 'quincy_adams', 'braintree'].map((id) => b.stop({ id }));
    const ashmontRp = b.pattern(route, { typicality: 'typical', directionId: 0, representativeTrip: { headsign: 'Ashmont', stopIds: [alewife, park, shawmut, ashmont].map((s) => s.id) } });
    const braintreeRp = b.pattern(route, {
      typicality: 'typical',
      directionId: 0,
      representativeTrip: { headsign: 'Braintree', stopIds: [alewife, park, quincyAdams, braintree].map((s) => s.id) },
    });
    const time = Date.now();
    b.schedule({ trip: b.tripFor(braintreeRp), departureTime: time + 2 * MIN });
    b.schedule({ trip: b.tripFor(ashmontRp), departureTime: time + 10 * MIN });
    const shuttleAt = (stopId: string, id?: string) =>
      b.alert({ id, effect: 'SHUTTLE', informedEntities: [b.entity({ activities: ['BOARD', 'RIDE'], routeId: route.id, stopId })] });
    const shawmutShuttle = shuttleAt(shawmut.id);
    const ashmontShuttle = shuttleAt(ashmont.id);
    const parkShuttle = shuttleAt(park.id, 'park_shuttle_alert');
    const parkElevator = b.alert({
      id: 'park_elevator_alert',
      effect: 'ELEVATOR_CLOSURE',
      informedEntities: [b.entity({ activities: ['USING_WHEELCHAIR'], routeId: route.id, stopId: park.id })],
    });
    const g = b.global({ patternIdsByStop: { [park.id]: [ashmontRp.id, braintreeRp.id] } });
    const downstream = alertsDownstreamForPatterns([ashmontShuttle, shawmutShuttle, parkShuttle, parkElevator], [ashmontRp, braintreeRp], route.type, [park.id], g.trips);
    expect(downstream.map((a) => a.id)).toEqual([shawmutShuttle.id]);
    expect(
      summarize(
        routeCardsForStopList({
          ...input(b, { stopIds: [park.id], now: time, context: 'nearby' }),
          global: g,
          sortByDistanceFrom: posOf(park),
          schedules: b.scheduleSet(),
        }),
      ),
    ).toEqual([
      {
        id: route.id,
        stops: [
          {
            stopId: park.id,
            leaves: [
              leafExpect({
                dir: 0,
                direction: directionFor(0, route),
                routePatternIds: [ashmontRp.id, braintreeRp.id],
                stopIds: [park.id],
                alertIdsHere: [parkShuttle.id, parkElevator.id],
                alertIdsDownstream: downstream.map((a) => a.id),
                allDataLoaded: true,
                hasSchedulesToday: true,
                context: 'nearby',
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('omits typical shuttle patterns with no service', () => {
    const b = createBuilder();
    const stop = b.stop({ id: 'test' });
    const last = b.stop({ id: 'last-stop' });
    const route = b.route({ id: 'Shuttle-service-ended', type: 3 });
    const p = b.pattern(route, { sortOrder: 1, typicality: 'typical', representativeTrip: { headsign: 'Test', stopIds: [stop.id, last.id] } });
    const time = easternInstant(2024, 2, 21, 9, 30, 8);
    b.schedule({ departureTime: time - HOUR, routeId: route.id, tripId: p.representativeTripId, stopId: stop.id });
    const g = b.global({ patternIdsByStop: { [stop.id]: [p.id] } });
    expect(
      routeIdsOf(routeCardsForStopList({ ...input(b, { stopIds: [stop.id], now: time, context: 'nearby' }), global: g, sortByDistanceFrom: posOf(stop), schedules: b.scheduleSet() })),
    ).toEqual([]);
  });

  it('includes typical shuttle patterns with service', () => {
    const b = createBuilder();
    const stop = b.stop({ id: 'test' });
    const route = b.route({ id: 'Shuttle-with-service', type: 3 });
    const p = b.pattern(route, { sortOrder: 1, typicality: 'typical', representativeTrip: { headsign: 'Test', stopIds: [stop.id] } });
    const time = easternInstant(2024, 2, 21, 9, 30, 8);
    b.schedule({ arrivalTime: time, departureTime: time, routeId: route.id, tripId: p.representativeTripId, stopId: stop.id });
    const g = b.global({ patternIdsByStop: { [stop.id]: [p.id] } });
    expect(
      routeIdsOf(routeCardsForStopList({ ...input(b, { stopIds: [stop.id], now: time, context: 'nearby' }), global: g, sortByDistanceFrom: posOf(stop), schedules: b.scheduleSet() })),
    ).toEqual(['Shuttle-with-service']);
  });

  it('returns null without global data', () => {
    expect(
      routeCardsForStopList({
        stopIds: [],
        global: null as unknown as RouteCardInput['global'],
        sortByDistanceFrom: null,
        schedules: null,
        predictions: null,
        alerts: null,
        now: 0,
        context: 'nearby',
      }),
    ).toBeNull();
  });
});

describe('routeCardsForStaticStopList', () => {
  it('sorts by distance', () => {
    const b = createBuilder();
    const closeBus = b.stop();
    const at = (d: number) => b.stop({ latitude: closeBus.latitude + d, longitude: closeBus.longitude + d });
    const midBus = at(0.2);
    const farBus = at(0.4);
    const closeSubway = at(0.1);
    const midSubway = at(0.3);
    const farSubway = at(0.5);
    const routes = {
      closeBus: b.route({ id: 'close-bus', type: 3 }),
      midBus: b.route({ id: 'mid-bus', type: 3 }),
      farBus: b.route({ id: 'far-bus', type: 3 }),
      closeSubway: b.route({ id: 'close-subway', type: 1 }),
      midSubway: b.route({ id: 'mid-subway', type: 0 }),
      farSubway: b.route({ id: 'far-subway', type: 1 }),
    };
    const pat = (r: Route, h: string, typicality: 'typical' | 'atypical' = 'typical') => b.pattern(r, { sortOrder: 1, typicality, representativeTrip: { headsign: h } });
    const cbp = pat(routes.closeBus, 'Lincoln Lab');
    const mbp1 = pat(routes.midBus, 'Nubian');
    const mbp2 = pat(routes.midBus, 'Nubian');
    const fbp1 = pat(routes.farBus, 'Malden Center');
    const fbp2 = pat(routes.farBus, 'Malden Center', 'atypical');
    const csp = pat(routes.closeSubway, 'Alewife');
    const msp = pat(routes.midSubway, 'Medford/Tufts');
    const fsp = pat(routes.farSubway, 'Oak Grove');
    const time = easternInstant(2024, 2, 21, 9, 30, 8);
    b.prediction({ arrivalTime: time, departureTime: time, routeId: 'mid-bus', stopId: midBus.id, tripId: mbp1.representativeTripId });
    b.schedule({ arrivalTime: time, departureTime: time, routeId: 'mid-bus', stopId: midBus.id, tripId: mbp1.representativeTripId });
    b.schedule({ arrivalTime: time, departureTime: time, routeId: 'far-subway', stopId: farSubway.id, tripId: fsp.representativeTripId });
    const g = b.global({
      patternIdsByStop: {
        [farBus.id]: [fbp1.id, fbp2.id],
        [midBus.id]: [mbp1.id, mbp2.id],
        [closeBus.id]: [cbp.id],
        [farSubway.id]: [fsp.id],
        [midSubway.id]: [msp.id],
        [closeSubway.id]: [csp.id],
      },
    });
    const fav = (r: Route, s: Stop, p: { directionId: 0 | 1 }) => rsdKey({ routeId: r.id, stopId: s.id, directionId: p.directionId });
    const cards = routeCardsForStaticStopList({
      stopIds: [farBus.id, farSubway.id, midSubway.id, closeBus.id, midBus.id, closeSubway.id],
      global: g,
      context: 'favorites',
      now: time,
      sortByDistanceFrom: posOf(closeBus),
      favorites: new Set([
        fav(routes.closeBus, closeBus, cbp),
        fav(routes.farBus, farBus, fbp1),
        fav(routes.midBus, midBus, mbp1),
        fav(routes.farSubway, farSubway, fsp),
        fav(routes.midSubway, midSubway, msp),
        fav(routes.closeSubway, closeSubway, csp),
      ]),
    });
    expect(routeIdsOf(cards)).toEqual(['close-bus', 'close-subway', 'mid-bus', 'mid-subway', 'far-bus', 'far-subway']);
  });
});

