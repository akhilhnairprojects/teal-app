---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "Teal makes your Boston commute simple: the next T and the nearest Bluebike, live, in one glance"
destination: social-feed
aspect: 1080x1080
language: en
audience: Boston commuters and students who ride the T and Bluebikes
length: 30s
angle: brand-mood
narration: yes
vo_mode: restructured
---

## Intent

A ~30s promo for Teal, a Boston commute iPhone app, for Instagram / LinkedIn / X
feeds. Sell, not tour: market the app, using real captured screens from the live
app as the hero visuals. Angle chosen by the user: "Your Boston commute, in teal"
— brand-first mood piece where the city, the motion, and the teal identity carry
the feeling, with the live T arrivals and Bluebikes availability as the proof.

## Assets

- http://localhost:8081 — the running Teal app (Expo web build, preview server
  "teal-web"); capture its screens (The T section, Bluebikes section, header
  with "teal." wordmark and live badge) as the featured assets.

## Customizations

- Design: reuse the Teal app theme. Background #EEF7F6 (light) / #061412 (dark);
  surface #FFFFFF / #0D211E; text #0B1F1E / #E6F4F2; brand #0D9488;
  brandDeep #0B4F4A; mint #5EEAD4; brandSoft #CCF1EC. Font: Manrope 400–800.
  Wordmark "teal." lowercase ExtraBold with the dot in teal.
- Audio: music bed plus a generated voiceover; we write the script (~70 words).

## Notes

- Hide the location-fallback line ("Showing Park Street · Location permission is
  off") from captured screens.
- Real MBTA line colors (Red #DA291C, Orange #ED8B00, Green #00843D) appear in the
  app's line pills; keep them as-is.
- Payment/unlocking happens in the Bluebikes app; don't imply Teal rents bikes.

---

## v2 — feature breakdown (2026-10-26)

workflow: launch (hyperframes `references/types/launch.md`)
flow: automation
storyboard: yes
message: "Teal runs your whole Boston day: the T, Bluebikes, finding a dock, and your runs, in one app"
destination: social-feed (LinkedIn / X)
aspect: 1080x1080
length: 45s
narration: yes (voiceover that covers both the day story and the feature breakdown)
angle: hybrid of "feature rundown" and "a day with Teal" (the user asked for both)
screens: Claude captures them (web screens from the running app; iPhone-only screens rendered
  from the app's real components with sample data in a temporary capture route that is not shipped)

### Features to cover (facts from the app code, 2026-10-26)

1. Live T arrivals near you (Red, Orange, Green, Blue), per-car crowding on trips
2. Nearby Bluebikes: classic, electric and open docks
3. Trip planner: T, Bluebike, mixed or walk, with the weather
4. Find a dock: say your destination; Teal picks a dock with room plus a backup, re-routes if it
   fills, and reads updates aloud
5. Record a run or a Bluebike ride, no account needed
6. Too-fast check: a warning, then the run is deleted if it keeps going (fair leaderboards)
7. Territory: finish a loop and claim the ~50 m squares inside it, no account needed
8. Leaderboards and friends, with Sign in with Apple or Google

v1 (the 30 s "Your Boston commute, in teal" promo above) stays in git history and in
`public/teal-promo.mp4` until v2 replaces it.

### Review changes (2026-10-26)

The user cut feature 6 (too-fast check: "a negative/security measure as opposed to something that
promotes running"), asked for real names off the leaderboard, and asked to focus on building a
community of runners. Final: 7 features, the last one "Run with your crew", end line "Run Boston,
together", 42 s. Voice: free on-device Kokoro (af_heart). Sign-in shot skipped.
