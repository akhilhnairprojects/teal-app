# SPEC — v2 "One day, seven taps" (2026-10-26)

> Final cut after review: 7 beats + end card, 42 s. The too-fast beat (06 below) was removed, the
> leaderboard names changed, beat 07 became "Run with your crew" (leaderboard → friend request →
> friends), and the end line became "Run Boston, together". Exact timings live in scripts/v2-data.mjs.

GOAL:    a LinkedIn / X viewer follows one Boston day and comes away knowing the eight things Teal
         does, ending on "teal." and wanting to try it.
OUTPUT:  HyperFrames, 1080 x 1080, 30 fps.
TIME:    ~45 s x 30 = ~1350 frames. The voiceover is the clock: each beat starts on its line, each
         title lands on the word that names it. Beat times below are estimates until the voice is
         generated, then re-timed to its word timings.

LOOK:    the app's own theme, one world that changes with the time of day.
         - Ground: flat colour, no gradient, no texture. Morning 7:42 #CCF1EC → 8:05 #EEF7F6 →
           8:25 #FFFFFF; evening 6:30 PM #0B4F4A → 6:48 #0D211E → 7:02 #061412 → 7:10 #061412;
           end card #0B4F4A. The ground tweens over 0.6 s at each beat change, never a cut.
         - Ink: #0B1F1E on light grounds, #E6F4F2 on dark. Accent: #0D9488 on light, #5EEAD4 on dark,
           only on the counter's current number, the time chip dot, the end-card dot.
           MBTA line colours appear only inside captured screens.
         - Type: Manrope (assets/fonts). Counter numerals 800, 200 px, -4% tracking. Feature title
           700, 60 px, -2% tracking, max 2 lines, max 4 words a line. Time chip 700, 30 px, uppercase
           +6% tracking. Captions 700, 40 px.
         - Medium: real product UI. Screens are 393x852 @3x captures from the app
           (assets/v2/*.png), shown inside a phone body: 412 x 892 px, corner radius 64 px, 10 px
           #0B1F1E bezel, shadow 0 24 px 60 px rgba(0,0,0,0.18) on light / 0.45 on dark. The capture
           is cropped 34 pt at the top (the map strip above the sheet).

OBJECTS: - Phone: the home stage, right side, x 588–1000, y 94–986, never leaves; only its screen
           changes and it tilts 0°.
         - Counter: "01" … "08" top-left at x 96, y 150, with "/08" at 40 % opacity beside it.
         - Time chip: "7:42 AM" above the counter at y 96, mint dot + text.
         - Feature title under the counter, y 400–560.
         - Punch-in card: one real component cut from the current screen (the Red Line card, the
           Kendall T dock card, the too-fast banner, "You hold 474 squares", the leaderboard row)
           lifted out at 1.6× and placed over the phone's left edge, x 300–760.
         - Territory squares: the real cells the loop claims (from the app's `previewClaim` on the
           same track), drawn as 4 px-gap squares in #5EEAD4 at 35 % fill with a 2 px outline,
           filling in along the loop.

MOTION:  enter power3.out 0.5 s (15 frames); move power2.inOut 0.5 s; exit power2.in 0.3 s.
         Screen swap inside the phone: the new screen slides up 60 px and fades from 0 in 0.4 s while
         the old one holds (one hero move). Counter: old number rolls up and out, new rolls in from
         below, 0.35 s. Punch-in card: scale 1 → 1.6 from its place on the screen, 0.5 s, holds,
         returns 0.4 s before the next beat. Stagger secondary elements 4–6 frames after the hero.

SHOTS (estimates):
  01 0.0–4.6   7:42 AM · 01 · "Live T arrivals" · nearby-t: Red Line card punches in.
               reads: chip + 01 (0.2–1.2); title (1.2–2.4); card (2.0–4.6). sound: bed enters; tick.
  02 4.6–9.0   8:05 AM · 02 · "Bluebikes near you" · nearby-bikes: Park Street station card.
  03 9.0–13.6  8:10 AM · 03 · "Plan any trip" · plan-kendall: weather row + T+bike option.
  04 13.6–19.8 8:25 AM · 04 · "Find a dock, by voice" · park-choose (listening, "Kendall Square")
               then park-nav: the Kendall T card punches in.
  05 19.8–24.4 6:30 PM · 05 · "Record runs and rides" · record: 3.12 mi, 26:04. Ground turns evening.
  06 24.4–29.4 6:48 PM · 06 · "Too fast? It's deleted" · record-fast banner punches in, then
               record-voided "Run deleted".
  07 29.4–34.6 7:02 PM · 07 · "Claim your territory" · territory: the loop draws, squares fill,
               "You hold 474 squares".
  08 34.6–40.0 7:10 PM · 08 · "Leaderboards and friends" · leaderboards: "akhil (you)" row
               punches in; sign-in screen (Apple + Google) slides in.
  09 40.0–45.0 end card: phone slides off right, "teal." wordmark wipes in centred (30 % of width),
               mint dot lands, line "Your whole Boston day." and the address "teal-demo-three.vercel.app".
               Holds 2.5 s.

BANNED:  the spec.md defaults (dark void with floating UI, glow, particles, gradients, glass cards,
         cream paper + serif, everything centred, everything fading and sliding up, text moving while
         read, corner labels, three cards in a row, title over a dimmed screenshot, docked logo).
         Also: tilted 3D phones, fake cursors, invented UI, implying Teal rents or unlocks bikes,
         Platform-web screens ("In the iPhone app"), the dev-only "Simulate target full" button.

QA:      frame 0 is a full poster (chip, 01, title, phone with live T); each beat's title is legible
         at 0.5 s + 0.3 s/word; captions never overlap the phone; the phone never jumps across a
         beat change; the end card's mark lands in the last 10 %; all text inside title-safe
         (108–972 px).
