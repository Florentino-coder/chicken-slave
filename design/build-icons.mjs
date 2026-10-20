// Generates the Lacquer Court icon set (design/icons/*.svg), a specimen sheet (design/icon-sheet.html)
// and renders it to design/icon-sheet.png with Playwright's Chromium.
// Run: node design/build-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS = process.env.CANVAS_FONTS ?? '';

// Paths live in the web app so the game and this sheet never drift apart.
const { ICONS, LABELS } = await import(pathToFileURL(path.join(here, '../apps/web/src/icons/paths.ts')).href);

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
<div class="sub">ICON SYSTEM &nbsp;·&nbsp; CHICKEN SLAVE &nbsp;·&nbsp; BY FLORENTINO</div>
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
