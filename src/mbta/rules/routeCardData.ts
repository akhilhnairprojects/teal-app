// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/RouteCardData.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Pattern grouping from model/RoutePattern.kt and stop families from model/Stop.kt, same commit.
import type { GlobalData } from '@/mbta/global/globalData';
import {
  isSubwayType,
  type Alert,
  type LatLng,
  type LiveDepartures,
  type Route,
  type RoutePattern,
  type ScheduleSet,
  type Stop,
} from '@/mbta/model/types';
import { distanceMeters } from '@/lib/geo';
import { rsdKey } from '@/state/rsd';

import {
  alertsDownstreamForPatterns,
  alertState,
  anyEntityMatches,
  applicableAlertsAnyTime,
  elevatorAlerts,
  iconNameFor,
  isActive,
  majorAlertAffectingAllTrips,
  isStopSkipped,
  significanceAt,
  significanceRank,
  willBeActiveSoon,
} from './alerts';
import { getDirections, getDirectionsForLine, type Direction } from './direction';
import { BRANCHING_LEAF_ROWS, TYPICAL_LEAF_ROWS, type LeafFormat } from './leafFormat';
import {
  allRoutes,
  containsRoute,
  GREEN_ROUTES,
  isCRCore,
  isShuttleLineOrRoute,
  isSubwayLineOrRoute,
  lineOrRouteFor,
  lineOrRouteType,
  resolveParentStop,
  routesByLineId,
  sortRoute,
  type LineOrRoute,
} from './lineOrRoute';
import { compareLeavesAtStop, compareRouteCards, compareStopsOnRoute } from './patternSorting';
import { stopTimeOf, type DisplayContext } from './tripInstantDisplay';
import { noTripsFormatFrom, type FormattedTrip, type UpcomingFormat, type WarningAlert } from './upcomingFormat';
import {
  allArrivalOnly,
  buildUpcomingTrips,
  doesPredictionHaveStatus,
  headsign as tripHeadsign,
  isArrivalOnly,
  isInTheFuture,
  isUpcoming,
  isUpcomingWithin,
  isVehicleAtTheStop,
  upcomingRouteId,
  upcomingStopId,
  withFormat,
  type UpcomingTrip,
} from './upcomingTrip';

export type { Direction, LineOrRoute };
export { compareRouteCards };
export { getDirections, getDirectionsForLine, directionLabel } from './direction';
export { nearbyStopIds } from './nearbyStops';

export type RouteCardContext = 'nearby' | 'stopDetailsUnfiltered' | 'stopDetailsFiltered' | 'favorites';

export type RouteCardLeaf = {
  lineOrRoute: LineOrRoute;
  stop: Stop;
  direction: Direction;
  routePatterns: RoutePattern[];
  stopIds: string[];
  upcomingTrips: UpcomingTrip[];
  alertsHere: Alert[];
  alertsDownstream: Alert[];
  hasSchedulesToday: boolean;
  subwayServiceStartTime: number | null;
  allDataLoaded: boolean;
  context: RouteCardContext;
  /** Per-pattern "has schedules today", used for branch rows; derived from `hasSchedulesToday` when absent. */
  hasSchedulesTodayByPattern?: Record<string, boolean>;
};

export type RouteStopData = {
  lineOrRoute: LineOrRoute;
  stop: Stop;
  directions: Direction[];
  leaves: RouteCardLeaf[];
  distanceMeters: number | null;
  elevatorAlerts: Alert[];
};

export type RouteCard = { id: string; lineOrRoute: LineOrRoute; stops: RouteStopData[]; at: number };

export type RouteCardInput = {
  stopIds: string[];
  global: GlobalData;
  sortByDistanceFrom: LatLng | null;
  schedules: ScheduleSet | null;
  predictions: LiveDepartures | null;
  alerts: Alert[] | null;
  now: number;
  context: RouteCardContext;
  favorites?: ReadonlySet<string> /* rsdKey */;
};

const isStopDetails = (c: RouteCardContext) => c === 'stopDetailsFiltered' || c === 'stopDetailsUnfiltered';

export function toDisplayContext(c: RouteCardContext): DisplayContext {
  switch (c) {
    case 'nearby':
    case 'favorites':
      return 'nearby';
    case 'stopDetailsFiltered':
      return 'stopDetailsFiltered';
    case 'stopDetailsUnfiltered':
      return 'stopDetailsUnfiltered';
  }
}

const isTypical = (p: RoutePattern) => p.typicality === null || p.typicality === 'typical';
const isCanonicalOnly = (p: RoutePattern) => p.typicality === null || p.typicality === 'canonical_only';

const distinctAlerts = (alerts: Alert[]) => {
  const seen = new Set<string>();
  return alerts.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
};

// --- leaf helpers ---------------------------------------------------------------------

function schedulesByPattern(leaf: RouteCardLeaf): Record<string, boolean> {
  if (leaf.hasSchedulesTodayByPattern) return leaf.hasSchedulesTodayByPattern;
  if (leaf.routePatterns.length === 0) return { fakeId: leaf.hasSchedulesToday };
  return Object.fromEntries(leaf.routePatterns.map((p) => [p.id, leaf.hasSchedulesToday]));
}

/** Secondary alert here, a major alert for only some trips, or the first downstream alert. */
function warningAlertToDisplay(leaf: RouteCardLeaf, now: number): Alert | null {
  return (
    leaf.alertsHere.find((a) => {
      const s = significanceAt(a, now);
      return (
        (significanceRank(s) < significanceRank('major') && significanceRank(s) >= significanceRank('secondary')) ||
        (s === 'major' && !a.informedEntities.some((e) => e.tripId === null))
      );
    }) ??
    leaf.alertsDownstream[0] ??
    null
  );
}

/** Alerts here that apply to all trips or to `tripId` (Leaf.alertsHere(tripId)). */
export function leafAlertsHere(leaf: RouteCardLeaf, tripId: string | null = null): Alert[] {
  return leaf.alertsHere.filter((a) => anyEntityMatches(a, { tripId: tripId ?? undefined }));
}

/** Downstream alerts that apply to all trips or to `tripId` (Leaf.alertsDownstream(tripId)). */
export function leafAlertsDownstream(leaf: RouteCardLeaf, tripId: string | null = null): Alert[] {
  return leaf.alertsDownstream.filter((a) => anyEntityMatches(a, { tripId: tripId ?? undefined }));
}

/** A leaf's identity as a favorite. */
export const leafRsdKey = (leaf: RouteCardLeaf) =>
  rsdKey({ routeId: leaf.lineOrRoute.id, stopId: leaf.stop.id, directionId: leaf.direction.id });

// --- formatting (Leaf.format) ---------------------------------------------------------

type PotentialService = { routeId: string; headsign: string; routePatternIds: Set<string> };

function potentialService(
  leaf: RouteCardLeaf,
  tripsUpcoming: { trip: UpcomingTrip; format: FormattedTrip | null }[],
  representativeRoute: Route,
  g: GlobalData,
): PotentialService[] {
  const byKey = new Map<string, PotentialService>();
  const isBus = representativeRoute.type === 3;
  const shown = tripsUpcoming.filter((t) => t.format !== null);
  const tripsShown = shown.length ? shown : tripsUpcoming;
  const toConsider = isBus && leaf.context !== 'stopDetailsFiltered' ? tripsShown.slice(0, TYPICAL_LEAF_ROWS) : tripsShown;
  const entry = (routeId: string, headsign: string) => {
    const key = `${routeId}\u0000${headsign}`;
    let e = byKey.get(key);
    if (!e) {
      e = { routeId, headsign, routePatternIds: new Set() };
      byKey.set(key, e);
    }
    return e;
  };
  for (const { trip } of toConsider) {
    if (isStopDetails(leaf.context) || isUpcoming(trip)) {
      const e = entry(upcomingRouteId(trip), tripHeadsign(trip));
      if (trip.trip.routePatternId !== null) e.routePatternIds.add(trip.trip.routePatternId);
    }
  }
  if (!isBus) {
    for (const p of leaf.routePatterns) {
      const represented = [...byKey.values()].some((e) => e.routePatternIds.has(p.id));
      if (isTypical(p) && !represented) {
        const headsign = g.trips[p.representativeTripId]?.headsign;
        if (headsign === undefined) continue;
        entry(p.routeId, headsign).routePatternIds.add(p.id);
      }
    }
  }
  return [...byKey.values()];
}

/** RouteCardData.filterStopsByPatterns: leaf stops on these patterns, or all leaf stops. */
export function filterStopsByPatterns(patterns: RoutePattern[], g: GlobalData, localStops: string[]): string[] {
  const patternStops: string[] = [];
  for (const p of patterns) {
    for (const id of g.trips[p.representativeTripId]?.stopIds ?? []) if (!patternStops.includes(id)) patternStops.push(id);
  }
  const relevant = patternStops.filter((id) => localStops.includes(id));
  return relevant.length ? relevant : localStops;
}

type ByHeadsign = {
  stopIds: string[];
  routePatterns: RoutePattern[];
  hasSchedulesToday: boolean;
  allUpcomingTrips: UpcomingTrip[];
  majorAlert: Alert | null;
};

function dataByHeadsign(leaf: RouteCardLeaf, services: PotentialService[], g: GlobalData, now: number): Map<string, ByHeadsign> {
  const byPattern = schedulesByPattern(leaf);
  const out = new Map<string, ByHeadsign>();
  for (const s of services) {
    const routePatterns = leaf.routePatterns.filter((p) => s.routePatternIds.has(p.id));
    const patternIds = new Set(routePatterns.map((p) => p.id));
    const stopIds = filterStopsByPatterns(routePatterns, g, leaf.stopIds);
    const major = applicableAlertsAnyTime(
      leaf.alertsHere.filter((a) => significanceRank(significanceAt(a, now)) >= significanceRank('major')),
      {
        directionId: leaf.direction.id,
        routeIds: routePatterns.map((p) => p.routeId),
        routeType: lineOrRouteType(leaf.lineOrRoute),
        stopIds,
      },
    );
    out.set(s.headsign, {
      stopIds,
      routePatterns,
      hasSchedulesToday: Object.entries(byPattern).some(([id, v]) => patternIds.has(id) && v),
      allUpcomingTrips: leaf.upcomingTrips.filter((t) => tripHeadsign(t) === s.headsign),
      majorAlert: major[0] ?? null,
    });
  }
  return out;
}

const minSortOrder = (patterns: RoutePattern[]) =>
  patterns.length ? Math.min(...patterns.map((p) => p.sortOrder)) : Number.POSITIVE_INFINITY;

/**
 * Branch-row ids double as React keys, so they must be stable across re-formats: the upcoming
 * trip's id for trip rows, else the row kind with its route and headsign (unique within a leaf).
 * Kotlin uses a random id here, which is not a reconciliation key.
 */
const tripRowId = (f: FormattedTrip) => `trip:${f.id}`;
const headsignRowId = (kind: 'disruption' | 'noTrips', routeId: string | undefined, headsign: string) => `${kind}:${routeId ?? ''}:${headsign}`;

function formatForBranchedService(
  leaf: RouteCardLeaf,
  services: PotentialService[],
  formattedTrips: FormattedTrip[],
  representativeRoute: Route,
  warningAlert: WarningAlert | null,
  g: GlobalData,
  now: number,
): LeafFormat {
  const includeRoute = leaf.lineOrRoute.kind === 'line';
  const routeFor = (id: string | undefined) => (includeRoute && id ? (g.routes[id] ?? null) : null);
  const byHeadsign = dataByHeadsign(leaf, services, g, now);
  const entries = [...byHeadsign.entries()];
  const nonDisrupted = entries.filter(([, d]) => d.majorAlert === null || d.majorAlert.informedEntities.some((e) => e.tripId !== null) || isStopSkipped(d.majorAlert));
  const disrupted = entries.filter((e) => !nonDisrupted.includes(e));

  if (disrupted.length === 0) {
    return {
      kind: 'branched',
      rows: formattedTrips.map((f) => ({
        id: tripRowId(f),
        route: routeFor(upcomingRouteId(f.trip)),
        headsign: tripHeadsign(f.trip),
        format: { kind: 'some', trips: [f], secondaryAlert: null },
      })),
      secondaryAlert: warningAlert,
    };
  }

  const firstMajor = disrupted[0][1].majorAlert;
  if (
    nonDisrupted.length === 0 &&
    disrupted.every(
      ([, d]) => d.majorAlert === firstMajor && !d.majorAlert!.informedEntities.some((e) => e.tripId !== null) && !isStopSkipped(d.majorAlert!),
    )
  ) {
    return {
      kind: 'single',
      route: null,
      headsign: null,
      format: { kind: 'disruption', alert: firstMajor!, iconName: iconNameFor(alertState(firstMajor!), representativeRoute) },
    };
  }

  const maxRows = leaf.context === 'stopDetailsFiltered' ? leaf.upcomingTrips.length + byHeadsign.size : BRANCHING_LEAF_ROWS;
  const disruptedRows = [...disrupted]
    .sort((a, b) => minSortOrder(a[1].routePatterns) - minSortOrder(b[1].routePatterns))
    .slice(0, maxRows)
    .map(([headsign, d]) => ({
      id: headsignRowId('disruption', d.routePatterns[0]?.routeId, headsign),
      route: routeFor(d.routePatterns[0]?.routeId),
      headsign,
      format: {
        kind: 'disruption',
        alert: d.majorAlert!,
        iconName: iconNameFor(alertState(d.majorAlert!), representativeRoute),
      } as UpcomingFormat,
    }));
  let remaining = Math.max(1, maxRows - disruptedRows.length);
  const tripRows = formattedTrips.slice(0, remaining).map((f) => ({
    id: tripRowId(f),
    route: routeFor(upcomingRouteId(f.trip)),
    headsign: tripHeadsign(f.trip),
    format: { kind: 'some', trips: [f], secondaryAlert: null } as UpcomingFormat,
  }));
  remaining = Math.max(0, remaining - tripRows.length);
  const unavailableRows =
    remaining > 0
      ? [...nonDisrupted]
          .filter(([headsign]) => !tripRows.some((r) => r.headsign === headsign))
          .sort((a, b) => minSortOrder(a[1].routePatterns) - minSortOrder(b[1].routePatterns))
          .flatMap(([headsign, d]) => {
            const noTrips = noTripsFormatFrom(d.allUpcomingTrips, d.hasSchedulesToday, now, leaf.subwayServiceStartTime);
            if (noTrips.kind !== 'predictionsUnavailable') return [];
            return [
              {
                id: headsignRowId('noTrips', d.routePatterns[0]?.routeId, headsign),
                route: routeFor(d.routePatterns[0]?.routeId),
                headsign,
                format: { kind: 'noTrips', noTrips, secondaryAlert: null } as UpcomingFormat,
              },
            ];
          })
          .slice(0, remaining)
      : [];

  return { kind: 'branched', rows: [...tripRows, ...unavailableRows, ...disruptedRows], secondaryAlert: warningAlert };
}

/** Format a leaf for display (RouteCardData.Leaf.format). */
export function formatLeaf(leaf: RouteCardLeaf, now: number, g: GlobalData): LeafFormat {
  const representativeRoute = sortRoute(leaf.lineOrRoute);
  const includeRoute = leaf.lineOrRoute.kind === 'line';
  const routeType = representativeRoute.type;
  const allTripsWithFormat = withFormat(leaf.upcomingTrips, now, representativeRoute, toDisplayContext(leaf.context));
  const services = potentialService(leaf, allTripsWithFormat, representativeRoute, g);
  const isBranching = services.length > 1;
  const count =
    leaf.context === 'stopDetailsFiltered' ? null : isBranching && routeType !== 3 ? BRANCHING_LEAF_ROWS : TYPICAL_LEAF_ROWS;
  const allShown = allTripsWithFormat.map((t) => t.format).filter((f): f is FormattedTrip => f !== null);
  const tripsToShow = count === null ? allShown : allShown.slice(0, count);

  const warning = warningAlertToDisplay(leaf, now);
  const warningAlert: WarningAlert | null = warning ? { iconName: iconNameFor('issue', representativeRoute), alertId: warning.id } : null;
  const majorAll = majorAlertAffectingAllTrips(leaf.alertsHere, now);

  if (majorAll === null && tripsToShow.length === 0) {
    const service = isBranching ? null : (services[0] ?? null);
    const route = includeRoute && service ? (g.routes[service.routeId] ?? null) : null;
    if (!leaf.allDataLoaded) return { kind: 'single', route, headsign: service?.headsign ?? null, format: { kind: 'loading' } };
    const hasSchedulesToday = Object.values(schedulesByPattern(leaf)).some(Boolean);
    return {
      kind: 'single',
      route,
      headsign: service?.headsign ?? null,
      format: {
        kind: 'noTrips',
        noTrips: noTripsFormatFrom(leaf.upcomingTrips, hasSchedulesToday, now, leaf.subwayServiceStartTime),
        secondaryAlert: warningAlert,
      },
    };
  }

  if (isBranching) return formatForBranchedService(leaf, services, tripsToShow, representativeRoute, warningAlert, g, now);

  const single = services.length === 1 ? services[0] : null;
  const route = includeRoute && single ? (g.routes[single.routeId] ?? null) : null;
  const format: UpcomingFormat = majorAll
    ? { kind: 'disruption', alert: majorAll, iconName: iconNameFor(alertState(majorAll), representativeRoute) }
    : { kind: 'some', trips: tripsToShow, secondaryAlert: warningAlert };
  return { kind: 'single', route, headsign: single?.headsign ?? null, format };
}

// --- building (RouteCardData.ListBuilder) --------------------------------------------

/** Stop.resolvedParentToAllStops: parent -> [given children..., parent], in first-seen order. */
export function resolvedParentToAllStops(stopIds: string[], g: GlobalData): Map<string, { parent: Stop; stopIds: string[] }> {
  const out = new Map<string, { parent: Stop; stopIds: string[] }>();
  for (const id of stopIds) {
    const stop = g.stops[id];
    if (!stop) continue;
    const parent = resolveParentStop(g.stops, stop);
    let entry = out.get(parent.id);
    if (!entry) {
      entry = { parent, stopIds: [] };
      out.set(parent.id, entry);
    }
    if (!entry.stopIds.includes(stop.id)) entry.stopIds.push(stop.id);
  }
  for (const entry of out.values()) if (!entry.stopIds.includes(entry.parent.id)) entry.stopIds.push(entry.parent.id);
  return out;
}

type PatternsForStop = { allPatterns: RoutePattern[]; patternsNotSeenAtEarlierStops: Set<string> };

/** RoutePattern.patternsGroupedByLineOrRouteAndStop. */
function patternsGrouped(
  parentToAllStops: Map<string, { parent: Stop; stopIds: string[] }>,
  g: GlobalData,
  context: RouteCardContext,
  alerts: Alert[] | null,
  now: number,
  favorites: ReadonlySet<string> | undefined,
): Map<string, { lineOrRoute: LineOrRoute; stops: Map<string, { stop: Stop; patterns: PatternsForStop }> }> {
  const used = new Set<string>();
  const majorUsed = new Set<string>();
  const grouped = new Map<string, { lineOrRoute: LineOrRoute; stops: Map<string, { stop: Stop; patterns: PatternsForStop }> }>();
  const inFavorites = context === 'favorites';
  const favoriteRouteStops = favorites ? new Set([...favorites].map((k) => k.split('|').slice(0, 2).join('|'))) : null;
  const byLine = routesByLineId(g);

  for (const { parent, stopIds } of parentToAllStops.values()) {
    // patternsByRouteOrLine
    const byLr = new Map<string, { lineOrRoute: LineOrRoute; patterns: RoutePattern[] }>();
    for (const stopId of stopIds) {
      for (const patternId of g.patternIdsByStop[stopId] ?? []) {
        const pattern = g.patterns[patternId];
        const route = pattern ? g.routes[pattern.routeId] : undefined;
        if (!pattern || !route) continue;
        const lr = lineOrRouteFor(g, route, byLine);
        let e = byLr.get(lr.id);
        if (!e) {
          e = { lineOrRoute: lr, patterns: [] };
          byLr.set(lr.id, e);
        }
        e.patterns.push(pattern);
      }
    }

    for (const { lineOrRoute, patterns } of byLr.values()) {
      if (inFavorites && favoriteRouteStops && !favoriteRouteStops.has(`${lineOrRoute.id}|${parent.id}`)) continue;
      const hasMajorAlert = new Map<number, boolean>();
      for (const d of new Set(patterns.map((p) => p.directionId))) {
        hasMajorAlert.set(
          d,
          alerts !== null &&
            applicableAlertsAnyTime(alerts, {
              directionId: d,
              routeIds: allRoutes(lineOrRoute).map((r) => r.id),
              routeType: lineOrRouteType(lineOrRoute),
              stopIds,
            }).some((a) => significanceAt(a, now) === 'major'),
        );
      }
      let card = grouped.get(lineOrRoute.id);
      if (!card) {
        card = { lineOrRoute, stops: new Map() };
        grouped.set(lineOrRoute.id, card);
      }
      const notSeen = new Set(
        patterns
          .filter((p) => !(used.has(p.id) || (hasMajorAlert.get(p.directionId) === true && majorUsed.has(p.id))))
          .map((p) => p.id),
      );
      if (notSeen.size === 0) continue;
      const skipPattern = (p: RoutePattern) =>
        inFavorites && favorites !== undefined && !favorites.has(rsdKey({ routeId: lineOrRoute.id, stopId: parent.id, directionId: p.directionId }));
      if (!card.stops.has(parent.id)) {
        card.stops.set(parent.id, {
          stop: parent,
          patterns: { allPatterns: patterns.filter((p) => !skipPattern(p)), patternsNotSeenAtEarlierStops: notSeen },
        });
      }
      // Favorites need stops on the same pattern to show up too.
      if (!inFavorites) {
        for (const p of patterns) (hasMajorAlert.get(p.directionId) ? majorUsed : used).add(p.id);
      }
    }
  }
  return grouped;
}

type LeafBuilder = {
  lineOrRoute: LineOrRoute;
  stop: Stop;
  direction: Direction;
  routePatterns: RoutePattern[];
  patternsNotSeenAtEarlierStops: Set<string>;
  stopIds: string[];
  upcomingTrips: UpcomingTrip[] | null;
  alertsHere: Alert[];
  alertsDownstream: Alert[];
  allDataLoaded: boolean;
  hasSchedulesTodayByPattern: Record<string, boolean> | null;
  subwayServiceStartTime: number | null;
  context: RouteCardContext;
};

type CardBuilder = { lineOrRoute: LineOrRoute; stops: Map<string, { stop: Stop; directions: Direction[]; leaves: Map<number, LeafBuilder> }> };

function addStaticStopsData(
  stopIds: string[],
  g: GlobalData,
  context: RouteCardContext,
  alerts: Alert[] | null,
  favorites: ReadonlySet<string> | undefined,
  allDataLoaded: boolean,
  now: number,
): { cards: Map<string, CardBuilder>; parentToAllStops: Map<string, { parent: Stop; stopIds: string[] }> } {
  const parentToAllStops = resolvedParentToAllStops(stopIds, g);
  const grouped = patternsGrouped(parentToAllStops, g, context, alerts, now, favorites);
  const cards = new Map<string, CardBuilder>();
  for (const { lineOrRoute, stops } of grouped.values()) {
    const card: CardBuilder = { lineOrRoute, stops: new Map() };
    for (const { stop, patterns } of stops.values()) {
      const typical = patterns.allPatterns.filter(isTypical);
      const directions =
        lineOrRoute.kind === 'line'
          ? getDirectionsForLine(g, stop, typical)
          : getDirections(g, stop, lineOrRoute.route, typical);
      const leaves = new Map<number, LeafBuilder>();
      const byDirection = new Map<number, RoutePattern[]>();
      for (const p of patterns.allPatterns) {
        const list = byDirection.get(p.directionId) ?? [];
        list.push(p);
        byDirection.set(p.directionId, list);
      }
      for (const [directionId, routePatterns] of byDirection) {
        const direction = directions.find((d) => d.id === directionId) ?? { id: directionId as 0 | 1, name: '', destination: '' };
        leaves.set(directionId, {
          lineOrRoute,
          stop,
          direction,
          routePatterns,
          patternsNotSeenAtEarlierStops: new Set(routePatterns.map((p) => p.id).filter((id) => patterns.patternsNotSeenAtEarlierStops.has(id))),
          stopIds: filterStopsByPatterns(routePatterns, g, parentToAllStops.get(stop.id)?.stopIds ?? [stop.id]),
          upcomingTrips: null,
          alertsHere: [],
          alertsDownstream: [],
          allDataLoaded,
          hasSchedulesTodayByPattern: null,
          subwayServiceStartTime: null,
          context,
        });
      }
      card.stops.set(stop.id, { stop, directions, leaves });
    }
    cards.set(lineOrRoute.id, card);
  }
  return { cards, parentToAllStops };
}

function* eachLeaf(cards: Map<string, CardBuilder>) {
  for (const [cardId, card] of cards) {
    for (const [stopId, stop] of card.stops) {
      for (const [directionId, leaf] of stop.leaves) yield { cardId, stopId, directionId, leaf };
    }
  }
}

function addUpcomingTrips(
  cards: Map<string, CardBuilder>,
  schedules: ScheduleSet | null,
  predictions: LiveDepartures | null,
  now: number,
  g: GlobalData,
  alerts: Alert[] | null,
  allDataLoaded: boolean = schedules !== null,
) {
  const trips = buildUpcomingTrips(g, schedules, predictions, undefined, { now, alerts });
  const byLine = routesByLineId(g);
  const bySlot = new Map<string, UpcomingTrip[]>();
  for (const t of trips) {
    const stopId = upcomingStopId(t);
    const stop = stopId ? g.stops[stopId] : undefined;
    if (!stop) continue;
    const parentId = resolveParentStop(g.stops, stop).id;
    const route = g.routes[upcomingRouteId(t)];
    if (!route) continue;
    const lrId = lineOrRouteFor(g, route, byLine).id;
    const key = `${lrId}|${parentId}|${t.trip.directionId}`;
    const list = bySlot.get(key) ?? [];
    list.push(t);
    bySlot.set(key, list);
  }
  const hasSchedulesByPattern: Record<string, boolean> | null = schedules ? {} : null;
  if (schedules && hasSchedulesByPattern) {
    for (const s of schedules.schedules) {
      const patternId = schedules.trips[s.tripId]?.routePatternId;
      if (patternId) hasSchedulesByPattern[patternId] = true;
    }
  }
  for (const { cardId, stopId, directionId, leaf } of eachLeaf(cards)) {
    leaf.upcomingTrips = bySlot.get(`${cardId}|${stopId}|${directionId}`) ?? null;
    leaf.allDataLoaded = allDataLoaded;
    leaf.hasSchedulesTodayByPattern = hasSchedulesByPattern
      ? Object.fromEntries(leaf.routePatterns.map((p) => [p.id, hasSchedulesByPattern[p.id] ?? false]))
      : null;
    if (isSubwayLineOrRoute(leaf.lineOrRoute) && schedules) {
      const times = schedules.schedules
        .filter(
          (s) =>
            containsRoute(leaf.lineOrRoute, s.routeId) &&
            leaf.stopIds.includes(s.stopId) &&
            schedules.trips[s.tripId]?.directionId === leaf.direction.id,
        )
        .map((s) => stopTimeOf(s))
        .filter((x): x is number => x !== null);
      leaf.subwayServiceStartTime = times.length ? Math.min(...times) : null;
    } else {
      leaf.subwayServiceStartTime = null;
    }
  }
}

/** True if every typical (else any) pattern ends at this stop. */
function isLastStopOnRoutePattern(leaf: LeafBuilder, stop: Stop, g: GlobalData): boolean {
  const typical = leaf.routePatterns.filter((p) => p.typicality === 'typical');
  const patterns = typical.length ? typical : leaf.routePatterns;
  if (patterns.length === 0) return false;
  return patterns.every((p) => {
    const ids = g.trips[p.representativeTripId]?.stopIds;
    if (!ids || ids.length === 0) return false;
    const last = ids[ids.length - 1];
    return last === stop.id || stop.childStopIds.includes(last);
  });
}

/** LeafBuilder.shouldShow (cutoffTime is always null here). */
function shouldShow(leaf: LeafBuilder, stop: Stop, now: number, showAllWhileLoading: boolean, g: GlobalData, cutoff: number | null = null): boolean {
  if (!leaf.allDataLoaded && showAllWhileLoading) return true;
  const lr = leaf.lineOrRoute;
  const isBus = lineOrRouteType(lr) === 3;
  const inCutoff = leaf.upcomingTrips
    ?.filter((t) => (cutoff === null ? isUpcoming(t) : isUpcomingWithin(t, cutoff)))
    .filter((t) => isInTheFuture(t, now) || isVehicleAtTheStop(t) || doesPredictionHaveStatus(t))
    .slice(0, isBus ? TYPICAL_LEAF_ROWS : BRANCHING_LEAF_ROWS);
  const arrivalOnly = isLastStopOnRoutePattern(leaf, stop, g) && (leaf.upcomingTrips ? allArrivalOnly(leaf.upcomingTrips) : true);
  const shuttleWithNoServiceToday = (inCutoff ?? []).length === 0 && isShuttleLineOrRoute(lr);
  if (leaf.context !== 'nearby') return !arrivalOnly && !shuttleWithNoServiceToday;
  const hasUnseenUpcomingTrip =
    inCutoff?.some((t) => (t.trip.routePatternId === null ? true : leaf.patternsNotSeenAtEarlierStops.has(t.trip.routePatternId))) ?? false;
  const hasUnseenTypicalPattern = leaf.routePatterns.some(
    (p) => (leaf.patternsNotSeenAtEarlierStops.has(p.id) && isTypical(p)) || isCanonicalOnly(p),
  );
  return (hasUnseenTypicalPattern || hasUnseenUpcomingTrip) && !arrivalOnly && !shuttleWithNoServiceToday;
}

function filterIrrelevantData(cards: Map<string, CardBuilder>, now: number, context: RouteCardContext, g: GlobalData) {
  const showAll = isStopDetails(context);
  for (const [cardId, card] of [...cards]) {
    for (const [stopId, stop] of [...card.stops]) {
      for (const [dir, leaf] of [...stop.leaves]) {
        if (!shouldShow(leaf, stop.stop, now, showAll, g)) stop.leaves.delete(dir);
        else if (leaf.upcomingTrips) leaf.upcomingTrips = leaf.upcomingTrips.filter((t) => !(isArrivalOnly(t) ?? false));
      }
      if (stop.leaves.size === 0) card.stops.delete(stopId);
    }
    if (card.stops.size === 0) cards.delete(cardId);
  }
}

function addAlerts(cards: Map<string, CardBuilder>, alerts: Alert[] | null, includeMinor: boolean, now: number, g: GlobalData) {
  const threshold = significanceRank(includeMinor ? 'minor' : 'accessibility');
  const relevant = (alerts ?? []).filter(
    (a) => (isActive(a, now) || willBeActiveSoon(a, now)) && significanceRank(significanceAt(a, now)) >= threshold,
  );
  const byLine = routesByLineId(g);
  for (const { cardId, stopId, directionId, leaf } of eachLeaf(cards)) {
    let routes: string[];
    if (leaf.lineOrRoute.kind === 'line') {
      const fromPatterns = [
        ...new Set(leaf.routePatterns.filter((p) => !GREEN_ROUTES.includes(p.routeId) || isTypical(p)).map((p) => p.routeId)),
      ];
      routes = fromPatterns.length ? fromPatterns : (byLine[cardId] ?? []).map((r) => r.id);
    } else {
      routes = [cardId];
    }
    const routeType = routes[0] !== undefined ? g.routes[routes[0]]?.type : undefined;
    if (routeType === undefined) continue;
    const stop = g.stops[stopId];
    const crCore = stop ? isCRCore(stop) : false;
    let applicable = applicableAlertsAnyTime(relevant, {
      directionId: directionId as 0 | 1,
      routeIds: routes,
      routeType,
      stopIds: leaf.stopIds,
    });
    if (crCore) applicable = applicable.filter((a) => a.effect !== 'TRACK_CHANGE');
    const alertsHere = distinctAlerts([...applicable, ...elevatorAlerts(relevant, leaf.stopIds)]);
    const isGL = leaf.routePatterns.some((p) => GREEN_ROUTES.includes(p.routeId));
    const otherBranches = isGL
      ? applicableAlertsAnyTime(relevant, {
          directionId: directionId as 0 | 1,
          routeIds: GREEN_ROUTES.filter((r) => !routes.includes(r)),
          routeType,
          stopIds: leaf.stopIds,
        }).filter((a) => !alertsHere.some((h) => h.id === a.id))
      : [];
    leaf.alertsHere = alertsHere;
    leaf.alertsDownstream = [...alertsDownstreamForPatterns(relevant, leaf.routePatterns, routeType, leaf.stopIds, g.trips), ...otherBranches];
  }
}

function buildLeaf(b: LeafBuilder): RouteCardLeaf {
  const byPattern = b.hasSchedulesTodayByPattern ?? Object.fromEntries(b.routePatterns.map((p) => [p.id, false]));
  return {
    lineOrRoute: b.lineOrRoute,
    stop: b.stop,
    direction: b.direction,
    routePatterns: b.routePatterns,
    stopIds: b.stopIds,
    upcomingTrips: b.upcomingTrips ?? [],
    alertsHere: b.alertsHere,
    alertsDownstream: b.alertsDownstream,
    hasSchedulesToday: Object.values(byPattern).some(Boolean),
    subwayServiceStartTime: b.subwayServiceStartTime,
    allDataLoaded: b.allDataLoaded,
    context: b.context,
    hasSchedulesTodayByPattern: byPattern,
  };
}

function build(cards: Map<string, CardBuilder>, from: LatLng | null, now: number, context: RouteCardContext): RouteCard[] {
  const result: RouteCard[] = [];
  for (const card of cards.values()) {
    const stops: RouteStopData[] = [...card.stops.values()].map(({ stop, directions, leaves }) => {
      const built = [...leaves.values()].map(buildLeaf).sort(compareLeavesAtStop(now));
      return {
        lineOrRoute: card.lineOrRoute,
        stop,
        directions,
        leaves: built,
        distanceMeters: from ? distanceMeters(from, { latitude: stop.latitude, longitude: stop.longitude }) : null,
        elevatorAlerts: distinctAlerts(built.flatMap((l) => l.alertsHere).filter((a) => a.effect === 'ELEVATOR_CLOSURE')),
      };
    });
    if (stops.length === 0) continue;
    result.push({ id: card.lineOrRoute.id, lineOrRoute: card.lineOrRoute, stops: stops.sort(compareStopsOnRoute(now)), at: now });
  }
  return result.sort((a, b) => compareRouteCards(a, b, context));
}

/**
 * Step-by-step builder mirroring Kotlin's RouteCardData.ListBuilder, exported so the ported
 * golden tests can check intermediate stages. App code should call `routeCardsForStopList`.
 */
export class RouteCardListBuilder {
  cards: Map<string, CardBuilder> = new Map();

  constructor(
    readonly allDataLoaded: boolean,
    readonly context: RouteCardContext,
    readonly now: number,
  ) {}

  addStaticStopsData(stopIds: string[], g: GlobalData, alerts: Alert[] | null, favorites?: ReadonlySet<string>): this {
    this.cards = addStaticStopsData(stopIds, g, this.context, alerts, favorites, this.allDataLoaded, this.now).cards;
    return this;
  }

  addUpcomingTrips(
    schedules: ScheduleSet | null,
    predictions: LiveDepartures | null,
    g: GlobalData,
    alerts: Alert[] | null,
    allDataLoaded: boolean = schedules !== null,
  ): this {
    addUpcomingTrips(this.cards, schedules, predictions, this.now, g, alerts, allDataLoaded);
    return this;
  }

  filterIrrelevantData(g: GlobalData): this {
    filterIrrelevantData(this.cards, this.now, this.context, g);
    return this;
  }

  addAlerts(alerts: Alert[] | null, includeMinorAlerts: boolean, g: GlobalData): this {
    addAlerts(this.cards, alerts, includeMinorAlerts, this.now, g);
    return this;
  }

  build(sortByDistanceFrom: LatLng | null): RouteCard[] {
    return build(this.cards, sortByDistanceFrom, this.now, this.context);
  }

  /** Plain snapshot of the intermediate state, for tests. */
  snapshot() {
    return [...this.cards.values()].map((card) => ({
      id: card.lineOrRoute.id,
      stops: [...card.stops.values()].map((s) => ({
        stopId: s.stop.id,
        leaves: [...s.leaves.entries()].map(([dir, l]) => ({
          dir,
          direction: l.direction,
          routePatternIds: l.routePatterns.map((p) => p.id),
          patternsNotSeenAtEarlierStops: [...l.patternsNotSeenAtEarlierStops].sort(),
          stopIds: [...l.stopIds].sort(),
          upcomingTripIds: l.upcomingTrips?.map((t) => t.id) ?? null,
          alertIdsHere: l.alertsHere.map((a) => a.id),
          alertIdsDownstream: l.alertsDownstream.map((a) => a.id),
          allDataLoaded: l.allDataLoaded,
          hasSchedulesTodayByPattern: l.hasSchedulesTodayByPattern,
          subwayServiceStartTime: l.subwayServiceStartTime,
          context: l.context,
        })),
      })),
    }));
  }
}

/**
 * Route cards for a list of stops (RouteCardData.routeCardsForStopList), ordered nearest-first by
 * the caller. Null only while global data is missing. Leaves show "loading" until both schedules
 * and predictions have arrived; missing alerts are treated as none.
 */
export function routeCardsForStopList(i: RouteCardInput): RouteCard[] | null {
  const g = i.global;
  if (!g) return null;
  const allDataLoaded = i.schedules !== null && i.predictions !== null;
  return new RouteCardListBuilder(allDataLoaded, i.context, i.now)
    .addStaticStopsData(i.stopIds, g, i.alerts, i.favorites)
    .addUpcomingTrips(i.schedules, i.predictions, g, i.alerts, allDataLoaded)
    .filterIrrelevantData(g)
    .addAlerts(i.alerts, isStopDetails(i.context), g)
    .build(i.sortByDistanceFrom);
}

/** Static cards with no realtime data (RouteCardData.routeCardsForStaticStopList). */
export function routeCardsForStaticStopList(i: {
  stopIds: string[];
  global: GlobalData;
  context: RouteCardContext;
  now: number;
  sortByDistanceFrom?: LatLng | null;
  favorites?: ReadonlySet<string>;
}): RouteCard[] {
  return new RouteCardListBuilder(true, i.context, i.now)
    .addStaticStopsData(i.stopIds, i.global, null, i.favorites)
    .addAlerts([], false, i.global)
    .build(i.sortByDistanceFrom ?? null);
}

/** Subway check used by UI pills and filters. */
export const isSubwayRoute = (r: Route) => isSubwayType(r.type);
