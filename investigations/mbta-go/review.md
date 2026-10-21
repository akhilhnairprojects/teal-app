# Teal v2 review (pre-ship)

Reviewer: rea-evidence-reviewer. Date: 2026-10-19. Scope: `teal/src/**`, `public/`, `app.json`, `package.json`,
`THIRD_PARTY_NOTICES.md`, `.gitignore`, the ledgers `mobile_app.md` / `api-and-routing.md`, and `spec.md` with
Addendum A. Kotlin spot-checks used the MBTA Go clone at commit `8c49ac5` (`git log -1` in the clone confirms it).
This was a static review plus local test/build runs. Nothing ran on a device, no dev server started, and no
external API was called.

## Commands run (real output)

| Command | Result |
|---|---|
| `npx jest --ci` (run 1) | `Test Suites: 1 failed, 48 passed, 49 total` / `Tests: 3 failed, 451 passed, 454 total` / `Time: 32.517 s`. All 3 failures are in `src/features/trip/__tests__/TripDetailsScreen.test.tsx`, each with `Can't access .root on unmounted test renderer` at `TripDetailsScreen.test.tsx:96`. |
| `npx jest src/features/trip/__tests__/TripDetailsScreen.test.tsx` | `Tests: 4 passed, 4 total` |
| `npx jest --ci` (run 2) | `Test Suites: 49 passed, 49 total` / `Tests: 454 passed, 454 total` |
| `npx tsc --noEmit` | exit 0, no diagnostics |
| `npx expo lint` | exit 0, no output |
| `npx expo export --platform web --output-dir …/scratchpad/review-web-export` | `Web Bundled 17435ms node_modules\expo-router\entry.js (1510 modules)`. One bundle, `entry-17606a….js (2.7MB)`. Output holds `index.html`, `demo.html`, `vercel.json` and `teal-promo.mp4` (7.9 MB total). A grep of the bundle finds no `react-native-maps` and no `MapView`. Hosts present: `api-v3.mbta.com`, `api.weather.gov`, `gbfs.lyft.com`, `photon.komoot.io`, `nominatim.openstreetmap.org`. |

The test suite is flaky under load: one of two full runs failed. "454 pass" is not a stable baseline yet.

---

## Blocker

### B1. Required device acceptance checks have not been run
- **Location:** `spec.md` WP1 acceptance (lines 569–573), WP2 acceptance (614–616), WP4 acceptance (725–727), and Risks (809–811).
- **Problem:** The spec makes several manual Expo Go checks part of acceptance:
  - sheet drag with an inner scroll;
  - station tap → stop page;
  - vehicles shown only on stop and trip pages;
  - the Red Line car diagram;
  - `ADDED`/`NO_DATA` → "Crowding not available";
  - a favorite surviving an app restart;
  - `demo.html` fitting on one screen.

  It also names "native stack inside the gorhom sheet" as the top risk, to be spiked first. None of this has been observed. WP0 step 5 (Hermes `Intl` time zones in Expo Go) is unverified too. A code fallback with a self-check exists in `src/mbta/time/eastern.ts:45-67`, but that is not an observation.
- **Fix:** Run the WP1/WP2/WP4 manual checklist in Expo Go on an iPhone and against the web export. Record each result as observed in an addendum to `spec.md`. Until then, ship status is "unverified on device". This is not a code defect.

No other Blockers were found:
- no copied proprietary assets, strings files, map styles or backend hosts;
- no secrets or personal data;
- no wrong conclusion in the ported rules I spot-checked.

---

## Should fix

### S1. The planner runs its own location lookup, which breaks the `/?demo` mode and can disagree with Nearby
- **Location:** `src/features/planner/PlannerScreen.tsx:53` (`const location = useLocation();`), `:73-81`. The shell's own lookup is at `src/features/shell/AppShell.tsx:30`.
- **Failure:** Tabs switch with `router.replace`, so every visit to the Plan tab remounts `PlannerScreen` and starts a second permission request and GPS fix.
  - On web, after the first navigation the URL no longer contains `?demo`, so `isDemoLink()` (`src/hooks/useLocation.ts:12-14`) returns false. Opening Plan in the demo (the iframe or "Open Teal") then triggers a browser geolocation prompt. It plans from the visitor's real location, or falls back with the reason "You're outside the Boston area" instead of "Demo".
  - On iPhone, the planner origin can differ from the Nearby position, and each Plan visit waits on a new fix.
- **Fix:** Read the shell-owned location with `useUserLocation()` from `src/features/map/mapCenter.ts:110`, and delete the second `useLocation()` call. The shell then stays the single owner of location.

### S2. `useStopLiveData` has an unbounded full-day schedule cache
- **Location:** `src/mbta/live/useStopLiveData.ts:11-12`, `:15-30`. The request is in `src/mbta/api/endpoints.ts:49-64`.
- **Failure:**
  - Each distinct stop set (every Nearby pan that crosses into new stations, every stop page, Favorites) adds a `ScheduleSet` for the whole service day. Downtown that can be thousands of schedules plus their trips.
  - Entries are only checked for age on read. They are never evicted, so memory grows for the whole session.
  - Payload size and parse cost on Hermes are unmeasured.
- **Fix:**
  - Cap the map (LRU, for example 8 entries) and drop entries whose date ≠ the current `serviceDate`.
  - Measure one downtown schedule response.
  - If it is large, keep a cheap "has schedules today" probe and fetch only `min_time ≥ now − 5 min` for the join.

### S3. Per-tick join cost in `buildUpcomingTrips` and Nearby recomputation (performance risk, unmeasured)
- **Location:** `src/mbta/rules/upcomingTrip.ts:227-233` (`alerts.find(...)` inside the loop over every schedule/prediction key). It is called from `routeCardsForStopList`, which `src/features/nearby/useNearbyCards.ts:47-62` re-runs every 5 s via `now`. The same applies to the Stop (10 s) and Favorites (10 s) pages.
- **Failure:** The cost is O(keys × alerts × entities) every tick, and `keys` covers the whole day's schedules (past ones are dropped only after the join and sort, `:245-251`). On a device this risks jank and battery drain. No measurement exists.
- **Fix:**
  - Build a `Map<tripId|rootStop, Alert>` once per alerts update.
  - Filter past schedule-only rows before the join.
  - Split the memo so the schedule/prediction join depends on data, not `now`, and only the formatting depends on `now`.
  - Measure on an iPhone before and after.

### S4. Every focus or remount refetches immediately, and data is lost on tab switches
- **Location:** `src/mbta/live/usePolling.ts:77-120`, which holds state per hook instance and calls `run()` whenever `active` becomes true.
- **Failure:**
  - Switching Nearby ↔ Plan ↔ Favorites unmounts and remounts screens (`SheetTabs.tsx:31`, `router.replace`). Each switch discards the last data (skeleton cards) and spends an MBTA call, even when the data is seconds old.
  - Popping back to Nearby also refetches at once.
  - Keyless cold start already uses about 15–17 of the 20 calls/min: 3–4 global calls, 9 `/shapes` calls (Addendum A item 16), predictions, schedules and alerts. Quick navigation then runs into the reserve, so background work (schedules) is deferred. `RequestBudget` prevents most 429s, but the UX degrades.
- **Fix:** Keep a module-level `{key → {data, updatedAt}}` cache in `usePolling`. Seed new instances from it, and skip the immediate fetch when `now − updatedAt < intervalMs`.

### S5. Flaky trip-screen smoke test
- **Location:** `src/features/trip/__tests__/TripDetailsScreen.test.tsx:102-124`. The test relies on a module-level `r`, ten `setTimeout(0)` flushes, and `afterEach` unmounting.
- **Failure:** Under full-suite load (run 1 above), a test overruns, `afterEach` unmounts the renderer it is still using, and the next three assertions throw `Can't access .root on unmounted test renderer`. Addendum A item 18 already notes a worker that "failed to exit gracefully".
- **Fix:**
  - Return a local renderer from `render()`.
  - Wait on a condition (poll `textOf` until it contains the expected header, with a timeout) instead of a fixed number of ticks.
  - Use `jest.useFakeTimers()` so `usePolling` / `useNow` intervals cannot keep the worker alive.

### S6. Duplicate href/path builders from parallel work
- **Location:**
  - Shell builders: `src/features/shell/routes.ts:24-30` (`stopPath`, `tripPath`, `alertPath`).
  - WP2 duplicates: `src/features/stop/stopFilter.ts:33-36` (`stopHref`), `src/features/trip/useTripDetails.ts:16-23` (`tripHref`, which also carries `stopSequence`), `src/features/alert/alertDetails.ts:12` (`alertHref`).
  - Local copies: `src/features/planner/PlannerScreen.tsx:30` (`alertPath`), `src/features/search/searchModel.ts:81` (`planHref`), `src/features/search/SearchScreen.tsx:19`.
  - Inline strings: `src/features/favorites/FavoritesScreen.tsx:104,106`.
- **Failure:** There are four representations of the same routes. `routes.ts` `tripPath` lacks `stopSequence`, so a later change to one builder will silently diverge from the route files that read the params (`src/app/stop/[stopId].tsx`, `src/app/trip/[tripId].tsx`).
- **Fix:** Make `src/features/shell/routes.ts` the single owner:
  - Return `Href` from it.
  - Add `stopSequence` to `tripPath`.
  - Add `planPath({ q, toStopId, … })`.
  - Delete `stopHref`, `tripHref`, `alertHref`, the planner's local `alertPath`, `planHref`, and the inline strings.

  Keep the matching parsers (`parseStopFilter`, `parseTripParams`) next to the builders, or import them from one place, so build and parse stay paired.

### S7. Pushing a top-level tab route stacks duplicate tab screens
- **Location:** `src/features/alert/AlertDetailsScreen.tsx:160` (`router.push('/plan')`), and `src/features/search/SearchScreen.tsx:50,94` (`go(planHref(...))`).
- **Failure:**
  - `/plan` renders as a top-level page with tab chrome and no back button (`SheetChrome.tsx:17`), sitting on top of the pushed pages.
  - Tapping a tab then `replace`s it, which leaves for example `[/, /search, /]` in the stack. A hidden, still-mounted Nearby instance accumulates per round trip.
- **Fix:** Navigate to top-level routes with `router.dismissTo` / `router.navigate` and pass params. Alternatively, show a back affordance on `/plan` whenever `router.canGoBack()`.

### S8. The trip page's "Try again" cannot recover static data
- **Location:** `src/features/trip/useTripDetails.ts:116-127` (the effect depends only on `[tripId, hasGlobal]`) and `src/features/trip/TripDetailsScreen.tsx:75`.
- **Failure:** If `loadStaticTrip` fails, the cache entry is deleted (`:69`), but the effect never re-runs. "Try again" only calls `predictions.refresh()`, so the page stays on "Couldn't load this trip".
- **Fix:** Add an `attempt` counter to the effect's dependencies and expose `retry()`, which bumps it and refreshes predictions.

### S9. Unstable React keys for branch rows
- **Location:** `src/mbta/rules/routeCardData.ts:274-275` (a module-level `rowSeq` counter), used as `key` in `src/ui/RouteCardView.tsx:155`.
- **Failure:** Row ids change on every `formatLeaf` call, which happens every render (5–10 s), so every branch row remounts. Kotlin uses a random lazy id (`LeafFormat.kt:85-86`), but that id is not a React reconciliation key.
- **Fix:** Use a deterministic id, for example `${headsign}-${routeId ?? ''}-${index}` or the trip id for `some` rows.

### S10. Duplicated rule helpers
- **Location:**
  - `alertStateOf` (`src/mbta/rules/routeCardData.ts:366-380`) duplicates `alertState` (`src/mbta/rules/alerts.ts:264-278`).
  - `isStopSkippedEffect` (`tripInstantDisplay.ts:57`) duplicates `isStopSkipped` (`alerts.ts:27`).
  - `SILVER_ROUTES` is defined twice (`alerts.ts:245`, `upcomingTrip.ts:33`).
  - The car-range wording is defined twice (`vehicle.ts:59-64` `describeCars`, `features/trip/crowding.ts:16-21` `boardCarHint`).
- **Fix:** Keep one owner for each: `alerts.ts` for alert state and stop-skipped, `upcomingTrip.ts` (or `lineOrRoute.ts`) for Silver routes, and `vehicle.ts` for car ranges, with an option for the "Board" prefix. Then delete the copies.

---

## Note

1. **Port faithfulness: spot-checks pass.**
   - `tripInstantDisplay.ts:62-161` matches `TripInstantDisplay.kt:93-244` branch for branch, and the cutoffs match `Prediction.kt:10-13`.
   - Alert significance matches: `alerts.ts:33-97` against `Alert.kt:82-126, 333-355` and `AlertSignificance.kt`. So do the stop-skipped effects (`Alert.kt:276-277`).
   - Crowding matches `Vehicle.kt:52-62`. `EMPTY → notCrowded` is Teal's own choice and is labeled [ours].
   - RouteCardData grouping matches:
     - the single `line-Green` card (`Line.kt:42`);
     - pattern de-duplication (`RoutePattern.kt:58-130`);
     - `shouldShow` (`RouteCardData.kt:1142-1202`);
     - `filterIrrelevantData` (`979-1015`);
     - `addAlerts` (`893-963`).
   - I found no divergence that changes what users see.
2. **Stale vehicles are not filtered.** `isVehicleStale` (`src/mbta/rules/vehicle.ts:103`) is never called. Vehicles older than 1 h (`Vehicle.kt:85-87`) can still appear on the map. Either apply it in `VehiclesLayer` or delete it.
3. **Dead exports:** `isStopBlocklisted` (`globalData.ts:172`), `isSubwayRoute` (`routeCardData.ts:887`), `typeScale` (`theme/index.ts:68`), `isAllServiceDisrupted` (`leafFormat.ts:22`), `currentPeriod` / `nextPeriod` (`alerts.ts:76-82`), `MS` (`eastern.ts:170`). Many others are exported but used only in their own file or in tests. Trim them.
4. **Circular import:** `patternSorting.ts:6` ↔ `routeCardData.ts:45`. It works because the values are bound late, but Metro prints a "Require cycle" warning. Move `hasMajorAlertsAffectingAllTrips` and `majorAlertAffectingAllTrips` into a leaf module.
5. **Small unbounded caches:**
   - In memory: `geocode/photon.ts:63`, `geocode/fallback.ts:41`, `weather/nws.ts:135`.
   - AsyncStorage keys `teal.nws.points.<lat3>,<lon3>` (`nws.ts:163`): one per ~100 m origin, never deleted. NWS grid cells are about 2.5 km, so round `/points` to 2 decimals and cap the in-memory maps.
6. **The `place-symcl` blocklist is hard-coded** (`globalData.ts:41`). In MBTA Go it is server data (`GlobalResponse.kt:36`, sourced from `mobile_app_backend/lib/mobile_app_backend/stop_blocklist.ex`). Teal will keep hiding Symphony after MBTA removes it from their list. Add a dated comment, or make it remote config.
7. **`expo-haptics` is an unused dependency** (`package.json:13`). Nothing imports it, so web and Expo Go are unaffected. Remove it or use it.
8. **Unclear deploy assumption for `vercel.json`.** It lives in `public/` and lands at the export root. Vercel reads it only when `dist/` is the deployed project root. Also confirm on the real deploy that `/demo` (`cleanUrls`) serves `demo.html` rather than the SPA rewrite `/((?!.*\.).*)`, and that `/stop/place-pktrm` deep-links work.
9. **Demo page links differ from spec WP4** (`public/demo.html:76-78`). There is a "Use my location" link and no Source/About link. It is 87 lines (target ≤ 90).
10. **Unused plan parameters.** The planner accepts `toName/toLat/toLon/toStopId` (`PlannerScreen.tsx:27-40`), but nothing links to them. A "Plan a trip here" link from the stop page would use them; otherwise drop them from the route doc.
11. **Plan state is lost on tab switch** (`router.replace` unmounts the screen). The selected itinerary also closes on refresh when its trip id changes (`PlannerScreen.tsx:95`, ids built at `planner/engine.ts:203-206`). Consider hoisting the planner state, and matching the selection by kind plus stations.
12. **Unvalidated alert URL scheme:** `Linking.openURL(url)` on alert data (`AlertDetailsScreen.tsx:151`). Allow only `http:`/`https:`.
13. **Rate-limit headers on web are unverified.** Whether `x-ratelimit-*` reach the browser depends on the API's `Access-Control-Expose-Headers`. Without them, `RequestBudget` counts locally (`budget.ts:127-134`). Spec §2.3's budget table omits the cold-start burst (S4); add it.
14. **Attribution: present and correct.**
    - `THIRD_PARTY_NOTICES.md` has the full MIT text, "Copyright (c) 2023 Massachusetts Bay Transportation Authority" (matching the clone's `LICENSE`), commit `8c49ac5`, paths, and a non-affiliation line.
    - Ported rules and tests carry the header.
    - Gaps: `src/mbta/time/eastern.ts` (`formatMinutes` is a port of `MinutesFormat.kt`) and `src/state/favorites.ts` (`Favorite.kt` semantics) have only in-body mentions. Add the file header, or mark them [ours].
    - MBTA/MassDOT non-endorsement, Bluebikes license, NWS and OSM attribution appear in `moreContent.ts:10-42` and the Nearby footer (`NearbyScreen.tsx:96-97`). Photon results show "© OpenStreetMap contributors" (`Suggestions.tsx:67`).
    - No MBTA branding found.
15. **Privacy and secrets: clean.**
    - No emails or names in `src/`, `public/`, `app.json` or the web bundle.
    - User-Agent is sent only on native, with `PROJECT_URL` (`photon.ts:72`, `nws.ts:125`).
    - The MBTA key is read only from the literal `process.env.EXPO_PUBLIC_MBTA_API_KEY` (`config.ts:10`).
    - `.env` is git-ignored and absent. Note that `.env.production` and `.env.development` are not ignored; use `.env*` plus `!.env.example`.
    - Photon receives the rider's position rounded to 2 decimals (~1 km, `photon.ts:80`), which is acceptable.
16. **Repo hygiene (AGENTS: never commit binaries or local artifacts).**
    - `investigations/expo-go-qr.png` probably encodes a dev-server or tunnel URL. Keep it out of commits and out of `public/`.
    - `marketing/` is untracked, with large wav/mp4/cache files. Do not commit it as-is.
    - `LICENSE` is still Expo's (650 Industries); spec decision 7.4 remains open.
17. **Ledgers and spec.**
    - Both ledgers label claims [obs]/[inf]/[ext] and keep an "Unverified and limitations" section (`api-and-routing.md:385`).
    - Spot-checks agree with the source:
      - MA §3.2 radii match `NearbyRepository.kt:25-37`;
      - MA §3.1 cutoffs match `Prediction.kt:10-13`;
      - the `place-symcl` blocklist is backend data (`stop_blocklist.ex`), not a `S/` rule. MA §3.2 should say so.
    - Addendum A items 4, 12, 13 and 16 match the code. The spec's "observed behavior" did not drift from the ledger in the areas checked.
    - WP0's "cold vs warm `useGlobalData` < 300 ms" acceptance item has no recorded result.

## Coverage of the requested checks

| # | Check | Status |
|---|---|---|
| 1 | Correctness | Answered: S1–S4, S8, S9; Notes 2, 11, 12 |
| 2 | Expo Go / web | Partial. Statically clean (no native module outside Expo Go is imported on web, `TealMap.web.tsx` exists, the export succeeds, the demo label "Demo" is wired at `useLocation.ts:36-37`). Demo-mode bug S1. Device behavior unverified (B1). |
| 3 | Port faithfulness | Answered: Note 1 (four areas), no user-visible divergence |
| 4 | Duplicates and dead code | Answered: S6, S10, Notes 3, 7. Retired files (`src/data/mbta.ts`, `useNearby`, `TransitStationCard`) are gone; `src/components/*` and `src/hooks/useLocation.ts` are in use. |
| 5 | Clean-room and licensing | Answered: Note 14 |
| 6 | Privacy and secrets | Answered: Note 15 |
| 7 | Spec claims vs code | Answered: B1, S5, Notes 9, 10, 13, 17 |

---

## Fix pass

Builder: rea-feature-builder. Date: 2026-10-19. Scope: S1–S10 and the Notes the lead assigned
(MIT headers, `.gitignore`, stale vehicles). B1 is not a code defect and is still open. Nothing
ran on a device, no dev server started, and no external API was called. Paths are relative to `teal/`.

### Per finding

| # | What changed | Files | Verification |
|---|---|---|---|
| S1 | The planner reads the shell's shared location (`useUserLocation()`) and no longer calls `useLocation()`. The shell is the only owner of the location lookup. `?demo` is read once, when `hooks/useLocation.ts` loads at startup, so it survives in-app navigation on web. | `src/features/planner/PlannerScreen.tsx`, `src/hooks/useLocation.ts` | New `src/hooks/__tests__/useLocation.test.tsx`: demo kept after `?demo` leaves the URL, with no permission request; no demo on native; device fix; out-of-Boston fallback. `planner.test.tsx`: in demo state the origin is Park Street, expo-location is never called, and a later shell update reaches the open planner. |
| S2 | The schedule cache keeps only the current service date and at most `SCHEDULE_CACHE_MAX = 8` stop sets. A hit counts as a use for the LRU order. Failures are not cached. | `src/mbta/live/useStopLiveData.ts` | New `src/mbta/live/__tests__/scheduleCache.test.ts`: in-flight sharing, LRU cap, date eviction, no caching of failures. |
| S3 | Trip/stop alerts are indexed once per alerts list (WeakMap), replacing a per-row `alerts.find`; the first alert in list order still wins. Past schedule-only rows are skipped before the join work. The join is memoized by input identity (last 4). Only the past-row filter depends on `now`, and a memo entry is reused only for a later or equal `now`. | `src/mbta/rules/upcomingTrip.ts` | `upcomingTrip.test.ts`: first-alert-wins, parent matching, and memo reuse only forward in time (2 new tests). Measured with a temporary jest benchmark (since deleted) in Node, not Hermes, median of 15 runs: 7,200 schedules / 360 predictions / 80 alerts. Old join 39 ms; new join with fresh inputs 6 ms; repeat tick with the same inputs under 1 ms. Output was identical to the old algorithm (asserted). |
| S4 | `usePolling` has a module-level last-result cache per key (16 keys, LRU). A new instance or a new key shows the cached data at once. The first fetch waits out the rest of `intervalMs` when the cached data is younger than that; otherwise it fetches at once and keeps showing the old data while refreshing. | `src/mbta/live/usePolling.ts` | `usePolling.test.tsx`: three new tests (remount within the interval makes no request and fetches at the boundary; remount after the interval refetches while showing the old data; a key change shows the cached data for that key). Every test now unmounts its renderer. |
| S5 | New `src/mbta/testing/render.tsx` (`withScreen`, `waitForText`, `waitUntil`, `textOf`). Each test owns its renderer and always unmounts it. Waits are bounded by flush turns, not wall time. The trip and stop tests use fake timers. The same pattern was fixed in `AlertDetailsScreen.test.tsx`. Two related flake sources found during the 3× runs were also fixed. (1) `budget.test.ts` left real 45–60 s window timers running (`--detectOpenHandles`), which caused "worker failed to exit gracefully"; budgets are now reset after each test. (2) The first test of `globalData.test.tsx` hit the 5 s default timeout under full-suite load; jest `testTimeout` is now 30 s. | `src/features/trip/__tests__/TripDetailsScreen.test.tsx`, `src/features/stop/__tests__/StopDetailsScreen.test.tsx`, `src/features/alert/__tests__/AlertDetailsScreen.test.tsx`, `src/mbta/api/__tests__/budget.test.ts`, `package.json` (`jest.testTimeout`) | 3 consecutive full runs pass (below). None printed "failed to exit gracefully". |
| S6 | `src/features/shell/routes.ts` is the single owner. It has `PATHS`/`pathHref`, `stopPath`, `tripPath` (now with `stopSequence`), `alertPath` and `planPath` (q, toName, toLat, toLon, toStopId), all returning `Href`. The parsers sit next to them: `parseStopFilter`, `stopFilterParams`, `parseTripParams`, `parsePlanParams`, `firstParam`. So do `goToTab` and `goBack`, which replace the five local `goBack` copies. Deleted: `stopHref`, `tripHref`, `alertHref`, `planHref`, the planner's local `alertPath`, `href()`, the Search and Favorites inline strings, and `parseStopFilter`/`parseTripParams` from their old homes. The route files parse with these functions; `PlannerScreen` now takes `params` from `app/plan.tsx`. | `src/features/shell/routes.ts`, `src/app/{plan,stop/[stopId],trip/[tripId],alert/[alertId]}.tsx`, `src/features/{stop/stopFilter.ts,stop/StopDetailsScreen.tsx,trip/useTripDetails.ts,trip/TripDetailsScreen.tsx,alert/alertDetails.ts,alert/AlertDetailsScreen.tsx,search/searchModel.ts,search/SearchScreen.tsx,favorites/FavoritesScreen.tsx,nearby/NearbyScreen.tsx,map/TealMap.tsx,map/TealMap.web.tsx,more/MoreScreen.tsx,shell/SheetTabs.tsx,shell/SheetChrome.tsx}` | New `src/features/shell/__tests__/routes.test.ts`: each builder round-trips through its parser, plus encoding, omitted params, and `stopSequence` 0. A grep finds no remaining inline `/stop`, `/trip`, `/alert` or `/plan` strings and no `as Href` outside `routes.ts`. |
| S7 | One mechanism for every move to a tab page: `goToTab(href)` dismisses pushed pages (`router.canDismiss()` → `router.dismissAll()`) and then `router.replace`s. The tab row, Nearby's "Plan a trip", Alert's "Plan around this" (`/plan`) and both Search plan actions (`/plan?q=`) use it. Nothing pushes a tab page any more. | `routes.ts`, `SheetTabs.tsx`, `AlertDetailsScreen.tsx`, `SearchScreen.tsx`, `NearbyScreen.tsx` | `routes.test.ts` checks that dismiss happens before replace. `shell.test.tsx` covers the tab row with a pushed stack. `SearchScreen.test.tsx` and `AlertDetailsScreen.test.tsx` assert `dismissAll` + `replace('/plan…')` and no `push`. |
| S8 | `useTripDetails` has an `attempt` counter in the static-load effect and exposes `retry()`. Retry clears the failed state (the page shows loading), reloads schedules/trip and refreshes predictions. A failed cache entry is deleted only if it is still the current one. "Try again" calls `retry`. | `src/features/trip/useTripDetails.ts`, `src/features/trip/TripDetailsScreen.tsx` | New trip-screen test: a schedule load fails → "Couldn’t load this trip" → Try again → the trip renders, with schedules and predictions each called twice. With `attempt` removed from the dependencies the test fails (checked, then restored). |
| S9 | Branch-row ids are deterministic: `trip:<upcoming id>` for trip rows, and `disruption:`/`noTrips:<routeId>:<headsign>` for the others. The module-level counter is gone. | `src/mbta/rules/routeCardData.ts` | Existing route-card and leaf-format suites pass (the id field is not compared there). |
| S10 | One owner each. Alert state: `alertState` in `alerts.ts` (`alertStateOf` deleted). Stop-skipped: `isStopSkipped` in `alerts.ts` (`isStopSkippedEffect` deleted; `tripInstantDisplay` imports it). `SILVER_ROUTES`: `lineOrRoute.ts` (both copies deleted). Car range: `describeCars(seqs, count?)` exported from `vehicle.ts` (`boardCarHint` deleted). Related cleanup: `majorAlertAffectingAllTrips` moved to `alerts.ts`, which removes the `patternSorting ↔ routeCardData` runtime import cycle (Note 4). | `src/mbta/rules/{alerts,routeCardData,tripInstantDisplay,upcomingTrip,lineOrRoute,vehicle,patternSorting}.ts`, `src/features/trip/crowding.ts` | `crowding.test.ts` and `vehicle.test.ts` updated; all rule suites pass. |
| Note 2 | `useVehicles` drops vehicles whose last update is over an hour old (`isVehicleStale`), for both the native and the web map. | `src/mbta/live/useVehicles.ts` | New `src/mbta/live/__tests__/useVehicles.test.tsx`. |
| Note 14 | MIT headers added: `eastern.ts` (`formatMinutes` ← `utils/MinutesFormat.kt`), `favorites.ts` and `rsd.ts` (← `model/Favorite.kt`), all at commit `8c49ac5`. | `src/mbta/time/eastern.ts`, `src/state/favorites.ts`, `src/state/rsd.ts` | Inspection. |
| Notes 15–16 | `.gitignore` now ignores `.env*` except `.env.example` (`.env` stays ignored), `investigations/expo-go-qr.png`, and the generated media, caches, `node_modules` and renders under `marketing/`. The `marketing/` files themselves were not touched. | `.gitignore` | Inspection; there is no git repo here to run `git check-ignore`. |

### Commands run (real output)

| Command (from `teal/`) | Result |
|---|---|
| `npx jest` (run 1) | `Test Suites: 53 passed, 53 total` / `Tests: 479 passed, 479 total` / `Time: 68.558 s` |
| `npx jest` (run 2) | `Test Suites: 53 passed, 53 total` / `Tests: 479 passed, 479 total` / `Time: 46.308 s` |
| `npx jest` (run 3) | `Test Suites: 53 passed, 53 total` / `Tests: 479 passed, 479 total` / `Time: 54.203 s` |
| `npx tsc --noEmit` | exit 0, no diagnostics |
| `npx expo lint` | exit 0, no output |
| `npx expo-doctor` | `21/21 checks passed. No issues detected!` |
| `npx expo export --platform ios --output-dir …/scratchpad/fix-ios-export` | `iOS Bundled 20605ms node_modules\expo-router\entry.js (1844 modules)`; `entry-f8f539cc….hbc (4.4MB)` |
| `npx expo export --platform web --output-dir …/scratchpad/fix-web-export` | `Web Bundled 1706ms node_modules\expo-router\entry.js (1510 modules)`; `entry-59046b56….js (2.7MB)`. Output holds `index.html`, `demo.html`, `vercel.json`, `teal-promo.mp4`. No `react-native-maps` in the bundle. |

### Deviations and design choices

- Car wording is unified as `[ours]`. The multi-car diagram label changed from "Cars 1–2 of 6" to "Board cars 1–2 of 6", so the label and the hint read the same. Single-car text is unchanged.
- `goBack()` (back, or replace to Nearby with no history) moved into `routes.ts` with `goToTab`, replacing five identical local copies.
- jest `testTimeout` is 30 s, from the measured 5 s timeout of a cold first test under full-suite load. No dependency was added.
- Files I edited are saved with LF line endings. The project mixes LF and CRLF, and a few of them may have been CRLF before. Untouched files keep their endings.

### Not done or not verified

- B1 (device acceptance) is still open. None of these fixes was observed in Expo Go or a browser. In particular, `dismissAll()` + `replace()` on the web history stack (S7) and the startup capture of `?demo` in the real static export (S1) are verified only in unit tests. Both ride on documented expo-router APIs (`canDismiss`/`dismissAll`/`replace`, expo-router 57.0.28).
- S2: one downtown `/schedules` response was not measured (that needs a live MBTA call), and the `min_time` probe was not built. The full-day set is still needed for `hasSchedulesToday` and the subway first-train time.
- S3: not measured on an iPhone or Hermes. The rest of `routeCardsForStopList` (pattern grouping and alert matching that depend on `now` through `significanceAt`) still runs every Nearby tick (5 s) and every Stop and Favorites tick (10 s).
- S4: the planner's own state (destination, selection) is still lost on a tab switch (Note 11). Only polled data is kept.
- Not in this pass: Notes 3, 5, 6, 8, 9, 10, 12 (alert URL scheme check) and 13. `expo-haptics` stays installed, as the lead asked.
