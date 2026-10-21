/**
 * Planner tuning constants [AR §3.2, spec WP3]. They are estimates, not calibrated against
 * schedules, so results built from them are labelled "estimated" in the UI.
 */

const MIN = 60_000;

/** Stations considered for boarding near the origin and alighting near the destination. */
export const CANDIDATE_RADIUS_M = 1200;
export const MAX_CANDIDATE_STATIONS = 4;
/** Street-grid detour factor for walking (walk minutes = meters × 1.3 ÷ 80). */
export const WALK_DETOUR = 1.3;

/** Average minutes per hop between adjacent stations. */
export const HOP_MIN = { heavyRail: 2.0, greenSubway: 1.8, lightRailSurface: 2.2 } as const;

/** Green Line stations in the central subway, where hops are shorter than on the surface branches. */
export const GREEN_SUBWAY_STATIONS: ReadonlySet<string> = new Set([
  'place-lech',
  'place-spmnl',
  'place-north',
  'place-haecl',
  'place-gover',
  'place-pktrm',
  'place-boyls',
  'place-armnl',
  'place-coecl',
  'place-hymnl',
  'place-kencl',
  'place-prmnl',
  'place-symcl',
]);

/** Rough midday headways (minutes) used only for the transfer pre-score. */
export const HEADWAY_MIN: Readonly<Record<string, number>> = {
  'line-Red': 9,
  'line-Orange': 8,
  'line-Blue': 7,
  'line-Green': 7,
  'line-Mattapan': 10,
};
export const DEFAULT_HEADWAY_MIN = 10;
/** Pre-score transfer penalty = base + headway / 2. */
export const TRANSFER_BASE_MIN = 4;

/** Transfer time allowed between legs: same line (Green trunk, Red at JFK) vs a level change. */
export const TRANSFER_MIN_SAME_LINE = 3;
export const TRANSFER_MIN_DEFAULT = 5;

/** Transit options kept after pre-scoring. */
export const TOP_TRANSIT_OPTIONS = 5;
/** Later departures listed under a transit leg. */
export const LATER_DEPARTURES = 2;

/** Bike + T: boarding/alighting stations this far from the origin/destination. */
export const MIXED_MIN_M = 1000;
export const MIXED_MAX_M = 4000;
export const MAX_MIXED_STATIONS = 3;
/** A dock this close to the station serves a bike+T transfer. */
export const DOCK_NEAR_STATION_M = 300;
/** A dock this close to the origin or destination is walkable. */
export const DOCK_NEAR_PLACE_M = 500;
/** A pure bike trip is offered only within this straight-line range. */
export const BIKE_MIN_M = 800;
export const BIKE_MAX_M = 12_000;

/** Below this distance origin and destination count as the same place. */
export const SAME_PLACE_M = 50;
/** Walk legs shorter than this are dropped from itineraries. */
export const MIN_WALK_LEG_M = 25;

/** Schedule fallback calls allowed per plan evaluation (trip schedules + windows) [§2.3]. */
export const MAX_SCHEDULE_FALLBACKS = 2;
/** Schedule-window fallback looks this far past now, plus the longest ride estimate. */
export const SCHEDULE_WINDOW_MIN = 60;
export const SCHEDULE_WINDOW_SLACK_MIN = 10;
/** Cached schedule windows are reused for this long across refreshes. */
export const SCHEDULE_WINDOW_REUSE_MS = 15 * MIN;

/** Ranking: score = arrival + weather penalty + this per transfer. */
export const TRANSFER_SCORE_MIN = 1;
export const WEATHER_PENALTY_MIN = { caution: 5, avoid: 15 } as const;
/** Itineraries shown at most. */
export const MAX_ITINERARIES = 6;

/** NWS bike advisory thresholds (spec WP3). */
export const WEATHER_RULES = {
  avoidPrecipPct: 60,
  cautionPrecipPct: 30,
  cautionWindMph: 20,
  coldF: 28,
  hotF: 92,
  avoidPattern: /thunder|snow|sleet|freezing|ice/i,
  cautionPattern: /rain|showers|drizzle/i,
} as const;

/** Greater Boston box for geocoding: west, south, east, north. */
export const BOSTON_BBOX = { west: -71.3, south: 42.2, east: -70.85, north: 42.5 } as const;
