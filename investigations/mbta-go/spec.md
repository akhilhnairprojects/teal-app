# Teal v2: implementation spec (clean-room, MBTA Go rules + destination planner)

Status: ready for build once the open decisions in section 7 are confirmed.
Evidence: `MA` = `investigations/mbta-go/mobile_app.md`, `AR` = `investigations/mbta-go/api-and-routing.md`.
Kotlin sources cited as `S/...` (MBTA Go `shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/`, commit `8c49ac5`, MIT).
The clone lives in a temp scratchpad (`...\e452beb0-...\scratchpad\mbta-repos\mobile_app`). If it is gone, run `git clone https://github.com/mbta/mobile_app` and check out `8c49ac5`.
Labels: **[obs]** observed in the evidence. **[ours]** our design choice. **[ext]** general external knowledge, not verified here.

---

## 1. Goal and observed behavior to reproduce

**Goal.** Teal v2 is an iPhone app that runs in Expo Go.
- Layout: a full-screen Apple Map with a draggable bottom sheet.
- The sheet has Nearby route cards, a destination planner, and Favorites. From there the user pushes Stop details, Trip details, Alert details, and Search.
- Nearby, Stop details and Trip details follow MBTA Go's departure, grouping, alert and crowding rules, ported as pure TypeScript.
- The planner compares T (direct or one transfer), Bluebikes, bike+T, and walking. It accounts for live predictions, MBTA alerts and NWS weather, and recommends the least-crowded car when per-car data exists.
- Teal's own identity stays: the teal/mint palette, Manrope, the "teal." wordmark, and light and dark themes. No MBTA branding.

**Observed behavior to reproduce:**
- **Shell.** Full-screen map plus bottom sheet. The sheet holds a navigation stack. A search bar shows only on the top-level lists. Pushed pages get a back button [MA §0].
- **Departure strings.** `TripInstantDisplay` runs a fixed decision order over prediction, schedule, vehicle, route type, context, last trip and alert. Cutoffs are 30/60/90 s and 60 min. Strings: BRD, ARR, Now, "1 min" for Approaching, `N min` / `N hr M min`, Cancelled, Shuttle, "Stop skipped" [MA §3.1, `S/model/TripInstantDisplay.kt`].
- **UpcomingTrip.**
  - Join schedules to predictions on `(route, trip, parent stop, stop_sequence)`.
  - Hide scheduled times on subway.
  - Headsign fallback: prediction trip, then stop_headsign, then trip.
  - Last-trip rules.
  - No-trips formats: First HH:MM, No service today, Predictions unavailable, Service ended.
  - [MA §3.1, `S/model/UpcomingTrip.kt`, `UpcomingFormat.kt`]
- **Nearby selection.**
  - Leaf stops within 0.5 mi (CR 1 mi), widening to 2 mi (CR 10 mi) if nothing is found.
  - Expand each stop to its siblings.
  - Blocklist `place-symcl`.
  - Order by distance.
  - Use the map center when the user pans.
  - [MA §3.2]
- **Route cards.**
  - Hierarchy: Line/Route → Stop → Direction leaf.
  - One `line-Green` card.
  - Pattern de-duplication by the closest stop.
  - Arrival-only leaves hidden.
  - 2 rows per leaf, 3 when branching (non-bus).
  - Card sort order: ≤100 ft first, then service bucket, then subway first, then distance, then sort_order.
  - Direction special cases: GL "Copley & West", "Kenmore & West", "Park St & North", "Gov Ctr & North", "North Station & North", "Lechmere & North"; Red "Ashmont" / "Braintree" past JFK.
  - [MA §3.3, `S/model/RouteCardData.kt`, `Direction.kt`, `PatternSorting.kt`, `LeafFormat.kt`]
- **Alerts.**
  - Intrinsic significance by effect.
  - Time cap: active, or starting within 24 h capped at Secondary, else None.
  - Major alerts that affect all trips replace predictions. Secondary and downstream alerts show a warning icon.
  - Nearby shows alerts at Accessibility and above. Stop details also shows Minor.
  - Matching uses the BOARD activity plus route, direction and stop.
  - [MA §3.4, `S/model/Alert.kt`, `AlertSignificance.kt`]
- **Vehicles and crowding.**
  - Status text: "Approaching" / "Next stop" / "Now at" / "Waiting to depart" / "Finishing another trip" / "Location not available yet".
  - Occupancy maps to Not crowded / Some crowding / Crowded.
  - A per-car diagram is shown when `carriages[]` exists. Crowding is hidden at the terminal.
  - The map shows vehicles only for the selected route and direction.
  - [MA §3.5]
- **Staleness.** A "stale" banner appears after 2 min with no update. Predictions are dropped after 10 min [MA §2.2].
- **Planner.**
  - MBTA Go has none [MA §5]. We build the client-side algorithm from [AR §3.2]:
    - Candidate stations within 1.2 km.
    - Direct and one-transfer patterns.
    - One predictions call joined by trip with a stop_sequence check.
    - Schedule fallbacks.
    - Alerts.
    - Bike legs from GBFS.
  - Call budget [AR §3.3].
  - Pitfalls: platform vs parent stops, per-route direction_id, Green branches, Red branches [AR §3.4].
  - Geocoding: local station names first, then Photon typeahead, then iOS `geocodeAsync` on submit, then web Nominatim on submit only [AR §4].
- **Rate limits.**
  - Without a key: 20 requests per 60 s per IP. With a key: 1,000 per minute.
  - Send the key as the `x-api-key` header.
  - Read the `x-ratelimit-*` headers and back off on 429 [AR §2].
- **Weather.** NWS `/points/{lat},{lon}` returns a `forecastHourly` URL. Live check from this session (2026-10-19, Boston): 200, `Access-Control-Allow-Origin: *`, `/points` Cache-Control max-age 86400. The hourly forecast periods carry `temperature`, `shortForecast`, `probabilityOfPrecipitation.value` and `windSpeed` ("1 mph") [obs].

---

## 2. Architecture

### 2.1 Folder layout (owner in brackets)
```
src/app/                         Expo Router routes; every route renders INSIDE the bottom sheet
  _layout.tsx [WP1]              providers + AppShell (map + sheet) wrapping <Stack/>
  index.tsx [WP1]                Nearby (default)
  plan.tsx [WP3]                 Plan a trip      ?toName&toLat&toLon&toStopId&q
  favorites.tsx [WP4]            Favorites
  search.tsx [WP4]               Search results   ?q
  more.tsx [WP4]                 About / attributions / licenses
  stop/[stopId].tsx [WP2]        Stop details     ?routeId&directionId (filter)
  trip/[tripId].tsx [WP2]        Trip details     ?stopId&stopSequence&vehicleId
  alert/[alertId].tsx [WP2]      Alert details
src/mbta/                [WP0]   api/, model/, global/, live/, rules/, time/, testing/
src/planner/types.ts     [WP0]   planner contracts; everything else in src/planner/ is WP3
src/state/               [WP0]   mapOverlay.ts, sheet.ts, favorites.ts, recents.ts
src/lib/                 [WP0]   geo.ts (extend), polyline.ts, cache.ts
src/ui/                  [WP0]   shared primitives (RoutePill, DepartureText, RouteCardView, ...)
src/features/shell|map|nearby [WP1]   features/stop|trip|alert [WP2]
src/features/planner [WP3]  src/weather/ [WP3]  src/geocode/ [WP3]
src/features/favorites|search|more [WP4]
src/data/bluebikes.ts [WP0, extended in place]   src/components/LiveDot.tsx [WP0, unchanged]
src/components/BikeStationCard.tsx [WP1]         src/hooks/useLocation.ts [WP0]
```
Retired by WP1, after its Nearby replaces them:
- `src/data/mbta.ts` and `src/data/__tests__/mbta.test.ts`
- `src/hooks/useNearby.ts`
- `src/components/TransitStationCard.tsx`

`useNow` moves to `src/mbta/live/usePolling.ts` (WP0). It is re-exported with the same signature.

### 2.2 Navigation: map + sheet with Expo Router [ours]
- `_layout.tsx` renders the following tree:
  ```
  GestureHandlerRootView > SafeAreaProvider > GlobalDataProvider >
    <View flex:1>
      <TealMap/>                  (absolute fill)
      <BottomSheet>
        <SheetChrome/>            (grabber; search bar + tab row only on top-level routes)
        <Stack/>                  (headerShown:false, transparent contentStyle, animation 'slide_from_right')
      </BottomSheet>
    </View>
  ```
  Every route file is sheet content.
- **Snap points** [ours]: `[132, '50%', '92%']`, i.e. collapsed / half / full. The sheet starts at half. `enableDynamicSizing={false}`, so the Stack has `flex:1`.
- **Top-level tabs.** Nearby (`/`), Plan (`/plan`) and Favorites (`/favorites`) are a segmented control in `SheetChrome`. It switches with `router.replace`.
- **Pushed pages.** Stop, trip, alert, search and more use `router.push`. Their `SheetPage` header shows a back chevron that calls `router.back()`.
- **Scrollables.** Each page scrolls only through `SheetScrollView` / `SheetFlatList` (WP0 wrappers over `BottomSheetScrollView` / `BottomSheetFlatList`), so the sheet's gestures and scrolling work together.
- **Map ↔ sheet communication** goes through two tiny external stores in WP0 (`useSyncExternalStore`, no new dependency):
  - `state/mapOverlay.ts`: a screen declares what the map should emphasize with `useMapOverlay(owner, overlay)`. The overlay is applied on focus and cleared on blur via expo-router `useFocusEffect`.
    - TealMap always draws rail shapes and stations from the global cache.
    - It adds route emphasis, live vehicles (TealMap polls them itself through `useVehicles`), a focused stop, and itinerary polylines from the active overlay.
    - Map taps navigate: a station goes to `/stop/[id]`, a vehicle goes to `/trip/[tripId]?vehicleId=`.
  - `state/sheet.ts`: `requestSheetDetent('collapsed'|'half'|'full')`. Screens call it, for example the planner calls `half` when it shows an itinerary on the map. WP1's shell subscribes and calls `snapToIndex`.
  - The Nearby position source is the user location, or the map center after a user pan [MA §3.2]. It is WP1-internal state in `features/map/mapCenter.ts`.
- **Web (static export demo).** `react-native-maps` has no web support [ext]. WP1 supplies `features/map/TealMap.web.tsx`, which draws the cached rail shapes and station dots as an inline `<svg>` (DOM elements are allowed in `.web.tsx`) in the Teal palette, with no tiles. The sheet works on web.

### 2.3 Polling and rate-limit strategy
`src/mbta/api/budget.ts` [WP0]:
- **Request queue.** Single queue with priorities `foreground > background > static`.
- **In-flight dedupe.** Requests are deduped by URL.
- **Token bucket.** Seeded from `x-ratelimit-limit/remaining/reset`. The defaults are 20/60 s without a key and 1000/60 s with a key [AR §2].
- **Reserve.** When `remaining ≤ 3`, only `foreground` requests run until reset.
- **On 429:**
  1. Mark the limiter as limited until `x-ratelimit-reset`, or now + 60 s if the header is missing.
  2. Reject queued requests with `MbtaApiError{kind:'rateLimited', resetAt}`.
  3. Hooks keep the last data and show `StatusBanner` "Live times paused · retrying in Ns" (or "add an API key" when there is none).
- **Pause rules.** `usePolling` pauses when the app is backgrounded (AppState) or the screen is unfocused. Only the focused page polls.

| Stream (owner of hook) | With key | Without key |
|---|---|---|
| Stop predictions `useStopLiveData` (Nearby, Stop, Favorites) | 10 s | 30 s |
| Stop schedules (same hook) | on stop-set change; cached 30 min per (stops, service date) | same |
| Alerts `useAlerts` (one app-wide poller) | 60 s | 120 s |
| Vehicles `useVehicles` (map; only with overlay route+direction) | 10 s | 30 s |
| Trip predictions (WP2 trip page) | 10 s | 30 s |
| Plan refresh while plan results are focused (WP3) | 30 s | 60 s |
| Global data / shapes | app start, if stale (2.4) | same |

- **Keyless worst case at steady state:** stop or trip predictions 2 + vehicles 2 + alerts 0.5 ≈ 4.5 calls/min, well under 20.
- **A plan costs:**
  - 1 MBTA predictions call.
  - Alerts reused from `useAlerts` (0 calls when fresh).
  - Up to 2 schedule fallbacks.
  - Non-MBTA calls: Bluebikes 1, NWS cached.
- **API key.** Read only as the literal `process.env.EXPO_PUBLIC_MBTA_API_KEY`, which Expo inlines statically. Absence sets `HAS_API_KEY=false`.

### 2.4 Caching (`src/lib/cache.ts`, AsyncStorage, `{v, fetchedAt, value}` envelopes)

| Key | TTL / invalidation | Contents |
|---|---|---|
| `teal.global.v1` | 24 h **or** service date changed; stale-while-revalidate (render cached, refetch in background) | `GlobalData` (rail only, ≈ <1 MB) |
| `teal.shapes.v1` | 7 days, or when the set of typical-pattern shape ids changes | `RailShapes` |
| `teal.bikeinfo.v1` | 6 h (matches the current `INFO_TTL_MS`) | GBFS station_information |
| `teal.nws.points.<lat3>,<lon3>` | 7 days | forecastHourly URL |
| `teal.nws.hourly.<url-hash>` | 10 min | hourly periods |
| `teal.favorites.v1`, `teal.recentStops.v1` | persistent | user data |

- Bumping a schema version discards the old envelope.
- Corrupt JSON counts as a cache miss.
- Global data is mode-scoped to `route_type 0,1` (decision 7.1).

**Global data requests** (cold start; 3 calls):
1. `/routes?filter[type]=0,1&include=line`
2. `/route_patterns?filter[route]=<ids>&include=representative_trip.stops,route.line&fields[stop]=`. This mirrors the MBTA Go backend [MA §2.1]. Fallback to the two-step `/route_patterns` + `/trips?filter[id]&include=stops` [AR §2.2] if `stops` relationships are missing.
3. `/stops?filter[route_type]=0,1&include=parent_station&fields[stop]=name,latitude,longitude,location_type,platform_code,platform_name,wheelchair_boarding,vehicle_type`

Shapes come from `/shapes/{shape_id}` for typical-pattern representative trips only. They are decoded with `lib/polyline.ts` (Google encoded-polyline algorithm, our own implementation).

---

## 3. Shared contracts (WP0 writes these first; other WPs import, never edit)

All times are **epoch ms** (`number`). Eastern wall-clock is derived only via `src/mbta/time/eastern.ts`.

```ts
// src/mbta/api/client.ts
export type ResourceIdentifier = { type: string; id: string };
export type Relationship = { data: ResourceIdentifier | ResourceIdentifier[] | null };
export type Resource<A = Record<string, unknown>> =
  { type: string; id: string; attributes: A; relationships?: Record<string, Relationship> };
export type JsonApiDocument<A> = { data: Resource<A>[] | Resource<A>; included?: Resource[] };
export type MbtaQuery = Record<string, string | number | readonly (string | number)[] | undefined>; // 'filter[stop]': [...]
export type RequestPriority = 'foreground' | 'background' | 'static';
export type MbtaErrorDetail =
  | { kind: 'rateLimited'; resetAt: number } | { kind: 'http'; status: number }
  | { kind: 'network'; message: string } | { kind: 'aborted' } | { kind: 'parse'; message: string };
export class MbtaApiError extends Error { readonly detail: MbtaErrorDetail }
export type IncludedIndex = { get(type: string, id: string): Resource | undefined };
export type MbtaResponse<A> = { doc: JsonApiDocument<A>; included: IncludedIndex; lastModified: string | null };
export const HAS_API_KEY: boolean;
export function mbtaGet<A>(path: string, query?: MbtaQuery,
  opts?: { signal?: AbortSignal; priority?: RequestPriority; ifModifiedSince?: string }): Promise<MbtaResponse<A>>;
export function relId(r: Resource, name: string): string | null;
export function relIds(r: Resource, name: string): string[];
export function useRateLimitState(): { limited: boolean; resetAt: number | null; remaining: number | null };
```

```ts
// src/mbta/model/types.ts
export type RouteType = 0 | 1 | 2 | 3 | 4;           // light rail, heavy rail, CR, bus, ferry
export type DirectionId = 0 | 1;
export type Route = { id: string; type: RouteType; color: string; textColor: string; // '#RRGGBB'
  shortName: string; longName: string; directionNames: [string | null, string | null];
  directionDestinations: [string | null, string | null]; sortOrder: number; lineId: string | null };
export type Line = { id: string; shortName: string; longName: string; color: string; textColor: string; sortOrder: number };
export type LocationType = 0 | 1 | 2 | 3;
export type Stop = { id: string; name: string; latitude: number; longitude: number; locationType: LocationType;
  parentStationId: string | null; childStopIds: string[]; platformCode: string | null;
  platformName: string | null; wheelchairBoarding: 0 | 1 | 2; vehicleType: RouteType | null };
export type Typicality = 'typical' | 'deviation' | 'atypical' | 'diversion' | 'canonical_only';
export type RoutePattern = { id: string; routeId: string; directionId: DirectionId; name: string;
  typicality: Typicality | null; canonical: boolean; sortOrder: number; representativeTripId: string };
export type Trip = { id: string; routeId: string; directionId: DirectionId; headsign: string;
  routePatternId: string | null; shapeId: string | null; stopIds: string[] | null }; // ordered platform ids when known
export type ScheduleRelationship = 'ADDED' | 'CANCELLED' | 'NO_DATA' | 'SKIPPED' | 'UNSCHEDULED' | null;
export type Prediction = { id: string; arrivalTime: number | null; departureTime: number | null;
  departureUncertainty: number | null; directionId: DirectionId; revenue: boolean;
  scheduleRelationship: ScheduleRelationship; status: string | null; stopSequence: number; lastTrip: boolean;
  routeId: string; stopId: string; tripId: string; vehicleId: string | null };
export type StopEventType = 0 | 1 | 2 | 3;
export type Schedule = { id: string; arrivalTime: number | null; departureTime: number | null;
  dropOffType: StopEventType; pickUpType: StopEventType; stopHeadsign: string | null; stopSequence: number;
  routeId: string; stopId: string; tripId: string };
export type VehicleStatus = 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO';
export type OccupancyStatus = 'EMPTY' | 'MANY_SEATS_AVAILABLE' | 'FEW_SEATS_AVAILABLE' | 'STANDING_ROOM_ONLY'
  | 'CRUSHED_STANDING_ROOM_ONLY' | 'FULL' | 'NOT_ACCEPTING_PASSENGERS' | 'NO_DATA_AVAILABLE' | 'NOT_BOARDABLE';
export type Carriage = { label: string | null; sequence: number; occupancyStatus: OccupancyStatus | null;
  occupancyPercentage: number | null };
export type Vehicle = { id: string; label: string | null; latitude: number; longitude: number; bearing: number | null;
  currentStatus: VehicleStatus; currentStopSequence: number | null; directionId: DirectionId;
  routeId: string | null; stopId: string | null; tripId: string | null;
  occupancyStatus: OccupancyStatus | null; carriages: Carriage[]; updatedAt: number };
export type LiveDepartures = { predictions: Prediction[]; trips: Record<string, Trip>; vehicles: Record<string, Vehicle> };
export type ScheduleSet = { schedules: Schedule[]; trips: Record<string, Trip> };
export type AlertSignificance = 'major' | 'secondary' | 'accessibility' | 'minor' | 'none';
export type InformedEntity = { activities: string[]; routeId: string | null; routeType: RouteType | null;
  directionId: DirectionId | null; stopId: string | null; tripId: string | null; facilityId: string | null };
export type Alert = { id: string; effect: string; cause: string | null; severity: number; header: string;
  description: string | null; url: string | null; lifecycle: string | null; timeframe: string | null;
  activePeriods: { start: number; end: number | null }[]; informedEntities: InformedEntity[]; updatedAt: number };
export type LatLng = import('@/lib/geo').LatLng;
```

```ts
// src/mbta/global/globalData.ts  (+ GlobalDataProvider.tsx, shapes.ts)
export type GlobalData = { version: 1; fetchedAt: number; serviceDate: string;
  routes: Record<string, Route>; lines: Record<string, Line>; stops: Record<string, Stop>;
  patterns: Record<string, RoutePattern>; trips: Record<string, Trip>;        // representative trips, stopIds set
  patternIdsByStop: Record<string, string[]> };                              // leaf platform id -> pattern ids
export type RailShapes = Record<string /*routeId*/, { shapeId: string; directionId: DirectionId; coordinates: LatLng[] }[]>;
export function fetchGlobalData(signal?: AbortSignal): Promise<GlobalData>;
export function fetchRailShapes(global: GlobalData, signal?: AbortSignal): Promise<RailShapes>;
export function useGlobalData(): { data: GlobalData | null; status: 'loading' | 'ready' | 'error'; error: string | null; refresh(): void };
export function useRailShapes(): RailShapes | null;
export function parentStationId(g: GlobalData, stopId: string): string;   // self if already parent / unknown
export function childStopIds(g: GlobalData, parentId: string): string[];
export function stationStopIds(g: GlobalData): string[];                    // all parent stations (location_type 1)
export const STOP_BLOCKLIST: readonly string[];                            // ['place-symcl']
```

```ts
// src/mbta/api/endpoints.ts  (all parse into model types; all accept { signal?, priority? } as last arg)
fetchPredictionsForStops(stopIds: string[], f?: { routeIds?: string[]; directionId?: DirectionId }): Promise<LiveDepartures>; // include=trip,vehicle
fetchPredictionsForTrip(tripId: string): Promise<LiveDepartures>;
fetchSchedulesForStops(stopIds: string[], serviceDate: string): Promise<ScheduleSet>;           // one call, comma list
fetchSchedulesForTrip(tripId: string, stopIds?: string[]): Promise<ScheduleSet>;
fetchSchedulesWindow(q: { stopIds: string[]; routeIds: string[]; directionId: DirectionId; date: string; minTime: string; maxTime: string }): Promise<ScheduleSet>; // 'HH:MM', may exceed 24:00
fetchTrip(tripId: string): Promise<Trip>;                                   // include=stops
fetchVehicles(q: { routeIds: string[]; directionId?: DirectionId }): Promise<Vehicle[]>;
fetchAlerts(): Promise<Alert[]>;                                            // filter[route_type]=0,1, all lifecycles
fetchAlert(id: string): Promise<Alert | null>;
```

```ts
// src/mbta/live/*.ts
export type Polled<T> = { data: T | null; error: MbtaErrorDetail | null; updatedAt: number | null;
  stale: boolean /* >2 min since update with data */; refreshing: boolean; refresh(): Promise<void> };
export function usePolling<T>(key: string | null, fetcher: (s: AbortSignal) => Promise<T>,
  o: { intervalMs: number; priority?: RequestPriority; focusAware?: boolean /*default true*/ }): Polled<T>;
export const POLL: { stopPredictionsMs: number; alertsMs: number; vehiclesMs: number; tripMs: number; planMs: number }; // per HAS_API_KEY
export function useNow(intervalMs?: number): number;
export function useAlerts(): Polled<Alert[]> & { byId: Record<string, Alert> };
export function useStopLiveData(stopIds: string[] | null, f?: { routeIds?: string[]; directionId?: DirectionId }):
  { predictions: Polled<LiveDepartures>; schedules: ScheduleSet | null; alerts: Alert[] | null };
export function useVehicles(routeIds: string[] | null, directionId: DirectionId | null): Polled<Vehicle[]>;
```

```ts
// src/mbta/time/eastern.ts
export function serviceDate(now: number): string;                 // 'YYYY-MM-DD' of (Eastern now − 3h)
export function easternParts(ms: number): { y: number; mo: number; d: number; h: number; mi: number; dow: number };
export function formatClock(ms: number): string;                  // '8:05 PM'
export function formatMinutes(min: number): string;               // '5 min' | '1 hr' | '1 hr 5 min' (MinutesFormat.kt)
```

```ts
// src/mbta/rules/tripInstantDisplay.ts  (port of S/model/TripInstantDisplay.kt, Prediction.kt cutoffs)
export type DisplayContext = 'nearby' | 'stopDetailsUnfiltered' | 'stopDetailsFiltered' | 'tripDetails';
export type TripInstantDisplay =
  | { kind: 'overridden'; text: string; last: boolean } | { kind: 'hidden' }
  | { kind: 'boarding'; last: boolean } | { kind: 'arriving'; last: boolean }
  | { kind: 'approaching'; last: boolean } | { kind: 'now'; last: boolean }
  | { kind: 'time'; predictionTime: number; last: boolean; headline: boolean }
  | { kind: 'timeWithStatus'; predictionTime: number; status: string; last: boolean; headline: boolean }
  | { kind: 'timeWithSchedule'; predictionTime: number; scheduledTime: number; last: boolean; headline: boolean }
  | { kind: 'minutes'; minutes: number; last: boolean }
  | { kind: 'scheduleTime'; scheduledTime: number; last: boolean; headline: boolean }
  | { kind: 'scheduleTimeWithStatusColumn'; scheduledTime: number; status: string; last: boolean; headline: boolean }
  | { kind: 'scheduleTimeWithStatusRow'; scheduledTime: number; status: string }
  | { kind: 'scheduleMinutes'; minutes: number; last: boolean }
  | { kind: 'skipped'; scheduledTime: number | null } | { kind: 'cancelled'; scheduledTime: number }
  | { kind: 'shuttle'; scheduledTime: number };
export const ARRIVAL_CUTOFF_MS = 30_000, APPROACH_CUTOFF_MS = 60_000, BOARDING_CUTOFF_MS = 90_000, SCHEDULE_CLOCK_CUTOFF_MIN = 60;
export function tripInstantDisplay(a: { prediction: Prediction | null; schedule: Schedule | null; vehicle: Vehicle | null;
  routeType: RouteType; now: number; context: DisplayContext; lastTrip: boolean; alert: Alert | null }): TripInstantDisplay;
export type DepartureText = { primary: string; boldPart: string | null; struck: string | null; realtime: boolean;
  last: boolean; icon: 'bus' | 'clock' | null; a11y: string };     // MA §3.1 strings table
export function departureText(d: TripInstantDisplay): DepartureText;
```

```ts
// src/mbta/rules/upcomingTrip.ts + upcomingFormat.ts + leafFormat.ts
export type UpcomingTrip = { id: string; trip: Trip; schedule: Schedule | null; prediction: Prediction | null;
  vehicle: Vehicle | null; predictionStop: Stop | null };
export function buildUpcomingTrips(g: GlobalData, s: ScheduleSet | null, p: LiveDepartures | null,
  filter?: { stopIds?: string[]; routeIds?: string[]; directionId?: DirectionId }): UpcomingTrip[];
export function upcomingTime(t: UpcomingTrip): number | null;
export function headsign(t: UpcomingTrip): string;
export function isLastTripFlags(trips: UpcomingTrip[], routeType: RouteType): boolean[];
export type WarningAlert = { iconName: string; alertId: string };
export type FormattedTrip = { id: string; trip: UpcomingTrip; routeType: RouteType; format: TripInstantDisplay; lastTrip: boolean; alert: Alert | null };
export type NoTripsFormat = { kind: 'subwayEarlyMorning'; scheduledTime: number } | { kind: 'noSchedulesToday' }
  | { kind: 'serviceEndedToday' } | { kind: 'predictionsUnavailable' };
export type UpcomingFormat = { kind: 'loading' }
  | { kind: 'some'; trips: FormattedTrip[]; secondaryAlert: WarningAlert | null }
  | { kind: 'noTrips'; noTrips: NoTripsFormat; secondaryAlert: WarningAlert | null }
  | { kind: 'disruption'; alert: Alert; iconName: string };
export type LeafFormat = { kind: 'single'; route: Route | null; headsign: string | null; format: UpcomingFormat }
  | { kind: 'branched'; rows: { id: string; route: Route | null; headsign: string; format: UpcomingFormat }[]; secondaryAlert: WarningAlert | null };
export const TYPICAL_LEAF_ROWS = 2, BRANCHING_LEAF_ROWS = 3;
```

```ts
// src/mbta/rules/routeCardData.ts + direction.ts + patternSorting.ts + nearbyStops.ts
export type LineOrRoute = { kind: 'route'; id: string; route: Route } | { kind: 'line'; id: string; line: Line; routes: Route[] }; // id 'line-Green'
export type Direction = { id: DirectionId; name: string | null; destination: string | null };
export type RouteCardContext = 'nearby' | 'stopDetailsUnfiltered' | 'stopDetailsFiltered' | 'favorites';
export type RouteCardLeaf = { lineOrRoute: LineOrRoute; stop: Stop; direction: Direction; routePatterns: RoutePattern[];
  stopIds: string[]; upcomingTrips: UpcomingTrip[]; alertsHere: Alert[]; alertsDownstream: Alert[];
  hasSchedulesToday: boolean; subwayServiceStartTime: number | null; allDataLoaded: boolean; context: RouteCardContext };
export type RouteStopData = { lineOrRoute: LineOrRoute; stop: Stop; directions: Direction[]; leaves: RouteCardLeaf[];
  distanceMeters: number | null; elevatorAlerts: Alert[] };
export type RouteCard = { id: string; lineOrRoute: LineOrRoute; stops: RouteStopData[]; at: number };
export type RouteCardInput = { stopIds: string[]; global: GlobalData; sortByDistanceFrom: LatLng | null;
  schedules: ScheduleSet | null; predictions: LiveDepartures | null; alerts: Alert[] | null; now: number;
  context: RouteCardContext; favorites?: ReadonlySet<string> /* rsdKey */ };
export function routeCardsForStopList(i: RouteCardInput): RouteCard[] | null;  // null while global missing
export function formatLeaf(leaf: RouteCardLeaf, now: number, g: GlobalData): LeafFormat;
export function getDirections(g: GlobalData, stop: Stop, route: Route, patterns: RoutePattern[]): Direction[];
export function getDirectionsForLine(g: GlobalData, stop: Stop, patterns: RoutePattern[]): Direction[];
export function directionLabel(d: Direction): string;   // e.g. 'Southbound to Ashmont'
export function compareRouteCards(a: RouteCard, b: RouteCard, ctx: RouteCardContext): number;
export function nearbyStopIds(g: GlobalData, at: LatLng): string[];   // MA §3.2, linear haversine (no k-d tree, [ours])
```

```ts
// src/mbta/rules/alerts.ts, vehicle.ts, routePill.ts, search.ts
export function intrinsicSignificance(a: Alert): AlertSignificance;
export function significanceAt(a: Alert, now: number): AlertSignificance;
export function significanceRank(s: AlertSignificance): number;          // major 4 … none 0
export function applicableAlerts(alerts: Alert[], q: { routeIds?: string[]; directionId?: DirectionId | null;
  stopIds?: string[]; tripId?: string | null; activities?: string[] /*default ['BOARD']*/ }, now: number): Alert[];
export function downstreamAlerts(alerts: Alert[], trip: Trip, targetStopIds: string[], g: GlobalData, now: number): Alert[];
export function alertIconName(a: Alert, route: Route | null): string;   // 'alert-large-red-shuttle' etc. -> mapped to Ionicons in ui/
export function effectLabel(effect: string): string;                     // 'Shuttle bus', 'Suspension', 'Stop skipped', …
export type CrowdingLevel = 'notCrowded' | 'someCrowding' | 'crowded';
export function crowdingLevel(o: OccupancyStatus | null): CrowdingLevel | null;
export function crowdingText(l: CrowdingLevel): 'Not crowded' | 'Some crowding' | 'Crowded';
export type CarRecommendation = { bestSequences: number[]; carCount: number; label: string /* 'Board car 3 of 6' | 'Cars 1–2 of 6' */;
  levels: (CrowdingLevel | null)[] /* index = sequence-1 */; frontIsSequence1: true };
export function recommendCar(carriages: Carriage[]): CarRecommendation | null;
export function vehicleStatusText(v: Vehicle, onTrip: boolean, atFirstStop: boolean): string;
export type RoutePillSpec = { text: string | null; icon: 'bus' | 'ferry' | null; shape: 'rectangle' | 'capsule' | 'circle';
  width: 'fixed' | 'flex'; color: string; textColor: string };
export function routePillSpec(lr: LineOrRoute | Route, o: { type: 'fixed' | 'flex'; context?: 'searchStation' | 'default' }): RoutePillSpec;
export type StopMatch = { stop: Stop; score: number; routeIds: string[] };
export function matchStations(g: GlobalData, query: string, limit: number): StopMatch[];  // prefix/token, accent-insensitive
export function matchRoutes(g: GlobalData, query: string, limit: number): LineOrRoute[];
```

- **`recommendCar` rule** [ours]:
  1. Score each car by `occupancyPercentage`. Without a percentage, use the level midpoint: notCrowded 20, some 55, crowded 85. `NO_DATA` and `NOT_BOARDABLE` are excluded.
  2. Return null when fewer than 2 cars are scored or all scores are equal.
  3. Best = the minimum score. Include any car within 5 points of it.
- **Car orientation** [ext]: GTFS-RT `carriage_sequence` 1 is the first car in the direction of travel. The UI says "Car 1 = front".

```ts
// src/state/*.ts
export type RouteStopDirection = { routeId: string /* LineOrRoute id, e.g. 'line-Green' */; stopId: string /* parent */; directionId: DirectionId };
export const rsdKey = (r: RouteStopDirection) => `${r.routeId}|${r.stopId}|${r.directionId}`;
export function useFavorites(): { ready: boolean; favorites: RouteStopDirection[]; keys: ReadonlySet<string>;
  isFavorite(r: RouteStopDirection): boolean; toggle(r: RouteStopDirection): Promise<void>; remove(r: RouteStopDirection): Promise<void> };
export function useRecentStops(): { ready: boolean; stopIds: string[] };   // most recent first, max 10, deduped
export function recordStopVisit(stopId: string): Promise<void>;
export type MapOverlay = { routeIds?: string[]; directionId?: DirectionId; showVehicles?: boolean;
  selectedVehicleId?: string | null; focusStopId?: string | null; itinerary?: ItineraryOverlay | null; fitTo?: LatLng[] | null };
export type ItineraryOverlay = { legs: { mode: 'walk' | 'bike' | 'transit'; color: string; coordinates: LatLng[] }[];
  markers: { kind: 'origin' | 'destination' | 'dock' | 'station'; latLng: LatLng; label: string }[] };
export function useMapOverlay(owner: string, overlay: MapOverlay | null): void;  // focus-aware; store compares by JSON, callers still useMemo
export function useActiveMapOverlay(): MapOverlay | null;                        // WP1 map only
export type SheetDetent = 'collapsed' | 'half' | 'full';
export function requestSheetDetent(d: SheetDetent): void;
export function useSheetDetentRequests(cb: (d: SheetDetent) => void): void;      // WP1 shell only
```

```ts
// src/planner/types.ts  (WP0 writes; WP3 implements planTrip in src/planner/engine.ts)
// imports: LatLng (@/lib/geo), BikeStation (@/data/bluebikes), Alert, Carriage, DirectionId, GlobalData, CarRecommendation, fetch* (@/mbta/...)
export type Place = { name: string; latLng: LatLng; source: 'station' | 'photon' | 'apple' | 'nominatim' | 'current' | 'map';
  stopId?: string; subtitle?: string };
export type PlanRequest = { origin: Place; destination: Place; departAt: number };
export type BikeDock = { stationId: string; name: string; latLng: LatLng; bikes: number; ebikes: number; docks: number; rentalUrl: string | null };
export type WalkLeg = { mode: 'walk'; from: LatLng; to: LatLng; fromName: string; toName: string; meters: number; startTime: number; endTime: number };
export type BikeLeg = { mode: 'bike'; fromDock: BikeDock; toDock: BikeDock; meters: number; startTime: number; endTime: number };
export type TransitLeg = { mode: 'transit'; routeId: string; directionId: DirectionId; headsign: string; tripId: string | null;
  fromStopId: string; toStopId: string; boardPlatformId: string | null; alightPlatformId: string | null;
  departTime: number; arriveTime: number; timeSource: 'realtime' | 'scheduled' | 'estimated'; stopCount: number;
  vehicleId: string | null; carriages: Carriage[]; car: CarRecommendation | null; alerts: Alert[];
  uncertaintySec: number | null; laterDepartures: number[] };
export type Leg = WalkLeg | BikeLeg | TransitLeg;
export type ItineraryKind = 'walk' | 'transit' | 'bike' | 'bike+transit' | 'transit+bike';
export type PlanNotice = { kind: 'weather' | 'alert' | 'bikeAvailability' | 'rateLimited' | 'scheduledOnly' | 'noService';
  severity: 'info' | 'warning'; text: string; alertId?: string };
export type Itinerary = { id: string; kind: ItineraryKind; legs: Leg[]; departTime: number; arriveTime: number;
  transfers: number; walkMeters: number; score: number;
  tags: ('fastest' | 'leastWalking' | 'noTransfers' | 'weatherRisk' | 'disrupted' | 'scheduled')[]; notices: PlanNotice[] };
export type WeatherSnapshot = { fetchedAt: number; temperatureF: number | null; shortForecast: string;
  precipProbability: number | null; windMph: number | null; bikeAdvisory: 'ok' | 'caution' | 'avoid'; reason: string | null };
export type PlanResult = { request: PlanRequest; itineraries: Itinerary[]; weather: WeatherSnapshot | null; generatedAt: number; notices: PlanNotice[] };
export type PlannerDeps = { global: GlobalData; alerts: Alert[] | null; now: () => number;
  fetchPredictions: typeof fetchPredictionsForStops; fetchSchedulesForTrip: typeof fetchSchedulesForTrip;
  fetchSchedulesWindow: typeof fetchSchedulesWindow; fetchBikeStations: () => Promise<BikeStation[]>;
  fetchWeather: (at: LatLng) => Promise<WeatherSnapshot | null> };
export declare function planTrip(req: PlanRequest, deps: PlannerDeps, signal?: AbortSignal): Promise<PlanResult>;
```

**UI primitives** (`src/ui/`, WP0). Props are fixed by WP0. Colors come from `usePalette()` and route colors from the API.
- `RoutePill`: `{ lineOrRoute | route, size: 'small'|'medium'|'large', type }`
- `DepartureText`: `{ display, size }`, with a LiveDot for realtime and a "Last" label.
- `AlertIcon`
- `RouteCardView`: `{ card, now, global, onLeafPress(leaf), onAlertPress?(id), showStopHeaders: boolean, renderLeafAccessory?(leaf) }`
- `CrowdingBadge`
- `CarCrowdingDiagram`: `{ carriages, recommendation, compact? }`
- `SheetPage`: `{ title?, onBack?, right?, children }`
- `SheetScrollView` / `SheetFlatList`
- `StatusBanner`: `{ kind: 'stale'|'rateLimited'|'offline'|'fallbackLocation', ... }`
- `EmptyState`

`src/theme/index.ts` (WP0) gains `type` (font size scale per [MA §4], set in Manrope) and `sheet` tokens. Existing palette keys are unchanged.

`src/data/bluebikes.ts` (WP0) adds `fetchBikeStations(signal?): Promise<BikeStation[]>`, which returns all installed stations with `distanceMeters: 0`. It keeps the existing exports.

`src/lib/geo.ts` (WP0) adds:
- `walkMinutesDetour(meters, detour = 1.3)` [AR §3.2]
- `bikeMinutes(meters)`, computed as `meters × 1.25 / 250 + 2` [AR §3.2]
- `boundsOf(points)`

---

## 4. Work packages (strict file ownership)

**Rules for all WPs:**
- Only WP0 edits `package.json`, `jest.setup.ts`, `.gitignore`, `.env.example`, `src/mbta/**`, `src/state/**`, `src/ui/**`, `src/lib/**`, `src/theme/**` and `src/planner/types.ts`.
- If a WP needs a contract change, it asks the lead. It does not edit the file.
- No new dependencies (WP0 may add none either without lead approval).
- Before declaring done, every WP runs `npx tsc --noEmit`, `npx expo lint` and `npx jest`.

### WP0 Core (runs first, alone)
**Files:**
- Everything listed in section 3.
- `src/mbta/api/{config,budget}.ts`
- `src/mbta/model/parse.ts`
- `src/mbta/testing/builders.ts` (TS port of the `ObjectCollectionBuilder` idea: `build.stop()`, `build.route()`, `build.pattern()`, `build.trip()`, `build.prediction()`, `build.schedule()`, `build.vehicle()`, `build.alert()`, `build.global()`, with defaults)
- `__mocks__/react-native-maps.tsx`
- `jest.setup.ts`
- `.env.example` (`EXPO_PUBLIC_MBTA_API_KEY=`)
- `.gitignore`: add `.env`
- `THIRD_PARTY_NOTICES.md`

**Steps:**
1. Implement the client, budget, endpoints and parsers. Parsers map platform stops to parents through global data.
2. Implement global load and cache, shapes, and the live hooks.
3. Port the rules with golden tests (section 6).
4. Build the UI primitives.
5. Verify `Intl.DateTimeFormat(..., {timeZone:'America/New_York'})` on Hermes in Expo Go. If it is missing, `eastern.ts` falls back to US DST rules (2nd Sun Mar / 1st Sun Nov, 02:00), which are unit-tested.

**Acceptance:**
- All ported golden tests pass.
- Parser tests use fixture JSON shaped like the [AR §2.2–2.3] observed responses: platform → parent mapping, `ADDED` trips without schedules, carriages with `NO_DATA_AVAILABLE`.
- Budget tests:
  - 429 sets `limited` until reset.
  - `remaining ≤ 3` defers background requests.
  - Duplicate URLs share one fetch.
- Cache tests: TTL expiry, version bump, corrupt JSON treated as a miss, service-date invalidation.
- `recommendCar` tests: ties, all NO_DATA, a single car, percentage vs status scoring.
- A throwaway screen or script loads `useGlobalData` from cold, then from warm in under 300 ms (AsyncStorage).

**Edge cases:**
- Parent-station ids in `filter[stop]` [AR §2.3].
- `min_time` values past 24:00 [AR §2.4].
- Null typicality treated as typical [MA §3.3].
- Missing `stops` relationship in route_patterns, which triggers the two-step fallback.

### WP1 Shell + Map + Nearby
**Files:**
- `src/app/_layout.tsx`, `src/app/index.tsx`
- `src/features/shell/{AppShell,SheetChrome,SheetTabs}.tsx`
- `src/features/map/{TealMap.tsx,TealMap.web.tsx,layers/*.tsx,mapCenter.ts}`
- `src/features/nearby/*`
- `src/components/BikeStationCard.tsx`
- Deletes the four retired files (2.1).

**Imports:** `useGlobalData`, `useRailShapes`, `useStopLiveData`, `useVehicles`, `nearbyStopIds`, `routeCardsForStopList`, `RouteCardView`, `useActiveMapOverlay`, `useSheetDetentRequests`, `useLocation`, `fetchNearestBikeStations`, `StatusBanner`.

**Screens:**
- **Shell.** As described in §2.2.
- **Map layers:**
  - Rail shapes, route-colored, width 4. When an overlay has `routeIds`, other routes drop to 30% opacity.
  - Parent stations as `Marker`s with `tracksViewChanges={false}`. When `latitudeDelta > 0.12`, only transfer stations show.
  - Vehicles: route-colored dots rotated by `bearing`. Follow mode re-centers the camera on each update.
  - Itinerary polylines: walk dashed, bike `brand`, transit route color. Plus markers.
  - A recenter button and the user location puck.
  - Dark mode via `userInterfaceStyle`.
- **Nearby:**
  - Route cards (context `nearby`).
  - A compact Bluebikes section (nearest 3, existing card).
  - The "Live · Ns ago" badge.
  - A fallback-location banner ("Showing Park Street · reason").
  - An empty state.
  - Footer attribution.
  - A leaf tap pushes `/stop/[stopId]?routeId=<lineOrRoute id>&directionId=`.

**Acceptance:**
- Unit test: `mapCenter` switches the Nearby position to the map center only on a user gesture, with a "Back to my location" reset.
- Render tests with mocks:
  - The shell mounts.
  - Tabs switch routes.
  - Nearby renders cards from builder fixtures.
- Manual check in Expo Go on an iPhone, recording observed results:
  - Sheet drag with an inner scroll.
  - Map tap on a station opens the stop page.
  - Vehicles appear only on stop and trip pages.
  - The web export renders the SVG map with no crash.

**Edge cases:**
- Location denied or outside Boston (keep the existing fallback).
- Global data still loading: skeleton cards.
- Rate-limited: keep the cards and show the banner.
- No rail within 2 mi: empty state with the Plan CTA.

### WP2 Stop details + Trip details + Alert details
**Files:**
- `src/app/stop/[stopId].tsx`, `src/app/trip/[tripId].tsx`, `src/app/alert/[alertId].tsx`
- `src/features/stop/*` (filtered header with pill + direction picker + favorite star, `DepartureTiles`, `tileData.ts`)
- `src/features/trip/*` (`tripDetailsStopList.ts`, a port of `S/model/TripDetailsStopList.kt`; `tripHeaderSpec.ts`, a port of `S/model/stopDetailsPage/TripHeaderSpec.kt`; `useTripDetails.ts`)
- `src/features/alert/*`

**Imports:** the live hooks, `routeCardsForStopList` (contexts `stopDetailsUnfiltered` / `stopDetailsFiltered`), `formatLeaf`, `tripInstantDisplay`, `departureText`, `applicableAlerts`, `significanceAt`, `effectLabel`, `crowdingLevel`, `recommendCar`, `vehicleStatusText`, `useFavorites`, `recordStopVisit`, `useMapOverlay`, `fetchTrip`, `fetchPredictionsForTrip`, `fetchSchedulesForTrip`, `fetchAlert`, UI primitives.

**Behavior:**
- **Stop page, unfiltered:** all cards for the stop.
- **Stop page, filtered** (`routeId` + `directionId` params, toggled with `router.setParams`):
  - Departure tiles with no row limit.
  - Alert cards: major, secondary, downstream, and elevator (Accessibility).
  - Map overlay `{routeIds, directionId, showVehicles, focusStopId}`.
  - Calls `recordStopVisit` on mount.
- **Trip page:**
  - Header states: VehicleOnTrip / FinishingAnotherTrip / NoVehicle / Scheduled [MA §1].
  - Crowding (`CrowdingBadge`, plus `CarCrowdingDiagram` and a "Board car N" hint when `recommendCar` is non-null). Crowding is hidden at the first stop [MA §3.5].
  - Stop list split before and after the target stop, with transfer pills.
  - A Follow toggle sets `selectedVehicleId`.
- **Alert page:**
  - Effect label with route pills, cause, and active periods in Eastern time.
  - Affected parent stops.
  - Description with line breaks preserved, and the URL.
  - "Plan around this" opens `/plan`.
  - Source: `useAlerts().byId`, else `fetchAlert`.

**Acceptance:**
- Ported `TripDetailsStopListTest`, `TileDataTest` and `TripHeaderSpec` cases pass (section 6).
- Unit tests:
  - Filter param round-trip.
  - The favorite star toggles `rsdKey` with the `line-Green` id on Green.
- Manual checks:
  - A Red train with carriages shows the diagram.
  - An `ADDED` trip with `NO_DATA` shows "Crowding not available".

**Edge cases:**
- Unknown stopId or tripId: friendly error page.
- Trip with no vehicle.
- Vehicle finishing another trip.
- Expired alert id: the 404 message "This alert has ended".

### WP3 Planner
**Files:**
- `src/app/plan.tsx`
- `src/planner/{engine.ts,graph.ts,candidates.ts,evaluate.ts,bike.ts,rank.ts,constants.ts,geometry.ts}`
- `src/weather/nws.ts`
- `src/geocode/{photon.ts,fallback.ts,index.ts}`
- `src/features/planner/*` (destination field with typeahead, origin row, itinerary cards, itinerary detail with leg timeline, `CarCrowdingDiagram` for transit legs, bike dock rows with the existing Unlock link)

**Imports:** `GlobalData`, `fetchPredictionsForStops`, `fetchSchedulesForTrip`, `fetchSchedulesWindow`, `useAlerts`, `applicableAlerts`, `significanceAt`, `recommendCar`, `fetchBikeStations`, `matchStations`, `routePillSpec`/`RoutePill`, `useMapOverlay`, `requestSheetDetent`, `walkMinutesDetour`, `bikeMinutes`, `useRailShapes`.

**Algorithm** ([AR §3.2]; constants live in `constants.ts`):
- **Graph.** Typical and canonical patterns of Red, Orange, Blue, Green-B..E and Mattapan, collapsed to ordered parent sequences with an index per station. Transfer stations are parents shared by two or more patterns.
- **Candidates.** Up to 4 stations within 1.2 km of the origin O and of the destination D. Walk time = distance × 1.3 ÷ 80 m/min.
- **Enumerate.**
  - Direct: `idx(o) < idx(d)`.
  - One transfer: via a transfer station x.
  - Pre-score = walk + hops × avgHop (2.0 heavy, 1.8 GL subway, 2.2 GL surface) + transfer (4 + headway/2) + walk.
  - Keep the top 5.
- **Mixed** [ours]:
  - bike→T: up to 3 boarding stations 1–4 km from O on patterns reaching the D-set directly. Needs an end dock within 300 m of the station and a start dock within 500 m of O.
  - T→bike: symmetric.
  - Pure bike: only for 0.8–12 km. Start dock needs `bikes>0 && isRenting`; end dock needs `docks>0 && isReturning`.
  - Walk: always computed.
- **One predictions call.** The union of stations and routes [AR §3.2 step 3].
- **Evaluate.** Earliest trip with a boarding `dep ≥ now + walk` and an alighting stop with a higher `stopSequence`; neither stop SKIPPED or CANCELLED. Transfers need `dep ≥ arr_x + transferMin`: 3 min for same-line branch transfers (GL trunk, Red at JFK), otherwise 5 min [ours].
- **Fallbacks.**
  - Trip schedules when the alighting prediction is missing.
  - Schedule window with `maxTime` widened by the ride estimate, labeled "scheduled".
  - Hop estimate for `ADDED-*` trips.
- **Alerts** from `useAlerts` (no extra call):
  - Legs hit by an alert of significance `major` with SUSPENSION / SHUTTLE / STATION_CLOSURE at the board or alight stop are dropped and replaced by a notice.
  - DELAY and DETOUR become notices.
- **Weather** (`nws.ts`):
  - `/points` → `forecastHourly`. Use the first two periods.
  - `avoid` if precipitation ≥ 60% or the forecast matches `/thunder|snow|sleet|freezing|ice/i`.
  - `caution` if precipitation ≥ 30%, or `/rain|showers|drizzle/i`, or wind ≥ 20 mph, or temperature ≤ 28°F or ≥ 92°F.
  - Score penalty for any bike leg: caution +5 min, avoid +15 min plus the `weatherRisk` tag and a notice. Bike options are never hidden [ours].
  - Native requests send `User-Agent: Teal/<version> (<NWS_CONTACT constant>)`. Web sends no UA. Failures yield `weather: null`, and the plan continues.
- **Rank.** Score = arrival + weather penalty + 1 min per transfer. Tags: `fastest`, `leastWalking`, `noTransfers`.
- **Car.** For each transit leg with ≥2 scored carriages, `leg.car = recommendCar(vehicle.carriages)`.
- **Refresh.** Re-evaluate while focused (`POLL.planMs`). This reuses the candidate graph, so the cost is one predictions call.
- **Geocoding** [AR §4]:
  - `matchStations` first.
  - Then Photon typeahead: ≥3 chars, 350 ms debounce, `lat/lon` bias, bbox `-71.3,42.2,-70.85,42.5`, `limit=5`, in-memory cache, `PHOTON_ENABLED` kill switch.
  - On submit with nothing chosen: iOS uses `Location.geocodeAsync`; web uses one Nominatim `jsonv2` bounded search (≤1/s).
  - Show "© OpenStreetMap contributors".
- **Map overlay.** Transit legs are sliced from `useRailShapes` between the stations' nearest shape points (`geometry.ts`). Walk and bike legs are straight segments [ours].

**Acceptance (unit, with builders and fixture graphs):**
- Downtown Crossing → Harvard is direct Red with direction from pattern order [AR §2.3].
- Park St → Quincy Center picks only Braintree trips [AR §3.4].
- Kenmore → Government Center accepts any Green branch.
- Harvard → Back Bay transfers at Downtown Crossing (Red→Orange, 5 min).
- A missing alighting prediction falls back to trip schedules.
- An `ADDED` trip uses the hop estimate.
- A shuttle alert drops the leg.
- Rain at 70% gives bike `avoid`, so it ranks below T, and the notice is present.
- No bikes at the start dock excludes bike options with a `bikeAvailability` notice.
- Pure walk wins for 400 m.
- 429 during plan: result has a `rateLimited` notice and keeps any schedule-based itineraries.
- `geometry.ts` slicing is tested.
- `nws.ts` parses the observed period shape (`windSpeed: "1 mph"`, `probabilityOfPrecipitation.value`).

**Edge cases:**
- Origin and destination at the same station.
- Destination outside the Boston area (reject with a message).
- Overnight with no predictions: scheduled-only results with a label.
- After-midnight service date [AR §3.4].
- Photon down: station matches still work.

### WP4 Favorites + Search + recents + More + demo site
**Files:**
- `src/app/favorites.tsx`, `src/app/search.tsx`, `src/app/more.tsx`
- `src/features/favorites/*` (list via `routeCardsForStopList` with context `favorites` and `favorites: keys`, edit mode with remove, empty state)
- `src/features/search/*`:
  - Results: stations (to `/stop/[id]`), routes (inline station list for that route), recents when the query is empty.
  - A row "Plan a trip to '<q>'" goes to `/plan?q=`.
  - 300 ms debounce.
- `src/features/more/*`: attributions, licenses, links, key status ("Live updates: standard / limited (no API key)").
- `public/demo.html`, `public/vercel.json`
- `app.json` (web settings only)

**Demo page.** One screen, no scrolling at 1280×800:
- The "teal." wordmark.
- A one-line pitch.
- A phone-frame `<iframe src="/?demo">`.
- A small link row: Open Teal, Watch the 30 s promo (links to `/teal-promo.mp4`; no inline video), Source/About.
- Target ≤ 90 lines.

**Vercel.**
- Confirm whether `app.json web.output` is `single` (SPA) for SDK 57.
- If so, add a rewrite of non-file paths to `/index.html` so deep links like `/stop/place-pktrm` load. Keep `cleanUrls`.

**Imports:** `useFavorites`, `useRecentStops`, `matchStations`, `matchRoutes`, `routeCardsForStopList`, `useStopLiveData`, `RouteCardView`, `RoutePill`, `SheetPage`.

**Acceptance:**
- Unit tests:
  - Favorites list ordering (no distance sort, no subway-first bucket [MA §1]) using builders.
  - Search ranking: exact > prefix > token. "park" → Park Street first; "harvard" → Harvard; "gl b" or "b line" → Green-B. Accent and case insensitive.
  - Recents dedupe and cap at 10.
  - Empty query shows recents.
- Manual checks:
  - Favorite added on a stop page appears on Favorites after an app restart.
  - `npx expo export -p web` output renders `demo.html` on one screen.

**Edge cases:**
- A favorite whose stop or route is gone from global data: show a "No longer served" row with remove.
- Search before global data loads: spinner.

---

## 5. Clean-room boundary and attribution

**MBTA Go code.**
- MBTA Go (`mbta/mobile_app`) is MIT, "Copyright (c) 2023 Massachusetts Bay Transportation Authority". Porting its logic to TS is allowed with attribution.
- `THIRD_PARTY_NOTICES.md` (WP0) carries the full MIT text with that copyright and the source commit `8c49ac5`.
- Every ported file starts with: `// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/<File>.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.`
- Ported tests cite their `*Test.kt` file the same way.

**Do not copy:**
- MBTA Go assets (`Icons.xcassets`, strings, Mapbox styles).
- Its backend host `mobile-app-backend.mbtace.com`.
- Algolia or Mapbox credentials.
- MBTA logos or trademarks.

Teal uses Ionicons and its own palette. The app must not be branded or described as MBTA's.

**Data attribution.** On the More page and in the Nearby footer, show:
- "Transit data: MBTA/MassDOT. Not affiliated with or endorsed by the MBTA."
  - The builder confirms the exact attribution and non-endorsement wording against the MassDOT Developers License Agreement linked from https://www.mbta.com/developers [AR §5]. Do not invent clauses.
- Bluebikes data (GBFS, Lyft), noting the Bluebikes data license.
- "Weather: National Weather Service".
- "Geocoding © OpenStreetMap contributors (Photon / Nominatim)".
- Apple Maps shows its own legal label.

**Teal LICENSE.** Teal's `LICENSE` is currently the Expo template's MIT text (650 Industries). The user should replace the holder (decision 7.4).

---

## 6. Test plan

**Golden ports.** Source: `...\mbta-repos\mobile_app\shared\src\commonTest\kotlin\com\mbta\tid\mbta_app\`. Rebuild fixtures with `src/mbta/testing/builders.ts`. Assert the same outputs, converting `EasternTimeInstant` to epoch ms.

| Kotlin test (tests) | TS target (owner) | Port |
|---|---|---|
| `model/TripInstantDisplayTest.kt` (33) | `src/mbta/rules/__tests__/tripInstantDisplay.test.ts` (WP0) | all |
| `model/UpcomingTripTest.kt` (33) | `upcomingTrip.test.ts` (WP0) | join, filters, subway schedule hiding, last-trip; skip serialization-only cases |
| `model/LeafFormatTest.kt` (10) + `model/RouteCardDataLeafTest.kt` (format/shouldShow cases, e.g. "formats Red Line southbound as branching showing next 3 trips", "format skips schedules on subway but keeps on non-subway", "formats as subway early morning…") | `leafFormat.test.ts` (WP0) | all format cases; rail ones mandatory |
| `model/RouteCardDataTest.kt` (48) | `routeCardData.test.ts` (WP0) | ≥22: all `addStaticStopsData` (incl. 3 Green Line grouping), "sorts subway routes first", "sorts close bus first…", "no service today to the bottom" ×2, "hides stop that has upcoming service all seen at earlier stop", "shows stop that has nontypical service…", "filters out direction if it is the typical last stop of subway", "filters out any arrival only", "groups lines by direction", "for line on branch uses branch direction name", "north station disruption case", "returns alertsHere and downstream alerts", "includes cancellations in filtered stop details context", "doesn't filter future trips in filtered", "routeCardsForStaticStopList sorts by distance", shuttle-pattern ×2 |
| `model/AlertTest.kt` (27) | `alerts.test.ts` (WP0) | significance ×3, "limited for upcoming and past", filter/applicable ×7, downstream ×5, elevatorAlerts, allClear; skip `recurrenceRange` ×6 |
| `model/DirectionTest.kt` (5) | `direction.test.ts` (WP0) | all |
| `model/PatternSortingTest.kt` (4) | `patternSorting.test.ts` (WP0) | all |
| `model/RoutePillSpecTest.kt` (6) | `routePill.test.ts` (WP0) | all |
| `model/VehicleTest.kt` (1) + own cases | `vehicle.test.ts` (WP0) | occupancy→crowding, unknown decoration, `recommendCar` |
| `repositories/NearbyRepositoryTest.kt` (6) | `nearbyStops.test.ts` (WP0) | all (radius widening, CR rules, blocklist) |
| `model/FavoriteTest.kt` | `src/state/__tests__/favorites.test.ts` (WP0) | key/serialization semantics only |
| `model/TripDetailsStopListTest.kt` (37) | `src/features/trip/__tests__/tripDetailsStopList.test.ts` (WP2) | ≥15 `fromPieces` cases (schedules only, predictions only, full match, aligned stop ids, extrapolated sequences, sibling stops) |
| `model/stopDetailsPage/TileDataTest.kt` | `src/features/stop/__tests__/tileData.test.ts` (WP2) | all |
| `usecases/VisitHistoryUsecaseTest.kt`, `viewModel/SearchViewModelTest.kt` | `src/features/search/__tests__/*` (WP4) | ordering and dedupe behavior only |

`KdTreeTest` is skipped: we use a linear scan over about 300 rail leaf stops [ours].

**Jest setup** (WP0: `jest.setup.ts` referenced from `package.json` `jest.setupFiles` (mocks) and `setupFilesAfterEnv` if matchers are added):
- `jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))`
- `require('react-native-gesture-handler/jestSetup')`
- `jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'))`. If worklets initialization fails under Reanimated 4, add `react-native-worklets/jest/resolver.js` as the Jest `resolver` (the file exists in node_modules). Verify, and record which one was needed.
- `jest.mock('@gorhom/bottom-sheet', () => require('@gorhom/bottom-sheet/mock'))`
- `__mocks__/react-native-maps.tsx`: `MapView`, `Marker`, `Polyline` and `Circle` as plain `View`s that forward children and testID. It also exports `PROVIDER_DEFAULT`.
- `expo-location` and `expo-haptics`: per-test `jest.mock`.
- `global.fetch`: per-test `jest.fn`. No live network in tests.

**Test priorities.** Pure-logic tests carry the weight. Render tests stay smoke-level. Real-device behavior (sheet gestures, Apple Maps, live carriages) is verified manually in Expo Go and reported as observed, not assumed.

---

## 7. Risks and open decisions

**Open decisions for the user:**
1. **Mode scope of Nearby, Stop and Search.** Default: subway + Mattapan only (`route_type 0,1`). This matches the planner, keeps the cache small, and keeps keyless polling cheap. The rules are ported mode-generic, so adding bus/CR later is a data-filter change.
2. **Inline vs pushed trip details.** Default: tapping a departure tile pushes `/trip/[id]`. MBTA Go expands it inline [MA §1].
3. **API key on the web demo.** `EXPO_PUBLIC_*` is inlined into the public bundle. Default: either lock the key to `allowed_domains` in the MBTA portal [AR §2], or deploy the demo keyless.
4. **LICENSE holder and NWS contact string.** These are needed for `LICENSE` and the NWS User-Agent. Use a project URL, not a personal email, unless the user prefers otherwise.
5. **`.env` vs `.env.local`.** Today only `.env*.local` is git-ignored. Default: WP0 adds `.env` to `.gitignore` as well.

**Risks:**
- **Native stack inside the gorhom sheet** in Expo Go: gesture or size glitches. Mitigation: WP1 spikes this first. Fallback is `<Slot/>` inside the sheet with a Reanimated slide transition (routes unchanged).
- **Expo Go version alignment.** `react-native-reanimated 4.5.1` / `worklets 0.10.1` / `@gorhom/bottom-sheet 5.2.14` must match Expo Go SDK 57's bundled natives. Run `npx expo install --check` before WP1.
- **Hermes `Intl` time zones.** Mitigated by the tested fallback (WP0).
- **Per-car data coverage** is partial (seen on a Red train; `NO_DATA` on an ADDED trip [AR §2.3]). The UI must degrade to the whole-train badge or "not available".
- **Uncalibrated planner constants** (walk, hop, transfer) [AR, limitations]. They are centralized in `planner/constants.ts`. Results that use estimates are labeled "estimated".
- **Unexercised API behavior.**
  - The `fields[stop]=` + `include=representative_trip.stops` single call.
  - `/shapes`.
  - Whether a 304 counts toward the rate limit.
  - [AR, Unverified] WP0 verifies each live once and keeps the fallbacks.
- **Photon fair-use and availability.** Mitigated by the kill switch and station-first results.

---

## Addendum A — WP0 as built (authoritative over §3 where they differ)

WP0 is implemented and green (26 suites / 273 tests, tsc, lint, expo-doctor). Code against the real exports in `src/mbta/**`, `src/state/**`, `src/ui/**`, `src/planner/types.ts`, `src/lib/{cache,polyline,geo}.ts`; read the source when in doubt. Deviations from §3:

1. `Prediction.tripHeadsign?` added (headsign fallback).
2. `UpcomingTrip.alert?` added; `buildUpcomingTrips(..., opts?: { now?, alerts? })` has an optional 5th arg.
3. `RouteCardLeaf.hasSchedulesTodayByPattern?` added (per-branch); `hasSchedulesToday` kept.
4. `applicableAlerts` query takes optional `routeType`; with `now` it keeps alerts active now or starting within 24 h. Raw versions: `applicableAlertsAnyTime`, `downstreamAlertsAnyTime`.
5. `routeCardsForStopList` returns null only when global data is missing; missing alerts = none; leaves show loading until schedules AND predictions arrive.
6. `compareRouteCards(a, b, ctx)` reads distance from `stops[0].distanceMeters`; `compareLeavesAtStop(now)` / `compareStopsOnRoute(now)` return comparators.
7. `nearbyStopIds(..., blocklist = STOP_BLOCKLIST)`.
8. `RoutePillSpec.shape: 'circle'` for Green branches.
9. `Direction` in `rules/direction.ts`, `LineOrRoute` in `rules/lineOrRoute.ts` (re-exported from `routeCardData.ts`); `rsdKey` in `state/rsd.ts` (re-exported from `favorites.ts`).
10. `mbtaGet<A = Record<string, unknown>>`; `MbtaApiError` in `api/errors.ts` (re-exported from `client.ts`); 304 → empty doc with `lastModified`.
11. Every endpoint function takes `{ signal?, priority? }` last; stop predictions/schedules/alerts add `filter[route_type]=0,1`.
12. `usePolling(..., dropAfterMs?)`; stop predictions use 10 min.
13. `crowdingLevel('EMPTY')` → `notCrowded`.
14. Test builders: `createBuilder()` + shared `build`; helpers `childStop`, `tripFor`, `predictionFor`, `entity`, `carriage`, `scheduleSet`, `liveDepartures` (`src/mbta/testing/`).
15. Extra exports available: `formatLeaf`, `leafAlertsHere`/`leafAlertsDownstream`, `RouteCardListBuilder`, `routeCardsForStaticStopList`, `noTripsText`, `effectLabel`, eastern-time helpers (`easternInstant`, `serviceMinutes`, `formatServiceTime`, `addDays`), `PROJECT_URL`.
16. Shapes: direction-0 typical patterns only (9 calls). Focus check falls back to "focused" outside a navigator.
17. `src/lib/geo.ts` adds `walkMinutesDetour`, `bikeMinutes`, `boundsOf`; `src/data/bluebikes.ts` adds `fetchBikeStations()` (all stations, 6 h info cache). Theme adds `type`/`typeScale`/`sheet` tokens.
18. Jest config: `setupFiles: jest.setup.ts`, worklets resolver; `__mocks__/react-native-maps.tsx` exists. Known open item: a Jest "worker failed to exit gracefully" warning (exit code still 0).

Privacy rule for all WPs: never send personal data (names/emails) to external services; any contact/User-Agent uses `PROJECT_URL` only.
