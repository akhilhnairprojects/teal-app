---
format: 1080x1080
duration: 30s
message: "Teal makes your Boston commute simple: the next T and the nearest Bluebike, live, in one glance"
arc: Demo Loop — question → product intro → demo cycle 1 (T) → demo cycle 2 (Bluebikes) → payoff → brand outro
audience: Boston commuters and students who ride the T and Bluebikes
mode: collaborative
music: warm minimal electronic, early-morning city pulse, light percussion, optimistic, ~110 BPM
---

## Video direction

- **Palette system** (`frame.md`): dark frames 01–04 sit on `dark-bg` with a soft `dark-surface` radial glow; `mint` is the only accent on dark (eyebrows, the swapped word, live dots, card outline glow); `dark-text` for headlines, `text-light` for secondary copy. Frame 05 flips to the light canvas (`bg`) with `primary` teal as accent and `text` ink. Frame 06 sits on `brand-deep` with `mint` dot/accent. MBTA line colors (Red #DA291C, Orange #ED8B00, Green #00843D, Blue #003DA5) appear only as line pills/dots, never as decoration. Type: Manrope throughout — display weight 800 tight-tracked for headlines and the wordmark, 600–700 for supporting copy, uppercase tracked 700 for eyebrows.
- **Motion grammar + reveal model**: one smooth long-tail feel (`power3` out) on every entrance; no bounce or overshoot except the single badge pop in frame 05. Every frame reveals each piece on its spoken cue — at t=0 only what the VO is saying enters, later pieces wait for their word; reveals spread across the back half. Real app screens enter as whole objects (phone, card) — never rebuilt. Holds stay still; the only sanctioned aliveness is the live-dot pulse (a finite opacity/scale tween on the mint dots, the app's own "live" signal) and at most subtle jitter.
- **Rhythm / held frames**: 01 is quick and punchy (word swap); 02 resolves and holds still as the breather before the demo; 03 and 04 are the busiest (sequential reveals across the real UI); 05 is a short comparison that settles and holds; 06 is the calm, deliberately held close.
- **Caption band**: bottom ~17% is the caption keep-out. Headlines, pills and key numbers stay in the top ~83%; only bleeding device/card imagery (supporting, non-essential) may pass into the band.
- **Negative list**: no slideshow (front-load then freeze), no screensaver (many elements floating independently), no circular breathing, no back-half slow pan/push, no bokeh or generic "AI" gradients, no fake cursors or browser chrome, no `repeat`/`yoyo`, no randomness. Never imply Teal rents or unlocks bikes itself.

## Frame 1 — The morning question

- scene: Kinetic type on the deep-dark canvas — "Train — or bike?" with the swapping word flipping between line-colored "train" and mint "bike"
- voiceover: "Every Boston morning starts with the same question: train — or bike?"
- duration: 5.016s
- transition_in: cut
- status: animated
- src: compositions/frames/01-morning-question.html
- type: hook
- persuasion: Pain validation (shared daily dilemma)
- beat: curiosity + recognition
- asset_candidates:

narrativeRole: Opens on the commuter's own daily question in their words, so every Boston viewer recognizes themselves before any product appears.
keyMessage: You make this call every morning.

- blueprint: kinetic-type-beats (Adapt)
- focal: the "Train / or bike?" line (typography only)
- roles: none (no assets)
- sfx: click-soft

Adapt: keep the in-place token swap as the signature; one line, the swap slot is the second line's last word.
Scene 1 (0.0–0.9s): dark field with soft radial glow; the mint eyebrow "BOSTON · 8:02 A.M." rises in alone via per-word staggered reveal (`dynamic-content-sequencing`) — centered, upper third.
Scene 2 (0.9–2.4s): as the VO says "the same question", "Train" lands big and centered on a smooth `power3` settle; beneath it "or ___?" appears with its slot cycling fast through line-colored tokens "Red?" → "Orange?" → "Green?" via hard-cut in-place token cycle (`discrete-text-sequence`), each token in its line color — centered, ~55% of frame, 2 depth layers (glow + type).
Scene 3 (2.4–3.2s): on the VO's "or bike?", the slot hard-cuts to mint "bike?" and stays — the swap is the joke landing.
Scene 4 (3.2–4.0s): the five line-color dots reveal left→right beneath the line (`center-outward-expansion`), the mint dot last; hold still.

## Frame 2 — Meet Teal

- scene: The "teal." wordmark assembles on dark — the dot lands last in teal — then the line "Your whole commute, live, in one glance." settles beneath it
- voiceover: "Meet Teal. Your whole commute — live, in one glance."
- duration: 5.172s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-meet-teal.html
- type: product_intro
- persuasion: Promise statement (value claim before evidence)
- beat: clarity + intrigue
- asset_candidates:

narrativeRole: Names the product and lands the message by beat 2, so everything after is evidence.
keyMessage: One app answers the morning question.

- blueprint: logo-assemble-lockup (Adapt)
- focal: the "teal." wordmark (typography only)
- roles: none (no assets)
- sfx: whoosh-short, chime

Adapt: keep "the mark comes to exist" as the signature; letters cascade instead of shapes, and the payoff beat is the tagline steps beneath the lockup (no product window — the next frame carries the product).
Scene 1 (0.0–1.4s): on "Meet Teal", the letters t-e-a-l cascade up into place left→right on a smooth `power3` settle (`dynamic-content-sequencing`), centered, ~60% of frame width; the radial glow behind it brightens slightly (`ambient-glow-bloom`).
Scene 2 (1.4–1.9s): the teal dot drops into place last with a small mint glow bloom — the mark completes.
Scene 3 (1.9–3.6s): as the VO says "your whole commute — live, in one glance", the claim line reveals per phrase beneath the mark ("Your whole commute —", then "live,", then "in one glance."); "live" settles in mint and gets a single keyword glow (`asr-keyword-glow`) on its spoken word.
Scene 4 (3.6–4.5s): held breather — the lockup reads still; no drift.

## Frame 3 — The T, counting down

- scene: A phone floats center-left showing the real Teal home screen (dark); the Park Street card lifts slightly and its live minute chips pulse as the line colors are named
- voiceover: "The next T at every station near you — Red, Orange, Green — counting down live."
- duration: 5.251s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-the-t.html
- type: feature_showcase
- persuasion: Show-don't-tell proof (real live data)
- beat: control + confidence
- asset_candidates: assets/screen-top-dark.png — full dark home screen with wordmark, live badge, Park Street arrivals; assets/card-t-park-street-dark.png — isolated Park Street arrivals card with line pills and live minute chips

narrativeRole: First evidence beat — proves the "live" claim on the app's real screen with real MBTA arrivals.
keyMessage: You always know when the next train comes.

- blueprint: device-surface-showcase (Adapt)
- focal: assets/card-t-park-street-dark.png
- roles: screen-top-dark = supporting (inside the phone mockup) · card-t-park-street-dark = cutout (lifted foreground card)
- sfx: whoosh-short, click-soft

Adapt: keep the real interface held as hero; instead of cycling screens, the key element (the Park Street card) lifts out of the phone toward the viewer.
Scene 1 (0.0–1.4s): on "The next T", the phone (real dark home screen inside a rounded device frame) rises into place lower-left, bleeding off the bottom edge (`gsap-effects`, `power3`); the eyebrow "THE T" and the headline "Every train near you, counting down live." reveal per phrase across the top, asymmetric 60/40 with the phone below — 3 depth layers (glow, phone, headline).
Scene 2 (1.4–3.8s): as the VO names "Red, Orange, Green", the three line pills reveal one by one in a column right of the card, each on its spoken word (`dynamic-content-sequencing`).
Scene 3 (3.8–5.4s): on "counting down live", the Park Street card lifts out of the phone toward the viewer and to the right with a mint outline glow (`card-morph-anchor` lift), the phone beneath dims slightly (`depth-of-field-blur`, light) so the card is the clear #1 element.
Scene 4 (5.4–7.0s): hold on the lifted card; the live-dot pulse is the only motion (finite, the app's own signal); the 2-minute Red chip gets one keyword glow.

## Frame 4 — Bluebikes, before you walk

- scene: The phone's screen scrolls to Bluebikes; the Park Street T Stop card slides out beside the phone and its three big numbers (11 classic · 13 e-bike · 4 open docks) count up as the VO names each
- voiceover: "The closest Bluebikes, too: classic, electric, and open docks — before you walk over."
- duration: 6.243s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-bluebikes.html
- type: feature_showcase
- persuasion: Feature-to-benefit translation (dock count = no wasted walk)
- beat: ease + relief
- asset_candidates: assets/screen-bikes-dark.png — dark Bluebikes screen with four stations and big counts; assets/card-bike-dark.png — isolated Park Street T Stop card, 11 classic · 13 e-bike · 4 open docks

narrativeRole: Second demo cycle on the same surface — the bike half of the morning question, with availability and parking at a glance.
keyMessage: You know if there's a bike — and a dock — before you go.

- blueprint: device-surface-showcase (Adapt)
- focal: assets/card-bike-dark.png
- roles: screen-bikes-dark = supporting (inside the phone mockup) · card-bike-dark = cutout (foreground card, lower right)
- sfx: whoosh-short, pop

Adapt: same device as frame 03 with its screen advanced to Bluebikes (the flow continues on one surface); the station card slides out and its three numbers are re-emphasized on their spoken words.
Scene 1 (0.0–1.3s): on "The closest Bluebikes, too", the phone (real dark Bluebikes screen) settles at left in the same position frame 03 left it, and the eyebrow "BLUEBIKES" + headline "A bike — and a dock — before you walk." reveal per phrase upper right — asymmetric 40/60, 3 depth layers.
Scene 2 (1.3–4.2s): the Park Street T Stop card slides out from the phone toward the lower right with a mint outline glow (`gsap-effects`, `power3`), kept inside the top ~83%; as the VO says "classic", "electric", "open docks", a mint underline marker sweeps under each count in turn — 11, 13, 4 (`css-marker-patterns`, highlight sweep), each on its word.
Scene 3 (4.2–5.4s): on "before you walk over", the supporting line "Classic, electric and open docks at the closest stations." reveals beneath the headline.
Scene 4 (5.4–6.5s): hold still; the card reads.

## Frame 5 — Pick the faster way

- scene: Light mint canvas; the T card (left) and the Bluebikes card (right) sit side by side, a teal "or" pill between them, then a check settles on one
- voiceover: "So you take the faster way. Every time."
- duration: 3.37s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/05-faster-way.html
- type: benefit_highlight
- persuasion: Negative contrast resolved (the dilemma from frame 1, answered)
- beat: control + peace of mind
- asset_candidates: assets/card-t-park-street-light.png — light Park Street arrivals card; assets/card-bike-light.png — light Bluebikes card with counts and Unlock

narrativeRole: Pays off the hook — the train-or-bike question now has an answer.
keyMessage: The choice is easy now.

- blueprint: comparison-split (Reproduce)
- focal: the two tiles together (assets/card-t-park-street-light.png + assets/card-bike-light.png)
- roles: card-t-park-street-light = supporting (left tile) · card-bike-light = supporting (right tile)
- sfx: whoosh, pop

Scene 1 (0.0–1.2s): light canvas; on "So you take", the headline "Take the faster way." slides down from above into the upper band, centered (`gsap-effects`, `power3`), "faster" in teal.
Scene 2 (1.2–2.6s): the two tiles arrive from opposite wings with mirrored book-open rotateY tilts — THE T tile from the left, BLUEBIKES tile ~0.2s behind from the right (`split-tilt-cards`, the signature) — split-screen, equal width; the teal "or" pill pops in between them.
Scene 3 (2.6–3.6s): on "Every time.", the "✓ Faster today" badge spring-pops onto the Bluebikes tile's top inner edge (`spring-pop-entrance`, the one overshoot).
Scene 4 (3.6–4.5s): hold still.

## Frame 6 — Your Boston commute, in teal

- scene: Elements clear; the "teal." wordmark holds center on deep teal while the tagline "Your Boston commute, in teal." completes beneath it; a small "For iPhone" chip
- voiceover: "Teal. Your Boston commute — in teal."
- duration: 3.709s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/06-outro.html
- type: branding
- persuasion: Brand anchoring (identity = the color of the commute)
- beat: belonging + inevitability
- asset_candidates:

narrativeRole: Brand-mood close in the user's chosen angle; leaves the name and color as the memory.
keyMessage: Teal is your commute.

- blueprint: fixed-anchor-cycle (Adapt)
- focal: the "teal." wordmark (typography only)
- roles: none (no assets)
- sfx: sparkle

Adapt: the anchor is the wordmark; instead of cycling taglines, the single tagline's words step bright one at a time and land on "teal" — 6 words read as a short roll-call, not a flurry.
Scene 1 (0.0–1.0s): deep-teal field; on "Teal.", the wordmark scales up softly from ~0.94 into place, centered, upper-middle (`gsap-effects`, `power3`), mint dot last.
Scene 2 (1.0–2.8s): as the VO says "Your Boston commute — in teal", the tagline sits dim beneath the anchor and its words step bright one by one in time with the VO, the last word "teal" landing in mint and bold.
Scene 3 (2.8–3.4s): the "FOR IPHONE" outline chip fades up beneath.
Scene 4 (3.4–4.0s): final hold, then the whole lockup fades to the deep-teal field (the film's only exit).
