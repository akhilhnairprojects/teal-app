# MBTA Go (mbta/mobile_app) — implementation spec for recreating in Teal (Expo / RN)

Source snapshots (shallow clones, MIT): `mbta/mobile_app` @ `8c49ac5` (2026-10-16), `mbta/mobile_app_backend` @ `5c40a48` (2026-10-16).
Read-only source research; nothing was run. Path prefixes used below:

- `S/` = `mobile_app/shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/` (Kotlin Multiplatform, all business logic)
- `A/` = `mobile_app/androidApp/src/main/java/com/mbta/tid/mbta_app/android/` (Compose UI), `AR/` = `mobile_app/androidApp/src/main/res/`
- `I/` = `mobile_app/iosApp/iosApp/` (SwiftUI)
- `B/` = `mobile_app_backend/lib/` (Elixir/Phoenix)

Labels: unlabeled statements are read from the cited code. **[Inference]** = my reasoning, not stated in code. **[External]** = general knowledge about the MBTA V3 API, not from these repos.

---

## 0. Key architecture fact

The app **never calls api-v3.mbta.com directly**. Every request goes to `mobile-app-backend.mbtace.com` (`S/AppVariant.kt`), over REST (`S/network/MobileBackendClient.kt`: gzip, 3 retries @100 ms, 8 s timeout) and a Phoenix websocket at `/socket` (`S/phoenix/*.kt`). Most backend endpoints are thin wrappers over V3 queries plus caching, so a client-only Teal app can reproduce most of them (section 2). The heavy business logic (grouping, formatting, alert significance) lives client-side in `S/model/`, so it can be ported to TypeScript.

UI shell: a full-screen map with a bottom sheet. Three tabs: Favorites, Nearby, More (`I/Utils/SelectedTab.swift`). The default tab is stored, falling back to Nearby (`S/repositories/TabPreferencesRepository.kt`). Sheet navigation stack is `S/routes/SheetRoutes.kt`: `Favorites | NearbyTransit | StopDetails(stopId, stopFilter?, tripFilter?) | RoutePicker(path, context) | RouteDetails(routeId, context) | EditFavorites | TripDetails(filter)`. The search bar shows only on Favorites and Nearby. StopDetails and TripDetails get a floating back button.

---

## 1. Feature inventory

| Feature | What it shows / key interactions | Main sources |
|---|---|---|
| **Nearby transit** | List of "route cards" for stops near the GPS location or the map center. Card hierarchy: Route (or Line) → Stop(s) → Direction ("leaf") → up to 2 departures (3 if branching). Tapping a leaf opens Stop Details filtered to that route and direction. Shows a "no nearby stops" empty state. | `S/viewModel/NearbyViewModel.kt`, `S/repositories/NearbyRepository.kt`, `S/model/RouteCardData.kt`, `I/Pages/NearbyTransit/*`, `A/nearbyTransit/` |
| **Stop details (unfiltered)** | All route cards serving one stop. Shows realtime departures, alerts, and elevator/accessibility info. | `I/Pages/StopDetails/StopDetailsUnfilteredView.swift`, `S/viewModel/StopDetailsViewModel.kt` |
| **Stop details (filtered)** | One route and direction at a stop. Has a header with route pill and direction picker, filter pills (`StopDetailsFilterPills.swift`), and a horizontal scroll of **departure tiles** (`DepartureTile.swift`, `S/model/stopDetailsPage/TileData.kt`). Also alert cards, a "not accessible" card, and a no-trip card. The selected tile expands inline into trip details: vehicle header card plus the stop list. | `I/Pages/StopDetails/StopDetailsFilteredDepartureDetails.swift`, `S/model/StopDetailsFilters.kt` |
| **Trip / vehicle details** | Header shows the vehicle status ("Now at" / "Approaching" / "Next stop" / "Waiting to depart"), track number, crowding, and a "Follow" toggle. Below it is the stop list with times, split into stops before and after the target stop, with transfer route pills. Header states: `VehicleOnTrip`, `FinishingAnotherTrip`, `NoVehicle`, `Scheduled` (`S/model/stopDetailsPage/TripHeaderSpec.kt`). An explainer page covers NoPrediction, FinishingAnotherTrip and NoVehicle (`S/model/stopDetailsPage/ExplainerType.kt`). Also available as a standalone page. | `S/model/TripDetailsStopList.kt`, `A/stopDetails/TripHeaderCard.kt`, `I/Pages/TripDetails/*`, `S/viewModel/TripDetailsViewModel.kt` |
| **Route picker** | Browse routes by mode. Paths: Root (subway), Bus, Silver, CommuterRail, Ferry (`S/model/routeDetailsPage/RoutePickerPath.kt`). Has a route search filter (`S/viewModel/SearchRoutesViewModel.kt`). | `I/Pages/RoutePicker/*` |
| **Route details** | Stop list for a route and direction, drawn as a branching "stick diagram" with collapsible segments. In Favorites context, you can tap a stop to favorite it. | `I/Pages/RouteDetails/*`, `S/model/RouteDetailsStopList.kt`, `S/shape/StickDiagramShapes.kt`, backend `B/mobile_app_backend/route_branching.ex` |
| **Search** | Search field over the sheet. An empty query shows recent stops from visit history. Typing debounces 500 ms, then shows route and stop results (`S/viewModel/SearchViewModel.kt`). | `I/Pages/Search/*`, `S/history/VisitHistory.kt` |
| **Favorites** | Favorites are keyed by `RouteStopDirection(route, stop, direction)`, each with `FavoriteSettings(notifications)` (`S/model/Favorite.kt`). They render as route cards (no distance sort, no subway-first bucket). Includes an Edit Favorites page, a Save Favorite sheet with a notification-window editor, and an empty state. | `S/viewModel/FavoritesViewModel.kt`, `I/Pages/Favorites/*`, `I/Pages/SaveFavorite/*` |
| **Disruption notifications** (push) | Per-favorite time windows. Presets: Morning 06–10, Midday 10–16, Evening 16–20, All day 03–03, each with a set of days of week (`S/model/NotificationWindowPresets.kt`). Subscriptions are POSTed to the backend, which sends pushes via FCM. | `S/repositories/SubscriptionsRepository.kt`, `B/mobile_app_backend/notifications/*` |
| **Alerts / alert details** | Inline warning icons, rows where a disruption replaces predictions, and alert cards. Alert detail page shows effect, cause, active period / recurrence, affected stops, and description, plus a link to "Plan a route with Trip Planner" (external). | `S/model/Alert.kt`, `A/util/FormattedAlert.kt`, `I/Pages/AlertDetails/*`, `A/alertDetails/AlertDetails.kt` |
| **Map** | Mapbox map with custom styles. Rail route lines and stops are always shown. In Stop/Trip details it adds the selected route's shapes and live vehicles for the selected route+direction. Includes a recenter button, location puck, and follow-vehicle mode. | `S/viewModel/MapViewModel.kt`, `S/map/*`, `I/Pages/Map/*`, `A/map/` |
| **More / settings** | Feedback link; resources (Trip Planner, Fares, mTicket external links); toggles (HideMaps, StationAccessibility); terms, privacy, source code, licenses; phone 617-222-3200 (`S/viewModel/MoreViewModel.kt`). Settings keys: `S/repositories/SettingsRepository.kt`. | `I/Pages/More/*` |
| **Onboarding** | Screens: Location, StationAccessibility, HideMaps (only when a screen reader is on), NotificationsBeta, Feedback (disabled) (`S/model/OnboardingScreen.kt`). Feature promos on upgrade (`S/model/FeaturePromo.kt`). | `I/Pages/Onboarding/*`, `I/Pages/Promo/*` |
| **Error banners** | Offline, data error, and "stale predictions" banner with refresh (`S/repositories/ErrorBannerStateRepository.kt`). | `S/viewModel/ErrorBannerViewModel.kt` |
| **Deep links** | `/s/:stop_id`, `/stop/:stop_id`, `/a/...`, `/alert/...`, `/t-alert`, `/c/:campaign` (`B/mobile_app_backend_web/router.ex`, `S/routes/DeepLinkState.kt`). | |

---

## 2. Data: backend endpoints → V3 equivalents

### 2.1 REST (backend `B/mobile_app_backend_web/router.ex`)

| App call (`S/repositories/…`) | Backend does (V3 queries) | Client-only feasible? |
|---|---|---|
| `GET api/global` (GlobalRepository) | `B/mobile_app_backend/global_data_cache.ex`, refreshed every 5 min:<br>(1) `/stops?filter[location_type]=0,1&include=child_stops,connecting_stops,parent_station`<br>(2) `/route_patterns?include=route.line,representative_trip.stops&fields[stop]=` (gives lines, routes, patterns, representative trips with stop id lists, and `pattern_ids_by_stop`)<br>(3) `/facilities?filter[type]=ELEVATOR`<br>Plus stop blocklist `["place-symcl"]` (`B/mobile_app_backend/stop_blocklist.ex`). | **Yes.** It is three large requests. Cache to disk with a daily or app-start TTL. **[Inference]** The payload is several MB, so fetch once and persist. |
| Nearby stop IDs | Done **client-side**: k-d tree over leaf stops from global data (`S/repositories/NearbyRepository.kt`, `S/kdTree/`). | Yes. A port is required. |
| `GET api/schedules?stop_ids=&date_time=` | `B/…/controllers/schedule_controller.ex`: resolves to parent stops, then one `/schedules?filter[stop]=X&filter[date]=SERVICE_DATE&include=trip` per stop, run in parallel. Drops past schedules for subway and bus but keeps the **last schedule per grouping** (needed for "service ended" logic); keeps all CR and ferry schedules. | Yes (N parallel requests). |
| `GET api/schedules?trip_id=` | `/schedules?filter[trip]=X&sort=stop_sequence` + `/trips?filter[id]=X&include=route_pattern.representative_trip.stops` | Yes |
| `GET api/schedules/next` | First schedule tomorrow, else walks `/services?filter[route]=` active dates; `/schedules?filter[route,stop,direction_id,date]&page[limit]=1&sort=time` (`next_schedule_controller.ex`). Used for "no service today, next trip …". | Yes |
| `GET api/trip?trip_id=` | `/trips?filter[id]=&include=stops,route_pattern.representative_trip.stops` (`trip_controller.ex`) | Yes |
| `GET api/trip/map-friendly` | Trip shape split into segments for map drawing (`B/mobile_app_backend/map_friendly_route_shape.ex`, `route_segment.ex`). | Partly. You can draw the raw `/shapes` polyline, but you lose the overlap-aware segmenting. |
| `GET api/shapes/map-friendly/rail` | `/routes?filter[type]=0,1,2&include=route_patterns`, then trips with shapes and stops for direction-0 typical patterns (`shapes_controller.ex`). | Yes, simplified. |
| `GET api/stop/map?stop_id=` | Child stops (excluding generic nodes) + `/route_patterns?filter[stop]=X&include=route,representative_trip.shape,representative_trip.stops.parent_station` (`stop_controller.ex`). | Yes |
| `GET api/route/stop-graph?route_id=&direction_id=` | `/stops?filter[route,direction_id]` + branch computation over patterns (`B/mobile_app_backend/route_branching*.ex`). | Yes, but you must port the branching algorithm. A simple fallback is the typical pattern's ordered stop list. |
| `GET api/search/query`, `api/search/routes` | **Algolia** multi-index search (route + stop indexes, `hitsPerPage=5`) using MBTA's Algolia credentials (`B/mobile_app_backend/search/algolia/*`). | **No (needs a backend or key).** Replace with local fuzzy search over global stops and routes. **[Inference]** At this data size (~10k stops), local search is good enough. |
| `GET api/protected/config` | Client config (Mapbox token rotation, `B/mobile_app_backend/mapbox_token_rotator.ex`). | N/A. Teal uses its own map key. |
| `POST api/notifications/subscriptions/*` | Stores subscriptions. Engine/scheduler matches alerts to favorites and windows, then pushes via FCM (`B/mobile_app_backend/notifications/*`). | **No. Requires a backend.** |

### 2.2 Realtime channels (Phoenix, `B/mobile_app_backend_web/channels/*`, client `S/phoenix/*`)

| Topic | Backend source | Direct V3 replacement **[External]**: V3 supports SSE streaming with `Accept: text/event-stream`, plus reset/add/update/remove events |
|---|---|---|
| `predictions:stops:v2:<ids>` | Backend streams `/predictions?filter[route]=R&include=trip` for each route serving the stops, plus `/vehicles`, then filters by stop (`B/mobile_app_backend/predictions/stream_subscriber.ex`, `B/mbta_v3_api/stream/static_instance.ex`). | SSE `/predictions?filter[stop]=<ids>&include=trip,vehicle`, or poll the same URL every 10–15 s. |
| `predictions:trip:<tripId>` | Same store, filtered by trip. | `/predictions?filter[trip]=X&include=vehicle` |
| `vehicle:id:<id>` | Vehicle store | `/vehicles/<id>` (poll) or SSE `/vehicles?filter[id]=` |
| `vehicles:routes:<routeIds>:<dir>` | Vehicle store | `/vehicles?filter[route]=..&filter[direction_id]=d` |
| `alerts:v3` | One `/alerts` stream for all alerts, enriched with server-computed **summaries** (`B/mobile_app_backend/alerts/alert_with_summaries.ex`, `alert_summary*.ex`). The summaries are text pieces such as location, timeframe, and recurrence. | `/alerts?filter[datetime]=NOW` or SSE `/alerts`. Summaries must be rebuilt client-side, or fall back to `alert.header`. The app already falls back: `summary() ?: header` in `A/util/FormattedAlert.kt`. |

Staleness: a "stale predictions" banner appears when there is >0 predictions and no update for **2 min** (`ErrorBannerStateRepository.kt:132-136`). Predictions are forgotten after **10 min** without updates (`S/repositories/PredictionsRepository.kt:49-51`). Stale checks run every 5 s (`S/viewModel/composeStateHelpers/subscribeToPredictions.kt:37`). Vehicles count as stale when `updated_at` is more than 1 h old (`S/model/Vehicle.kt`).

**[External]** A V3 API key is strongly recommended. Unkeyed requests are rate-limited to about 20 per minute. The key should be in app config, and it is not a real secret on a client.

---

## 3. Business rules to copy exactly

### 3.1 Departure formatting: `S/model/TripInstantDisplay.kt` (port verbatim)

Constants (`S/model/Prediction.kt:10-13`): `ARRIVAL_CUTOFF=30s`, `APPROACH_CUTOFF=60s`, `BOARDING_CUTOFF=90s`, `SCHEDULE_CLOCK_CUTOFF=60min`.
Contexts: `NearbyTransit | StopDetailsUnfiltered | StopDetailsFiltered | TripDetails`.

Algorithm, in order, given prediction `p`, schedule `s`, vehicle `v`, routeType, now, context, lastTrip, alert:

1. `scheduleBased = CR || Ferry`. `forceAsTime = TripDetails || scheduleBased`. `isScheduledDeparture = scheduleBased && context != TripDetails`. For scheduleBased routes the time is departure-first (`departure ?? arrival`). Otherwise it is `arrival` if not in the past, else `departure` (`S/model/TripStopTime.kt:16-20`).
2. If the schedule time is upcoming and (bus in StopDetailsFiltered, or CR, or Ferry), then:
   - `p.schedule_relationship==CANCELLED` → **Cancelled**(schedTime)
   - alert effect SHUTTLE → **Shuttle**
   - alert effect STATION/STOP_CLOSURE → **Skipped**
3. If `p.status` is set (V3 `status` text):
   - For CR: filtered context → **TimeWithStatus**. Otherwise, if there is a prediction time → **Time**. If there is only a schedule: filtered or last trip → **ScheduleTimeWithStatusColumn**; past schedule → **ScheduleTimeWithStatusRow**; otherwise **ScheduleTime**.
   - For all other modes → **Overridden(status)**. The status text is shown verbatim and is always English.
4. `p.schedule_relationship==SKIPPED` → **Skipped**(schedTime) or Hidden.
5. No prediction: no schedule time, or no schedule departure (outside TripDetails) → **Hidden**. Otherwise minutes = round((sched−now)/60). If minutes ≥ 60 or forceAsTime → **ScheduleTime** (clock). Otherwise **ScheduleMinutes**.
6. No prediction time, or no departure (outside TripDetails) → **Hidden** (arrival-only predictions are hidden).
7. forceAsTime (CR, Ferry, trip details): if in the past → Hidden. If the filtered context and the schedule's HH:MM differs from the prediction's → **TimeWithSchedule** (new time plus struck-through scheduled time). Otherwise **Time**.
8. **Bus**: in the past → Hidden. ≤30 s → **Now**. Otherwise **Minutes**.
9. Subway (rail): if the vehicle is `STOPPED_AT` the same stop and trip, and (≤90 s or arrived-but-not-departed) → **Boarding**. In the past → Hidden. ≤30 s or arrived-not-departed → **Arriving**. ≤60 s → **Approaching**. Otherwise **Minutes**.

Rendered strings (`AR/values/strings.xml`, `A/component/UpcomingTripView.kt`):

| Display | Text |
|---|---|
| Boarding | `BRD` |
| Arriving | `ARR` |
| Now | `Now` |
| Approaching | `1 min` (deliberately shown as 1 min; the "Approaching" string is used for vehicle status) |
| Minutes | `<b>N</b> min`. At 60 min or more, `MinutesFormat` gives `N hr` or `N hr M min` (`S/utils/MinutesFormat.kt`) |
| Cancelled | `Cancelled` + struck schedule time |
| Shuttle | bus icon + `Shuttle` |
| Skipped | `Stop skipped` |

Indicators (`A/component/WithStatusIndicators.kt`):
- Realtime predictions get a pulsing "live" icon.
- Schedule-only times get no live icon. On a last trip they show a clock icon.
- `lastTrip` adds a "Last" label.
- Schedule-based CR/Ferry times are rendered in "headline" semibold style.

Additional filters (`S/model/UpcomingTrip.kt`):
- Scheduled times are **hidden entirely on subway and Silver Line** (routes 741, 742, 743, 751, 749, 746). This is "API best practice", `UpcomingTrip.kt:~150-165`, `S/model/MapStopRoute.kt:5`.
- Schedules and predictions are joined on key `(routeId, tripId, parentStopId, stopSequence)`. Stop sequence is dropped for trips with any CANCELLED prediction.
- Trips with only a past schedule are dropped.
- Displayed time = the prediction time if the prediction is "stopping here", else the schedule time.
- Headsign = `prediction.trip.headsign ?? schedule.stop_headsign ?? trip.headsign`.
- Track number is shown only when the prediction's child stop `shouldShowTrackNumber` applies (CR at major stations, `platform_code`).
- Last trip: on subway it comes from `prediction.last_trip`. On other modes it is the last item in the list, adjusted so a cancelled final trip does not carry the flag (`UpcomingTrip.kt:341-370`).

No-trips messages (`S/model/UpcomingFormat.kt`):
- Subway, after 03:30 and before the first scheduled train → "First **HH:MM**" with a clock icon.
- No schedules today → "No service today".
- Future trips exist but are not displayable → "Predictions unavailable".
- Otherwise → "Service ended".
- Cancelled trips are removed in Nearby, StopDetailsUnfiltered, and always on subway (`RouteCardData.kt filterCancellations`). Arrival-only trips are removed.

### 3.2 Nearby stop selection: `S/repositories/NearbyRepository.kt`

- Find leaf stops (location_type 0) within **0.5 mi**, or **1.0 mi** for Commuter Rail stops.
- If nothing is found, widen to **2 mi** and **10 mi** for CR.
- Expand each stop to all siblings under its parent station. Beyond the normal radius, only CR siblings are kept.
- Drop blocklisted parents (`place-symcl`).
- Results are ordered by distance (k-d tree).
- Map view: the location is the user puck, or the map center when the user pans (`S/viewModel/NearbyViewModel.kt`).

### 3.3 Grouping into route cards: `S/model/RouteCardData.kt`, `S/model/RoutePattern.kt`, `S/model/PatternSorting.kt`

- Hierarchy is `LineOrRoute → Stop (parent) → Direction → Leaf`. **Green Line routes B/C/D/E are grouped into one `line-Green` card** (`S/model/Line.kt:39-42`). All other routes get their own card.
- **Pattern de-duplication:** walk stops in distance order. A stop is included for a route only if it serves a route pattern **not already served by a closer stop** (`addStaticStopsData`). A leaf is shown in Nearby only if all of these hold:
  - it has an unseen *typical* (or canonical-only) pattern, or an upcoming trip on an unseen pattern;
  - AND it is not arrival-only (last stop of all typical patterns);
  - AND it is not a shuttle route with no service (`shouldShow`, lines 1142-1203).
- Typicality: `typical | deviation | atypical | diversion | canonical_only`. A null typicality is treated as typical.
- Directions: `route.direction_names[id]` and `direction_destinations[id]`, with **special-case trunk labels** (`S/model/Direction.kt`):
  - GL westbound: "Copley & West", then "Kenmore & West".
  - GL eastbound: "Park St & North", "Gov Ctr & North", "North Station & North", "Lechmere & North".
  - Red Line southbound: "Ashmont" / "Braintree" past JFK.
- Leaf format (`Leaf.format`):
  - Collect "potential service" `(route, headsign)` pairs. For **bus**, use only the next 2 trips' headsigns. For other modes, also add headsigns of typical patterns' representative trips.
  - More than one pair = **branching**. Branching non-bus leaves show up to **3 rows** (one per headsign, disruptions first). Otherwise up to **2 departures** (`TYPICAL_LEAF_ROWS=2`, `BRANCHING_LEAF_ROWS=3`).
  - Filtered stop details has no limit.
- Card sort (`PatternSorting.compareRouteCards`):
  1. Very close (≤100 ft) first.
  2. Service bucket: has trips or major alert, then service ended, then no service today.
  3. Subway before others (not in Favorites).
  4. Distance.
  5. Route `sort_order`.
- Stops within a card sort by close bucket, then service bucket, then distance. Leaves sort by service bucket, then direction id.

### 3.4 Alerts: `S/model/Alert.kt`, `S/model/AlertSignificance.kt`

Intrinsic significance by effect:

| Effect | Significance |
|---|---|
| SHUTTLE, SUSPENSION | **Major** |
| STATION/STOP/DOCK_CLOSURE, DETOUR, SNOW_ROUTE | Major if *every* informed entity has a stop, else Secondary |
| SERVICE_CHANGE | Secondary |
| ELEVATOR_CLOSURE | Accessibility |
| TRACK_CHANGE, CANCELLATION | Minor (cancellation is Major for the specific trip) |
| DELAY | Minor if severity ≥3 on non-bus, or cause SINGLE_TRACKING; else None |
| other | None |

Time cap (`significance(at)`):
- Active now, or all-clear (all periods ended): intrinsic significance.
- Starting within 24 h: capped at Secondary.
- Otherwise: None.

Display:
- **Major** alerts affecting all trips (no trip-specific informed entity) **replace predictions** in the leaf (`UpcomingFormat.Disruption`). The row reads "Shuttle bus" / "Suspension" / "Stop skipped" / "Dock closed" with an icon.
- Secondary alerts, major trip-specific alerts, and **downstream** alerts show as a warning icon next to predictions.
- Nearby shows alerts at Accessibility significance and above. Stop details also shows Minor.
- Matching uses informed_entity activity BOARD, plus route, route_type, direction and stop (`Alert.applicableAlerts`).
- Icon name pattern: `alert-{large-<mode>|borderless}-{issue|shuttle|suspension|elevator}` (`UpcomingFormat.kt` iconName, `I/Icons.xcassets`). Modes are red, orange, blue, green, mattapan, silver, bus, commuter, ferry.

### 3.5 Vehicles, occupancy, crowding

- Vehicle status text (`A/stopDetails/TripHeaderCard.kt:~470`):

  | `current_status` | Text |
  |---|---|
  | `INCOMING_AT` | "Approaching" |
  | `IN_TRANSIT_TO` | "Next stop" |
  | `STOPPED_AT` | "Now at", or "Waiting to depart" at the first terminal |

  If the vehicle is on another trip: "Finishing another trip". With no vehicle: "Location not available yet".
- Occupancy → crowding (`S/model/Vehicle.kt`):

  | `occupancy_status` | Crowding text |
  |---|---|
  | MANY_SEATS | **Not crowded** |
  | FEW_SEATS | **Some crowding** |
  | STANDING / CRUSHED / FULL / NOT_ACCEPTING | **Crowded** |
  | otherwise | unknown |

  If carriage-level data exists (`carriages[].occupancy_status`), a per-car "Train crowding diagram" is shown instead. Otherwise a single bus-style icon is shown. Not shown at the terminal.
- Map shows vehicles only for the selected route and direction in Stop/Trip details (`A/pages/MapAndSheetPage.kt:~320`). Selecting a vehicle enables follow mode.

### 3.6 Time

All logic uses Eastern time (`S/utils/EasternTimeInstant.kt`). The service day starts at 03:00 (`Alert.kt` RecurrenceInfo: 03:00 = start of service, 02:59/03:00 = end).

---

## 4. Design system

- **Font:** Inter (regular and bold) with tabular numerals (`fontFeatureSettings = "tnum"`) (`A/util/Typography.kt`).
- **Type scale (sp):**

  | Style | Size |
  |---|---|
  | largeTitle | 36 |
  | title1 | 32 |
  | title2 | 24 |
  | title3 | 20 |
  | headline / body | 17 |
  | callout | 16 |
  | subheadline | 15 |
  | footnote | 13 |
  | caption | 12 |
  | caption2 | 11 |

  Each has semibold / bold / italic variants. Departure minutes use `<b>N</b> min`, meaning a bold number with a regular unit.
- **Semantic colors** (`I/Colors.xcassets`, light / dark):

  | Token | Light | Dark |
  |---|---|---|
  | Text | #192026 | #E5E5E3 |
  | Text Contrast | #E5E5E3 | #192026 |
  | Key (accent) | #006CD9 | #66B2FF |
  | Key Inverse | #66B2FF | #006CD9 |
  | Fill 1 | #E5E5E3 | #3E454D |
  | Fill 2 | #F5F4F2 | #192026 |
  | Fill 3 | #FFFFFF | #000000 |
  | Sheet Background | #F5F4F2 | #3E454D |
  | Deemphasized | #8A9199 | #8A9199 |
  | Contrast | #3E454D | #E5E5E3 |
  | Error / Delete | #B3261E | #B3261E |
  | Accessibility | #165C96 | #E5E5E3 |
  | Halo | #192026 @10% | #FFFFFF @15% |

  Map palette: `S/map/ColorPalette.kt`.
- **Route colors** come from the V3 `route.color` / `route.text_color`. They are not hard-coded.
- **Route pills** (`S/model/RoutePillSpec.kt`, `A/component/RoutePill.kt`). Text is uppercased.

  | Mode | Shape | Text |
  |---|---|---|
  | Bus | Rectangle, 4 dp radius | `short_name` |
  | All others (shuttles too) | Capsule | — |
  | Green-B..E | Circle | "B" etc. |
  | Line-level Green | — | "GL" |
  | Heavy rail | — | initials of long name ("RL", "OL", "BL") |
  | Mattapan | — | "M" |
  | CR | — | "CR" (fixed/compact), long name minus " Line" (flex) |
  | Ferry | — | ferry icon (fixed), long name (flex) |
  | Shuttle bus | — | bus icon |

  Heights: Small 16 dp / 12 sp, Medium 24 dp / 16 sp, Large 24 dp (32 dp circle). Fixed width = (h+1)×2.
- **Icons:** Font Awesome glyphs (`fa-*`) plus custom mode, alert, crowding and accessibility imagesets (`I/Icons.xcassets`). The realtime "live" indicator is an animated icon.
- **Map:** Mapbox custom styles, light and dark (`S/AppVariant.kt`). Stop layers appear at zoom ≥11, bus stops at ≥12, close threshold 15, default 16, child-stop labels at 19 (`S/map/MapDefaults.kt`, `S/map/StopLayerGenerator.kt`).

---

## 5. Trip planning

**MBTA Go has no in-app trip planner or destination routing.** The only references are external links to `https://www.mbta.com/trip-planner`:
- More → Resources (`S/viewModel/MoreViewModel.kt:~60`)
- Alert details "Plan a route with Trip Planner" (`A/alertDetails/AlertDetails.kt:348-360`)

The backend contains an `OpenTripPlannerClient` nearby module (`B/open_trip_planner_client/nearby.ex`), but no controller or channel references it. **[Inference]** It is legacy or unused. If Teal wants routing it has to come from elsewhere, for example MBTA's OTP via its own backend. That is out of scope for this spec.

---

## 6. Recommended build order (Expo, direct to api-v3.mbta.com)

1. **Data layer.** Write a typed JSON:API client with `include` resolution and an API key. Add a global-data loader for the three requests in §2.1, persisted to disk, with the stop blocklist. Add Eastern-time / service-date utilities.
2. **Port the pure logic as TS modules with unit tests**, using MBTA's own tests in `mobile_app/shared/src/commonTest/` as golden cases:
   - `TripInstantDisplay` + `UpcomingTrip` join/filter
   - `UpcomingFormat` / NoTrips
   - `Alert` significance
   - `RoutePattern` typicality
   - `Direction` special cases
   - `PatternSorting`
   - `RoutePillSpec`
3. **Nearby.** Get location (expo-location), then radius search (a k-d tree, or plain haversine over ~8k leaf stops). Then `RouteCardData` grouping and dedup. Then schedules (per-parent-stop `/schedules?filter[stop]&filter[date]&include=trip`), predictions (`/predictions?filter[stop]=…&include=trip,vehicle`; poll every 10–15 s or use SSE via `react-native-sse`), and alerts (`/alerts`).
4. **Route card UI.** Pills, rows, departure strings and indicators, warning and disruption rows, empty and loading states.
5. **Stop details.** Unfiltered list, then filtered view with departure tiles and direction picker. Elevator alerts come from facilities plus alerts.
6. **Trip details.** `/trips/<id>?include=…` + `/schedules?filter[trip]` + `/predictions?filter[trip]&include=vehicle`. Build the stop list, then the vehicle header, crowding, and follow-vehicle mode.
7. **Map** (react-native-maps or @rnmapbox/maps). Draw rail shapes (`/shapes` via typical patterns), stop markers by zoom, and route vehicles (`/vehicles?filter[route]&filter[direction_id]`), polled every ~10 s.
8. **Favorites.** Store `RouteStopDirection` in local storage and reuse the route-card pipeline with Favorites sort.
9. **Search.** Local fuzzy search over global stops and routes, plus recent-stop history (replaces Algolia).
10. **Route picker and route details.** Start with a linear stop list from the typical pattern, and port `route_branching` later for the stick diagram.
11. **Alert details page and alert summaries.** Start with the V3 `header`/`description`, then optionally port `B/mobile_app_backend/alerts/alert_summary*.ex`.
12. **Things that need a backend if wanted:**
    - push disruption notifications (subscription store, alert matching, FCM/APNs)
    - hosted search (Algolia)
    - fan-out caching to protect API rate limits at scale
    - server-computed alert summaries (optional)
    - map-friendly overlapping-segment shapes (optional)
    - universal and deep links domain

   **[Inference]** For a single-user or low-traffic app, polling V3 directly with a key is sufficient.
