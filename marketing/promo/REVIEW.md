# REVIEW — v2 "One day, seven taps" (2026-10-26)

Delivered: `renders/teal-v2-final.mp4` (42.0 s, 1080×1080, 30 fps, H.264/AAC, 5.8 MB), also published
as `public/teal-promo.mp4` on teal-demo-three.vercel.app. `renders/teal-v2.mp4` is the same picture
before loudness normalization.

## Creative calls

- Storyline A ("one day", picked by the user) with the numbered rundown riding on it. Not built:
  B "The map is the day" (a flight across a Boston map) and C "Eight before nine" (beat-cut type).
- After the board review the user removed the too-fast beat (a security measure, not a reason to
  run), renamed the leaderboard runners (no real names), and asked for a community-of-runners focus:
  the last beat became "Run with your crew" (leaderboard → friend request → friends' weekly miles)
  and the close became "Run Boston, together". The count went from 8 to 7.
- The evening run is one real track: the Charles River loop (Charles Circle → Esplanade → Harvard
  Bridge → Memorial Drive → Longfellow), 2.77 mi. The record screen, the territory squares (431,
  computed with the app's own `previewClaim`) and the territory screen all show that same run.
- iPhone-only screens were rendered from the app's real components on web with sample data, through
  a temporary capture route and hooks that were reverted afterwards (not committed). Live screens
  (T, Bluebikes, planner, place search) are real data from the capture time.
- Sign-in with Apple was dropped from the film: Apple's button is a native view the web build cannot
  draw, and the user chose to skip an iPhone screenshot. The VO no longer mentions it.
- Voice: Kokoro `af_heart` on device (free). Music: the v1 track, extended to 42 s at bar lines.

## Measured vs looked at

- `hyperframes check`: 0 errors. One kept warning, `duplicate_media_discovery_risk`: two cards in
  b07 crop the same friends screenshot on purpose.
- Contrast passed on all sampled frames. Snapshot review (beats, seams, phone sheet) and a 9-frame
  sheet of the final render were looked at.
- Audio measured with `hyperframes audio`: −14.2 LUFS integrated, −1.3 dBTP, no clipping (raised from
  −20 LUFS with a two-pass loudnorm). The mix was measured, not heard.
- Caption timing comes from the pauses in each voice clip (ffmpeg silencedetect), split by character
  count inside a phrase; no word-level transcription was run.

## Weakest shot and next steps

- b06 territory: the squares panel is a flat shape with no map under it; a faint river outline would
  make the Charles read instantly. With more time: draw the basin outline from open map data.
- Card text inside the lifted cards is small at phone width (360 px); titles and captions read fine.
- Leaderboard and friends names, distances and the invite code are sample data (stated on the site).
