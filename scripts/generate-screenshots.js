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
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DEMO_BLOCKS } from './fixtures-demo.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'webstore');

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
const STUB = () => {
  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: {
      get: (k, cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); },
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
  await page.addInitScript(STUB);
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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;}
    .tile{width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:${18 * s}px;box-sizing:border-box;padding:${24 * s}px;
      font-family:'Segoe UI',system-ui,sans-serif;text-align:center;
      background:radial-gradient(120% 120% at 20% 0%, #1c1f26 0%, #0f1115 60%, #0a0c10 100%);}
    .logo{display:flex;align-items:center;gap:${16 * s}px;}
    .logo img{width:${84 * s}px;height:${84 * s}px;}
    .name{font-size:${44 * s}px;font-weight:800;color:#fff;letter-spacing:-0.5px;}
    .name b{color:#ff7a33;}
    .tag{font-size:${17 * s}px;font-weight:600;color:#94a3b8;max-width:${w * 0.82}px;line-height:1.4;}
    .chips{display:flex;flex-wrap:wrap;gap:${8 * s}px;justify-content:center;}
    .chip{font-size:${13 * s}px;font-weight:700;color:#2dd4bf;border:1px solid #2f3540;
      border-radius:${999 * s}px;padding:${4 * s}px ${12 * s}px;}
  </style></head><body><div class="tile">
    <div class="logo"><img src="${iconDataUri}"><div class="name">Tracking <b>Auditor</b></div></div>
    <div class="tag">Every GA4, Meta, Bing, TikTok, Pinterest, Google Ads and LinkedIn hit of the inspected tab — decoded live in DevTools.</div>
    <div class="chips"><span class="chip">GA4</span><span class="chip">Meta</span><span class="chip">Bing</span><span class="chip">TikTok</span><span class="chip">Pinterest</span><span class="chip">Google Ads</span><span class="chip">LinkedIn</span></div>
  </div></body></html>`;
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

    await light.locator('.ev').first().click();   // expand the first card's parameter table
    await light.evaluate(() => window.scrollTo(0, 0));
    await light.screenshot({ path: join(outDir, '02-event-detail.png') });
    shots.push('02-event-detail.png');

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
  for (const s of shots) console.log(`  • ${s}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
