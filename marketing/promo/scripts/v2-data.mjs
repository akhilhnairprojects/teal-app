// v2 "One day, seven taps": every timing, line and screen in one table. build-v2.mjs writes the
// compositions from it. Beat times are laid end to end from `dur`; card/screen `at` and caption
// times are beat-local seconds. `voiceAt` is when the beat's voice clip starts inside the beat;
// caption times are relative to the voice clip (phrase timings from the clip's pauses).

export const FILM = { width: 1080, height: 1080 };

/** Captured screens (assets/v2): crop = points hidden at the top so the sheet's grabber sits high. */
export const SCREENS = {
  t: { file: 'nearby-t-light.png', crop: 70 },
  bikes: { file: 'nearby-bikes-light.png', crop: 0 },
  plan: { file: 'plan-kendall-light.png', crop: 70 },
  parkc: { file: 'park-choose-light.png', crop: 70 },
  parkn: { file: 'park-nav-light.png', crop: 70 },
  rec: { file: 'record-dark.png', crop: 70 },
  terr: { file: 'territory-dark.png', crop: 70 },
  lb: { file: 'leaderboards-dark.png', crop: 70 },
  friends: { file: 'friends-dark.png', crop: 70 },
};

const LIGHT = { ink: '#0B1F1E', muted: '#3E5A57', accent: '#0D9488' };
const DARK = { ink: '#E6F4F2', muted: '#9DBDB8', accent: '#5EEAD4' };

export const TOTAL = 7;

/** box = [x, y, w, h] in screen points of the component lifted out of the screen. */
const RAW_BEATS = [
  {
    id: 'b01', dur: 5.5, voiceAt: 0.25, voice: 'assets/voice-v2/b01.wav', time: '7:42 AM', n: '01', title: ['Live T', 'arrivals'], ground: '#CCF1EC', ...LIGHT,
    screens: [{ at: 0, s: 't' }],
    cards: [{ at: 1.5, s: 't', box: [16, 290, 361, 190] }],
    caps: [['7:42 at Park Street.', 0.05, 2.07], ['Teal already knows', 2.52, 3.38], ['when your train is coming.', 3.38, 4.67]],
  },
  {
    id: 'b02', dur: 4.7, voiceAt: 0.35, voice: 'assets/voice-v2/b02.wav', time: '8:05 AM', n: '02', title: ['Bluebikes', 'near you'], ground: '#EEF7F6', ...LIGHT,
    screens: [{ at: 0, s: 'bikes' }],
    cards: [{ at: 1.35, s: 'bikes', box: [17, 152, 359, 166] }],
    caps: [['Rather ride?', 0.05, 0.74], ['The Bluebikes nearest you,', 1.05, 2.44], ['and every open dock.', 2.44, 3.56]],
  },
  {
    id: 'b03', dur: 4.6, voiceAt: 0.35, voice: 'assets/voice-v2/b03.wav', time: '8:10 AM', n: '03', title: ['Plan any', 'trip'], ground: '#EEF7F6', ...LIGHT,
    screens: [{ at: 0, s: 'plan' }],
    cards: [{ at: 1.5, s: 'plan', box: [17, 318, 359, 174] }],
    caps: [['Or let Teal plan it:', 0.05, 1.09], ['train, bike or both,', 1.39, 2.4], ['with the weather.', 2.4, 3.31]],
  },
  {
    id: 'b04', dur: 6.0, voiceAt: 0.35, voice: 'assets/voice-v2/b04.wav', time: '8:25 AM', n: '04', title: ['Find a dock,', 'by voice'], ground: '#FFFFFF', ...LIGHT,
    screens: [{ at: 0, s: 'parkc' }, { at: 2.45, s: 'parkn' }],
    cards: [
      { at: 0.7, until: 2.1, s: 'parkc', box: [16, 148, 361, 84] },
      { at: 2.85, s: 'parkn', box: [17, 181, 359, 249] },
    ],
    caps: [['Riding to Kendall?', 0.05, 0.96], ['Just say it.', 1.18, 1.78], ['Teal finds a dock with room,', 2.18, 3.64], ['and a backup.', 3.64, 4.37]],
  },
  {
    id: 'b05', dur: 4.9, voiceAt: 0.35, voice: 'assets/voice-v2/b05.wav', time: '6:30 PM', n: '05', title: ['Record runs', 'and rides'], ground: '#0B4F4A', ...DARK,
    screens: [{ at: 0, s: 'rec' }],
    cards: [{ at: 1.3, s: 'rec', box: [16, 212, 361, 160] }],
    caps: [['After work, hit record.', 0.05, 1.25], ['Runs and rides,', 1.64, 2.54], ['no account needed.', 2.54, 3.67]],
  },
  {
    id: 'b06', dur: 5.1, voiceAt: 0.35, voice: 'assets/voice-v2/b06.wav', time: '7:02 PM', n: '06', title: ['Claim your', 'territory'], ground: '#061412', ...DARK,
    screens: [{ at: 0, s: 'terr' }],
    cards: [],
    territory: { at: 0.6 },
    caps: [['Close a loop,', 0.05, 0.59], ['and the squares inside it', 0.85, 1.95], ['are yours for the month.', 1.95, 3.04]],
  },
  {
    id: 'b07', dur: 6.6, voiceAt: 0.35, voice: 'assets/voice-v2/b07.wav', time: '7:10 PM', n: '07', title: ['Run with', 'your crew'], ground: '#061412', ...DARK,
    screens: [{ at: 0, s: 'lb' }, { at: 2.3, s: 'friends' }],
    cards: [
      { at: 0.6, until: 2.0, s: 'lb', box: [17, 318, 359, 242] },
      { at: 2.7, until: 4.3, s: 'friends', box: [17, 506, 359, 80] },
      { at: 4.55, s: 'friends', box: [17, 640, 359, 160] },
    ],
    caps: [['Then see how you stack up this week,', 0.05, 1.65], ['and add friends to run with.', 1.95, 3.21]],
  },
];

const ENDCARD = { dur: 4.6, voiceAt: 0.5, voice: 'assets/voice-v2/end.wav', ground: '#0B4F4A' };

// Lay the beats end to end.
let t = 0;
export const BEATS = RAW_BEATS.map((b) => {
  const out = { ...b, start: t, end: t + b.dur };
  t += b.dur;
  return out;
});
export const END = { ...ENDCARD, start: t, end: t + ENDCARD.dur };
FILM.duration = Math.round((t + ENDCARD.dur) * 1000) / 1000;
