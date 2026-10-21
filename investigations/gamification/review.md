# Teal gamification release: pre-ship review

Reviewer: rea-evidence-reviewer. Date: 2026-10-20.
Scope: `supabase/migrations/*`, `supabase/tests/*`, `supabase/functions/send-push/*`, and the client modules and routes listed in the task, against `spec.md` and Addendum D (authoritative).
Method: a static read of the source, plus the three commands below. I did not run the SQL tests, query the database, deploy anything, or run on a device. Every runtime claim below is labeled as **static inference** unless it comes from the command output.

## Commands run (real output)

| Command | Result |
|---|---|
| `npx jest` | `Test Suites: 84 passed, 84 total` · `Tests: 773 passed, 773 total` · `Time: 6.511 s` · exit 0. Two suites print `console.warn expo-notifications: Android Push notifications (remote notifications) functionality provided by expo-notifications was removed from Expo Go with the release of SDK 53…` (from `src/notifications/index.ts:10`, through `src/backend/auth.ts:12`). |
| `npx tsc --noEmit` | no output, exit 0 |
| `npx expo lint` | `env: load .env` · `env: export EXPO_PUBLIC_MBTA_API_KEY EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY EXPO_PUBLIC_SUPABASE_URL` (variable names only) · exit 0 |

Not run by me: the `supabase/tests/*.sql` scripts, `get_advisors`, `expo-doctor`, the exports. The lead reports these pass.

## Summary

- **1 Blocker**: territory is on by default, but the app tells users their loop is "never shown". The claimed squares trace the loop at about 50 m resolution, and users get no notice before their first loop is published.
- **8 Should fix**: PostgREST's 1000-row cap breaks the territory layer; failed attempts are never rate-limited, so invite codes can be guessed without limit; the recorder can get stuck after a failed recovery; the territory edge undoes the shared-route trimming near the start; account deletion and the retention job have no tests; one RLS test proves nothing; the banned-terms list is empty until loaded; group-code rotation has no rate limit.
- **Clean-room and data handling**: no secrets, tokens, real emails or captured personal data were found in the project or the investigation files. `.env` is git-ignored. `.env.example` holds placeholders only (checked by length and pattern; values not printed).
- **Privacy core holds statically**:
  - RLS is on for every table.
  - Raw traces are owner-only.
  - Emails exist only in `auth.users`.
  - Live session broadcasts carry no coordinates.
  - Shared routes are trimmed server-side.
  - Every `public`/`private` function pins `search_path = ''`.
  - `anon` has no table or RPC access.
  - The Edge Function compares its secret in constant time and logs only counts.

---

## Blocker

### B1. Territory privacy copy is inaccurate, and nothing is disclosed before the first loop is published
- **Where:**
  - `src/features/account/AccountScreen.tsx:16-17` (`TERRITORY_EXPLANATION`: "Your loop and route are never shown.").
  - `supabase/migrations/20261021000200_profiles_notifications.sql:19` (`territory_opt_in default true`).
  - `supabase/migrations/20261021000700_territory.sql:71-85` (claims every cell whose centre lies inside the loop polygon).
  - `src/features/account/NicknameScreen.tsx` and `src/features/record/*`: no territory notice.
- **What I observed:**
  - The claimed cells are the interior of the closed loop. The outline of a user's squares is therefore the loop itself, to about 50 m.
  - The start/end point sits on that outline.
  - Under Addendum D everyone is opted in. The only explanation lives on the Account page, so the first loop a user runs is published under their nickname before they have seen any notice.
- **Why it matters:**
  - Addendum D allows territory on by default and requires that "claimed cells are shown only as grid cells (never the raw loop)". The code meets the letter of that.
  - The user-facing claim, though, is false.
  - The spec's own rationale (§8 O3) says territory "inherently reveals where you loop".
  - Spec §6 required "The explanation is shown before enabling it", and with default-on there is no such moment.
- **Fix:**
  1. Change the copy to something accurate. Example: "Your squares outline the area you looped, so they show roughly where you ran (to about 50 m), including near your start."
  2. Show the territory notice once, with a "Turn off" link, on the nickname screen (new accounts) or on the first record finish of a loop-eligible run, before the first sync.
  3. The cheap structural fix is in S4.

---

## Should fix

### S1. The territory layer silently drops cells beyond 1000; "Zoom in" never appears
- **Where:**
  - `src/territory/api.ts:19, 73` (`truncated` when `length >= 20_000`).
  - `supabase/migrations/20261021000700_territory.sql:114-132` (`limit 20000`).
  - Spec §2.4 and §4 claim "≤20 000 rows".
- **What happens (static inference):** Supabase's PostgREST caps every response at its "Max rows" setting, which defaults to 1000. That cap applies to set-returning RPCs too. So `get_territory` returns at most 1000 cells; I have not verified this project's setting. The client never reaches 20 000, never shows the truncated notice, and silently draws a partial map. 1000 cells is about 2.5 km².
- **Fix:** Take one of these, then add a test asserting the client's threshold equals the server's page size:
  - (a) Page with `.range()` (or a `p_after_cell` cursor) until fewer than a page comes back, up to 20 000.
  - (b) Lower the server `limit` to 1000 and set `TERRITORY_ROW_LIMIT = 1000`, so truncation is detected.
  - (c) Raise "Max rows" in the dashboard and record it in the spec.

### S2. Failed attempts never count toward rate limits, so code guessing is unlimited
- **Where:**
  - `supabase/migrations/20261021000100_extensions_private.sql:66-75`. The rate event is inserted in the caller's transaction, and the comment says a call that raises rolls it back.
  - Callers: `send_friend_request` (`…000300_social.sql:132-142`) and `join_group` (`…000300_social.sql:271-273`).
- **What happens:** A wrong invite code or group code raises `not_found`, which rolls back the rate event. Only successful requests are throttled.
  - Codes are 40-bit (8 characters from a 32-letter alphabet; `new_code` is uniform). That is strong against online guessing *if* failures are limited, and they are not.
  - A guessed friend code auto-accepts (`:149-155`), which exposes the target's weekly running distance and enables overtake pushes.
  - A guessed group code exposes group members, sessions and results.
- **Fix:** Make the lookup-failure path commit. For example, return `'not_found'` as a value (`returns text` / jsonb status) instead of raising, so the `rate_events` row persists. Alternatively, record failures through a separate committed path. Then add a SQL test: 21 bad codes in a day must give `rate_limited`.

### S3. The recorder gets stuck "recording" with no GPS after a failed crash recovery
- **Where:** `src/activity/recorder.ts:566-571` (recover `'resume'`: when `acquire()` fails, it sets `phase = 'paused'` and returns, without `startRuntime()`, a filter or a lease) and `:486-496` (`resume()` only flips the phase).
- **What happens:** If location permission or services are off when the user resumes an unfinished run, tapping Resume shows "Recording" forever.
  - `filter` is `null` and no lease exists, so `onFix` drops everything (`:278`).
  - The persist timer and the AppState listener are not running either.
- **Fix:** In `resume()`, when `release === null` or `filter === null`:
  1. Re-run `acquire()`. On failure, surface the hub error.
  2. On success, call `startRuntime()` and `beginRecording(startedAt)` (keeping the existing points).
  3. Add a recorder test for "recover resume with permission denied, then grant, then resume".

### S4. Territory undoes the 200–300 m start/finish trimming of shared loop routes
- **Where:** `…000700_territory.sql:44-91` versus `…000400_activities.sql:76-102`. The copy is in `src/features/record/recordModel.ts:27` ("Start and finish (~200–300 m) are hidden").
- **What happens (static inference):**
  - For a shared loop, the public path ends 200–300 m along the route on each side of the start.
  - The territory blob edge fills in the missing stretch at about 50 m resolution.
  - The start is thereby narrowed from a disc of about 300 m radius to a short stretch of the blob edge.
  - Addendum D says "the existing 200–300 m endpoint trimming rules still apply to any shared route". Today they no longer protect the start for loops.
- **Fix:** In `claim_territory`, exclude cells whose centre lies within 300 m of the loop's start or end point. This acts as a privacy zone: compute `st_dwithin(cell_centre::geography, st_startpoint(v_line)::geography, 300)`. Mirror the rule in `src/territory/preview.ts`, add a `territory.sql` case for it, and mention it in the B1 copy.

### S5. Account deletion and the 180-day retention job have no tests
- **Where:**
  - `…000200_profiles_notifications.sql:188-197` (`delete_my_account`).
  - `…000800_cron_and_grants.sql:2-9` (`apply_retention`).
  - Nothing in `supabase/tests/` calls either one.
- **What I checked statically:** the cascades cover every table with user data:
  - `profiles` → `profile_private`, `push_tokens`, `notifications` (recipient and actor), `friendships`, `blocks`, `group_members`, `participants`, `activities` → `traces`/`efforts`/`cells`/`claims`, `leaderboard_archive`, `territory_champions`.
  - Owned groups are handed over first.
  - `private.rate_events` has no FK and stays for up to 2 days.
- **What remains unverified (spec §6 and §8 flag it):** whether `delete from auth.users` is permitted from this definer function on this project.
- **Fix:**
  1. Add a rolled-back SQL test. Create a user with an activity, a trace, cells, a friend, a notification and an owned group. Call `delete_my_account()` as that user. Assert zero rows for that id in every table above, and assert the group has a new owner.
  2. Add a retention test: insert a trace with `created_at = now() - 181 days`, run `private.apply_retention()`, and assert it is gone while a 179-day trace stays.
  3. Optionally delete `private.rate_events` for the user inside `delete_my_account`.

### S6. One RLS test passes without testing anything
- **Where:** `supabase/tests/rls.sql:37`. `get_my_activity_track((select id from public.activities limit 1))` runs as B, who cannot see A's row, so the argument is `NULL` and the assertion holds trivially.
- **Fix:** Fetch A's activity id as postgres first (the pattern at `:58-60`) and pass it in. Add the same cross-user checks for:
  - `get_activity_claim`;
  - `get_session_results` / `get_group_members` / `get_group_session` from a non-member;
  - `realtime.messages` select/insert on another group's `session:<id>` topic.

### S7. Nickname and group-name filtering is empty until the lead loads the banned-terms list
- **Where:** `…000200_profiles_notifications.sql:31` (`private.banned_terms` created empty) and `:75-84`.
- **What happens:** Until the list is loaded, only the format and reserved-name checks apply. This also covers group names and session titles, which go out in push text (`messages.ts:94-98`). I could not check whether it has been loaded (no DB access).
- **Fix:** Add a release-checklist line ("`select count(*) from private.banned_terms` > 0"). Also add `THIRD_PARTY_NOTICES.md` attribution for the chosen list, as spec §6 requires.

### S8. `rotate_group_code` has no rate limit, and the spec's limit table is incomplete
- **Where:** `…000300_social.sql:302-309`. Compare `rotate_invite_code` at `:205` and the spec §6 "Invite-code rotations 5/day".
- **Fix:** Add `perform private.hit_rate_limit('rotate_group_code', 5, interval '1 day');`. Owner-only already limits abuse, so this is mainly about spec parity.

---

## Note

**Privacy and security**
- N1 — `public.profiles` is readable whole by any signed-in user, including `created_at` (`…000200:66`). Fine by design (nicknames are public). Consider a view or RPC that omits `created_at`.
- N2 — `register_push_token` re-binds an existing token to the caller (`…000200:170-171`). This is correct for device hand-over. If an offline sign-out failed to unregister, the old account keeps getting pushes on that device until another user signs in. Acceptable; document it.
- N3 — Session results show other members' `flagged` status (`…000500:154`). Spec §4 includes it, but §2.5 calls flagged "private". Pick one; returning `null` instead of `'flagged'` to non-owners is the safer choice.
- N4 — Realtime broadcast payloads are self-asserted. Any group member can broadcast `status: ended`, which makes other clients `stopFollowing` (`src/social/sessionRuntime.ts:58-61`). They can also broadcast progress under another `userId` (`sessions.ts:132-140`). The page re-reads the server on status, so the impact is cosmetic. Fixes:
  - ignore `ended` until `getSession` confirms it;
  - drop progress whose `userId` ≠ the presence key.
- N5 — `friend_accepted` rows ignore `notify_friend_requests` at insert (`…000300:153, 178`). The Edge Function respects the setting, but `inboxWatcher.deliver` (`src/social/inboxWatcher.ts:58-66`) shows a local banner whatever the preference is.
- N6 — The Edge Function handles tickets only, not push receipts (`index.ts:149-166`). Most `DeviceNotRegistered` results arrive in receipts, so stale tokens linger. Add a receipts pass in the sweep later.
- N7 — `…000800:25-32` grants on existing objects only. Add `alter default privileges in schema public revoke execute on functions from public, anon;` (and the same for tables from anon), so a future migration that forgets the sweep doesn't expose anything.
- N8 — Shared device: `signOut` (`src/backend/auth.ts:302-313`) keeps the local activity index. `useActivities` (`src/activity/store.ts:324-337`) lists every local activity whatever its owner, so the next account on the device sees the previous user's runs and tracks. Fix: filter by `ownerUserId ∈ {me, null}`, or wipe on sign-out.
- N9 — `submit_activity` range-checks lat/lon only for points 2..n (`…000400:177-181`). Point 1 can be NaN or out of range. Add `la[1]`/`lo[1]` to the check.

**Correctness**
- N10 — `archive_closed_periods` and `archive_territory` run as one cron command (`…000800:19-20`). If the first fails, the second is skipped in the same transaction. Schedule them as two jobs.
- N11 — A single `leaderboard_eligible` flag means a run on the last day of a month whose week continues is excluded from *both* boards once the month closes (`…000400:230-232`). This matches the spec; a per-period flag would be fairer.
- N12 — The client never enforces the server's limits (6 h span, 20 000 points, 30 days old, `ended_at ≤ now()+2 min`). A run that breaks one is permanently `rejected` after the user has recorded it (`recorder.ts:446-475`; `…000400:147-158`). This includes a long ride at about 1 point/s, a signed-out recording uploaded after 30 days, or a phone clock more than 2 min fast. Fixes:
  - stop at 6 h;
  - decimate to ≤ 20 000 points before upload;
  - warn on old signed-out recordings.
- N13 — The server's `elapsed_ms = t[n]` includes manual pauses. The live recorder's elapsed time excludes them (`recorder.ts:153`), so the number jumps after sync.
- N14 — Idempotent retry returns the stored summary and ignores a changed `share_route` (`…000400:136-137`). If a submit committed but its response was lost, a local "unshare" before the retry flips back to shared. It is visible, not silent; call `set_activity_sharing` after sync when the local flag differs.
- N15 — Deleting a local activity while it is uploading (`store.ts:362-376`, with `syncState` `pending`) can leave the server copy. It then reappears as a "remote" item.
- N16 — Parking polls every 45 s while the app is in the foreground, whatever screen is shown (`parking/session.ts:214-217`, `startPolling`). The spec says "while focused". This is probably intended, since the active-mode pill stays; update the spec.
- N17 — `block_user` with an unknown id raises an FK error, which maps to `unknown` (`…000300:192-199`). Check that the profile exists and return `not_found`.
- N18 — The friend cap (200) is checked for the requester only, not the target (`…000300:148`).
- N19 — Featured routes are not thinned to the 500-point overlay cap (`src/social/leaderboards.ts:115`, `LeaderboardsScreen.tsx:176`). Use `thin()` or `recentPath` as `ActivityDetailScreen.tsx:120` does.
- N20 — Supabase's `email_address_invalid` auth code maps to `unknown` (`src/backend/errors.ts:98-113`). Map it to `invalid_payload`, so the "Enter a valid email" copy shows.

**Expo Go and web**
- N21 — I checked the supabase-js URL-polyfill risk (G0 spike) statically.
  - supabase-js 2.118 assigns `realtimeUrl.protocol`.
  - React Native's own `URL` has no `protocol` setter.
  - Expo installs its own WHATWG `URL` global on native (`node_modules/expo/src/winter/runtime.native.ts:21`), so the assignment should work.
  - This is static inference only. The spike result is still not recorded in a spec addendum as §5 G0 step 2 requires. Record it after the first device run.
- N22 — On web, `/record` and `/activities` deep links render the native UI. Recording then fails with "GPS isn't available" (`acquireFixes` returns `unavailable`) rather than the "In the iPhone app" panel. Add the `Platform.OS === 'web'` panel to `RecordScreen` (`src/features/record/RecordScreen.tsx:27`) and `ActivitiesScreen`, as `ParkingScreen.tsx:44` does.
- N23 — Importing `expo-notifications` on Android Expo Go logs the SDK 53 warning (seen in the Jest output). It does not crash, which is acceptable since Android is not targeted.
- N24 — Push degrades correctly without an EAS projectId. `pushGate` returns `noProjectId` (`src/notifications/index.ts:43-49`), and the inbox watcher then shows local banners.

**Integration gaps between the builders**
- N25 — `previewClaim` / `previewClaimText` (`src/territory/preview.ts:177, 193`) are exported but never used. The record summary and the activity detail show no territory estimate (spec G4 "Preview"). This was optional in the spec, but wiring it into the finish summary is the natural place for the B1 notice.
- N26 — `useInboxWatcher` (`src/social/inboxWatcher.ts:46`) is dead code. The watcher is started once, in `AppShell.tsx:45`, which is correct. Remove the hook.
- N27 — Crash recovery is offered only on the Move hub (`MoveHome.tsx:75`). On `/record` the user gets "Resume or save your unfinished recording first." with no buttons (`recorder.ts:450`). Render the same recovery card on `RecordScreen`.
- N28 — Duplicated rules:
  - The nickname regex appears in `src/backend/auth.ts:50` and `src/social/friends.ts:73`. Export one.
  - The reserved-name list is duplicated in client and SQL (`auth.ts:45-48`, `…000200:26-28`). Acceptable, but add a test that compares them.
- N29 — `inboxWatcher.ts:16` imports `../../supabase/functions/send-push/messages`. That pulls an Edge Function file into the app bundle and the typecheck, even though `tsconfig.json` excludes `supabase/functions`. It works because the file has no imports. Keep it pure, and say so in its header (it already does).

**Spec versus code**
- N30 — `investigations/gamification/schema.sql:110` still says `territory_opt_in default false`, and the migrations say `true`. The spec's body also still says "default false" (§2.2 at `spec.md:92`, §6 at `:902`) and "the full SQL is in schema.sql" (`:5, :70`). Mark `schema.sql` as superseded by `supabase/migrations/`, or regenerate it. Add a one-line note in §2.2 and §6 pointing to Addendum D.
- N31 — `client.ts` drops the spec's `lock: processLock` (documented in a comment at `src/backend/client.ts:30-33`). Record the deviation in the spec.
- N32 — Spec §2.4 says `get_territory` returns ≤ 20 000 rows. In practice that depends on PostgREST "Max rows" (S1).
- N33 — The "advisors clean" claim (G0 acceptance) is not reproduced here. I had no DB access.

## Coverage of the requested areas

| Area | Status |
|---|---|
| RLS on every table; raw traces owner-only | Answered: yes, static (`…000200:58-72`, `…000300:65-106`, `…000400:55-60`, `…000500:11-12`, `…000700:33-37`) |
| No path to another user's raw GPS, email or exact loop | Partial: no raw GPS or email path. Territory cells outline loops (B1, S4). |
| Definer RPCs check `auth.uid()` and inputs; `search_path` pinned; grants | Answered: yes, with minor input gaps (N9, N17). Default privileges in N7. |
| Delete-my-account removes everything | Partial: cascades complete statically; runtime permission untested (S5) |
| 180-day retention actually deletes | Partial: code is correct; no test (S5) |
| No emails, tokens or traces in logs; Edge secret; no service key on the client | Answered: yes |
| Push payloads contain no sensitive data | Answered: nicknames, group names, titles and distances only (per spec) |
| Rate limits, nickname filter, unguessable codes | Partial: S2, S7, S8 |
| ET period boundaries | Answered: server `date_trunc` in ET (`…000100:34-46`) matches `src/activity/periods.ts`. DST tests exist per the builders; I did not re-derive them. |
| Bluebike never speed-ranked | Answered: yes (efforts are runs-only `…000400:203`; bike boards are distance-only `…000500:35-43`) |
| Opt-in sharing end to end | Answered: yes, except N14 |
| Overtake once per friend per week | Answered: yes (dedupe key `…000600:60`; `social.sql:149`) |
| Territory conflicts and monthly reset | Answered: later `ended_at` wins (`…000700:82-84`); reset by `month_start` key plus `archive_territory` |
| Client/server metric parity | Answered: same rules; parity constants shared (`metrics.test.ts:93`, `submit.sql:54-59`); elapsed differs (N13) |
| Offline sync idempotency | Answered: unique `(user_id, client_id)` plus a serial queue; edge cases N14, N15 |
| Recorder state machine | Partial: S3, N12, N27 |
| Parking re-route | Answered: matches the spec (`src/parking/engine.ts:79-133`) |
| OTP error states | Answered: mapped (`src/backend/errors.ts:98-113`); minor N20 |
| Expo Go and web compatibility | Answered: N21–N24 |
| Integration gaps | Answered: N25–N29 |
| Spec versus code | Answered: N30–N33, S1 |

No device testing has been done (stated by the lead, and confirmed: there is no device addendum in the spec). Treat every runtime statement above as unverified until the spec §7 device checks run.

---

## Fix pass

Builder: rea-feature-builder, 2026-10-20. Earlier migrations were left unchanged. Every database change is in `supabase/migrations/20261021000900_review_fixes.sql`, applied with MCP `apply_migration` (recorded as `review_fixes`, the 9th migration). Territory stays **on by default** (Addendum D).

| Finding | Change | Verification |
|---|---|---|
| **B1** Territory copy and notice | One accurate explanation, `TERRITORY_EXPLANATION` in `src/features/territory/TerritoryNotice.tsx`. It says the squares outline the looped area to about 50 m and that the 300 m start/finish zone is never claimed. Account, the territory page and the nickname screen all use it; the "never shown" copy is gone. A one-time notice with a **Turn off** action: on the nickname screen at account creation (a switch, on by default); otherwise on the first run's finish review (saving records it before the run syncs); otherwise on Account or the territory page. **Server gate:** new `profile_private.territory_notice_at`, set through `set_my_settings({territory_notice_seen: true})` and exposed by `get_my_profile`. `claim_territory` claims nothing until it is set, so no loop is published before the notice. | `territory.sql`: no claim before the notice; `false` does not un-see it. Jest: nickname notice and choice (`account.test.tsx`); review-card notice and the notice-then-finish order (`RecordScreen.test.tsx`); territory page turn-on. |
| **S1** Row cap | `get_territory` gains `p_after` and `p_limit`, orders by `cell_id` and caps a page at 1000. `fetchTerritory` pages by cursor until a short page, up to `TERRITORY_MAX_CELLS` (20 000). It sets `truncated` only when it stops at the cap after a full page. A failed page fails the whole fetch, so no partial map is drawn. | `territory.sql` paging (pages join to the full set). Jest: 2500 cells over 3 pages; exactly 1000 cells; the cap gives `truncated: true`; a failed page fails the fetch. A test reads the migration and asserts the server cap equals `TERRITORY_PAGE_SIZE`. |
| **S2** Rate limits on misses | `send_friend_request` returns `'not_found'` and `join_group` returns `null` instead of raising, so the attempt's `rate_events` row commits. Requests by code still auto-accept: spec §5 G3 requires it ("sharing the code is consent"). The client maps both misses to `not_found`. | `social.sql`: the 21st friend-request attempt and the 21st join attempt give `rate_limited`. Jest: value-to-error mapping. |
| **S3** Recorder stuck "Recording" | A recovery resume whose GPS fails stays **paused**, with a new `gpsStopped` warning (plus permission or services) and the error returned. `resume()` re-acquires GPS when there is no lease; on failure it stays paused and returns the error. On success it starts the runtime and the filter, then records. RecordScreen shows the banner and the error. The recovery card is now also on `/record` (N27). | Jest `recorder.test.ts`: recover with permission denied, Resume fails, grant, Resume records, finish releases the lease. `RecordScreen.test.tsx`: banner, error and recovery card. |
| **S4** Start/finish zone | `claim_territory` skips cells whose centre is within 300 m (haversine `private.ll_dist_m`) of the trace's first or last point. `preview.ts` has the same rule (`outsidePrivacyZone`), and status `nearStartOnly` covers a loop left with no squares. | `territory.sql`: no claimed centre within 300 m of the start. The 400 m test square now claims 35 cells (64 before). Jest parity: the client's cell ids for B's loop equal the 35 ids the server claimed. |
| **S5** Deletion and retention tests | New `supabase/tests/account.sql`. `delete_my_account` (now also clears `private.rate_events`) removes rows from every table, and the group passes to the remaining member. A 181-day trace is purged; a 179-day trace and the summaries stay. | Passed. `delete from auth.users` from the definer function **works on this project** (the spec §6 open item). |
| **S6** RLS tests | `rls.sql` reads A's ids as postgres. B (a non-member) gets no track, no claim, no group or session rows, and `not_member`/`not_found`/`forbidden` from members, session, results, join and status. Positive controls run as A. Realtime: the channel predicate is false for B and true for A on A's session topic, and the two `realtime.messages` policies are checked. | Passed. **Limit:** inserting into `realtime.messages` can't be exercised. The table has no partition yet, routing fails before RLS (`23514`), and `postgres` may not create one. Listed in the spec release checklist. |
| **S7** Banned terms | The migration seeds 34 original, conservative terms. Short fragments that appear inside names are left out (ass, cum, shit, coon, nazi and others). No third-party list was added, so `THIRD_PARTY_NOTICES.md` is unchanged. A release-checklist line was added to the spec. | `social.sql`: "F4ggot Club" gives `name_invalid` (leet folding). `select count(*)` = 34. |
| **S8** Group-code rotation | `rotate_group_code`: an owner check, then `hit_rate_limit('rotate_group_code', 5, '1 day')`. Spec §6 table updated. | `social.sql`: a non-owner gets `forbidden`; the 6th rotation gives `rate_limited`. |
| N10 | `teal-rollover` split into `teal-rollover-boards` and `teal-rollover-territory`. | `cron.job` lists both. |
| N20 | `email_address_invalid` is mapped to `invalid_payload` ("Enter a valid email address."). | tsc and jest |
| N22 | `/record` and `/activities` show the "In the iPhone app" panel on web. | iOS export only; the web render was not run. |
| N25 | `previewClaim` is wired into the record summary (the saved-run card) for signed-in, opted-in, notice-seen loop runs. | jest (`preview.test.ts`) |
| N26 | The dead `useInboxWatcher` was removed. | tsc |
| N30 | `schema.sql` is marked superseded. Spec §2.1, §2.2, §2.4, §2.7, §6 and §8 O3 now point to Addendum D and the review-fix migration. | — |

**Commands (real results, run from `teal/`)**
- `npx jest`, twice: `Test Suites: 84 passed, 84 total` · `Tests: 784 passed, 784 total`, both runs (6.8 s and 6.6 s).
- `npx tsc --noEmit`: exit 0, no output.
- `npx expo lint`: exit 0. The output is only the `env:` load lines, which list variable names only.
- `npx expo-doctor`: `21/21 checks passed. No issues detected!`
- `npx expo export --platform ios --output-dir …/scratchpad/fix2-ios`: bundled `entry-….hbc (5.5MB)`, exit 0.

**SQL tests** (MCP `execute_sql`, each rolled back; the file contents were run without their comment lines): `rls.sql`, `submit.sql`, `boards.sql`, `social.sql`, `territory.sql` and `account.sql` all printed `<file> passed`. Asserts were confirmed live: `assert false` raises P0004.

**Advisors** (`get_advisors`)
- Security:
  - WARN `authenticated_security_definer_function_executable`: the intended one, for the 36 public RPCs, including the recreated `get_territory`.
  - INFO `rls_enabled_no_policy`: 5 tables, intended.
  - No ERROR and no anon-executable function.
- Performance: one INFO, `unused_index` (`activities_session`).

**Types:** `src/backend/database.types.ts` was updated to match `generate_typescript_types`: `territory_notice_at` and the new `get_territory` arguments.

**Not done or not verified**
- Device checks (spec §7), including the notice flow and Resume on a real permission prompt.
- The realtime insert path.
- The PostgREST "Max rows" project setting. The client assumes it is ≥ 1000; this is in the release checklist.
- The web panels have not been rendered on web.
- Notes not listed above were skipped.
