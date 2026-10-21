# MBTA data stack for destination-aware trip planning in Teal

Research date: 2026-10-19, around 00:40 America/New_York, so it was late-night service. This was read-only research.
Sources:
- Shallow clones of `mbta/api`, `mbta/concentrate`, `mbta/otp-deploy` and `mbta/open_trip_planner_client`, plus a sparse clone of `mbta/dotcom` (`config/`, `lib/`).
- About 14 live calls to `https://api-v3.mbta.com` with no key.
- Official MBTA, Expo, OSMF and komoot web pages.

Labels used below:
- **[obs]**: observed live or read directly in source.
- **[src]**: derived from reading source, not exercised.
- **[inf]**: inference or recommendation.

Repo paths are relative to each repo root.

---

## 1. What concentrate does and what it feeds

**Role [src].** Concentrate is a GenStage pipeline that merges several GTFS-realtime feeds, filters and corrects them, and writes the result as files. Its stages are fetch, parse, MergeFilter, group by trip, GroupFilters, encoders and sinks (`concentrate/guides/architecture.md`).
- **Inputs:**
  - GTFS-RT protobuf and "enhanced JSON" sources. Each source can have per-source route include/exclude lists, `max_future_time` and `drop_fields` (`guides/configuration.md`).
  - The static GTFS zip.
  - An Alerts feed.
  - A Screenplay "suppressed predictions" API (`config/runtime.exs:30-31`).
- **Production sources are not in the repo.** They are injected through `CONCENTRATE_JSON`. The dev defaults just loop back to `cdn.mbta.com` (`config/config.exs:38-49`).
- **Outputs** (`config/config.exs:92-103`):
  - `TripUpdates.pb`, `TripUpdates.json`, `TripUpdates_enhanced.json`
  - `VehiclePositions.pb`, `VehiclePositions.json`, `VehiclePositions_enhanced.json`
  - The sinks are S3 (production) or the filesystem (`lib/concentrate/sink/`).
- **Alerts are not produced by concentrate.** It only consumes them, to cancel or skip stops.

**What the V3 API consumes [src].** `api/apps/state_mediator/config/config.exs:23-44` sets these sources:
- Predictions from `https://cdn.mbta.com/realtime/TripUpdates_enhanced.json`. This is concentrate's output.
- Vehicles from `https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json`. This is also concentrate's output, with an optional MQTT broker.
- Alerts from `https://cdn.mbta.com/realtime/Alerts_enhanced.json`. A separate system produces this feed (not concentrate).
- Static data from `https://cdn.mbta.com/MBTA_GTFS.zip`.
- Commuter Rail crowding from a Keolis Firebase/S3 source (`config.exs:7-16`).

**Realtime facts that reach the V3 API, and their concentrate origin:**

| Fact | Where it ends up in V3 | Concentrate / API source |
|---|---|---|
| Predicted arrival and departure times plus uncertainty (seconds) | `prediction.attributes.arrival_time`, `departure_time`, `arrival_uncertainty`, `departure_uncertainty` | `api/apps/parse/lib/parse/gtfs_rt/trip_updates_enhanced_json.ex:47-54`; uncertainty set from `update_type` in `concentrate/lib/concentrate/group_filter/uncertainty_value.ex` |
| `schedule_relationship`: ADDED / SKIPPED / CANCELLED / NO_DATA | `prediction.attributes.schedule_relationship` (null means scheduled) | Group filters `cancelled_trip.ex`, `closed_stop.ex` (alert-closed stops become skipped), `shuttle.ex`, `skipped_departures.ex`, `skipped_stop_on_added_trip.ex` |
| Boarding status text (mostly Commuter Rail) | `prediction.attributes.status` | `trip_updates_enhanced_json.ex:54` (`boarding_status`); mapping in `concentrate/config/config.exs:25-36` |
| `revenue`, `last_trip`, `route_pattern_id`, trip headsign | Prediction and trip filters (`revenue`, `route_pattern`) | `trip_updates_enhanced_json.ex:31-39,106` |
| Vehicle position, `current_status`, stop | `/vehicles` | `parse/vehicle_positions_json.ex` |
| Whole-vehicle occupancy plus per-car occupancy | `vehicle.attributes.occupancy_status`, `vehicle.attributes.carriages[] {label, occupancy_status, occupancy_percentage, carriage_sequence}` | `concentrate/lib/concentrate/vehicle_position/carriage_details.ex`; `api/apps/parse/lib/parse/vehicle_positions_json.ex:51-93` |
| Alerts (effect, severity, informed entities, active periods) | `/alerts` | `Alerts_enhanced.json` (not concentrate) |

**Filters that matter to a client [src]:**
- Predictions more than 3 hours out are dropped (`group_filter/time_out_of_range.ex:10`, `@max_time_in_future 10_800`).
  - Beyond that horizon, fall back to `/schedules`.
- Predictions can be **deliberately suppressed** for a stop, route and direction through Screenplay (`group_filter/suppress_stop_time_update.ex`).
  - Missing predictions are therefore not proof that no train is coming.
- Stop-time updates are removed once the vehicle has already left a stop (`vehicle_past_stop.ex`).
- The first stop has no arrival time and the last stop has no departure time (`remove_unneeded_times.ex`).
- Stops closed by alerts and shuttled segments are marked SKIPPED (`closed_stop.ex`, `shuttle.ex`).

---

## 2. V3 API features for trip planning

**Global behaviour:**
- **Rate limits:**
  - **[obs]** The no-key limit is 20 requests per window per IP. Response headers include `x-ratelimit-limit: 20`, `x-ratelimit-remaining` and `x-ratelimit-reset` (epoch).
  - **[src]** The window is 60 s: `apps/api_web/config/prod.exs:56-57` sets `clear_interval: 60_000` and `max_anon_per_interval: 20`. Anonymous users are tracked by IP (`apps/api_web/lib/api_web/user.ex`).
  - A free key raises the limit to a default of 1,000 requests/min (https://www.mbta.com/developers/v3-api). Get the key at https://api-v3.mbta.com/.
  - Send the key as the **`x-api-key` header** or the `api_key` query parameter (`apps/api_web/lib/api_web/plugs/authenticate.ex:45-59`).
- **CORS [src]:** Allowed (Corsica). The allowed headers include `x-api-key`, `if-modified-since` and `if-none-match`, and allowed origins default to `*`. A key can be locked to `allowed_domains`, which is useful for an Expo web build (`plugs/cors.ex`).
- **Conditional GET:**
  - **[obs]** Responses carry `last-modified`.
  - **[src]** The API returns a 304 when `If-Modified-Since` matches (`plugs/modified_since_handler.ex:52-56`).
  - **[inf]** A 304 probably still counts against the rate limit, because the RateLimiter plug runs in the controller (`api_controller_helpers.ex:29`). This was not measured.
- **JSON:API conventions:**
  - `fields[type]=a,b` sparse fieldsets shrink payloads.
  - `include=` side-loads related records.
  - Filters accept comma-separated lists.
  - `sort=` and `page[limit]` are supported.
  - Times are ISO-8601 with an offset (e.g. `2026-10-19T00:41:19-04:00`).
- **Streaming:** Predictions, vehicles and alerts can be streamed (SSE, `accept: text/event-stream`) with a key (MBTA developer page). Not exercised here.

### 2.1 Stops

The filters are `id, date, direction_id, latitude, longitude, radius, route, route_type, location_type, service` (`stop_controller.ex:9`).
- **There is no name or text search [src]**, so name matching has to happen client-side over cached stops.
- `radius` is in degrees; the default is 0.01, roughly 0.69 mi (`stop_controller.ex:27-30`).

Verified query [obs], stops near Downtown Crossing:
```
GET /stops?filter[latitude]=42.3554&filter[longitude]=-71.0605&filter[radius]=0.005
    &filter[route_type]=0,1&sort=distance
    &fields[stop]=name,latitude,longitude,location_type,platform_name,wheelchair_boarding
    &include=parent_station
```
This returned 22 **platforms** (`location_type: 0`), sorted by distance, plus 6 parent stations. For example:
- `70020` has `platform_name: "Forest Hills"` and parent `place-dwnxg`.
- `70197` is Park Street "Cleveland Circle", with parent `place-pktrm`.

Notes:
- The `route_type` filter returns platforms. Add `filter[location_type]=1` to get stations only [src].
- **[inf]** You rarely need this call at runtime. Do nearest-station selection locally over the cached station list (section 3).

### 2.2 Route patterns and ordered stops (static, cacheable)

Verified query [obs]:
```
GET /route_patterns?filter[route]=Red,Orange,Blue,Green-B,Green-C,Green-D,Green-E,Mattapan
    &filter[canonical]=true&include=representative_trip
    &fields[route_pattern]=name,direction_id,typicality,canonical,sort_order&fields[trip]=headsign,direction_id,shape_id
```
This returned 18 patterns, for example:
- `Red-3-0` "Alewife - Braintree" and `Red-1-0` "Alewife - Ashmont".
- `Green-B-812-0` "Government Center - Boston College".
- `Green-D-855-0` "Union Square - Riverside".
- `Green-E-886-0` "Medford/Tufts - Heath Street".
- `Mattapan-_-0` "Ashmont - Mattapan".

Their representative trips are synthetic IDs such as `canonical-Red-C1-0`.

Then fetch all ordered stop lists in **one call** [obs]:
```
GET /trips?filter[id]=canonical-Red-C1-0,canonical-Red-C2-0,...(all 18)&include=stops
    &fields[trip]=headsign,direction_id&fields[stop]=name,latitude,longitude,location_type
```
- `trip.relationships.stops.data` is the **ordered** platform list. For example, Blue direction 0 is `70059 … 70838`.
- The 265 included platform stops each carry `relationships.parent_station.data.id`.
- **Pitfall [obs]:** `/schedules?filter[trip]=canonical-Red-C1-0` returns `[]`. Canonical trips carry no dated times, so they provide no static run times.

### 2.3 Predictions (realtime departures and in-vehicle time)

The filters are `stop route trip latitude longitude radius direction_id stop_sequence route_type route_pattern revenue schedule_relationship`. The includes are `schedule stop route trip vehicle alerts`, and the default sort is `arrival_time` (`prediction_controller.ex:22-24,125`).
- A parent-station ID in `filter[stop]` is expanded to its child platforms (`prediction_controller.ex:67`, `includes_children: true`) [src+obs].

Verified query [obs], next Red departures southbound at Park Street with vehicle crowding:
```
GET /predictions?filter[stop]=place-pktrm&filter[route]=Red&filter[direction_id]=0&sort=departure_time&page[limit]=3
    &fields[prediction]=arrival_time,departure_time,status,schedule_relationship,stop_sequence,direction_id,arrival_uncertainty,departure_uncertainty
    &include=trip,vehicle&fields[trip]=headsign&fields[vehicle]=occupancy_status,carriages,current_status,label
```
Two predictions came back:
- **First prediction:**
  - Trip `77916607`, headsign Braintree, stop `70075`, `stop_sequence: 70`.
  - Departure `00:41:19-04:00`, uncertainty 60 s.
  - Vehicle `R-548C2B19`. Its `carriages[]` were, e.g., `{label:"1902", occupancy_status:"MANY_SEATS_AVAILABLE", occupancy_percentage:1}`.
- **Second prediction:**
  - Trip `ADDED-1585007754`, headsign Ashmont, `schedule_relationship: "ADDED"`.
  - Its carriages reported `NO_DATA_AVAILABLE`.

**The key trick [obs]: one call gives door-to-door realtime times.** Put the boarding and alighting stations in a single `filter[stop]`, then join the results by trip ID:
```
GET /predictions?filter[stop]=place-dwnxg,place-harsq&filter[route]=Red
    &fields[prediction]=arrival_time,departure_time,stop_sequence,direction_id,schedule_relationship
```
Example join: trip `77916431` departs `70078` (Downtown Crossing, seq 140) at 00:41:01 and arrives at `70068` (Harvard, seq 190) at 00:50:22.
- The trip qualifies because seq 140 < 190, so it is going the right way.
- Direction 0 trips appear only at Downtown Crossing here, because they head away from Harvard.

Single trip to destination [obs]: `GET /predictions?filter[trip]=77916607&filter[stop]=place-qnctr` returned an arrival of 01:00:02 at `70101` (Quincy Center, seq 200).

### 2.4 Schedules (static fallback and arrival at destination)

The filters are `date direction_id max_time min_time route stop stop_sequence route_type trip`, and `route`, `stop` or `trip` **must** be present (`schedule_controller.ex:19,31`).

Yes: `filter[trip]` + `filter[stop]` works and accepts parent stations [obs].
```
GET /schedules?filter[trip]=77916607&filter[stop]=place-pktrm,place-qnctr
    &fields[schedule]=arrival_time,departure_time,stop_sequence,pickup_type,drop_off_type
```
- Park Street `70075` (seq 70) at 00:38.
- Quincy Center `70101` (seq 200) at 00:59.
- That is 21 minutes of scheduled in-vehicle time.

Pair query for a future time window [obs]:
```
GET /schedules?filter[stop]=place-dwnxg,place-harsq&filter[route]=Red&filter[direction_id]=1
    &filter[date]=2026-10-19&filter[min_time]=08:00&filter[max_time]=08:20&sort=departure_time
```
Example join: trip `77871071` is at Downtown Crossing 08:02 and Harvard 08:14.
- **Pitfall [obs]:** `min_time`/`max_time` filter every row. The Harvard rows for trips that leave Downtown Crossing at 08:11 and later were cut off.
- Widen `max_time` by the expected ride length, or query the destination window separately.
- `min_time`/`max_time` take values past 24:00 for after-midnight service. `min_time=00:00&max_time=02:00` returns nothing [src, `schedule_controller.ex:67-74`].

`ADDED` trips have **no schedules**. Use their predictions, or a static estimate.

### 2.5 Other endpoints

- **Vehicles** (`vehicle_controller.ex:11-13`, filters `trip route direction_id id label route_type revenue`):
  - Prefer `include=vehicle` on predictions to avoid an extra call [obs].
  - Occupancy is often `NO_DATA_AVAILABLE` [obs].
- **Alerts** (`alert_controller.ex:5-7`, filters `activity id direction_id facility route route_type stop trip banner datetime lifecycle severity`). Verified query [obs]:
  ```
  GET /alerts?filter[route_type]=0,1&filter[datetime]=NOW&filter[activity]=BOARD,EXIT,RIDE
      &fields[alert]=effect,header,severity,lifecycle,informed_entity,active_period,timeframe
  ```
  - It returned 9 alerts. Examples:
    - `STATION_CLOSURE` at `70241` (Symphony, Green-E).
    - `STATION_CLOSURE` at `70225` (Brandon Hall, Green-C, direction 0 only).
  - `informed_entity[]` has `{stop, route, route_type, direction_id?, activities[]}`.
  - At runtime, narrow by `filter[route]=...&filter[stop]=...` for the candidate legs.
- **Facilities** (`facility_controller.ex:5`, filters `stop type`):
  - `GET /facilities?filter[stop]=place-dwnxg&filter[type]=ELEVATOR` returned 6 elevators [obs].
  - Live elevator status uses `/live_facilities` plus `ELEVATOR_CLOSURE` alerts [src].
- **Transfers** (`transfer_controller.ex`):
  - `filter[from_trip]` is **required**.
  - Fields include `min_transfer_time`, `min_walk_time` (experimental) and `min_wheelchair_time`.
  - **[inf]** It is impractical for planning before a trip is chosen. Use a fixed transfer allowance (section 3).
- **Shapes** (`shape_controller.ex:8,17`):
  - `/shapes?filter[route]=Red` is required, or use `/shapes/{trip.shape_id}`. The result is an encoded polyline for drawing [src, not exercised].
- **Stop events** (`stop_event_controller.ex`): new historical arrive/depart events. Not needed here.

---

## 3. Client-side algorithm (direct ride or one transfer)

### 3.1 Static cache (refresh daily, or with `If-Modified-Since`): 2–3 calls

1. `/route_patterns?…canonical=true&include=representative_trip` (section 2.2).
2. `/trips?filter[id]=<18 canonical ids>&include=stops` (section 2.2).
3. Optional: `/stops?filter[route_type]=0,1&filter[location_type]=1&fields[stop]=name,latitude,longitude,wheelchair_boarding` for station-level coordinates and names.
   - **[inf]** Alternatively, average the coordinates of each station's platforms from call 2.

Build the following:
- `patterns[]`: `{routeId, directionId, stations: [parentId…]}`, ordered.
  - Map each platform to its parent and collapse consecutive duplicates.
  - Keep `index[parentId]` for each pattern.
- `stations{parentId → {name, lat, lon, routes:Set}}`.
- `transferStations`: parents served by two or more patterns. Examples [inf, from the topology]:
  - Park St, Downtown Crossing, State, Government Center, Haymarket, North Station.
  - JFK/UMass for the Red branches.
  - Ashmont for Red and Mattapan.
  - Kenmore, Copley and the other Green trunk stations for branch-to-branch transfers.
- A name index for local typeahead (section 4).

Optional key buses [inf]: add canonical patterns for a curated set, such as SL1/SL2/SL4/SL5 and the frequent routes (e.g. 1, 15, 22, 23, 28, 32, 39, 66, 71, 73, 77, 111, 116/117). The same code path works, but there are many more stops, so cache them separately.

### 3.2 Per query (origin O, destination D)

1. **Candidate stations (0 calls).**
   - Haversine distance to every station.
   - Keep up to 4 stations within about 1.2 km of O, and likewise for D.
   - Walk time = distance × 1.3 detour factor ÷ 80 m/min [inf].
   - Also compute a pure-walk option for O→D.
2. **Enumerate itineraries (0 calls):**
   - **Direct:** pattern p with `idx_p(o) < idx_p(d)` for o ∈ O-set and d ∈ D-set.
   - **One transfer:** p1 with `idx(o) < idx(x)`, and p2 ≠ p1 (or a different direction) with `idx(x) < idx(d)`, where x is a transfer station.
   - Pre-score each itinerary: walkO + hops × avgHop + transfer penalty + walkD.
     - **[inf]** avgHop ≈ 2.0 min heavy rail, 1.8 min Green subway, 2.2 min Green surface; transfer ≈ 4 min plus half the headway.
   - Keep the top K (K = 3–5).
3. **One realtime call (1 call):** for the union of stations S and routes R in the top-K itineraries:
   ```
   /predictions?filter[stop]=<S>&filter[route]=<R>
     &fields[prediction]=arrival_time,departure_time,stop_sequence,direction_id,schedule_relationship
     &include=vehicle,trip&fields[vehicle]=occupancy_status,carriages&fields[trip]=headsign
   ```
   Group the results by `tripId` into `{stopParent → {arr, dep, seq, rel}}`. Map platform to parent using the cache.
4. **Evaluate each itinerary leg.** Pick the earliest trip T on the leg's route and direction that meets all of these:
   - It has a prediction at the boarding station with `dep ≥ now + walk`.
   - It has a prediction at the alighting station with a greater `seq`.
   - Neither stop has `rel ∈ {SKIPPED, CANCELLED}`.

   Then:
   - Wait = dep − (now + walk).
   - Ride = arr_alight − dep.
   - For a second leg, use the same rule at x with `dep ≥ arr_x + transferMin`.
     - **[inf]** transferMin is 3 min same-platform, 5 min cross-platform/level.
     - For example, Park St Red ↔ Green or Downtown Crossing Red ↔ Orange need a level change.
5. **Fallbacks:**
   - **Boarding prediction exists but alighting prediction is missing** (suppression, or a short-turn or non-canonical pattern):
     - Call `/schedules?filter[trip]=T&filter[stop]=o,d` (1 call) and use the scheduled delta.
     - If T is `ADDED-*`, use the hop estimate instead.
   - **No predictions at the boarding stop** (more than 3 h ahead, suppressed, or overnight): run the schedule pair query with a widened `max_time` (section 2.4, 1 call per leg). Label the result "scheduled".
6. **Alerts (1 call, cache for about 60 s):**
   ```
   /alerts?filter[route]=<R>&filter[stop]=<S>&filter[datetime]=NOW&filter[activity]=BOARD,EXIT,RIDE
   ```
   - Drop or penalize legs hit by `SUSPENSION`, `SHUTTLE` or `STATION_CLOSURE`.
   - Surface `DELAY` and `DETOUR`.
   - Add `USING_WHEELCHAIR` plus `ELEVATOR_CLOSURE` for an accessible mode.
7. **Rank** by arrival time at D (pure walk competes too). Show wait, ride, transfers, crowding and an "uncertainty" badge.
   - **[inf]** Base the badge on `departure_uncertainty`: 60 is good, 120 means at the terminal, 360 means a reverse trip.

**Bike or mixed options [inf; feed verified only for availability and CORS].**
- Bluebikes GBFS (`https://gbfs.lyft.com/gbfs/2.3/bos/gbfs.json`, with `station_information` and `station_status`) returned 200 with `Access-Control-Allow-Origin: *` [obs].
- Treat "bike to station" or "station to bike" as alternative first or last legs:
  - Ride time = distance × 1.25 ÷ 250 m/min, plus 2 min to dock and undock.
  - Require `num_bikes_available > 0` at the start dock and `num_docks_available > 0` at the end dock.

### 3.3 Call budget

| Phase | Calls |
|---|---|
| Static cache | 2–3 per day, ~0 per query |
| Per plan, typical | 1 predictions + 1 alerts = **2** |
| Per plan, worst case | + up to 2 schedule fallbacks = **4** |
| Refresh while the user watches | 1 predictions call every 30–60 s (or SSE with a key) |

- Without a key, 20 requests/min/IP allows roughly 5–10 plans per minute.
- Shared carrier/NAT IPs make the anonymous limit unpredictable, so **ship with an `x-api-key`** (free, 1,000/min).
- **[inf]** A key in a client-only app is extractable. For web, MBTA can bind it to `allowed_domains` (CORS). Accept that limitation for a free key.
- Handle 429 by backing off until `x-ratelimit-reset`.

### 3.4 Pitfalls

- **Parent stations vs platforms:**
  - Predictions and schedules return **platform** stop IDs, even when you filter by `place-*` [obs].
  - Always map back through `parent_station`.
  - Platform IDs encode direction and branch. Park Street has 7 platforms [obs].
- **direction_id is per route:**
  - Red/Orange/Blue: 0 = toward Ashmont/Braintree, Forest Hills and Bowdoin.
  - Green: 0 = westbound (toward Boston College, Cleveland Circle, Riverside and Heath).
  - Mattapan: 0 = Ashmont→Mattapan.
  - Derive direction from the cached pattern order, not from assumptions [obs, from the 2.2 output].
- **Green Line:**
  - B, C, D and E are separate route IDs.
  - For trunk stations, query all four. Any branch whose trip hits both stations qualifies.
  - Canonical termini differ: B and C start at Government Center, D at Union Square, E at Medford/Tufts.
  - Short-turn trips may not reach D. The per-trip join with stop_sequence handles this.
- **Red branches:**
  - Ashmont and Braintree trips share Alewife to JFK/UMass.
  - A Braintree trip won't reach Ashmont, which is why the join is per trip and not per route.
- **Skipped or cancelled stops:** `schedule_relationship` is `SKIPPED` or `CANCELLED` with null times. Source: concentrate's `closed_stop.ex`, `shuttle.ex` and `cancelled_trip.ex`.
- **Missing predictions** can mean any of the following, so fall back to schedules and label the result:
  - Suppression (Screenplay).
  - More than 3 hours ahead.
  - The vehicle has already passed the stop.
  - The first stop of a trip, which has a departure only.
- **Time parsing:** times carry an offset. `filter[date]` is the service date, and after-midnight trips belong to the previous service date [src].
- **Schedules `min_time`/`max_time`** truncate the destination rows (section 2.4).
- **Canonical trips** have no `/schedules` times [obs].

---

## 4. Geocoding a typed destination for free (Expo, iOS and web)

| Option | iOS | Web | Autocomplete | Terms and limits | Verdict |
|---|---|---|---|---|---|
| `expo-location` `geocodeAsync` | Yes (Apple CLGeocoder, no key) | **Not supported** (docs list Android/iOS only) | No | Must be used "reasonably"; too many requests error; returns only lat/lon/accuracy (https://docs.expo.dev/versions/latest/sdk/location/) | iOS fallback only |
| OSM Nominatim (public) | Yes | Yes (CORS `*` [obs]) | **Forbidden**, including client-side | Max 1 req/s **per app across all users**; identifying UA/Referer; cache; attribution (ODbL); must be switch-offable without an app update (https://operations.osmfoundation.org/policies/nominatim/) | Last-resort fallback, on explicit submit only |
| Photon (photon.komoot.io) | Yes | Yes (CORS `*` [obs]) | Yes, typeahead is a stated feature | "Be fair"; heavy use throttled; no availability guarantee (https://photon.komoot.io/) | **Primary** |
| MBTA stop-name search | n/a | n/a | Local | The V3 API has no name filter [src]; filter the cached station list | Always merge first |
| mbta.com `/places/*` (AWS Location) | — | — | — | Internal mbta.com endpoints (`dotcom/lib/dotcom_web/router.ex:417-427`), not a published API | Do not use |

Photon check [obs]:
```
GET https://photon.komoot.io/api/?q=fenway%20park&lat=42.3555&lon=-71.0605&limit=3&bbox=-71.3,42.2,-70.85,42.5
```
- It returned Fenway Park at `[-71.0971, 42.3465]` with street, housenumber, city and `osm_key`/`osm_value` (GeoJSON features).
- Nominatim returned the same coordinates.

**Recommendation [inf]:**
1. Run a local station-name match over the cached MBTA stations first. It is instant and works offline.
2. Then use **Photon** for typeahead on both platforms:
   - Debounce 300–400 ms, minimum 3 characters.
   - Bias with `lat`/`lon` from the user's position, plus a Greater Boston `bbox`.
   - Cache queries in memory, show "© OpenStreetMap contributors", and keep a kill-switch constant.
3. **Fallback:**
   - On iOS, use `Location.geocodeAsync(text)` on submit when Photon errors or is empty.
   - On web, use a single Nominatim `/search?format=jsonv2&viewbox=-71.3,42.5,-70.85,42.2&bounded=1` on submit only. No autocomplete, at most 1 req/s, with attribution.
4. For reverse geocoding the user's own position, use `reverseGeocodeAsync` on iOS and Photon `/reverse` on web.

---

## 5. Is any MBTA-hosted OpenTripPlanner endpoint usable from a client?

**No.** MBTA publishes no public trip-planning API.
- `mbta/OpenTripPlanner` is **archived** (last push 2024-02-12) [obs, GitHub API].
- `mbta/otp-deploy` is active (pushed 2026-08-25). It contains deploy scripts and config (`var/router-config.json`, `build-config.json`) for MBTA's internal OTP 2 instance, built from upstream OTP `dev-2.x` and deployed to AWS (`otp-deploy/README.md`) [obs].
- `mbta/open_trip_planner_client` is an Elixir client for OTP's GraphQL `planConnection`.
  - Its dev default is `otp_url: "http://otp2-local.mbtace.com"` (`config/config.exs:4`), with path `/otp/routers/default/index/` (`lib/open_trip_planner_client/request.ex:19-21`).
  - That hostname resolves to AWS IPs but **did not answer HTTP or HTTPS within 8 s** from this machine [obs]. It is undocumented, and no terms or CORS apply to it.
- mbta.com's Trip Planner is a server-side Phoenix LiveView (`dotcom/lib/dotcom_web/router.ex:363`, `live("/trip-planner", TripPlannerLive)`).
  - It calls OTP from the server through the private `OPEN_TRIP_PLANNER_URL` env var (`dotcom/config/runtime.exs:150-156`, `mix.exs:155`, client `v0.22.0`).
  - It geocodes with the **AWS Location Service** place index `AWS_PLACE_INDEX_NAME`. The defaults are a Boston bias and a New England bbox, cached for 24 h (`dotcom/lib/location_service/location_service.ex`, `config/runtime.exs:177-178`).
- The developer portal lists the V3 API, GTFS, GTFS-RT, historical data and real-time display guidelines. It lists **no trip planner API**. Data use falls under the MassDOT Developers License Agreement (https://www.mbta.com/developers, https://www.mbta.com/developers/v3-api).

**Implications [inf]:**
- Teal, as a client-only app, should use the section 3 planner (V3 API plus a local graph).
- Deep-linking to `https://www.mbta.com/trip-planner` for "full itinerary" is the only MBTA-sanctioned full planner.
- Self-hosting OTP 2 with the otp-deploy config would require a server, which is out of scope for a client-only app.

---

## Unverified and limitations

- Live calls were made around 00:40 local time. Late-night data was sparse, and no daytime Green Line predictions were observed.
- Not exercised: SSE streaming, `/shapes`, `/live_facilities`, `/transfers`, and the rate-limit cost of 304 responses.
- Production concentrate sources are not in the repo.
- Walk, hop and transfer constants are estimates and need calibration against `/schedules`.
