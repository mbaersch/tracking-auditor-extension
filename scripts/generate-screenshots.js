// Generates Chrome Web Store assets into webstore/ without a live browser session:
// a tiny static server hosts the unpacked extension, Playwright loads panel.html
// with a stubbed `chrome` API, and the synthetic demo capture is replayed through
// the panel's real onRequest pipeline (parsers + rendering included). The page
// itself is never shown — only the English panel UI is — so the cards are the
// whole picture; their content is English by construction (see fixtures-demo.js).
//
// Needs Playwright + a Chromium build:  npm install  &&  npx playwright install chromium
// Run:  npm run screenshots

import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { DEMO_BLOCKS } from './fixtures-demo.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'webstore');

// The service list is read out of panel.js rather than restated here, so a new
// provider shows up in the settings row, the filter bar and the promo tiles
// without anyone remembering to edit this script.
function readProviders() {
  const src = readFileSync(join(root, 'panel.js'), 'utf8');
  const order = src.match(/^const PROVIDER_ORDER = \[(.+?)\];/m);
  const label = src.match(/^const PROVIDER_LABEL = \{(.+?)\};/m);
  if (!order || !label) throw new Error('PROVIDER_ORDER / PROVIDER_LABEL not found in panel.js');
  const keys = [...order[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const labels = Object.fromEntries([...label[1].matchAll(/(\w+):\s*'([^']+)'/g)].map(m => [m[1], m[2]]));
  return keys.map(k => ({ key: k, label: labels[k] || k }));
}

const PROVIDERS = readProviders();

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css',
};

// --- static server (so panel.js's ES-module imports resolve over http) ------
function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/panel.html';
    const abs = join(root, p);
    if (!abs.startsWith(root) || !existsSync(abs)) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', MIME[extname(abs)] || 'application/octet-stream');
    res.end(readFileSync(abs));
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

// Stub the extension APIs panel.js touches, capture the network listeners so we
// can replay HAR entries, and no-op storage/devtools so nothing throws.
// Storage answers with every service recorded — the shots have to show the full
// service list in the settings row and the filter bar, and the filter bar only
// carries a pill for a service that is enabled or already seen. Four providers
// ship default-off, so an empty storage would leave them out of the bar.
const STUB = (providerKeys) => {
  window.chrome = window.chrome || {};
  const saved = {
    trackingAuditorSettings: {
      record: Object.fromEntries(providerKeys.map(k => [k, true])),
      filter: Object.fromEntries(providerKeys.map(k => [k, true])),
    },
  };
  window.chrome.storage = {
    local: {
      get: (k, cb) => { if (typeof cb === 'function') cb(saved); return Promise.resolve(saved); },
      set: (o, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
    },
  };
  const noop = () => {};
  window.chrome.devtools = {
    inspectedWindow: { eval: (e, cb) => { if (typeof cb === 'function') cb('https://atomkraftwerke24.de/ectest.html', null); }, reload: noop },
    network: {
      onRequestFinished: { addListener: (fn) => { window.__onRequest = fn; } },
      onNavigated: { addListener: (fn) => { window.__onNavigated = fn; } },
    },
  };
};

// Replay the demo capture through the real pipeline, in the page context.
// startedDateTime is left off so onRequest falls back to "now" — the same clock
// the block header uses (onNavigated stamps Date.now()), keeping both in sync
// rather than showing a fixture timestamp on cards under a live-stamped block.
const REPLAY = (blocks) => {
  document.getElementById('recordBtn').click();   // sets recording = true (reload is a no-op)
  for (const b of blocks) {
    window.__onNavigated(b.navUrl);
    for (const r of b.requests) {
      window.__onRequest({
        request: { url: r.url, method: r.method || 'GET', postData: r.postData || undefined },
      });
    }
  }
};

const EXPECTED_CARDS = DEMO_BLOCKS.reduce((n, b) => n + b.requests.length, 0);

async function renderPanel(context, base, colorScheme) {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme });
  await page.addInitScript(STUB, PROVIDERS.map(p => p.key));
  await page.goto(`${base}/panel.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__onRequest && window.__onNavigated);
  await page.evaluate(REPLAY, DEMO_BLOCKS);
  await page.waitForFunction(
    (n) => document.querySelectorAll('.ev').length >= n,
    EXPECTED_CARDS,
    { timeout: 5000 },
  );
  return page;
}

function promoHtml(iconDataUri, w, h) {
  const s = h / 280;   // scale type/icon to the tile height
  // Both tiles now carry the full service list as chips, so the tagline no
  // longer names services — fifteen names would run to four lines and the
  // chips say it better anyway. At 440x280 the chips wrap to three rows, which
  // only clears the bottom edge once the logo block and the gaps give way.
  const wide = w >= 600;
  const chipSize = wide ? 13 : 10;
  const iconSize = wide ? 84 : 56;
  const nameSize = wide ? 44 : 30;
  const tagSize = wide ? 17 : 13;
  const gap = wide ? 16 : 10;
  const chips = PROVIDERS.map(p => `<span class="chip">${p.label}</span>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;}
    .tile{width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:${gap * s}px;box-sizing:border-box;padding:${18 * s}px;
      font-family:'Segoe UI',system-ui,sans-serif;text-align:center;
      background:radial-gradient(120% 120% at 20% 0%, #1c1f26 0%, #0f1115 60%, #0a0c10 100%);}
    .logo{display:flex;align-items:center;gap:${14 * s}px;}
    .logo img{width:${iconSize * s}px;height:${iconSize * s}px;}
    .name{font-size:${nameSize * s}px;font-weight:800;color:#fff;letter-spacing:-0.5px;white-space:nowrap;}
    .name b{color:#ff7a33;}
    .tag{font-size:${tagSize * s}px;font-weight:600;color:#94a3b8;max-width:${w * 0.86}px;line-height:1.35;}
    .chips{display:flex;flex-wrap:wrap;gap:${7 * s}px;justify-content:center;max-width:${w * 0.9}px;}
    .chip{font-size:${chipSize * s}px;font-weight:700;color:#2dd4bf;border:1px solid #2f3540;
      border-radius:${999 * s}px;padding:${4 * s}px ${10 * s}px;white-space:nowrap;}
  </style></head><body><div class="tile">
    <div class="logo"><img src="${iconDataUri}"><div class="name">Tracking <b>Auditor</b></div></div>
    <div class="tag">Every ad &amp; analytics hit of the inspected tab — decoded live in DevTools.</div>
    <div class="chips">${chips}</div>
  </div></body></html>`;
}

// Playwright writes true-color PNGs (the marquee tile alone is ~200 kB). These
// are web-store / website assets, so shrink them the way TinyPNG does: lossy
// palette quantization via libimagequant (sharp's `palette: true`), which drops
// the marquee to ~40 kB and the panel shots by ~60% with no visible loss. Only
// overwrite when the result is actually smaller, so re-runs never bloat a file.
const kb = (n) => (n / 1024).toFixed(1) + ' kB';
async function optimize(names) {
  let before = 0, after = 0;
  for (const n of names) {
    const p = join(outDir, n);
    const src = readFileSync(p);
    const out = await sharp(src).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
    const kept = out.length < src.length ? out : src;
    if (out.length < src.length) writeFileSync(p, out);
    before += src.length;
    after += kept.length;
    console.log(`  • ${n.padEnd(28)} ${kb(src.length).padStart(9)} → ${kb(kept.length).padStart(9)}`);
  }
  console.log(`Optimized ${names.length} PNGs: ${kb(before)} → ${kb(after)} (−${(100 - after / before * 100).toFixed(0)}%)`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = await startServer();
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const shots = [];

  try {
    // --- store listing screenshots (1280x800) ------------------------------
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

    const light = await renderPanel(ctx, base, 'light');
    await light.screenshot({ path: join(outDir, '01-overview.png') });
    shots.push('01-overview.png');

    await light.locator('.ev').first().click();   // expand the top card (GA4 purchase)
    await light.evaluate(() => window.scrollTo(0, 0));
    await light.screenshot({ path: join(outDir, '02-event-detail.png') });
    shots.push('02-event-detail.png');

    // Toggle via the caret, not the card body: an expanded card's centre lands in
    // the .ev-detail table, whose clicks are ignored (panel.js), so a body-click
    // would never collapse it.
    await light.locator('.ev').first().locator('.ev-caret').click();   // collapse GA4 again
    await light.locator('.ev').nth(1).locator('.ev-caret').click();    // expand the Meta card instead
    await light.click('#settingsBtn');             // reveal the capture-settings row
    await light.evaluate(() => window.scrollTo(0, 0));
    await light.screenshot({ path: join(outDir, '03-settings-filter.png') });
    shots.push('03-settings-filter.png');
    await light.close();

    const dark = await renderPanel(ctx, base, 'dark');
    await dark.screenshot({ path: join(outDir, '04-dark-mode.png') });
    shots.push('04-dark-mode.png');
    await dark.close();
    await ctx.close();

    // --- promo tiles -------------------------------------------------------
    const iconDataUri = `data:image/png;base64,${readFileSync(join(root, 'icon-128.png')).toString('base64')}`;
    const promos = [['promo-small-440x280.png', 440, 280], ['promo-marquee-1400x560.png', 1400, 560]];
    for (const [name, w, h] of promos) {
      const pctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await pctx.newPage();
      await page.setContent(promoHtml(iconDataUri, w, h), { waitUntil: 'load' });
      await page.screenshot({ path: join(outDir, name) });
      shots.push(name);
      await pctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`Generated ${shots.length} assets → webstore/`);
  await optimize(shots);
}

main().catch((e) => { console.error(e); process.exit(1); });
