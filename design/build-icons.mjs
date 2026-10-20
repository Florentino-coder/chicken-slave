// Generates the Lacquer Court icon set (design/icons/*.svg), a specimen sheet (design/icon-sheet.html)
// and renders it to design/icon-sheet.png with Playwright's Chromium.
// Run: node design/build-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS = process.env.CANVAS_FONTS ?? '';

/** Translucent inner wash used for depth. */
const W = 'fill="currentColor" fill-opacity=".2"';
/** Solid fill, no stroke (suits, dots). */
const F = 'fill="currentColor" stroke="none"';

export const ICONS = {
  // ---- the court, highest to lowest ----
  king: `<path d="M5 16.5 3.6 7.6l4.6 3.5L12 4.9l3.8 6.2 4.6-3.5L19 16.5z" ${W}/><path d="M5 19.5h14"/><circle cx="3.6" cy="6.6" r="1" ${F}/><circle cx="12" cy="3.6" r="1" ${F}/><circle cx="20.4" cy="6.6" r="1" ${F}/>`,
  noble: `<path d="M12 5.2 14.4 8.6 12 12 9.6 8.6z" ${W}/><path d="M4 15.4c2.5-1.2 5.2-1.8 8-1.8s5.5.6 8 1.8v3c-2.5-1.2-5.2-1.8-8-1.8s-5.5.6-8 1.8z" ${W}/><path d="M6.3 14.4 5.4 10l3 2.3M17.7 14.4l.9-4.4-3 2.3"/>`,
  commoner: `<circle cx="12" cy="8.3" r="3.6" ${W}/><path d="M5 19.6c.9-3.6 3.6-5.6 7-5.6s6.1 2 7 5.6"/>`,
  peasant: `<path d="M12 10.2v7.2M12 17.4 10.2 21M12 17.4l1.8 3.6M12 15.4c-2.3-.5-3.9-2.3-4.4-4.6M12 15.4c2.3-.5 3.9-2.3 4.4-4.6M9.4 17.4h5.2"/><path d="M12 10c-1.4-1.6-1.4-4.1 0-5.8 1.4 1.7 1.4 4.2 0 5.8zM7.5 10.6c-1.7-1-2.4-3.2-1.7-5 1.7 1 2.4 3.2 1.7 5zM16.5 10.6c1.7-1 2.4-3.2 1.7-5-1.7 1-2.4 3.2-1.7 5z" ${W}/>`,
  slave: `<rect x="3.8" y="12" width="10.4" height="6" rx="3" transform="rotate(-45 9 15)" ${W}/><rect x="9.8" y="6" width="10.4" height="6" rx="3" transform="rotate(-45 15 9)"/>`,

  // ---- suits (solid) ----
  spade: `<path ${F} d="M12 3.2c3 3 8.3 6.4 8.3 10.4 0 2.4-1.9 4.2-4.2 4.2-1.4 0-2.6-.6-3.4-1.6.2 1.9.9 3.4 2.3 4.6H9c1.4-1.2 2.1-2.7 2.3-4.6-.8 1-2 1.6-3.4 1.6-2.3 0-4.2-1.8-4.2-4.2 0-4 5.3-7.4 8.3-10.4z"/>`,
  heart: `<path ${F} d="M12 20.3C8.8 17.6 3.5 13.6 3.5 9.2c0-2.6 2-4.5 4.4-4.5 1.7 0 3.2.9 4.1 2.4.9-1.5 2.4-2.4 4.1-2.4 2.4 0 4.4 1.9 4.4 4.5 0 4.4-5.3 8.4-8.5 11.1z"/>`,
  club: `<g ${F}><circle cx="12" cy="7.4" r="3.6"/><circle cx="7.3" cy="13.4" r="3.6"/><circle cx="16.7" cy="13.4" r="3.6"/><circle cx="12" cy="12" r="2.2"/><path d="M11 13h2c0 3.3.8 5.5 2.6 7.3H8.4C10.2 18.5 11 16.3 11 13z"/></g>`,
  diamond: `<path ${F} d="M12 2.8c1.9 3.2 4.2 6.3 6.6 9.2-2.4 2.9-4.7 6-6.6 9.2-1.9-3.2-4.2-6.3-6.6-9.2 2.4-2.9 4.7-6 6.6-9.2z"/>`,

  // ---- table interface ----
  bot: `<rect x="4.5" y="8" width="15" height="11" rx="3" ${W}/><path d="M12 8V5.2M2.6 12.2v3M21.4 12.2v3M10 16h4"/><circle cx="12" cy="4.2" r="1" ${F}/><circle cx="9.3" cy="12.6" r="1.2" ${F}/><circle cx="14.7" cy="12.6" r="1.2" ${F}/>`,
  host: `<path d="M12 3.6l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" ${W}/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.5" ${W}/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.4v2.4"/>`,
  quick: `<path d="M13.2 2.8 5.2 13.4h6.2l-1 7.8 8-10.6h-6.2z" ${W}/>`,
  hint: `<path d="M12 3.2a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2v.6h5.2V16c0-.8.4-1.5 1-2A6 6 0 0 0 12 3.2z" ${W}/><path d="M9.6 19h4.8M10.6 21.2h2.8"/>`,
  log: `<path d="M6 3.5h8.8l3.7 3.7v13.3H6z" ${W}/><path d="M14.8 3.5v3.7h3.7M9 11h6.5M9 14h6.5M9 17h4"/>`,
  chat: `<path d="M5.5 4.8h13a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2H11l-4.6 3.6v-3.6h-.9a2 2 0 0 1-2-2V6.8a2 2 0 0 1 2-2z" ${W}/><circle cx="8.6" cy="10.6" r="1" ${F}/><circle cx="12" cy="10.6" r="1" ${F}/><circle cx="15.4" cy="10.6" r="1" ${F}/>`,
  sound: `<path d="M3.8 9.4h3.6L12 5.4v13.2l-4.6-4H3.8z" ${W}/><path d="M15.4 9.2a4 4 0 0 1 0 5.6M18 6.6a7.6 7.6 0 0 1 0 10.8"/>`,
  mute: `<path d="M3.8 9.4h3.6L12 5.4v13.2l-4.6-4H3.8z" ${W}/><path d="M15.8 9.6l4.8 4.8M20.6 9.6l-4.8 4.8"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  back: `<path d="M14.8 5.2 8 12l6.8 6.8"/>`,
  help: `<circle cx="12" cy="12" r="8.8" ${W}/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6v.6"/><circle cx="12" cy="16.9" r="1" ${F}/>`,
  revolution: `<path d="M19.4 9.4A7.8 7.8 0 0 0 5.6 7.2M4.6 14.6a7.8 7.8 0 0 0 13.8 2.2"/><path d="M5 3.6v3.9h3.9M19 20.4v-3.9h-3.9"/><path d="M12 9.2 14.8 12 12 14.8 9.2 12z" ${W}/>`,
  pass: `<path d="M4.8 6.4 11 12l-6.2 5.6zM12.6 6.4 18.8 12l-6.2 5.6" ${W}/>`,
  play: `<rect x="4" y="4.6" width="9.4" height="13.4" rx="1.8" transform="rotate(-12 8.7 11.3)"/><rect x="10.4" y="5.4" width="9.4" height="13.4" rx="1.8" transform="rotate(8 15.1 12.1)" ${W}/><path d="M15.1 10.2l1.6 1.9-1.6 1.9-1.6-1.9z" ${F}/>`,
  link: `<path d="M10.4 13.6a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1M13.6 10.4a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1"/>`,
  offline: `<path d="M3.4 9a12.4 12.4 0 0 1 5-2.6M12 6.2c3.2 0 6.2 1.2 8.6 3.2M6.2 12.4a8.2 8.2 0 0 1 2.9-1.8M15.6 11a8 8 0 0 1 2.2 1.4M9.2 15.6a4.4 4.4 0 0 1 5.6 0M3.6 3.6l16.8 16.8"/><circle cx="12" cy="19" r="1" ${F}/>`,
  trophy: `<path d="M7.4 4h9.2v5.4a4.6 4.6 0 0 1-9.2 0z" ${W}/><path d="M7.4 6H4.6v1.4a3.4 3.4 0 0 0 3.2 3.4M16.6 6h2.8v1.4a3.4 3.4 0 0 1-3.2 3.4M12 14v3.4M8.4 20.4h7.2M9.6 17.4h4.8v3H9.6z"/>`,
};

export const LABELS = {
  king: ['KING', 'กษัตริย์'],
  noble: ['NOBLE', 'ขุนนาง'],
  commoner: ['COMMONER', 'ประชาชน'],
  peasant: ['PEASANT', 'ไพร่'],
  slave: ['SLAVE', 'ทาส'],
};

const UI = ['bot', 'host', 'lock', 'quick', 'hint', 'log', 'chat', 'sound', 'mute', 'close', 'back', 'help', 'revolution', 'pass', 'play', 'link', 'offline', 'trophy'];
const SUITS = ['spade', 'heart', 'diamond', 'club'];
const COURT = ['king', 'noble', 'commoner', 'peasant', 'slave'];

const svg = (name, attrs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"${attrs}>${ICONS[name]}</svg>`;

// ---- individual files + sprite ----
const outDir = path.join(here, 'icons');
mkdirSync(outDir, { recursive: true });
for (const name of Object.keys(ICONS)) writeFileSync(path.join(outDir, `${name}.svg`), svg(name) + '\n');
writeFileSync(
  path.join(outDir, 'sprite.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${Object.keys(ICONS)
    .map(
      (n) =>
        `  <symbol id="i-${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</symbol>`,
    )
    .join('\n')}\n</svg>\n`,
);

// ---- specimen sheet ----
const font = (fam, file) =>
  FONTS ? `@font-face{font-family:'${fam}';src:url('${pathToFileURL(path.join(FONTS, file)).href}')}` : '';

const courtHtml = COURT.map((n, i) => {
  const drop = i * 34;
  return `<div class="court" style="left:${i * 196}px;top:${drop}px">
    <div class="numeral">${['I', 'II', 'III', 'IV', 'V'][i]}</div>
    <div class="plate">${svg(n)}</div>
    <div class="lab">${LABELS[n][0]}</div><div class="th">${LABELS[n][1]}</div></div>`;
}).join('');

const uiHtml = UI.map((n) => `<div class="cell">${svg(n)}<span>${n.toUpperCase()}</span></div>`).join('');
const suitHtml = SUITS.map((n) => `<div class="suit ${n === 'heart' || n === 'diamond' ? 'red' : ''}">${svg(n)}</div>`).join('');

// Construction grid for the king mark.
const gridLines = Array.from({ length: 25 }, (_, i) => {
  const p = i * 12;
  const major = i % 4 === 0 ? 'major' : '';
  return `<line class="${major}" x1="${p}" y1="0" x2="${p}" y2="288"/><line class="${major}" x1="0" y1="${p}" x2="288" y2="${p}"/>`;
}).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Italiana', 'Italiana-Regular.ttf')}
${font('DMMono', 'DMMono-Regular.ttf')}
${font('Jura', 'Jura-Light.ttf')}
:root{--ground:#06140e;--gold:#e7c45c;--goldDim:rgba(231,196,92,.32);--red:#c8402e;--paper:#f3ecdb}
*{box-sizing:border-box;margin:0}
body{width:1600px;height:1000px;background:radial-gradient(ellipse 70% 60% at 50% 45%,#0b2419 0%,var(--ground) 70%);color:var(--gold);font-family:'Jura',sans-serif;position:relative;overflow:hidden}
.frame{position:absolute;inset:36px;border:1px solid var(--goldDim)}
.frame::after{content:'';position:absolute;inset:6px;border:1px solid rgba(231,196,92,.12)}
.title{position:absolute;left:84px;top:74px;font-family:'Italiana',serif;font-size:46px;letter-spacing:.32em}
.sub{position:absolute;left:88px;top:134px;font-family:'DMMono',monospace;font-size:11px;letter-spacing:.28em;color:rgba(231,196,92,.6)}
.meta{position:absolute;right:84px;top:84px;text-align:right;font-family:'DMMono',monospace;font-size:10px;letter-spacing:.24em;line-height:1.9;color:rgba(231,196,92,.55)}
.sec{position:absolute;font-family:'DMMono',monospace;font-size:10px;letter-spacing:.3em;color:rgba(231,196,92,.7)}
.sec b{font-weight:400;color:var(--gold);margin-right:14px}
.rule{position:absolute;height:1px;background:var(--goldDim)}
.courtwrap{position:absolute;left:96px;top:226px;width:980px;height:300px}
.court{position:absolute;width:150px;text-align:center}
.numeral{font-family:'Italiana',serif;font-size:15px;letter-spacing:.2em;margin-bottom:10px;color:rgba(231,196,92,.7)}
.plate{width:118px;height:118px;margin:0 auto;border:1px solid var(--goldDim);border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(231,196,92,.035)}
.plate svg{width:68px;height:68px}
.lab{margin-top:14px;font-family:'DMMono',monospace;font-size:10px;letter-spacing:.3em}
.th{margin-top:5px;font-family:'Leelawadee UI','Tahoma',sans-serif;font-size:12px;color:rgba(231,196,92,.6)}
.stair{position:absolute;left:96px;top:226px}
.construct{position:absolute;left:1166px;top:206px;width:288px;height:288px}
.construct svg.grid{position:absolute;inset:0;width:288px;height:288px}
.construct svg.grid line{stroke:rgba(231,196,92,.1);stroke-width:1}
.construct svg.grid line.major{stroke:rgba(231,196,92,.24)}
.construct .safe{position:absolute;left:24px;top:24px;width:240px;height:240px;border:1px dashed rgba(200,64,46,.55)}
.construct svg.mark{position:absolute;inset:0;width:288px;height:288px}
.cap{position:absolute;font-family:'DMMono',monospace;font-size:9px;letter-spacing:.22em;color:rgba(231,196,92,.5)}
.uigrid{position:absolute;left:96px;top:716px;display:grid;grid-template-columns:repeat(9,92px);row-gap:34px}
.cell{display:flex;flex-direction:column;align-items:center;gap:10px}
.cell svg{width:36px;height:36px}
.cell span{font-family:'DMMono',monospace;font-size:8.5px;letter-spacing:.2em;color:rgba(231,196,92,.55)}
.suits{position:absolute;left:1000px;top:712px;display:grid;grid-template-columns:repeat(2,74px);gap:18px}
.suit{width:74px;height:74px;border:1px solid var(--goldDim);display:flex;align-items:center;justify-content:center}
.suit svg{width:40px;height:40px;color:var(--gold)}
.suit.red svg{color:var(--red)}
.card{position:absolute;top:706px;width:118px;height:168px;border-radius:10px}
.face{left:1214px;background:var(--paper);color:#13221a;box-shadow:0 10px 30px rgba(0,0,0,.45)}
.face .r{position:absolute;left:10px;top:8px;font-family:'Italiana',serif;font-size:26px;line-height:1;text-align:center}
.face .r svg{display:block;width:16px;height:16px;margin:3px auto 0}
.face .r.b{left:auto;top:auto;right:10px;bottom:8px;transform:rotate(180deg)}
.face .c{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.face .c svg{width:54px;height:54px}
.back{left:1350px;background:#4a1410;border:5px solid var(--paper);box-shadow:0 10px 30px rgba(0,0,0,.45);overflow:hidden}
.back svg{width:100%;height:100%}
.foot{position:absolute;left:88px;bottom:62px;font-family:'DMMono',monospace;font-size:9px;letter-spacing:.3em;color:rgba(231,196,92,.4)}
.foot.r{left:auto;right:88px}
</style></head><body>
<div class="frame"></div>
<div class="title">LACQUER COURT</div>
<div class="sub">ICON SYSTEM &nbsp;·&nbsp; สลาฟ ONLINE &nbsp;·&nbsp; GILT ON LACQUER</div>
<div class="meta">GRID 24 / SAFE 2<br>STROKE 1.75 / ROUND<br>${Object.keys(ICONS).length} MARKS</div>

<div class="sec" style="left:96px;top:190px"><b>PL. I</b>THE COURT &nbsp;— DESCENT OF ORNAMENT</div>
<div class="rule" style="left:96px;top:208px;width:980px"></div>
<div class="courtwrap">${courtHtml}</div>

<div class="sec" style="left:1166px;top:190px"><b>PL. II</b>CONSTRUCTION</div>
<div class="rule" style="left:1166px;top:208px;width:288px;opacity:0"></div>
<div class="construct">
  <svg class="grid" viewBox="0 0 288 288">${gridLines}</svg>
  <div class="safe"></div>
  ${svg('king', ' class="mark"')}
</div>
<div class="cap" style="left:1166px;top:506px">24 × 24 · 1U = 12PX · SAFE ZONE IN CINNABAR</div>

<div class="sec" style="left:96px;top:662px"><b>PL. III</b>THE TABLE</div>
<div class="rule" style="left:96px;top:680px;width:828px"></div>
<div class="uigrid">${uiHtml}</div>

<div class="sec" style="left:1000px;top:662px"><b>PL. IV</b>SUITS · SPECIMEN</div>
<div class="rule" style="left:1000px;top:680px;width:468px"></div>
<div class="suits">${suitHtml}</div>
<div class="card face"><div class="r">A${svg('spade')}</div><div class="c">${svg('spade')}</div><div class="r b">A${svg('spade')}</div></div>
<div class="card back"><svg viewBox="0 0 108 158" preserveAspectRatio="none">
  <defs><pattern id="lat" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M6 0 12 6 6 12 0 6z" fill="none" stroke="#e7c45c" stroke-opacity=".55" stroke-width=".8"/><circle cx="6" cy="6" r=".9" fill="#e7c45c" fill-opacity=".7"/></pattern></defs>
  <rect width="108" height="158" fill="url(#lat)"/>
  <rect x="7" y="7" width="94" height="144" rx="4" fill="none" stroke="#e7c45c" stroke-opacity=".8"/>
  <g transform="translate(36 61) scale(1.5)" color="#e7c45c"><circle cx="12" cy="12" r="11" fill="#4a1410" stroke="#e7c45c" stroke-width=".8"/><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(4.8 4.8) scale(.6)">${ICONS.king}</g></g>
</svg></div>

<div class="foot">FIG. 1–4 &nbsp;·&nbsp; FROM THE HIGHEST SEAT TO THE LOWEST</div>
<div class="foot r">currentColor · ONE MATERIAL</div>
</body></html>`;

writeFileSync(path.join(here, 'icon-sheet.html'), html);

// ---- render PNG ----
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(here, 'icon-sheet.html')).href);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(here, 'icon-sheet.png') });
await browser.close();
console.log(`wrote ${Object.keys(ICONS).length} icons, sprite, sheet html + png`);
