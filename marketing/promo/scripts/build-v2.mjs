// Writes the v2 compositions from v2-data.mjs. Usage: node scripts/build-v2.mjs [rootOut=index.html]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { BEATS, END, FILM, SCREENS, TOTAL } from './v2-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'compositions', 'v2');
fs.mkdirSync(OUT_DIR, { recursive: true });
const rootOut = path.resolve(ROOT, process.argv[2] ?? 'index.html');

const GSAP = '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>';
const FONTS = [400, 600, 700, 800]
  .map((w) => `@font-face { font-family: "Manrope"; font-weight: ${w}; src: url("assets/fonts/Manrope_${{ 400: '400Regular', 600: '600SemiBold', 700: '700Bold', 800: '800ExtraBold' }[w]}.ttf") format("truetype"); }`)
  .join('\n    ');
const r = (n) => Math.round(n * 1000) / 1000;

// Phone geometry (px) and capture scale (px per screen point).
const PHONE = { x: 588, y: 140, w: 412, h: 800 };
const SCR = { x: 598, y: 150, w: 392, h: 780 };
const K = SCR.w / 393;
const CARD_TARGET = { x: 96, y: 560, maxW: 576, maxH: 300 };

const screenImg = (id, s, extra = '') =>
  `<img id="${id}" src="assets/v2/${SCREENS[s].file}" alt="" style="position:absolute;left:0;top:${r(-SCREENS[s].crop * K)}px;width:${SCR.w}px;height:${r(852 * K)}px;${extra}" />`;

// ── stage: ground, phone and its screens, the whole film ─────────────────────────────────────
function stage() {
  const events = BEATS.flatMap((b) => b.screens.map((e) => ({ t: b.start + e.at, s: e.s })));
  const imgs = events.map((e, i) => screenImg(`st-scr-${i}`, e.s, i === 0 ? '' : 'opacity:0;')).join('\n          ');
  const tweens = [];
  BEATS.forEach((b, i) => {
    if (i > 0) tweens.push(`tl.to("#st-ground", { backgroundColor: "${b.ground}", duration: 0.6, ease: "power2.inOut" }, ${r(b.start - 0.3)});`);
  });
  tweens.push(`tl.to("#st-ground", { backgroundColor: "${END.ground}", duration: 0.6, ease: "power2.inOut" }, ${r(END.start - 0.2)});`);
  events.forEach((e, i) => {
    if (i > 0) tweens.push(`tl.fromTo("#st-scr-${i}", { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, ${r(e.t)});`);
  });
  tweens.push(`tl.to("#st-phone", { x: 640, duration: 0.6, ease: "power3.in" }, ${r(END.start)});`);
  return `<template>
  ${GSAP}
  <style>
    #root { position: absolute; inset: 0; overflow: hidden; }
    #st-ground { position: absolute; inset: 0; background: ${BEATS[0].ground}; }
    #st-phone { position: absolute; left: ${PHONE.x}px; top: ${PHONE.y}px; width: ${PHONE.w}px; height: ${PHONE.h}px;
      border-radius: 60px; background: #0B1F1E; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22), inset 0 0 0 1.5px rgba(255, 255, 255, 0.14); }
    #st-screen { position: absolute; left: 10px; top: 10px; width: ${SCR.w}px; height: ${SCR.h}px; border-radius: 50px; overflow: hidden; background: #EEF7F6; }
  </style>
  <div id="root" data-composition-id="stage" data-width="${FILM.width}" data-height="${FILM.height}">
    <div id="st-ground"></div>
    <div id="st-phone">
      <div id="st-screen" data-layout-allow-overflow>
          ${imgs}
      </div>
    </div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${tweens.join('\n    ')}
    tl.to({}, { duration: ${FILM.duration} }, 0);
    window.__timelines["stage"] = tl;
  </script>
</template>
`;
}

// ── one beat: time chip, counter, title, lifted cards ───────────────────────────────────────
function territoryPanel(b) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/v2/territory-cells.json'), 'utf8'));
  const W = 440;
  const H = 300;
  const lats = data.path.map((p) => p[0]).concat(data.cells.flatMap((c) => [c.south, c.north]));
  const lons = data.path.map((p) => p[1]).concat(data.cells.flatMap((c) => [c.west, c.east]));
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = (Math.max(...lons) - Math.min(...lons)) * kx;
  const spanY = Math.max(...lats) - Math.min(...lats);
  const sc = Math.min((W - 40) / spanX, (H - 40) / spanY);
  const ox = (W - spanX * sc) / 2;
  const oy = (H - spanY * sc) / 2;
  const X = (lon) => r(ox + (lon - Math.min(...lons)) * kx * sc);
  const Y = (lat) => r(oy + (Math.max(...lats) - lat) * sc);
  const cells = [...data.cells].sort((a, b2) => b2.north - a.north || a.west - b2.west);
  const rects = cells
    .map((c, i) => `<rect class="${b.id}-cell" data-i="${i}" x="${X(c.west) + 0.6}" y="${Y(c.north) + 0.6}" width="${r(X(c.east) - X(c.west) - 1.2)}" height="${r(Y(c.south) - Y(c.north) - 1.2)}" />`)
    .join('');
  const d = data.path.map((p, i) => `${i ? 'L' : 'M'}${X(p[1])},${Y(p[0])}`).join(' ') + ' Z';
  return {
    html: `<div id="${b.id}-terr" style="position:absolute;left:96px;top:560px;width:${W}px;height:${H}px;opacity:0;">
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <g fill="rgba(94,234,212,0.35)" stroke="#5EEAD4" stroke-width="1">${rects}</g>
        <path id="${b.id}-loop" d="${d}" fill="none" stroke="#E6F4F2" stroke-width="3" stroke-linejoin="round" />
      </svg>
      <div id="${b.id}-terr-count" style="position:absolute;left:0;top:${H + 6}px;font:700 30px Manrope;color:#5EEAD4;">${data.count} squares</div>
    </div>`,
    js: `{
      const loop = document.getElementById("${b.id}-loop");
      const len = loop.getTotalLength();
      tl.set("#${b.id}-terr", { opacity: 1 }, ${b.territory.at});
      tl.fromTo(loop, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.4, ease: "power1.inOut" }, ${b.territory.at});
      tl.fromTo(".${b.id}-cell", { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "none", stagger: { amount: 1.2 } }, ${r(b.territory.at + 1.2)});
      tl.fromTo("#${b.id}-terr-count", { opacity: 0 }, { opacity: 1, duration: 0.3 }, ${r(b.territory.at + 2.2)});
      tl.to("#${b.id}-terr", { opacity: 0, duration: 0.3, ease: "power2.in" }, ${r(b.end - b.start - 0.35)});
    }`,
  };
}

function beat(b, index) {
  const dur = r(b.end - b.start);
  const first = index === 0;
  const cardEls = [];
  const cardJs = [];
  b.cards.forEach((c, i) => {
    const [bx, by, bw, bh] = c.box;
    const crop = SCREENS[c.s].crop;
    const x0 = r(SCR.x + bx * K);
    const y0 = r(SCR.y + (by - crop) * K);
    const w = r(bw * K);
    const h = r(bh * K);
    const s = r(Math.min(1.6, CARD_TARGET.maxW / w, CARD_TARGET.maxH / h));
    const id = `${b.id}-card${i}`;
    cardEls.push(`<div id="${id}" class="card" style="left:${x0}px;top:${y0}px;width:${w}px;height:${h}px;">
      <img src="assets/v2/${SCREENS[c.s].file}" alt="" style="position:absolute;left:${r(-bx * K)}px;top:${r(-by * K)}px;width:${SCR.w}px;height:${r(852 * K)}px;" />
    </div>`);
    const back = c.until ?? dur - 0.5;
    cardJs.push(
      `tl.set("#${id}", { opacity: 1 }, ${c.at});`,
      // Drop first, then slide left, so a card from high on the screen passes under the title.
      `tl.to("#${id}", { y: ${r(CARD_TARGET.y - y0)}, scale: ${s}, boxShadow: "0 18px 40px rgba(0,0,0,0.28)", duration: 0.38, ease: "power3.out" }, ${c.at});`,
      `tl.to("#${id}", { x: ${r(CARD_TARGET.x - x0)}, duration: 0.55, ease: "power2.inOut" }, ${c.at});`,
      `tl.to("#${id}", { x: 0, y: 0, scale: 1, boxShadow: "0 0 0 rgba(0,0,0,0)", duration: 0.4, ease: "power2.inOut" }, ${r(back)});`,
      `tl.set("#${id}", { opacity: 0 }, ${r(back + 0.4)});`,
    );
  });
  const terr = b.territory ? territoryPanel(b) : null;
  const enterAt = first ? 0 : 0.05;
  const enter = first
    ? []
    : [
        `tl.fromTo("#${b.id}-num", { yPercent: 100 }, { yPercent: 0, duration: 0.35, ease: "power3.out" }, ${enterAt});`,
        `tl.fromTo("#${b.id}-time", { yPercent: 100 }, { yPercent: 0, duration: 0.35, ease: "power3.out" }, ${enterAt});`,
        `tl.fromTo("#${b.id}-t1", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.45, ease: "power3.out" }, 0.35);`,
        `tl.fromTo("#${b.id}-t2", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.45, ease: "power3.out" }, 0.5);`,
      ];
  const exit = [
    `tl.to("#${b.id}-num", { yPercent: -100, duration: 0.3, ease: "power2.in" }, ${r(dur - 0.32)});`,
    `tl.to("#${b.id}-time", { yPercent: -100, duration: 0.3, ease: "power2.in" }, ${r(dur - 0.32)});`,
    `tl.to("#${b.id}-title", { opacity: 0, duration: 0.25, ease: "power2.in" }, ${r(dur - 0.3)});`,
  ];
  return `<template>
  ${GSAP}
  <style>
    ${FONTS}
    #root { position: absolute; inset: 0; overflow: hidden; font-family: "Manrope", sans-serif; color: ${b.ink}; }
    #${b.id}-chip { position: absolute; left: 96px; top: 96px; height: 40px; overflow: hidden; display: flex; align-items: center; gap: 12px; }
    #${b.id}-dot { width: 14px; height: 14px; border-radius: 7px; background: ${b.accent}; }
    #${b.id}-time { display: block; font-weight: 700; font-size: 30px; letter-spacing: 0.06em; text-transform: uppercase; color: ${b.ink}; }
    #${b.id}-counter { position: absolute; left: 88px; top: 140px; height: 210px; overflow: hidden; display: flex; align-items: baseline; }
    #${b.id}-num { display: block; font-weight: 800; font-size: 200px; line-height: 210px; letter-spacing: -0.04em; color: ${b.accent}; }
    #${b.id}-of { font-weight: 800; font-size: 64px; letter-spacing: -0.02em; color: ${b.ink}; opacity: 0.4; margin-left: 10px; }
    #${b.id}-title { position: absolute; left: 96px; top: 370px; font-weight: 700; font-size: 60px; line-height: 72px; letter-spacing: -0.02em; }
    #${b.id}-title div { white-space: nowrap; }
    .card { position: absolute; overflow: hidden; border-radius: 22px; opacity: 0; transform-origin: 0 0; }
  </style>
  <div id="root" data-composition-id="${b.id}" data-width="${FILM.width}" data-height="${FILM.height}">
    <div id="${b.id}-chip"><div id="${b.id}-dot"></div><span id="${b.id}-time">${b.time}</span></div>
    <div id="${b.id}-counter"><span id="${b.id}-num">${b.n}</span><span id="${b.id}-of">/${String(TOTAL).padStart(2, '0')}</span></div>
    <div id="${b.id}-title"><div id="${b.id}-t1">${b.title[0]}</div><div id="${b.id}-t2">${b.title[1]}</div></div>
    ${terr ? terr.html : ''}
    ${cardEls.join('\n    ')}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${enter.join('\n    ')}
    ${cardJs.join('\n    ')}
    ${terr ? terr.js : ''}
    ${exit.join('\n    ')}
    tl.to({}, { duration: ${dur} }, 0);
    window.__timelines["${b.id}"] = tl;
  </script>
</template>
`;
}

// ── end card ─────────────────────────────────────────────────────────────────────────────
function endCard() {
  const dur = r(END.end - END.start);
  return `<template>
  ${GSAP}
  <style>
    ${FONTS}
    #root { position: absolute; inset: 0; overflow: hidden; font-family: "Manrope", sans-serif; color: #E6F4F2; }
    #end-lockup { position: absolute; left: 0; right: 0; top: 330px; text-align: center; }
    #end-mark { display: inline-block; font-weight: 800; font-size: 190px; line-height: 1; letter-spacing: -0.06em; }
    #end-dot { display: inline-block; color: #5EEAD4; }
    #end-line { position: absolute; left: 0; right: 0; top: 590px; text-align: center; font-weight: 700; font-size: 46px; letter-spacing: -0.01em; }
    #end-url { position: absolute; left: 0; right: 0; top: 680px; text-align: center; font-weight: 600; font-size: 32px; color: #5EEAD4; }
  </style>
  <div id="root" data-composition-id="end" data-width="${FILM.width}" data-height="${FILM.height}">
    <div id="end-lockup"><span id="end-mark">teal<span id="end-dot">.</span></span></div>
    <div id="end-line">Run Boston, together</div>
    <div id="end-url">teal-demo-three.vercel.app</div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#end-mark", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.6, ease: "power3.out" }, 0.55);
    tl.fromTo("#end-dot", { scale: 0, transformOrigin: "50% 80%" }, { scale: 1, duration: 0.45, ease: "back.out(2.2)" }, 1.05);
    tl.fromTo("#end-line", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.5, ease: "power3.out" }, 1.45);
    tl.fromTo("#end-url", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, 1.95);
    tl.to({}, { duration: ${dur} }, 0);
    window.__timelines["end"] = tl;
  </script>
</template>
`;
}

// ── captions: one host, one group visible at a time ─────────────────────────────────────────
function captionGroups() {
  return BEATS.flatMap((b) => b.caps.map(([text, s, e]) => ({ text, start: b.start + b.voiceAt + s, end: b.start + b.voiceAt + e, ink: b.ink })));
}

function captions() {
  const groups = captionGroups();
  const els = groups.map((g, i) => `<div id="cap-${i}" class="cap" style="color:${g.ink};">${g.text}</div>`).join('\n    ');
  const js = groups
    .map((g, i) => {
      const next = groups[i + 1];
      const end = r(Math.min(g.end + 0.25, next ? next.start - 0.02 : g.end + 0.6));
      const start = r(Math.max(0.15, g.start - 0.05));
      return [
        `tl.fromTo("#cap-${i}", { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "power2.out" }, ${start});`,
        `tl.to("#cap-${i}", { opacity: 0, duration: 0.1, ease: "power2.in" }, ${r(end - 0.1)});`,
        `tl.set("#cap-${i}", { opacity: 0, visibility: "hidden" }, ${end});`,
      ].join('\n    ');
    })
    .join('\n    ');
  return `<template>
  ${GSAP}
  <style>
    ${FONTS}
    #root { position: absolute; inset: 0; overflow: hidden; font-family: "Manrope", sans-serif; }
    .cap { position: absolute; left: 96px; width: 470px; bottom: 108px; font-weight: 700; font-size: 38px; line-height: 46px; letter-spacing: -0.01em; opacity: 0; }
  </style>
  <div id="root" data-composition-id="captions" data-width="${FILM.width}" data-height="${FILM.height}">
    ${els}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${js}
    tl.to({}, { duration: ${FILM.duration} }, 0);
    window.__timelines["captions"] = tl;
  </script>
</template>
`;
}

// ── audio: voice per beat, the music bed, and a few sounds on visible actions ────────────────
function audio() {
  const el = (id, src, start, dur, track, vol) => `<audio id="${id}" src="${src}" data-start="${r(start)}" data-duration="${r(dur)}" data-track-index="${track}" data-volume="${vol}"></audio>`;
  const wavDur = (f) => { const buf = fs.readFileSync(path.join(ROOT, f)); return r((buf.length - 44) / buf.readUInt32LE(28)); };
  const mediaDur = (f) => r(Math.min(1.2, Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(ROOT, f)]).toString().trim())));
  const sfx = (id, f, start, vol, track = 12) => el(id, f, start, mediaDur(f), track, vol);
  const out = [];
  for (const b of BEATS) out.push(el(`vo-${b.id}`, b.voice, b.start + b.voiceAt, wavDur(b.voice), 10, 1));
  out.push(el('vo-end', END.voice, END.start + END.voiceAt, wavDur(END.voice), 10, 1));
  out.push(el('bgm', 'assets/bgm/track-v2.mp3', 0, FILM.duration, 11, 0.14));
  // A soft pop as each counter lands (two takes, alternating), a whoosh as the phone leaves, a pop on the end dot.
  BEATS.slice(1).forEach((b, i) => out.push(sfx(`sfx-count-${b.id}`, i % 2 ? 'assets/sfx/click-soft.mp3' : 'assets/sfx/pop.mp3', b.start + 0.32, 0.45)));
  out.push(sfx('sfx-exit', 'assets/sfx/whoosh-short.mp3', END.start + 0.05, 0.5));
  out.push(sfx('sfx-dot', 'assets/sfx/pop.mp3', END.start + 1.12, 0.55, 13));
  return out.join('\n      ');
}

// ── root ────────────────────────────────────────────────────────────────────────────────
function root(audio) {
  const host = (id, src, start, dur, track, kind) =>
    `<div id="${id}" data-composition-id="${id}" data-composition-src="compositions/v2/${src}" data-start="${r(start)}" data-duration="${r(dur)}" data-track-index="${track}" data-track-kind="${kind}" data-width="${FILM.width}" data-height="${FILM.height}" style="position:absolute;inset:0;"></div>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${FILM.width}, height=${FILM.height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${FILM.width}px; height: ${FILM.height}px; overflow: hidden; background: #000; }
      #root { position: relative; width: ${FILM.width}px; height: ${FILM.height}px; overflow: hidden; background: ${BEATS[0].ground}; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${FILM.duration}" data-width="${FILM.width}" data-height="${FILM.height}">
      ${host('stage', 'stage.html', 0, FILM.duration, 1, 'graphics')}
      ${BEATS.map((b) => host(b.id, `${b.id}.html`, b.start, b.end - b.start, 2, 'graphics')).join('\n      ')}
      ${host('end', 'end.html', END.start, END.end - END.start, 2, 'graphics')}
      ${host('captions', 'captions.html', 0, FILM.duration, 3, 'captions')}
      ${audio ?? ''}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
      window.__timelines["main"].to({}, { duration: ${FILM.duration} }, 0);
    </script>
  </body>
</html>
`;
}

fs.writeFileSync(path.join(OUT_DIR, 'stage.html'), stage());
BEATS.forEach((b, i) => fs.writeFileSync(path.join(OUT_DIR, `${b.id}.html`), beat(b, i)));
fs.writeFileSync(path.join(OUT_DIR, 'end.html'), endCard());
fs.writeFileSync(path.join(OUT_DIR, 'captions.html'), captions());
fs.writeFileSync(rootOut, root(audio()));
console.log('wrote compositions/v2 and', path.relative(ROOT, rootOut));
