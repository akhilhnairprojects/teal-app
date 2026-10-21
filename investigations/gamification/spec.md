# Teal gamification release: implementation spec

Status: ready for G0 once the lead confirms the open decisions in §8.
Inputs: `teal/AGENTS.md`, `investigations/mbta-go/spec.md` (with Addendum A, which is authoritative for existing contracts), `review.md`, and the code under `teal/src`.
SQL draft: `investigations/gamification/schema.sql` (historical). The applied schema is `teal/supabase/migrations/`, which supersedes the draft: territory defaults on (Addendum D) and the review fixes are in `20261021000900_review_fixes.sql`.

This is an original feature, not a reverse-engineering of a target app, so there is no ledger evidence to cite.
Labels:
- **[user]**: a user decision.
- **[plat]**: a platform limit the lead verified against the Expo SDK 57 docs.
- **[ours]**: our design choice.
- **[ext]**: general external knowledge, not verified here. Builders verify it against the SDK 57 or Supabase docs before relying on it.

---

## 1. Goals, non-goals, Expo Go limits

**Goals** [user]
- **Accounts.** Email one-time code sign-in. The user picks a nickname after signing in.
- **Activity recorder.** Records runs and Bluebike rides. It is GPS-filtered, works offline first, and syncs to Supabase.
- **Leaderboards.** Weekly and monthly, reset on Eastern time (Monday 00:00 and the 1st of the month).
  - Fastest 1K, 5K and 10K, taken as the best segment within a run.
  - Total running distance.
  - Total Bluebike distance. Bike rides are never ranked by speed.
  - Featured run cards.
- **Friends and groups.** Group-scoped boards and "run together" sessions.
- **Overtake push.** A push when a friend's weekly running distance passes yours.
- **Bike parking mode.** Live dock availability, re-routing, and an Apple Maps handoff.
- **Monthly territory.** Grid cells captured by closed running loops.

**Non-goals**
- Walking.
- Bike speed rankings.
- Turn-by-turn navigation in Teal. Apple Maps does that.
- Background recording in Expo Go.
- Web support for any of these features. The web demo shows "Available in the iPhone app".
- Comments, likes, chat, avatars and photos.
- Moderation tooling beyond filters, blocks and rate limits.
- Android polish. Android is not targeted, but it must not crash.

**Expo Go limits and how the UX states them** [plat]

| Limit | Behaviour | Copy shown (owner) |
|---|---|---|
| iOS Expo Go cannot run TaskManager in the background. | Recording and parking work only while Teal is in the foreground. Keep-awake runs while a recorder or parking session is active. | First Start sheet: "Keep Teal open while you record. In this version, iPhone pauses GPS when Teal is in the background or the phone locks. We'll keep your screen on." During recording, a chip: "Screen on · keep Teal open". (G2) |
| Leaving the app opens a GPS gap. | The gap is not counted (§3.3). | On return: "Paused for 4 min while Teal was in the background. That stretch isn't counted." (G2) |
| Parking polls only in the foreground. | When the app goes to the background mid-ride, it schedules a local reminder at ETA − 2 min. | "Teal re-checks docks every 45 s while it's open." Reminder: "Open Teal to re-check docks near ⟨dock⟩." (G1) |
| No remote push without an EAS projectId. No remote push on Android Expo Go. | The in-app inbox plus a local notification while the app is open. | Account → Notifications shows a `PushAvailability` line, e.g. "Push alerts need an Expo project (eas init). You'll still see alerts while Teal is open." (G0) |
| Free-plan auth email is heavily rate-limited (a few per hour). | `email_rate_limited` maps to a friendly retry message. | "Too many sign-in emails right now. Try again later." Custom SMTP is decision O1. (G0) |
| Battery | GPS plus a lit screen. | "Recording uses GPS and keeps the screen on, so expect noticeable battery use." No number is shown, because none was measured. (G2) |

**Designed for later background tracking** [ours]
- All GPS goes through one hub, `src/activity/locationHub.ts`, with two sources:
  - `foreground`: `watchPositionAsync`.
  - `background`: `TaskManager.defineTask` plus `startLocationUpdatesAsync`. Its task callback pushes fixes into the same hub.
- `canTrackInBackground()` returns false when `BACKGROUND_TRACKING = false` or `Constants.executionEnvironment === 'storeClient'` (Expo Go).
- To turn background tracking on in a development build:
  1. Flip the flag.
  2. Add the `expo-location` plugin options `isIosBackgroundLocationEnabled: true` and `locationAlwaysAndWhenInUsePermission`.
  3. Call `registerBackgroundLocationTask()` at module scope from `src/app/_layout.tsx`.
  4. Request background permission.
- The recorder and parking code stay unchanged.

---

## 2. Data model (Supabase project `teal`, ref `mzjgdjlrlwfgaedweerc`)

### 2.1 Migrations

Files in `teal/supabase/migrations/`, applied in order. These files are the source of truth; `schema.sql` is the superseded draft.

| File | Contents |
|---|---|
| `20261021000100_extensions_private.sql` | Extensions: postgis (schema `extensions`), pg_net, pg_cron. Schema `private`. Helpers: `fail`, `ll_dist_m` (haversine), `week_start`, `month_start`, `period_end`, `grid_i`, `grid_j`, `rate_events` with `hit_rate_limit`, and `new_code`. |
| `…0200_profiles_notifications.sql` | Enums `activity_kind` (run, bike) and `activity_status` (valid, flagged). Tables `profiles`, `profile_private`, `reserved_nicknames`, `banned_terms`, `push_tokens`, `notifications`. RPCs: `get_my_profile`, `claim_nickname`, `set_my_settings`, `register_push_token`, `unregister_push_token`, `mark_notifications_read`, `delete_my_account`. |
| `…0300_social.sql` | Tables `friendships`, `blocks`, `groups`, `group_members`, `group_sessions`, `group_session_participants`. RLS helpers. Realtime channel policies. Friend, group and session RPCs, including `list_friends`. |
| `…0400_activities.sql` | Tables `activities`, `activity_traces`, `activity_efforts`. RPCs `submit_activity`, `set_activity_sharing`, `delete_activity`, `list_my_activities`, `get_my_activity_track`. Server-side trimming via `build_public_path`. |
| `…0500_leaderboards.sql` | Table `leaderboard_archive`. `board_rows`. RPCs `get_leaderboard`, `get_featured_runs`, `get_champions`, `get_session_results`. Archive jobs. |
| `…0600_push_and_overtake.sql` | pg_net dispatch to the Edge Function, the push sweep, the overtake trigger, and `notifications` added to the realtime publication. |
| `…0700_territory.sql` | Tables `territory_cells`, `territory_claims`, `territory_champions`. The claim trigger on trace insert. The opt-out trigger. RPCs `get_territory`, `get_territory_standings`, `get_activity_claim`. `archive_territory`. |
| `…0800_cron_and_grants.sql` | Retention, housekeeping, four cron jobs, and the final grant and revoke sweep. |
| `…0900_review_fixes.sql` | Review fixes: `profile_private.territory_notice_at` (claims wait for the notice), the 300 m start/finish zone in `claim_territory`, paged `get_territory`, code misses returned as values (rate limits count them), `rotate_group_code` 5/day, `delete_my_account` clears rate events, a built-in banned-terms seed, split rollover cron jobs, and the grant sweep. |

Edge Function: `teal/supabase/functions/send-push/` (G3). There is no config.toml. The lead deploys it with MCP `deploy_edge_function` and `verify_jwt: false`, because it checks a shared secret instead.

### 2.2 Tables (summary)

**Accounts and notifications**
- `profiles`
  - Columns: `id`→auth.users, `nickname` (3–20 chars, unique on `lower()`), `color` 0–11.
  - The public projection: the only user data other users ever see.
- `profile_private`
  - Columns: `invite_code`, `age_confirmed_at`, `nickname_changed_at`, `territory_opt_in` (default **true**: Addendum D supersedes the O3 default below), `territory_notice_at` (when the territory notice was acknowledged; null = no claims yet), `notify_*` flags.
- `push_tokens(token pk, user_id, platform)`
- `notifications(recipient, kind, actor, dedupe_key unique per recipient, payload, read_at, push_state, push_attempts)`
  - This one table is both the inbox and the push outbox. Payloads hold nicknames and numbers only.

**Activities**
- `activities`
  - Server-computed: `distance_m`, `excluded_m`, `elapsed_ms`, `moving_ms`, `status`, `flags[]`, `is_loop`, `leaderboard_eligible`.
  - Period keys stored at insert: `week_start`, `month_start` (ET).
  - Sharing: `share_route`, plus `public_path geometry(LineString,4326)`, which exists only when shared.
  - `group_session_id`.
  - Unique `(user_id, client_id)` for idempotent sync.
- `activity_traces(activity_id, user_id, path geometry(LineStringM,4326))`
  - M = ms since the start.
  - Owner-only. Purged after 180 days (decision O2).
- `activity_efforts(activity_id, distance_m ∈ {1000,5000,10000}, duration_ms, start_offset_ms, week_start, month_start, eligible)`
  - Runs only.

**Social**
- `friendships(user_a<user_b, requested_by, status pending|accepted)` and `blocks`.
- `groups(name, owner_id, invite_code)`, `group_members(role)`, `group_sessions(status open|live|ended)`, `group_session_participants`.

**Boards and territory**
- `leaderboard_archive(period, period_start, board, rank, user_id, value)`: top 10 per board per closed period.
- `territory_cells(month_start, cell_id) pk → owner_id, activity_id, claimed_at`
- `territory_claims(activity_id → cells_claimed, cells_stolen, area_m2)`
- `territory_champions(month_start, rank, user_id, cells)`
- `private.*`: `rate_events`, `reserved_nicknames`, `banned_terms`, `period_runs` (makes archive jobs idempotent).

**Indexes** (all in `schema.sql`):
- Activities: partial `(week_start|month_start, kind, user_id) where valid and eligible`.
- Efforts: `(distance_m, week_start|month_start, duration_ms) where eligible`.
- Territory: PK range scan on `(month_start, cell_id)`.
- Inbox: `(recipient_id, created_at desc)`.
- Pending push: `(created_at) where push_state = 'pending'`.

### 2.3 RLS (every table has RLS on; clients never INSERT/UPDATE/DELETE directly)

| Table | `authenticated` SELECT | Writes |
|---|---|---|
| profiles | all rows (nickname, color only) | `claim_nickname`, `set_my_settings` |
| profile_private, push_tokens | owner | RPCs |
| notifications | recipient | triggers; `mark_notifications_read` |
| activities, activity_efforts | **owner** | `submit_activity`, `set_activity_sharing`, `delete_activity` |
| activity_traces | **owner only** (raw trace) | `submit_activity` |
| friendships | either party | friend RPCs |
| blocks | blocker | `block_user` |
| groups, group_members, group_sessions, participants | group members (`private.is_group_member`, SECURITY DEFINER, so no recursion) | group/session RPCs |
| leaderboard_archive, territory_champions | all signed-in | cron |
| territory_cells | none (read through `get_territory`) | claim trigger |
| territory_claims | owner | claim trigger |
| `realtime.messages` | topic `session:<uuid>` for members of that session's group while it is not ended | same (broadcast + presence) |

- **anon** has no table access and no RPC execute.
- Every RPC is `SECURITY DEFINER` with `set search_path = ''`.
- Execute is granted to `authenticated` only. `private.*` is not executable, except the two RLS helpers.
- Public projections of other users' activity data exist only as RPC outputs:
  - board rows: rank, nickname, color, value, activity id, ET date;
  - featured cards;
  - group session results;
  - friends' weekly running distance;
  - territory cells.
- None of them returns a time of day, a raw point, or an email.

### 2.4 RPCs (exact names; arguments as in `schema.sql`)

| Area | RPCs |
|---|---|
| Profile | `claim_nickname(p_nickname, p_age_confirmed)`→profile jsonb · `get_my_profile()` · `set_my_settings(p jsonb)` · `delete_my_account()` |
| Push/inbox | `register_push_token(p_token, p_platform)` · `unregister_push_token(p_token)` · `mark_notifications_read(p_ids)`. Inbox rows are read straight from `notifications` (RLS). |
| Activities | `submit_activity(p jsonb)`→summary jsonb · `set_activity_sharing(p_activity, p_share)` · `delete_activity(p_activity)` · `list_my_activities(p_before, p_limit)` · `get_my_activity_track(p_activity)`→encoded polyline · `get_activity_claim(p_activity)` |
| Boards | `get_leaderboard(p_board, p_period, p_period_start, p_scope, p_group_id, p_limit)` · `get_featured_runs(p_period, p_period_start, p_limit)` · `get_champions(p_period, p_period_start)` |
| Social | `send_friend_request(p_nickname \| p_code)`→'requested'\|'accepted'\|'not_found' · `respond_friend_request` · `remove_friend` · `block_user` · `rotate_invite_code` · `list_friends` · `create_group` · `join_group(p_code)`→group id, or null for an unknown code · `leave_group` · `remove_group_member` · `rotate_group_code` · `list_my_groups` · `get_group_members`. Unknown codes are values, not errors, so the attempt's rate event commits. |
| Sessions | `create_group_session` · `join_group_session` · `set_group_session_status(p_session, 'live'\|'ended')` · `get_group_session` · `get_session_results` |
| Territory | `get_territory(p_south, p_west, p_north, p_east, p_month, p_after, p_limit)`: one page of ≤ 1000 rows ordered by `cell_id`, after the cursor `p_after`. The client pages until a short page, up to 20 000 cells, then reports truncation. 1000 is PostgREST's default "Max rows"; the project setting must stay ≥ 1000 (release checklist). · `get_territory_standings(p_month, p_limit)` |

- **Boards:** `run_1k`, `run_5k` and `run_10k` (value in ms, ascending); `run_distance` and `bike_distance` (value in m, descending).
- **Scopes:** `global`, `friends`, `group`.
- **The caller's own row** is appended when it falls outside the limit.
- **Errors:** SQLSTATE `P0001`, with MESSAGE ∈ `not_authenticated`, `no_profile`, `nickname_invalid`, `nickname_taken`, `nickname_too_soon`, `age_required`, `name_invalid`, `rate_limited`, `not_found`, `not_member`, `forbidden`, `limit_reached`, `invalid_payload`, `invalid_time`, `overlap`, `trace_expired`.

### 2.5 `submit_activity`: the authoritative server metrics [ours]

**Input:** `{client_id, kind, started_at, ended_at, share_route, group_session_id?, points: [[t_ms, lat, lon], …]}`.
The points are the client's filtered, smoothed points rounded to 6 dp, with `t[0] = 0`.

**Rejections** (nothing is stored):
- More than 20 000 or fewer than 2 points.
- Timestamps not strictly increasing.
- `ended_at > now()+2 min`.
- `started_at` older than 30 days.
- The span ≠ the last `t` by more than 5 s.
- Longer than 6 h.
- Time overlaps another of the user's activities.
- More than 30 submits per day.

**Segment rules,** shared with the client `metrics.ts`. For segment (i−1, i), with `dt` and haversine `d`:
- `dt > 30 s`: a gap. It is not counted, and efforts cannot cross it.
- `d/dt > cap`: a vehicle segment. Run cap 7.5 m/s, bike cap 17 m/s. It adds to `excluded_m`, is not counted, and breaks efforts.
- Otherwise the segment is counted. Its `dt` adds to moving time when `d/dt ≥ 0.5 m/s` (run) or `1.0 m/s` (bike).

**Status and flags:**
- `flagged` (stored, private, never on a board) when:
  - `excluded_m > 20 %` of the total (`vehicle`); or
  - any effort is faster than the floors 1K 2:30, 5K 13:30, 10K 28:00 (`implausible_effort`).
- `sparse` (median `dt > 5 s`) and `too_short` (< 200 m) leave the status valid but not eligible.

**Best effort for D** (runs only): the minimum, over start points s, of the interpolated time at which the counted cumulative distance first reaches `cum[s] + D`, minus `t[s]`. The window never spans an uncounted segment.

**Eligibility:** status valid, not sparse or too_short, and received before `least(week end, month end) + 3 h` in ET.

**Loop:** run only, start–end ≤ 75 m, and counted distance ≥ 1 km.

**Shared-route trimming** (server only):
- `build_public_path` drops a random **200–300 m** at each end, chosen independently per end and per build, by cumulative trace distance.
- It then simplifies to about 2 m.
- If the trace is under 1 km, there is no public path.
- Unsharing nulls the path. Re-sharing requires the trace to still exist (`trace_expired`).

### 2.6 Leaderboards, archives, cron

- Boards are computed live from indexed rows; there are no materialised views at this scale [ours].
- "Reset" is implicit: the current period keys change at Monday 00:00 or on the 1st in ET.
- pg_cron runs in UTC, which cannot follow DST, so the rollover job runs **hourly** and archives a period once it is more than 3 h past its end. `private.period_runs` makes this idempotent.

| Job | Schedule (UTC) | Function |
|---|---|---|
| `teal-rollover` | `7 * * * *` | `archive_closed_periods()` (top 10 per board, week and month) + `archive_territory()` (monthly top 10; deletes cells older than last month) |
| `teal-retention` | `17 7 * * *` | traces > 180 d, notifications > 30 d, rate events > 2 d, pending friend requests > 30 d |
| `teal-housekeeping` | `*/15 * * * *` | ends sessions live > 4 h or open > 24 h |
| `teal-push-sweep` | `*/5 * * * *` | re-dispatches pending notifications (< 1 day old, < 5 attempts) |

### 2.7 Territory grid [ours]

The grid is an equal-angle grid over Greater Boston:
- Origin `lat0 = 42.0`, `lon0 = −71.5`.
- `dLat = 0.00045°` (≈ 50.0 m) and `dLon = 0.0006°` (≈ 49.3 m at 42.36°N).
- `i = floor((lon − lon0)/dLon)` in [0, 1500] and `j = floor((lat − lat0)/dLat)` in [0, 1555].
- `cell_id = i·10000 + j`, which fits an `int`.

**Why this grid:**
1. It is identical integer math in PostGIS and in Hermes.
2. It needs no extension. `h3-pg` is not known to be available on Supabase [ext].
3. It needs no dependency. `h3-js` would be a new package, and its emscripten build has had issues on Hermes [ext].
4. The cells are close to square at Boston's latitude: within about 1.5 % over the box.
5. Neighbour and run-length merging are trivial on the client.

Trade-off: it covers only this box, so loops outside it claim nothing.

**Claim** (trigger on `activity_traces` insert):
- Requires:
  - a valid run with `is_loop`;
  - the owner opted in;
  - the activity month equals the current ET month (with the 3 h grace).
- Polygon: `ST_MakeValid(ST_MakePolygon(close(trace)))`, keeping the polygonal parts. Figure-8 loops become two lobes.
- Area must be between 20 000 m² and 25 km².
- Cells claimed are those whose **centre** intersects the polygon, **except** cells whose centre is within **300 m** (haversine) of the trace's first or last point. This privacy zone keeps the squares from undoing the 200–300 m endpoint trimming of shared routes (review S4); `src/territory/preview.ts` applies the same rule.
- No claim until the owner has acknowledged the territory notice (`territory_notice_at`, review B1).
- Upsert per `(month_start, cell_id)`. **The later loop wins**, by activity `ended_at`, so a delayed upload cannot steal back newer cells.
- Stolen and claimed counts are recorded in `territory_claims`.
- Opting out deletes all of the user's cells. Deleting an activity cascades its cells; they become unowned and are not restored to the previous owner.

### 2.8 Overtake push and the Edge Function

**Trigger** (`after insert on activities`): for a valid, eligible run in the **current** ET week:
1. `new_total` = my eligible weekly running distance; `old_total = new_total − this run`.
2. For each accepted friend F with `notify_overtake` and a weekly total `f > 0`:
   - if `old_total ≤ f < new_total`, insert a notification with `kind 'overtake'`, dedupe key `overtake:<me>:<week>`. That allows at most one per pair per week.

**Dispatch:**
- A statement-level trigger on `notifications` sends `net.http_post(<functions_url>/send-push, {ids})` with header `x-teal-push-secret`.
- Both values come from Vault: `teal_functions_url`, `teal_push_secret`. The lead creates them, so no secret is in git.
- With no Vault secrets, dispatch is a no-op and the app falls back to the inbox.

**`send-push`** (Deno, G3):
1. Constant-time check of the header against env `TEAL_PUSH_SECRET`.
2. Reads ≤ 500 pending rows plus the recipients' tokens using the service-role client (env provided by the platform [ext]; verify the variable name on this project's key model).
3. Builds messages in `messages.ts`, a pure TS module that Jest tests:
   - overtake: "⟨nick⟩ passed you this week · 14.2 mi vs your 13.9 mi" (miles, Teal's default [ours]);
   - session_live: "⟨group⟩: ⟨title⟩ is starting";
   - friend_request and friend_accepted.
   - `data.url` uses a route from §3.2.
4. POSTs to `https://exp.host/--/api/v2/push/send` in chunks of 100, adding `Authorization: Bearer EXPO_ACCESS_TOKEN` only if that is set.
5. Ticket handling:
   - ok → `sent`;
   - `DeviceNotRegistered` → delete the token;
   - other errors → `push_attempts++`, or `failed` at 5 attempts;
   - no tokens → `no_token`.
6. Logs counts only. Never tokens, nicknames or ids.

### 2.9 Auth settings (the lead sets these in the dashboard; MCP cannot)

- Email provider on. "Confirm email" on.
- Email OTP length **6**, expiry **600 s**.
- Templates **Magic Link** and **Confirm signup**: replace the link with the code, e.g. `Your Teal code is {{ .Token }}. It expires in 10 minutes. If you didn't ask for this, ignore this email.`
- No links: the app has no redirect handling.
- Built-in SMTP sends only a few emails per hour per project. Before inviting friends, configure custom SMTP (Resend, Postmark or SES) under Auth → SMTP and raise the email rate limit (O1).
- CAPTCHA: later, since it needs a webview.
- Vault secrets and the Edge Function secret `TEAL_PUSH_SECRET` (§2.8).
- Banned-terms list (§6).

---

## 3. Client architecture

### 3.1 Layout (owner in brackets; G0 files are contracts other WPs import, never edit)

```
src/backend/      [G0] config.ts client.ts errors.ts rpc.ts auth.ts parse.ts database.types.ts(generated) testing/mockSupabase.ts
src/activity/     [G0] types.ts kalman.ts filter.ts metrics.ts periods.ts format.ts locationHub.ts backgroundTask.ts
                       recorder.ts store.ts sync.ts __fixtures__/tracks.ts
src/notifications/[G0] index.ts
src/social/       [G0] leaderboards.ts friends.ts groups.ts sessions.ts inbox.ts      [G3] inboxWatcher.ts sessionRuntime.ts
src/territory/    [G0] grid.ts api.ts                                                 [G4] merge.ts preview.ts useTerritory.ts
src/parking/      [G0] types.ts                                                       [G1] engine.ts session.ts appleMaps.ts
src/state/        [G0] mapOverlay.ts (extend) activeModes.ts
src/lib/id.ts     [G0] uuidv4() (Math.random-based; idempotency keys only; no new dependency)
src/features/account/ [G0] SignInScreen NicknameScreen AccountScreen SignInGate
src/features/move/    [G0] MoveHome (entry rows only)
src/features/parking/ [G1]   src/features/record|activities|leaderboards/ [G2]
src/features/social/  [G3]   src/features/territory/ [G4] (TerritoryLayer.tsx stub created by G0, then owned by G4)
src/features/map/TealMap.tsx [G0 edit] + layers/TrackLayer.tsx [G0]
supabase/migrations/*, supabase/tests/*.sql [G0]   supabase/functions/send-push/* [G3]
```

### 3.2 Shell integration (G0 edits only)

- **Tabs.**
  - A fourth top-level tab, **Move** (`/move`), is added to `PATHS`, `TOP_LEVEL_PATHS`, `SHEET_TABS` and `_layout.tsx` `TOP_LEVEL_ROUTES`.
  - If the four segments do not fit at 375 pt with icons, drop the icons.
  - Move hub rows: Record a run · Record a Bluebike ride · Find a dock · Leaderboards · Friends & groups · Territory · My activities · Inbox (unread badge) · Account.
- **Routes.** `features/shell/routes.ts` stays the single owner of paths (review S6). G0 adds every builder and parser now:
  `movePath`, `signInPath({next?})`, `nicknamePath()`, `accountPath()`, `recordPath({kind, sessionId?})`, `activitiesPath()`, `activityPath(localId)`, `leaderboardsPath({board?, period?, scope?, groupId?})`, `parkPath({toName?, toLat?, toLon?})`, `friendsPath()`, `friendInvitePath(code)` (`/friend/[code]`), `groupPath(id)`, `joinGroupPath(code)` (`/join/[code]`), `sessionPath(id)`, `territoryPath({month?})`, `inboxPath()`. Each has a `parse*` for its params.
- **Route files.** `src/app/move.tsx` and `src/app/account/{index,sign-in,nickname}.tsx` (G0). The others are created by the owning WP.
- **AppShell** mounts once:
  - `startBackend()`: session restore and AppState auto-refresh.
  - `configureNotifications()`.
  - `startSyncTriggers()`.
  - `useNotificationRouting()`.
  - An `ActiveModePills` row above the sheet content. It reads `useActiveModes()`, shows "● Recording · 2.4 mi" or "Parking → ⟨dock⟩", taps back to the mode's page, and hides on that page.
- **Map overlay** (`state/mapOverlay.ts` extension; existing fields unchanged):
  - `tracks?: TrackOverlay[] | null`: drawn by `TrackLayer`. Used for the live track, the activity detail, and featured routes.
  - `territory?: { month: string; highlightUserId?: string | null } | null`: TealMap renders `<TerritoryLayer month region/>` with the current settled region. The layer fetches its own data, the same pattern as vehicles.
  - `followUser?: boolean`: sets `followsUserLocation`, and forces `showsUserLocation` on.
  - Parking reuses the existing `itinerary` overlay: a bike leg to the dock, a walk leg to the destination, dock and destination markers. No new layer.
  - Large payloads such as territory cells are **never** put in the overlay; the store compares by JSON. Tracks are ≤ 500 points.
- **Sign-in gating.** `SignInGate` wraps leaderboard, social and territory pages:
  - `unavailable`: "Accounts aren't set up in this build".
  - `signedOut`: a CTA to `/account/sign-in?next=…`.
  - `needsProfile`: redirect to the nickname screen.
  - Recording and parking work signed out.
- **Web.** The Move hub shows a static "In the iPhone app" panel. The backend, recorder and parking are not started on web (O7).

### 3.3 Recorder pipeline [ours]

**Pipeline:** `locationHub` (1 Hz, `Accuracy.BestForNavigation`, `timeInterval 1000`, `distanceInterval 0`) → `GpsFilter.push(fix)` → `TrackPoint` emitted → `LiveStats` → snapshot published (throttled to 1 s; `recentPath` to 5 s).

**Filter rules** (constants in `FILTER_CONFIG`, per kind; run / bike):
1. Reject a fix when:
   - accuracy is null or above 25 / 30 m;
   - its timestamp is ≤ the last accepted one;
   - it is older than 10 s at arrival.
2. Smooth with a 2-axis constant-position Kalman filter in local metres:
   - measurement variance = acc²;
   - process noise q = 3 / 8 m²/s.
3. Jump and vehicle check, on implied speed from the last emitted point to the smoothed position, against the segment caps (7.5 / 17 m/s):
   - ≤ 2 consecutive violations: drop the fix ("jump");
   - violations sustained ≥ 20 s: `vehicleSuspected`, shown as a banner. The points are emitted, and the segment rules exclude them.
4. Emit a `TrackPoint` when either:
   - displacement from the last emitted point ≥ 4 / 6 m; or
   - 5 s have passed (a keepalive that **repeats the last position** with the new `t`, adding zero distance).

   Points are rounded to 6 dp, and `t` is an integer of ms since the start.
5. Stats from the emitted points use the **same segment rules as the server** (`metrics.ts`), so the totals match:
   - distance, moving time and excluded distance;
   - current pace over the last 10 s of points;
   - `autoPaused` when 10 s speed < 0.5 / 1.0 m/s for 5 s; it resumes at > 0.9 / 1.5 m/s for 3 s. This is display only.
6. Gaps:
   - manual pause emits nothing, so its gap > 30 s is not counted;
   - background (AppState) records `backgroundGapMs` and raises a warning.

**States:** `idle → acquiring` (first fix ≤ 20 m within 30 s, else "Weak GPS, start anyway?") `→ recording ⇄ paused → finished`.

**Persistence:**
- During recording, append-only chunks of 300 points go to `teal.rec.inprogress.v1.<n>`, plus a header, every 15 s.
- On launch the Move hub offers "Resume or save your unfinished run?"
- `finish()` discards a recording under 100 m or 60 s, with a message.

### 3.4 Offline-first storage and sync [ours]

**Local storage** (AsyncStorage, `lib/cache` envelopes):
- `teal.activities.v1`: the index of `LocalActivity` summaries.
- `teal.activity.<id>.pts.v1`: points.
- `teal.units.v1`: `'mi'|'km'`, default mi.

`localId` = a uuid v4, and it is the server `client_id`.

**Sync queue** (`sync.ts`):
- Triggers: finish, AppState → active, auth `signedIn`, and manual retry.
- Serial processing. Backoff 30 s, 2 min, 10 min, 1 h.
- Server summary values replace local metrics on success. The UI marks local numbers "pending sync".
- Codes `invalid_payload`, `invalid_time` and `overlap` → `rejected`, never retried; the reason is shown.
- `rate_limited` and network errors → retried.

**Signed-out recordings** are kept with `ownerUserId: null`. After sign-in: "Upload N activities recorded before you signed in?" (default Upload).

**Retention:**
- Local points are deleted 30 days after a successful sync.
- The summary and a ≤ 300-point preview polyline are kept.
- "Delete my data" wipes every `teal.activit*`, `teal.rec*` and `sb-*` auth key.

### 3.5 Notifications (G0 `src/notifications`) [plat]+[ours]

- **Handler:** show banner and list; no sound; no badge. Builders must check the SDK 57 handler field names [ext].
- **Permission** is asked in context only: enabling a notify toggle, starting parking, or joining a session.
- **`PushAvailability`:**

  | Value | When |
  |---|---|
  | `web` | running on web |
  | `simulator` | `!Device.isDevice` |
  | `expoGoAndroid` | Android and `executionEnvironment === 'storeClient'` |
  | `noProjectId` | no `Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId` |
  | `permissionDenied` | the user said no |
  | `available` | a token was registered with `register_push_token` |
  | `error` | anything else |

- **Re-registration:** on sign-in and on app start when signed in. Sign-out calls `unregister_push_token`.
- **Local fallback** (G3 `inboxWatcher`): while the app is foreground and signed in, it:
  - subscribes to realtime INSERTs on `notifications` (RLS-filtered);
  - fetches unread rows on foreground;
  - calls `notifyLocal` for new rows **only if** push availability ≠ `available`, to avoid duplicates.
- **Taps:** `data.url` is routed only if it matches a known builder prefix (`/friends`, `/inbox`, `/session/`, `/leaderboards`, `/park`, `/territory`).

---

## 4. Shared contracts (G0 writes; exact names; others import, never edit)

```ts
// src/backend/errors.ts
export type BackendErrorCode = 'not_configured' | 'offline' | 'not_authenticated' | 'no_profile' | 'rate_limited'
  | 'email_rate_limited' | 'otp_invalid' | 'otp_expired' | 'nickname_invalid' | 'nickname_taken' | 'nickname_too_soon'
  | 'age_required' | 'name_invalid' | 'not_found' | 'not_member' | 'forbidden' | 'limit_reached' | 'invalid_payload'
  | 'invalid_time' | 'overlap' | 'trace_expired' | 'unknown';
export type BackendError = { code: BackendErrorCode; message: string /* user-safe copy */; retryable: boolean };
export type Result<T> = { ok: true; value: T } | { ok: false; error: BackendError };
export function toBackendError(e: unknown): BackendError;   // PostgrestError P0001 → MESSAGE code; AuthError → otp_*/email_rate_limited; fetch TypeError → offline

// src/backend/config.ts + client.ts + rpc.ts
export const BACKEND_CONFIGURED: boolean;                    // literal process.env.EXPO_PUBLIC_SUPABASE_URL/_PUBLISHABLE_KEY present and not web
export type TealSupabase = import('@supabase/supabase-js').SupabaseClient;
export function getSupabase(): TealSupabase | null;          // singleton: AsyncStorage storage, persistSession, autoRefreshToken,
                                                             // detectSessionInUrl:false, lock: processLock
export function startBackend(): () => void;                  // AppState → startAutoRefresh/stopAutoRefresh; returns cleanup
export function rpc(fn: string, args?: Record<string, unknown>): Promise<Result<unknown>>;   // parse with src/backend/parse.ts

// src/backend/auth.ts
export type MyProfile = { id: string; nickname: string; color: number; inviteCode: string; territoryOptIn: boolean;
  notifyOvertake: boolean; notifySessions: boolean; notifyFriendRequests: boolean; createdAt: string };
export type AuthState = { status: 'unavailable' } | { status: 'loading' } | { status: 'signedOut' }
  | { status: 'needsProfile'; userId: string } | { status: 'signedIn'; userId: string; profile: MyProfile };
export function useAuth(): AuthState;
export function getAuthState(): AuthState;
export function subscribeAuth(l: (s: AuthState) => void): () => void;
export function requestEmailCode(email: string): Promise<Result<{ resendAfterMs: number /* 60_000 */ }>>;  // signInWithOtp({ email, options:{ shouldCreateUser:true } })
export function verifyEmailCode(email: string, code: string): Promise<Result<AuthState>>;                // verifyOtp({ email, token, type:'email' })
export function claimNickname(nickname: string, o: { ageConfirmed: boolean }): Promise<Result<MyProfile>>;
export function updateMySettings(p: Partial<Pick<MyProfile, 'color' | 'territoryOptIn' | 'notifyOvertake' | 'notifySessions' | 'notifyFriendRequests'>>): Promise<Result<MyProfile>>;
export function validateNicknameLocally(n: string): { ok: true } | { ok: false; reason: 'length' | 'chars' | 'reserved' };
export function signOut(): Promise<void>;
export function deleteMyAccount(): Promise<Result<void>>;   // RPC, then unregisterPush, wipeLocalUserData, signOut

// src/activity/types.ts
export type ActivityKind = 'run' | 'bike';
export type RawFix = { latitude: number; longitude: number; accuracy: number | null; speed: number | null; timestamp: number };
export type TrackPoint = { t: number /* ms since start, int */; lat: number; lon: number /* 6 dp */ };
export type LiveStats = { elapsedMs: number; movingMs: number; distanceM: number; excludedM: number;
  currentPaceSecPerKm: number | null; avgPaceSecPerKm: number | null; autoPaused: boolean;
  gpsQuality: 'good' | 'fair' | 'poor' | 'none'; vehicleSuspected: boolean };
export type Effort = { distanceM: 1000 | 5000 | 10000; durationMs: number; startOffsetMs: number };
export type Split = { index: number; distanceM: number; durationMs: number };

// src/activity/filter.ts + kalman.ts
export type FilterConfig = { maxAccuracyM: number; staleMs: number; kalmanQ: number; minMoveM: number; keepaliveMs: number;
  jumpTolerance: number; vehicleSustainMs: number; pauseMps: number; resumeMps: number; pauseAfterMs: number; resumeAfterMs: number };
export const FILTER_CONFIG: Record<ActivityKind, FilterConfig>;
export type FilterVerdict = 'emitted' | 'held' | 'inaccurate' | 'stale' | 'outOfOrder' | 'jump';
export type GpsFilter = { push(fix: RawFix, now: number): { verdict: FilterVerdict; point: TrackPoint | null; vehicleSuspected: boolean };
  reset(startedAt: number): void };
export function createGpsFilter(kind: ActivityKind, startedAt: number): GpsFilter;

// src/activity/metrics.ts  (parity with submit_activity; tests share __fixtures__/tracks.ts)
export const SEGMENT_RULES: Record<ActivityKind, { capMps: number; maxGapMs: 30_000; movingMps: number }>;
export const STANDARD_DISTANCES: readonly [1000, 5000, 10000];
export const EFFORT_FLOOR_MS: Record<1000 | 5000 | 10000, number>;          // 150_000, 810_000, 1_680_000
export type TrackMetrics = { distanceM: number; excludedM: number; elapsedMs: number; movingMs: number;
  efforts: Effort[] /* runs only */; isLoop: boolean; loopGapM: number | null; medianDtMs: number | null };
export function computeTrackMetrics(points: readonly TrackPoint[], kind: ActivityKind): TrackMetrics;
export function bestEffort(points: readonly TrackPoint[], kind: ActivityKind, distanceM: number): Effort | null;
export function splits(points: readonly TrackPoint[], kind: ActivityKind, unitM: number): Split[];
export function recentPath(points: readonly TrackPoint[], max: number): LatLng[];   // evenly decimated for display

// src/activity/periods.ts + format.ts  (ET via mbta/time/eastern.ts)
export type PeriodKind = 'week' | 'month';
export function periodStart(kind: PeriodKind, now: number): string;        // 'YYYY-MM-DD', Monday / 1st, ET
export function periodEndMs(kind: PeriodKind, start: string): number;
export function periodLabel(kind: PeriodKind, start: string): string;      // 'Week of Oct 19' | 'October 2026'
export type Units = 'mi' | 'km';
export function useUnits(): [Units, (u: Units) => void];
export function formatDistanceM(m: number, u: Units): string;  export function formatDurationMs(ms: number): string;
export function formatPace(secPerKm: number | null, u: Units): string;      // '8:05 /mi'

// src/activity/locationHub.ts + backgroundTask.ts
export const BACKGROUND_TRACKING: false;
export function canTrackInBackground(): boolean;
export type HubMode = 'foreground' | 'background';
export type HubError = 'permissionDenied' | 'servicesOff' | 'unavailable';
export type HubLease = { ok: true; mode: HubMode; release: () => void } | { ok: false; error: HubError };
export function acquireFixes(owner: string, listener: (fix: RawFix) => void, o: { precision: 'fitness' | 'navigation' }):
  Promise<HubLease>;                                         // ref-counted: one watch shared by recorder and parking
export function registerBackgroundLocationTask(): void;     // no-op unless canTrackInBackground()

// src/activity/recorder.ts
export type RecorderPhase = 'idle' | 'acquiring' | 'recording' | 'paused' | 'finished';
export type RecorderWarning = 'foregroundOnly' | 'backgroundGap' | 'vehicleSegment' | 'poorGps' | 'permissionDenied' | 'servicesOff';
export type RecorderSnapshot = { phase: RecorderPhase; kind: ActivityKind | null; localId: string | null; startedAt: number | null;
  stats: LiveStats; recentPath: LatLng[]; groupSessionId: string | null; backgroundGapMs: number; warnings: RecorderWarning[] };
export function useRecorder(): RecorderSnapshot;
export function subscribeRecorder(l: (s: RecorderSnapshot) => void): () => void;
export const recorder: {
  start(o: { kind: ActivityKind; groupSessionId?: string | null }): Promise<Result<void>>;   // keep-awake tag 'teal-recorder'
  pause(): void; resume(): void;
  finish(o: { shareRoute: boolean }): Promise<LocalActivity | { discarded: 'tooShort' }>;
  discard(): Promise<void>;
  pendingRecovery(): Promise<{ kind: ActivityKind; startedAt: number; points: number } | null>;
  recover(action: 'resume' | 'save' | 'discard'): Promise<void>;
};

// src/activity/store.ts + sync.ts
export type SyncState = 'local' | 'pending' | 'syncing' | 'synced' | 'rejected';
export type ServerActivity = { id: string; clientId: string; kind: ActivityKind; status: 'valid' | 'flagged'; flags: string[];
  startedAt: string; endedAt: string; weekStart: string; monthStart: string; distanceM: number; excludedM: number;
  elapsedMs: number; movingMs: number; isLoop: boolean; leaderboardEligible: boolean; shareRoute: boolean;
  groupSessionId: string | null; efforts: Effort[] };
export type LocalActivity = { localId: string; kind: ActivityKind; startedAt: number; endedAt: number; ownerUserId: string | null;
  groupSessionId: string | null; shareRoute: boolean; metrics: TrackMetrics; previewPolyline: string;
  sync: { state: SyncState; attempts: number; nextAttemptAt: number | null; lastError: BackendErrorCode | null; server: ServerActivity | null } };
export type ActivityListItem = { localId: string | null; serverId: string | null; kind: ActivityKind; startedAt: number;
  distanceM: number; movingMs: number; syncState: SyncState | 'remote'; status: 'valid' | 'flagged' | null; flags: string[] };
export function useActivities(): { ready: boolean; items: ActivityListItem[]; refresh(): Promise<void> };  // local ∪ list_my_activities
export function getLocalActivity(localId: string): Promise<LocalActivity | null>;
export function getLocalPoints(localId: string): Promise<TrackPoint[] | null>;
export function wipeLocalUserData(): Promise<void>;
export function syncPending(reason: 'finish' | 'foreground' | 'signIn' | 'manual'): Promise<{ synced: number; rejected: number; failed: number }>;
export function startSyncTriggers(): () => void;
export function useSyncStatus(): { pending: number; syncing: boolean; lastError: BackendErrorCode | null };
export function setActivitySharing(serverId: string, share: boolean): Promise<Result<ServerActivity>>;
export function deleteActivity(item: { localId: string | null; serverId: string | null }): Promise<Result<void>>;
export function fetchMyTrack(serverId: string): Promise<Result<LatLng[] | null>>;   // null = trace expired

// src/social/leaderboards.ts
export type BoardId = 'run_1k' | 'run_5k' | 'run_10k' | 'run_distance' | 'bike_distance';
export const BOARD_META: Record<BoardId, { label: string; unit: 'duration' | 'distance'; order: 'asc' | 'desc' }>;
export type BoardScope = { kind: 'global' } | { kind: 'friends' } | { kind: 'group'; groupId: string };
export type LeaderboardRow = { rank: number; userId: string; nickname: string; color: number; value: number;
  activityId: string | null; achievedOn: string | null; isMe: boolean };
export type Leaderboard = { board: BoardId; period: PeriodKind; periodStart: string; scope: BoardScope;
  rows: LeaderboardRow[]; me: LeaderboardRow | null; fetchedAt: number };
export function fetchLeaderboard(q: { board: BoardId; period: PeriodKind; periodStart?: string; scope: BoardScope; limit?: number }): Promise<Result<Leaderboard>>;
export type FeaturedRun = { activityId: string; nickname: string; color: number; effortM: 1000 | 5000 | 10000;
  durationMs: number; totalM: number; achievedOn: string; route: LatLng[] | null };
export function fetchFeaturedRuns(period: PeriodKind, periodStart?: string): Promise<Result<FeaturedRun[]>>;
export type Champion = { board: BoardId; rank: number; userId: string; nickname: string; color: number; value: number };
export function fetchChampions(period: PeriodKind, periodStart: string): Promise<Result<Champion[]>>;

// src/social/friends.ts + groups.ts + sessions.ts + inbox.ts
export type Friend = { userId: string; nickname: string; color: number; status: 'friends' | 'incoming' | 'outgoing'; since: string; weekRunM: number | null };
export function listFriends(): Promise<Result<Friend[]>>;
export function sendFriendRequest(t: { nickname: string } | { code: string }): Promise<Result<'requested' | 'accepted'>>;
export function respondFriendRequest(userId: string, accept: boolean): Promise<Result<void>>;
export function removeFriend(userId: string): Promise<Result<void>>;
export function blockUser(userId: string): Promise<Result<void>>;
export function rotateInviteCode(): Promise<Result<string>>;
export function friendInviteLink(code: string): string;          // Linking.createURL of friendInvitePath(code)
export function parseInviteInput(s: string): { code: string } | { nickname: string } | null;  // accepts code, link or nickname
export type Group = { id: string; name: string; role: 'owner' | 'member'; memberCount: number; inviteCode: string; createdAt: string };
export type GroupMember = { userId: string; nickname: string; color: number; role: 'owner' | 'member'; joinedAt: string };
export function listMyGroups(): Promise<Result<Group[]>>;  export function createGroup(name: string): Promise<Result<string>>;
export function joinGroup(code: string): Promise<Result<string>>;  export function leaveGroup(id: string): Promise<Result<void>>;
export function getGroupMembers(id: string): Promise<Result<GroupMember[]>>;
export function removeGroupMember(groupId: string, userId: string): Promise<Result<void>>;
export function rotateGroupCode(groupId: string): Promise<Result<string>>;
export type GroupSession = { id: string; groupId: string; title: string; kind: ActivityKind; status: 'open' | 'live' | 'ended';
  createdBy: string | null; startsAt: string | null; startedAt: string | null; endedAt: string | null;
  participants: { userId: string; nickname: string; color: number; joinedAt: string }[] };
export function createSession(groupId: string, o: { title: string; kind: ActivityKind; startsAt?: string | null }): Promise<Result<string>>;
export function joinSession(id: string): Promise<Result<void>>;
export function setSessionStatus(id: string, s: 'live' | 'ended'): Promise<Result<void>>;
export function getSession(id: string): Promise<Result<GroupSession>>;
export type SessionResult = { userId: string; nickname: string; color: number; activityStatus: 'valid' | 'flagged' | null;
  distanceM: number | null; movingMs: number | null; elapsedMs: number | null; best1kMs: number | null; best5kMs: number | null };
export function fetchSessionResults(id: string): Promise<Result<SessionResult[]>>;
export type LiveProgress = { userId: string; distanceM: number; elapsedMs: number; state: 'recording' | 'paused' | 'finished'; at: number };
export function openSessionChannel(sessionId: string, h: { onProgress(p: LiveProgress): void; onPresence(userIds: string[]): void;
  onStatus(s: 'live' | 'ended'): void }): { sendProgress(p: Omit<LiveProgress, 'userId' | 'at'>): void; sendStatus(s: 'live' | 'ended'): void; close(): Promise<void> };
  // channel `session:<id>`, config { private: true }; payloads never contain coordinates
export type InboxItem = { id: string; kind: 'overtake' | 'session_live' | 'friend_request' | 'friend_accepted'; createdAt: string;
  readAt: string | null; actorNickname: string | null; payload: Record<string, unknown> };
export function fetchInbox(limit?: number): Promise<Result<InboxItem[]>>;
export function markInboxRead(ids: string[]): Promise<Result<void>>;
export function subscribeInboxInserts(cb: (item: InboxItem) => void): () => void;

// src/notifications/index.ts
export type PushAvailability = 'available' | 'noProjectId' | 'expoGoAndroid' | 'simulator' | 'web' | 'permissionDenied' | 'error';
export function configureNotifications(): void;
export function ensureNotificationPermission(): Promise<'granted' | 'denied'>;
export function notifyLocal(n: { title: string; body: string; url?: string }): Promise<void>;
export function scheduleLocal(n: { title: string; body: string; url?: string; at: number }): Promise<string | null>;
export function cancelScheduled(id: string): Promise<void>;
export function registerForPush(): Promise<PushAvailability>;     // → register_push_token
export function unregisterPush(): Promise<void>;
export function usePushAvailability(): PushAvailability | null;
export function useNotificationRouting(): void;
export function haptic(kind: 'success' | 'warning' | 'light'): void;   // expo-haptics, no-op on web

// src/territory/grid.ts + api.ts
export const GRID: { lat0: 42.0; lon0: -71.5; dLat: 0.00045; dLon: 0.0006; iMax: 1500; jMax: 1555 };
export type CellId = number;
export function cellOf(p: LatLng): CellId | null;            // null outside the box
export function cellIJ(id: CellId): { i: number; j: number };
export function cellBounds(id: CellId): { south: number; west: number; north: number; east: number };
export function cellCenter(id: CellId): LatLng;
export type TerritoryCell = { cellId: CellId; ownerId: string; nickname: string; color: number };
export function fetchTerritory(b: { south: number; west: number; north: number; east: number }, month?: string):
  Promise<Result<{ month: string; cells: TerritoryCell[]; truncated: boolean /* 20 000 rows returned */ }>>;
export type TerritoryStanding = { rank: number; userId: string; nickname: string; color: number; cells: number; isMe: boolean };
export function fetchTerritoryStandings(month?: string): Promise<Result<TerritoryStanding[]>>;
export function fetchTerritoryChampions(month: string): Promise<Result<TerritoryStanding[]>>;
export function fetchActivityClaim(serverId: string): Promise<Result<{ cellsClaimed: number; cellsStolen: number; areaM2: number } | null>>;
export const OWNER_COLORS: readonly string[];                // 12 colors, light/dark legible, from theme

// src/parking/types.ts  (G1 implements engine.ts against these)
export type DockCandidate = { station: BikeStation; rideM: number; walkM: number; scoreMin: number; risk: 'ok' | 'low' | 'critical' };
export type ParkingPhase = 'choosing' | 'navigating' | 'arrived' | 'ended';
export type ParkingState = { phase: ParkingPhase; destination: Place | null; target: DockCandidate | null; backup: DockCandidate | null;
  candidates: DockCandidate[]; radiusM: number; lastCheckAt: number | null; lastSwitchAt: number | null; error: string | null };
export type ParkingEvent = { kind: 'none' } | { kind: 'rerouted'; reason: 'targetFull' | 'targetClosed' | 'better'; from: DockCandidate; to: DockCandidate }
  | { kind: 'lowDocks'; dock: DockCandidate } | { kind: 'arrived'; dock: DockCandidate } | { kind: 'noDocks' } | { kind: 'staleData'; ageMs: number };
export const PARKING: { pollMs: 45_000; searchRadiusM: 600; widenRadiusM: 1200; arriveM: 35; switchGainMin: 3;
  switchCooldownMs: 120_000; staleMs: 600_000; reminderLeadMs: 120_000 };
export declare function rankDocks(stations: readonly BikeStation[], here: LatLng | null, destination: LatLng, radiusM: number): DockCandidate[];
export declare function evaluateParking(s: ParkingState, i: { stations: readonly BikeStation[]; here: LatLng | null; now: number }): { state: ParkingState; event: ParkingEvent };

// src/state/mapOverlay.ts (additions) + activeModes.ts
export type TrackOverlay = { id: string; coordinates: LatLng[]; color: string; width?: number; dashed?: boolean };
// MapOverlay gains: tracks?: TrackOverlay[] | null; territory?: { month: string; highlightUserId?: string | null } | null; followUser?: boolean
export type ActiveMode = { id: 'recording' | 'parking'; label: string; href: Href };
export function setActiveMode(m: ActiveMode): void;  export function clearActiveMode(id: ActiveMode['id']): void;
export function useActiveModes(): ActiveMode[];
```

**Parsing rule.** Every API module parses RPC output with `src/backend/parse.ts` helpers. The input is `unknown`; the output is a typed value. A malformed row is dropped, not cast. This follows the existing `mbta/model/parse.ts` style. `database.types.ts` is generated with MCP `generate_typescript_types` after the migrations are applied, and is used for reference only.

---

## 5. Work packages (strict file ownership; order G0 → {G1, G2, G3, G4} in parallel)

**Rules for all WPs:**
- No new dependencies. The one pre-approved exception is G0 step 2.
- Only G0 edits:
  - `package.json`, `app.json`, `jest.setup.ts`, `tsconfig.json`, `eslint.config.js`;
  - `src/backend|activity|notifications/**`;
  - the G0 files in `src/social|territory|parking`;
  - `src/state/**`, `src/lib/**`;
  - `features/shell/**`, `features/map/TealMap.tsx`, `src/app/_layout.tsx`;
  - `supabase/migrations|tests`.
- Contract changes go through the lead.
- No network in tests: mock `@/backend/client` with `src/backend/testing/mockSupabase.ts`; mock `expo-location`, `expo-notifications`, `expo-keep-awake`, `expo-haptics` and `fetch` per test.
- Before declaring done, every WP runs `npx tsc --noEmit`, `npx expo lint` and `npx jest`, and reports the real output.
- Before touching an Expo API, read the SDK 57 page for it (`https://docs.expo.dev/versions/v57.0.0/sdk/<module>`). This is required by AGENTS.md.
- Logging: never log coordinates, emails, tokens or nicknames.

### G0 Core (alone, in this order)

1. **Migrations.** Split `schema.sql` into the 8 files listed in §2.1. Add `supabase/tests/{rls,submit,boards,social,territory}.sql`; each is a `begin; … rollback;` script (see §7). **Checkpoint:** the lead reviews, applies via MCP, runs `get_advisors` (security and performance), creates the Vault secrets, and sets up auth (§2.9). G0 then generates `database.types.ts`.
2. **Backend client spike** in Expo Go: does `createClient` (URL handling, realtime websocket) work on Hermes in RN 0.86?
   - If URL APIs throw, add `react-native-url-polyfill` (pure JS, Expo Go-safe, via `npx expo install`). This is the only pre-approved dependency.
   - Record the result in an Addendum.
3. **Backend modules:** `src/backend/*`, `auth.ts` (the AuthState store follows the `useSyncExternalStore` pattern of `mapCenter.ts`), and `src/lib/id.ts`.
4. **Activity core:** `kalman`, `filter`, `metrics`, `periods`, `format`, `locationHub`, `backgroundTask` (flagged off), `recorder`, `store`, `sync`, and `__fixtures__/tracks.ts`. The fixtures are generated deterministically: seeded noise, a constant 4 m/s 11 km run, a car segment, a 30 s+ gap, a 1.2 km² loop, and a figure-8.
5. **API wrappers:** `src/social/{leaderboards,friends,groups,sessions,inbox}.ts`, `src/territory/{grid,api}.ts`, `src/parking/types.ts`, `src/notifications/index.ts`.
6. **Shell and UI:**
   - Shell edits (§3.2): the routes in `routes.ts`, the Move tab, `ActiveModePills`, the overlay extension, `TrackLayer`, the `TerritoryLayer` stub (`() => null`, props `{ month, region, highlightUserId }`), and `followUser`.
   - Account screens: the sign-in flow (email → 6-digit code with paste/autofill `textContentType="oneTimeCode"`, 60 s resend), the nickname screen (local validation, server errors mapped, 13+ checkbox), and the account screen (nickname, color, units, notification toggles + PushAvailability line, territory opt-in with explanation, sign out, delete my data with a typed "DELETE" confirm).
   - The Move hub.
   - `app.json`: update the `expo-location` permission text to mention activity recording.
   - Exclude `supabase/functions` from `tsconfig.json` and ESLint, since Deno code must not enter the app typecheck. Keep `messages.ts` Jest-testable.

**Acceptance:**
- `metrics` on the fixtures:
  - the 4 m/s run gives 1K = 250 000 ms ± 5, 5K = 1 250 000 ± 5, 10K = 2 500 000 ± 5;
  - the gap fixture's 5K never spans the gap;
  - the car segment is excluded (`excludedM` within 1 % of the injected leg);
  - the loop fixture gives `isLoop`.
- `filter`:
  - a stationary noisy fixture (σ 8 m, 10 min) accumulates < 15 m;
  - a 40 m/s single-fix spike is dropped;
  - stale and out-of-order fixes are rejected;
  - keepalive points add 0 m.
- **Parity:** the SQL test runs `submit_activity` on the shared fixture JSON and asserts distance ±1 m and efforts ±50 ms against the Jest values. Record both numbers.
- `periods` across DST (2026-11-01 and 2027-03-14) and the Sunday 23:59 / Monday 00:00 ET boundary.
- `recorder` with a fake hub and fake timers: acquiring → recording, pause gap, AppState background gap warning, chunk persistence, recovery, tooShort discard.
- `sync`:
  - an idempotent retry returns the existing summary;
  - backoff schedule;
  - `invalid_time` → rejected and not retried;
  - signed-out activities attach after sign-in;
  - the server summary replaces local metrics.
- `auth` error mapping: OTP invalid / expired / rate-limited and `nickname_taken`.
- Parsers drop malformed rows.
- `grid`: known points → `cell_id`. Cell edges are exact, `cellOf` of the centre round-trips, and points outside the box give null.
- `PushAvailability` matrix.
- `routes` builders round-trip through their parsers.
- Shell test: four tabs render and the Move tab navigates.
- SQL tests pass.
- Advisors show no `security definer` exposure to anon and no mutable `search_path`.

**Edge cases:** the env is missing (`unavailable`), the session expires while offline, a nickname differs only in case, the sign-in code is pasted with spaces, and the clock moves backward mid-run (out-of-order fixes rejected).

### G1 Bike parking mode

**Files:** `src/parking/{engine,session,appleMaps}.ts`, `src/features/parking/*`, `src/app/park.tsx`, and tests.

**Imports:** `fetchBikeStations`, `canReturn` (`planner/bike.ts`), `useGeocodeSuggestions`, `resolveTypedPlace`, `stationPlaces`, `OSM_ATTRIBUTION` (geocode), `bikeMinutes`, `walkMinutesDetour`, `distanceMeters`, `acquireFixes`, `notifyLocal`, `scheduleLocal`, `haptic`, `useMapOverlay`, `requestSheetDetent`, `setActiveMode`, and `parkPath`.

**Engine** [ours]:
- **Candidates:** stations within 600 m of the destination with `canReturn`. Widen to 1200 m with a notice if there are none.
- **Score (minutes):** `bikeMinutes(here→dock) + walkMinutesDetour(dock→dest) + fullness + staleness`.
  - Fullness: 1 dock +4, 2 docks +2, 3 docks +1. `risk` is critical, low or ok to match.
  - Staleness: `reportedAt` older than 10 min adds +2.
- **Decisions:**
  - Reroute immediately when the target has 0 docks or `!isReturning`.
  - Switch to a "better" option only when it gains ≥ 3 min and the last switch was ≥ 2 min ago.
  - `lowDocks` fires once when the target drops to ≤ 1.
  - `arrived` fires within 35 m.

**Session:**
- Polls `fetchBikeStations` every **45 s** while focused and foreground.
- Holds keep-awake tag `teal-parking`.
- Sets `ActiveMode` "Parking → ⟨dock⟩".
- Sets the itinerary overlay (bike leg + walk leg + markers) with `followUser`.
- On reroute: `haptic('warning')` and `notifyLocal` ("Dock full. Now heading to ⟨dock⟩, +2 min").
- When backgrounded, schedules a reminder at ETA − 2 min. It is cancelled on foreground.

**UI:**
- Destination search, reusing the geocode hooks.
- A target card: dock name, docks/bikes, distance, a bearing such as "0.6 mi NE", ETA, and the backup dock.
- "Open in Apple Maps".
- "End parking".
- A `__DEV__` "Simulate target full" button for device tests.

**Apple Maps:**
- First try `https://maps.apple.com/directions?destination=<lat>,<lon>&mode=cycling` [ext, unverified].
- If `canOpenURL` fails, fall back to `http://maps.apple.com/?daddr=<lat>,<lon>&dirflg=w`.
- Verify on device and record the result.

**Acceptance** (unit, using builder stations):
- Ranking prefers a 2-dock station 100 m away over a 6-dock station 500 m away only when the scores say so.
- Full target → reroute to the backup.
- Hysteresis blocks flapping.
- Widening.
- `noDocks`.
- Stale penalty.
- Arrival.
- Device checks: polling stops in the background, the reminder fires, and the Apple Maps URL opens cycling directions.

**Edge cases:** no location (rank by destination distance only), the GBFS fetch fails (keep the last data and show a banner), the destination is outside Boston (reject), and the user is already at the destination.

### G2 Recorder UI, activity history, leaderboards, featured runs

**Files:** `src/features/record/*`, `src/features/activities/*`, `src/features/leaderboards/*`, `src/app/{record,activities,leaderboards}.tsx`, `src/app/activity/[activityId].tsx`, and tests.

**Imports:** `recorder`, `useRecorder`, the stores, `syncPending`, `useSyncStatus`, `setActivitySharing`, `deleteActivity`, `fetchMyTrack`, the format and period helpers, `fetchLeaderboard`, `fetchFeaturedRuns`, `fetchChampions`, `fetchActivityClaim`, `listMyGroups`, `useMapOverlay`, `setActiveMode`, `SignInGate`, `parkPath`, and the UI primitives.

**Record screen:**
- Kind toggle.
- The first-run Expo Go sheet (§1).
- Big stats: time, distance, current pace (run), speed (bike, display only), and an avg pace.
- GPS quality dot.
- Pause, resume and finish (hold to finish).
- Banners: `foregroundOnly`, `backgroundGap`, `vehicleSegment`.
- Overlay: a live track plus `followUser`.
- Bike mode has a "Find a dock" button linking to `/park`.
- The finish summary has a "Show route on featured runs" toggle, off by default, explained: "Start and finish (~200–300 m) are hidden. Shown to signed-in Teal users."

**History:**
- Merged list with sync chips: Waiting to sync, Synced, "Not counted: ⟨reason⟩".
- Detail: stats, splits, efforts, and the track (local points, else `fetchMyTrack`), with a territory claim line when a claim exists.
- Share toggle, delete, and retry.

**Leaderboards:**
- Week/Month segment, then board chips, then scope chips (Everyone · Friends · each group).
- Rows: rank, color dot, nickname, value, "you" highlight, and my row pinned at the bottom when outside the top N.
- Period label and "Resets Mon" / "Resets Nov 1".
- "Last week's / last month's champions" (`fetchChampions` for the previous period).
- **Featured** strip: a horizontal list of cards. Tapping one draws its route as a track overlay with `fitTo`, or says "Route not shared".
- Refreshes on focus. 60 s minimum between refetches (review S4 lesson).

**Acceptance:**
- Unit tests: value formatting per board, me-row pinning, period labels and `resetCountdown`, mapping sync state to chips, and share-toggle confirmation copy.
- Render smoke tests with mocked APIs.
- Device checks:
  - a 2 km run recorded in Expo Go with the screen on, its distance within ±3 % of a known route;
  - auto-pause at a stop light;
  - a backgrounded gap is reported;
  - sync appears on the board.

**Edge cases:** permission denied (Settings link), signed out (local only, board gated), flagged activity, sync rejected, empty board, the period rolls over while the screen is open, and units in miles while efforts stay labeled 1K/5K/10K.

### G3 Friends, groups, run-together sessions, overtake push

**Files:** `src/features/social/*`, `src/social/{inboxWatcher,sessionRuntime}.ts`, `src/app/{friends,inbox}.tsx`, `src/app/friend/[code].tsx`, `src/app/group/[groupId].tsx`, `src/app/join/[code].tsx`, `src/app/session/[sessionId].tsx`, `supabase/functions/send-push/{index.ts,messages.ts}` plus a Jest test for `messages.ts`, and tests.

**Imports:** the social APIs, `useAuth`, `registerForPush`, `usePushAvailability`, `notifyLocal`, `recorder`, `subscribeRecorder`, `recordPath`, `leaderboardsPath`, `SignInGate`, and the format helpers.

**Friends page:**
- My invite code, with copy and share. The share text includes the code and the `friendInviteLink`.
- An add field that accepts a nickname, a code or a link.
- Incoming requests (accept / decline), friends with this week's running distance, outgoing requests, and remove / block.

**Group page:** members, the invite code (rotate is owner only), the group leaderboard (links to `/leaderboards?scope=group`), sessions, and leave.

**Session page:**
- Lobby: presence and joined members.
- Creator: Start / End.
- On `live`, members get a "Start recording" button that opens `recordPath({kind, sessionId})`.
- `sessionRuntime` subscribes to the recorder while the user is a participant and broadcasts `LiveProgress` every 10 s (no coordinates).
- Live list, then results (`fetchSessionResults`).

**Inbox:**
- Lists items and marks them read.
- `inboxWatcher` gives the foreground local fallback (§3.5).
- Overtake rows link to the Friends tab.

**Edge Function:** as in §2.8. Pin `npm:@supabase/supabase-js@2.118.0`.

**Acceptance:**
- Unit tests:
  - `parseInviteInput` (code, link, nickname, junk);
  - `messages.ts` per kind, with miles formatting and no PII beyond the nickname;
  - `sessionRuntime` throttles to ≤ 1 message per 10 s and stops on finish;
  - `inboxWatcher` local fallback fires only when push is not `available`, and dedupes ids.
- SQL tests (G0's `social.sql`): a request by code auto-accepts, block hides the user as `not_found`, limits apply, and an overtake row is created once per week.
- Device checks:
  - two phones: a friend request round-trip;
  - a session with live progress on both;
  - a push received on iOS Expo Go after `eas init`;
  - without a projectId, a local banner while the app is open.

**Edge cases:** I friend myself, a nickname is renamed after the request, the group is full (50), the owner leaves (handover), the session ended while recording (the activity keeps `group_session_id` only if inside the window; otherwise it is flagged `session_mismatch` and the run is still saved), and the realtime connection drops (fall back to polling `getSession` every 15 s).

### G4 Territory

**Files:** `src/territory/{merge,preview,useTerritory}.ts`, `src/features/territory/*` (it replaces the `TerritoryLayer` stub; the props contract is fixed), `src/app/territory.tsx`, and tests.

**Imports:** `GRID`, the cell helpers, `fetchTerritory`, `fetchTerritoryStandings`, `fetchTerritoryChampions`, `OWNER_COLORS`, `useAuth`, `updateMySettings`, `useMapOverlay`, the `metrics` loop helpers, `getLocalPoints`, and `SignInGate`.

**Layer:**
- Fetch by settled region, debounced 500 ms and cached per `(month, rounded bbox)` for 60 s.
- Merge cells into horizontal run-length rectangles per owner (`merge.ts`).
- Render ≤ 600 `Polygon`s.
- When `latitudeDelta > 0.08`, aggregate to 4×4 super-cells colored by the majority owner.
- Owner color from `OWNER_COLORS[color]` at 35 % fill. My cells get an outline.

**Screen:**
- Opt-in card when off, explaining that areas you loop are shown publicly by nickname.
- This month's standings, my cell count, and "Resets Nov 1".
- Last month's champions.
- A legend.
- "How to claim: finish a run within 75 m of where you started; the enclosed area becomes yours; later loops steal cells."

**Preview** (`preview.ts`): for the recorder summary and the activity detail, it estimates claimable cells with even-odd point-in-polygon on cell centres. It is labeled "estimate; confirmed after sync". G2 may show it via `fetchActivityClaim` once synced; G4 exports `previewClaim(points)` for G2's optional use.

**Acceptance:**
- Unit tests:
  - `merge` (adjacent cells collapse, owners never merge, rows are correct);
  - `preview` against a square loop of known size (cell count within ±2 of the analytic value) and a figure-8;
  - super-cell aggregation;
  - `useTerritory` caching and debounce with fake timers.
- SQL tests (G0's `territory.sql`):
  - a claim, then a later loop steals;
  - an earlier `ended_at` cannot steal;
  - opt-out deletes cells;
  - a too-small loop does not claim;
  - out-of-box claims nothing;
  - archive idempotency.
- Device check: smooth panning with about 3 000 cells in view.

**Edge cases:** month rollover while the screen is open (refetch on period change), a truncated result (show "Zoom in to see all territory"), and a user with no color set.

---

## 6. Safety, privacy, abuse and anti-cheat

**Location minimisation**
- Raw fixes never leave the phone. Only filtered, smoothed points are uploaded, at 6 dp.
- Live location is never shared. Group sessions broadcast distance, time and state only.
- Raw traces are owner-only (RLS) and purged after **180 days** (O2).
- Public routes exist only per run with opt-in, trimmed server-side by 200–300 m per end, with randomised trims. The privacy copy says the gap still hints at a general area.
- Public cards and boards show the ET **date**, never the time of day.

**Territory is visible by design.** It is **on by default with an opt-out** (Addendum D supersedes the O3 default). Because the squares outline the looped area to about 50 m, every account sees a one-time notice with a "Turn off" action before anything is claimed: at nickname creation, otherwise on the first run's finish review, the Account page or the territory page. The server records the acknowledgement (`territory_notice_at`) and claims nothing until then. Cells within 300 m of a loop's start or finish are never claimed. Opting out deletes the user's cells.

**Identity**
- Email exists only in `auth.users`. It is never in public tables and never shown to others.
- Nicknames are visible to signed-in users. Boards are signed-in only (O6).
- Friends see weekly running distance. Group members see group boards and session results.

**Logs:** no coordinates, emails, push tokens or nicknames in client logs or the Edge Function. No analytics or crash SDKs are added.

**Delete my data:**
1. `delete_my_account()`: groups are handed over, then `auth.users` is deleted, which cascades to every row.
2. Local wipe (§3.4).
3. Sign out.

`delete from auth.users` from a definer function must be verified on this project. Fallback: a `delete-account` Edge Function using the admin API (decision for the lead if the check fails).

**Minors:**
- A 13+ confirmation at nickname creation (`age_required`). No birthdate is collected.
- No targeting of minors.
- Under-13 users are told they can't create an account. The COPPA rationale [ext] is a note for the user, not legal advice.

**Session storage:** the Supabase refresh token is kept in AsyncStorage [user]. It is unencrypted at rest; SecureStore would be a later hardening.

**Nickname and name filtering**
- Format: `^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$`.
- A reserved list.
- A banned-term substring match after leet folding (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s, !→i) and stripping non-letters. This blocks spaced-out evasions and accepts some false positives.
- Renames: one per 7 days.
- `private.banned_terms` is seeded by `20261021000900_review_fixes.sql` with a small, original, conservative list (long unambiguous slurs and obscenities; short fragments that appear inside ordinary names are left out). The lead may add a maintained public list (e.g. LDNOOBW, CC-BY-4.0); a third-party list needs attribution in `THIRD_PARTY_NOTICES.md`.

**Rate limits** (server, `private.rate_events`):

| Action | Limit per day |
|---|---|
| Submits | 30 |
| Friend requests | 20 (plus 50 pending outgoing and 200 friends) |
| Nickname attempts | 10 |
| Group creates | 5 (10 memberships, 50 members) |
| Group joins | 20 |
| Session creates | 10 (3 open per group) |
| Push-token registrations | 20 |
| Invite-code rotations | 5 |
| Group-code rotations | 5 |

Failed code lookups (unknown, blocked or own friend code; unknown group code) count toward the friend-request and group-join limits: the RPC returns the miss as a value, so the rate event commits.

Supabase Auth's own limits cover OTP sends and verifies.

**Anti-cheat** (server-authoritative, §2.5):
- Speed caps per segment.
- Effort floors.
- Median sample density ≤ 5 s.
- Gaps > 30 s break efforts.
- No future or old timestamps; the span must match the samples; no overlapping activities.
- Late uploads miss closed periods.
- Bike rides are never speed-ranked.

Known limit: GPS spoofing apps can fabricate plausible traces. We do plausibility checks only and say so. Flagged activities stay visible to their owner as "Not counted: ⟨reason⟩".

---

## 7. Test and verification plan

**Jest** (all WPs; no network)
- Pure logic carries the weight: filter, metrics, periods, grid, parking engine, merge and preview, parsers, sync, and message building.
- Render tests stay smoke-level.
- Fake timers for any polling or interval code (review S5 lesson).

**SQL** (`supabase/tests/*.sql`, run by the lead with MCP `execute_sql`, each wrapped in `begin; … rollback;`)
- Setup: insert two test users into `auth.users` inside the transaction, then `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'`.
- Checks:
  - **RLS:** B cannot select A's activities, traces, efforts or `profile_private`; `anon` selects nothing and cannot execute RPCs.
  - **`submit_activity`:** rejects non-monotonic, future and overlap; computes efforts on the fixture (parity); trims (`ST_Distance` from each `public_path` end to the trace's start/end ≥ 199 m along-route proxy).
  - **Boards:** ranking, ties, the friends and group scopes, and me-row append.
  - **Overtake:** row created once.
  - **Territory:** claim, steal and opt-out.
  - **Archive:** idempotency (`archive_board_period` twice gives one set of rows).
- Then `get_advisors` for security and performance.

**Device-only checks** (Expo Go on the user's iPhone; record what was observed in an addendum, as review B1 required)
- OTP email arrives and contains the code; verify works; the session persists across restarts.
- The supabase-js URL / realtime spike result.
- GPS accuracy on a known route (±3 %); auto-pause; keep-awake; lock and background gap reporting.
- Push: a token appears only after `npx eas-cli init` (free Expo account); delivery end to end; tap routing; a local fallback banner while foreground.
- Haptics on reroute; the Apple Maps cycling URL.
- Realtime session on two phones.
- Territory render performance; the four-tab layout at 375 pt; dark mode.
- Battery drain over a 30 min recording: measure and report. Do not estimate.

---

## 8. Risks and open decisions

**Open decisions (default in bold):**
- **O1 Email.** **Ship with built-in SMTP for the user only, and configure custom SMTP (Resend free tier) before inviting friends.** Built-in sending allows only a few emails per hour per project.
- **O2 Raw trace retention.** **180 days**, then only the summary and efforts remain, plus the public path if shared. Alternatives: 30 or 365 days, or until deletion.
- **O3 Territory participation.** **Opt-in, default off.** It inherently reveals where you loop. *Superseded by Addendum D: on by default with an opt-out, a one-time notice and a 300 m start/finish zone.*
- **O4 Units.** **Miles and min/mi by default**, matching Teal's `formatDistance`. Standard efforts stay 1K/5K/10K.
- **O5 Friend links.** Expo Go links are `exp://…` and only work for people on the same dev server, so the **invite code is primary**. A `teal://friend/CODE` link works only in a future dev build.
- **O6 Visibility.** **Boards and featured runs are visible to signed-in users only.**
- **O7 Web demo.** **No accounts or recording on web**, so strangers cannot trigger auth emails.
- **O8 Overtake frequency.** **Once per friend pair per week.**

**Risks**
- **No-op push before setup.** Push does nothing until `eas init`, the Vault secrets and the function secret are all set; this degrades to the inbox.
- **Unverified items:**
  - whether supabase-js needs a URL polyfill on Hermes (G0 spike);
  - the Apple Maps cycling URL;
  - `delete from auth.users` permission;
  - the Edge Function service-key env name;
  - expo-notifications handler fields in SDK 57.
- **Foreground-only recording** loses distance whenever the user leaves the app. This is mitigated by clear copy and the background-ready design.
- **Client/server metric drift** is mitigated by identical rules, rounding before computing, and fixture parity tests.
- **Free-plan limits:** Postgres size and Edge Function invocations. The traces are the largest data: about 0.3 MB per hour of activity before compression.
- **Map performance:** large territory and track overlays on MapKit. Mitigated by run-length merging, a 600-polygon cap, and 500-point tracks.
- **G0 is large and serial.** The checkpoint after migrations lets the lead review SQL before client work starts.

---

## Addendum D — User decisions (2026-10-20), authoritative over §8 defaults

- **O1 email:** Supabase built-in email for testing only; custom SMTP before inviting friends (lead/user task).
- **O2 retention:** raw GPS traces kept **180 days**; summaries/records kept until account deletion.
- **O3 territory:** **ON for everyone by default** (user's choice). Keep a per-user **opt-out** toggle in settings (default on), honored server-side by the claim RPC; claimed cells are shown only as grid cells (never the raw loop) and the existing 200–300 m endpoint trimming rules still apply to any shared route.
- **O4 units:** **miles**, pace in min/mi; leaderboard race distances stay 1K / 5K / 10K.
- **O5 friends:** invite code is the primary add-friend path.
- **O6 visibility:** leaderboards and featured runs readable by **signed-in users only**.
- **O7 web demo:** no accounts or recording on web.
- **O8 overtake push:** at most once per friend per week.

## Release checklist (review fix pass, 2026-10-20)

- `select count(*) from private.banned_terms` > 0 (the built-in seed has 34 terms; add a maintained list with attribution if wanted).
- PostgREST "Max rows" (Dashboard → API settings) is ≥ 1000, the `get_territory` page size.
- All `supabase/tests/*.sql` pass via `execute_sql` (each rolls back); `get_advisors` security shows only the intended `authenticated_security_definer_function_executable` WARN and `rls_enabled_no_policy` INFO.
- Realtime channel RLS for inserts is checked only through the policy predicate in `rls.sql` (the test transaction cannot create a `realtime.messages` partition); confirm on two phones that a non-member cannot join a session channel.
