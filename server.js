const express = require('express');
const { chromium } = require('playwright');
const { spawn }    = require('child_process');
const http         = require('http');
const path = require('path');
const fs   = require('fs');

const app = express();
const PORT = 3000;

// --- Vinted domain options ---
const VINTED_DOMAINS = {
  com: 'https://www.vinted.com',
  fr:  'https://www.vinted.fr',
  uk:  'https://www.vinted.co.uk',
  de:  'https://www.vinted.de',
  es:  'https://www.vinted.es',
  nl:  'https://www.vinted.nl',
  pl:  'https://www.vinted.pl',
  be:  'https://www.vinted.be',
  it:  'https://www.vinted.it',
};

// -----------------------------------------------------------------------
// Chrome CDP approach — spawn real Chrome independently, connect via CDP.
// Chrome runs WITHOUT --enable-automation, so navigator.webdriver = false
// and Cloudflare cannot detect automation.
// -----------------------------------------------------------------------
const DEBUG_PORT  = 9222;
const PROFILE_DIR = path.join(__dirname, '.cf-profile');

let _cdpBrowser = null;   // Playwright CDP connection
const _pages = {};        // cached page per domain
let _launchLock = null;   // serialise concurrent calls

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

function cleanLocks(dir) {
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.rmSync(path.join(dir, f)); } catch (_) {}
  }
}

function isChromeUp() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${DEBUG_PORT}/json/version`, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
  });
}

async function ensureChrome() {
  if (await isChromeUp()) return;

  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome/Edge not found. Install Google Chrome or set CHROME_PATH env var.');

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  cleanLocks(PROFILE_DIR);

  console.log(`Launching Chrome: ${chromePath}`);
  spawn(chromePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
  ], { detached: true, stdio: 'ignore' }).unref();

  // Wait up to 15 s for Chrome to be ready
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isChromeUp()) { console.log('Chrome ready on port', DEBUG_PORT); return; }
  }
  throw new Error('Chrome did not start in time.');
}

async function getVintedPage(domain, baseUrl) {
  if (_pages[domain] && !_pages[domain].isClosed()) return _pages[domain];

  // Serialise to prevent two simultaneous Chrome launches
  if (_launchLock) {
    await _launchLock;
    if (_pages[domain] && !_pages[domain].isClosed()) return _pages[domain];
  }

  let resolveLock;
  _launchLock = new Promise(r => { resolveLock = r; });

  try {
    await ensureChrome();

    if (!_cdpBrowser || !_cdpBrowser.isConnected()) {
      console.log('Connecting to Chrome via CDP...');
      _cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
      _cdpBrowser.on('disconnected', () => {
        _cdpBrowser = null;
        Object.keys(_pages).forEach(k => delete _pages[k]);
        console.log('Chrome disconnected — will reconnect on next request.');
      });
    }

    // Reuse the default browser context (it has the persistent cookies)
    const ctx = _cdpBrowser.contexts()[0] || await _cdpBrowser.newContext();
    const page = await ctx.newPage();
    await page.bringToFront();

    console.log(`[${domain}] Navigating to ${baseUrl}/catalog ...`);
    await page.goto(baseUrl + '/catalog', { waitUntil: 'load', timeout: 30000 }).catch(() => {});

    // Wait for any Cloudflare challenge to resolve (usually auto-passes with real Chrome)
    console.log(`[${domain}] Waiting for Cloudflare...`);
    await page.waitForFunction(
      () => !document.title.includes('Just a moment') &&
            !document.title.includes('Please wait') &&
            document.title.length > 0,
      { timeout: 30000 }
    ).catch(() => {});

    const title = await page.title().catch(() => '?');
    console.log(`[${domain}] Ready: "${title}"`);

    _pages[domain] = page;
    return page;
  } finally {
    resolveLock();
    _launchLock = null;
  }
}

// Mean helper
function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// -----------------------------------------------------------------------
// Brand priority scores — higher = better resale demand
// Normalised 0-10; items not in map get 0.
// -----------------------------------------------------------------------
const BRAND_SCORES = {
  // Streetwear / hype
  'supreme': 10, 'palace': 10, 'stussy': 9, 'stüssy': 9, 'off-white': 10,
  'bape': 10, 'a bathing ape': 10, 'cdg': 9, 'comme des garcons': 9,
  'comme des garçons': 9, 'kith': 8, 'fear of god': 9, 'essentials': 7,
  'obey': 6, 'huf': 6, 'carhartt': 7, 'carhartt wip': 8,
  // Footwear
  'nike': 8, 'jordan': 10, 'air jordan': 10, 'adidas': 7, 'yeezy': 10,
  'new balance': 7, 'asics': 6, 'salomon': 7, 'converse': 5, 'vans': 5,
  'reebok': 5, 'puma': 5, 'saucony': 6, 'nb': 6, 'onitsuka tiger': 7,
  // Luxury
  'louis vuitton': 10, 'gucci': 10, 'prada': 10, 'burberry': 9,
  'stone island': 9, 'moncler': 10, 'canada goose': 9, 'ralph lauren': 7,
  'lacoste': 6, 'hugo boss': 6, 'versace': 9, 'balenciaga': 10,
  'givenchy': 9, 'fendi': 9, 'dior': 10, 'saint laurent': 10,
  'alexander mcqueen': 9, 'bottega veneta': 9,
  // Sport / outdoor
  'north face': 8, 'the north face': 8, 'arc\'teryx': 9, 'arcteryx': 9,
  'patagonia': 8, 'columbia': 6, 'berghaus': 6,
  // Tech / gaming collectibles
  'apple': 8, 'sony': 7, 'nintendo': 8, 'lego': 8,
};

function brandScore(brandName) {
  const key = (brandName || '').toLowerCase().trim();
  return BRAND_SCORES[key] ?? 0;
}

// -----------------------------------------------------------------------
// Similarity grouping: group items by brand + extracted product model
// so each item is only compared against truly similar listings.
// -----------------------------------------------------------------------
const STOP_WORDS = new Set([
  'the','a','an','in','on','at','for','to','with','and','or','of','by','from',
  'size','xs','s','m','l','xl','xxl','new','used','good','very','great','like',
  'condition','excellent','perfect','lovely','nice','beautiful','stunning',
  'ladies','womens','mens','boys','girls','kids','junior','adult','unisex',
  'official','authentic','genuine','original','rare','limited','edition',
  'bundle','lot','set','pair','single','item','piece','vintage','retro',
  'second','hand','preloved','worn','once','barely','never',
]);

function titleKeywords(title, brand) {
  let text = (title || '').toLowerCase();
  // Remove brand name to avoid it dominating the key
  if (brand) text = text.replace(brand.toLowerCase(), '');
  return text
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
    .slice(0, 3)
    .join(' ');
}

/**
 * Groups items so each item is compared only against similar ones.
 * Strategy:
 *   1. Try brand + top-3-keywords (needs >= MIN_GROUP items)
 *   2. Fall back to brand + top-1-keyword
 *   3. Fall back to brand only
 * Returns: { annotated, groups }
 */
const MIN_GROUP = 2;

function buildComparisonGroups(items) {
  const annotated = items.map(item => {
    const brand = (item.brand_title || '').toLowerCase().trim() || 'unknown';
    const kw3   = titleKeywords(item.title, brand);
    const kw1   = kw3.split(' ')[0] || '';
    return { ...item, _brand: brand, _kw3: kw3, _kw1: kw1 };
  });

  const level3 = {};
  const level1 = {};
  const level0 = {};

  for (const item of annotated) {
    const k3 = `${item._brand}||${item._kw3}`;
    const k1 = `${item._brand}||${item._kw1}`;
    const k0 = item._brand;
    (level3[k3] = level3[k3] || []).push(item);
    (level1[k1] = level1[k1] || []).push(item);
    (level0[k0] = level0[k0] || []).push(item);
  }

  const groups = new Map();

  for (const item of annotated) {
    const k3 = `${item._brand}||${item._kw3}`;
    const k1 = `${item._brand}||${item._kw1}`;
    const k0 = item._brand;

    let chosenKey, chosenPool, chosenLabel;
    if (level3[k3].length >= MIN_GROUP) {
      chosenKey   = k3;
      chosenPool  = level3[k3];
      chosenLabel = `${item._kw3 || item._brand}`.trim();
    } else if (level1[k1] && level1[k1].length >= MIN_GROUP) {
      chosenKey   = k1;
      chosenPool  = level1[k1];
      chosenLabel = `${item._brand} ${item._kw1}`.trim();
    } else if (level0[k0] && level0[k0].length >= MIN_GROUP) {
      chosenKey   = k0;
      chosenPool  = level0[k0];
      chosenLabel = item._brand;
    } else {
      continue;
    }

    if (!groups.has(chosenKey)) {
      const prices = chosenPool.map(i => i._price);
      groups.set(chosenKey, {
        items:     chosenPool,
        meanPrice: mean(prices),   // ← mean, not median
        label:     chosenLabel,
      });
    }

    item._groupKey   = chosenKey;
    item._groupMean  = groups.get(chosenKey).meanPrice;  // ← _groupMean
    item._groupLabel = groups.get(chosenKey).label;
    item._groupSize  = groups.get(chosenKey).items.length;
  }

  return { annotated, groups };
}

// -----------------------------------------------------------------------
// Vinted fee structure (buyer pays on top of item price)
//   Buyer protection: 5% of item price + €0.70 flat
//   Estimated postage: €4.50 (conservative average across EU/UK)
// -----------------------------------------------------------------------
const PROTECTION_RATE = 0.05;
const PROTECTION_FLAT = 0.70;
const ESTIMATED_POSTAGE = 4.50;

function totalBuyCost(price) {
  return price + (price * PROTECTION_RATE + PROTECTION_FLAT) + ESTIMATED_POSTAGE;
}

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Status endpoint so the frontend can check if the session is ready
app.get('/api/status', (req, res) => {
  const domain = req.query.domain || 'uk';
  const page   = _pages[domain];
  if (!page || page.isClosed()) return res.json({ ready: false, status: 'not_started' });
  page.title().then(title => {
    const blocked = title.includes('Just a moment') || title.includes('Please wait');
    if (blocked) {
      res.json({ ready: false, status: 'verifying', message: 'Cloudflare check in progress — please wait for the browser window to finish loading.' });
    } else {
      res.json({ ready: true, status: 'ready' });
    }
  }).catch(() => res.json({ ready: false, status: 'unknown' }));
});

// -----------------------------------------------------------------------
// GET /api/search
// query params:
//   q           – search term (required)
//   domain      – vinted domain key, default "com"
//   minProfit   – minimum profit after all fees (€), default 8
//   pages       – number of pages to fetch (1-5), default 2
//   sort        – newest | price_asc | price_desc | relevance
// -----------------------------------------------------------------------
app.get('/api/search', async (req, res) => {
  const {
    q,
    domain     = 'com',
    minProfit  = '8',
    minHearts  = '3',
    maxPrice   = '0',   // 0 = no limit
    maxAgeDays = '0',   // 0 = no limit
    pages      = '2',
    sort       = 'relevance',
    sessionCookie = '',  // optional manual cookie bypass
  } = req.query;

  if (!q || q.trim() === '') {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  const baseUrl = VINTED_DOMAINS[domain] || VINTED_DOMAINS.com;

  try {
    const vintedPage = await getVintedPage(domain, baseUrl);

    const ORDER_MAP = {
      relevance: 'relevance',
      newest:    'newest_first',
      price_asc: 'price_low_to_high',
      price_desc: 'price_high_to_low',
    };

    const orderBy = ORDER_MAP[sort] || 'relevance';
    const maxPages = Math.min(parseInt(pages) || 2, 10);

    let allItems = [];

    for (let pg = 1; pg <= maxPages; pg++) {
      const qs = new URLSearchParams({
        search_text: q.trim(),
        per_page: '96',
        page: String(pg),
        order: orderBy,
      }).toString();

      const data = await vintedPage.evaluate(async ([apiUrl, queryString]) => {
        const r = await fetch(`${apiUrl}?${queryString}`, {
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }, [`${baseUrl}/api/v2/catalog/items`, qs]);

      const items = data?.items || [];
      allItems = allItems.concat(items);
      if (items.length < 96) break;
    }

    if (allItems.length === 0) {
      return res.json({ items: [], avgPrice: 0, medianPrice: 0, totalFetched: 0 });
    }

    // Parse prices (Vinted returns price as a string like "12.50")
    const withPrices = allItems.map(item => ({
      ...item,
      _price: parseFloat(item.price?.amount ?? item.price ?? 0),
    })).filter(item => item._price > 0);

    const minProfitVal  = Math.max(parseFloat(minProfit) || 8, 0);
    const minHeartsVal  = Math.max(parseInt(minHearts)   || 0, 0);
    const maxPriceVal   = Math.max(parseFloat(maxPrice)  || 0, 0);  // 0 = no limit
    const maxAgeDaysVal = Math.max(parseFloat(maxAgeDays) || 0, 0);

    // ── Similarity-based comparison ──────────────────────────────────────
    const { annotated } = buildComparisonGroups(withPrices);

    // Recency: use item ID as a sequential proxy (higher ID = newer listing)
    const ids   = annotated.map(i => Number(i.id));
    const minId = Math.min(...ids);
    const maxId = Math.max(...ids);
    const idRange = maxId - minId || 1;

    // If maxAgeDays is set, estimate a minimum ID cutoff.
    // Vinted issues roughly 500k–1M new item IDs per day across the platform.
    // We use 700k/day as a conservative estimate for the cutoff.
    const ID_PER_DAY = 700_000;
    const minIdCutoff = maxAgeDaysVal > 0
      ? maxId - Math.round(maxAgeDaysVal * ID_PER_DAY)
      : 0;

    // ID_PER_MINUTE: 700k IDs/day ÷ 1440 min
    const ID_PER_MINUTE = ID_PER_DAY / 1440;

    const underpriced = annotated
      .filter(item => {
        if (item._groupMean == null) return false;
        const hearts = item.favourite_count ?? item.favourites_count ?? 0;
        if (hearts < minHeartsVal) return false;
        if (maxPriceVal > 0 && item._price > maxPriceVal) return false;  // max buy price gate
        if (maxAgeDaysVal > 0 && Number(item.id) < minIdCutoff) return false;  // age gate
        const buyCost = totalBuyCost(item._price);
        return (item._groupMean - buyCost) >= minProfitVal;
      })
      .map(item => {
        const buyCost = totalBuyCost(item._price);
        const estimatedProfit = Math.round((item._groupMean - buyCost) * 100) / 100;
        const discount = Math.round(((item._groupMean - item._price) / item._groupMean) * 100);
        const hearts   = item.favourite_count ?? item.favourites_count ?? 0;

        // Age as days and minutes
        const ageDays    = (maxId - Number(item.id)) / ID_PER_DAY;
        const ageMinutes = (maxId - Number(item.id)) / ID_PER_MINUTE;

        // Freshness 0-1: brand new = 1.0, 30+ days = 0.0
        const freshness = Math.max(0, 1 - ageDays / 30);

        // Like velocity: hearts per minute (capped to avoid div/0 on newest item)
        const likeVelocity = ageMinutes > 0.5 ? hearts / ageMinutes : hearts * 2;

        // Brand priority boost (0-10 scale, normalised to 0-1 for scoring)
        const bScore  = brandScore(item.brand_title);
        const brandBoost = bScore / 10;  // 0.0 – 1.0

        // Is it very fresh? < 5 minutes estimated
        const isHot  = ageMinutes < 5;
        const isNew  = ageDays < 1;

        // ── Composite hotScore ──────────────────────────────────────────
        // Base: profit potential
        // × hearts signal (log-like curve)
        // × freshness curve
        // + brand bonus (adds up to 20% on top for top-tier brands)
        // + velocity surge (high velocity = extra push)
        const hotScore =
          estimatedProfit
          * Math.pow(1 + hearts, 0.4)
          * (0.3 + 0.7 * freshness)
          * (1 + 0.2 * brandBoost)
          + Math.min(likeVelocity, 5) * estimatedProfit * 0.1;

        return {
          ...item,
          _estimatedProfit: estimatedProfit,
          _discount: discount,
          _freshness: freshness,
          _ageDays: ageDays,
          _ageMinutes: ageMinutes,
          _hotScore: hotScore,
          _isNew: isNew,
          _isHot: isHot,
          _likeVelocity: likeVelocity,
          _brandBoost: bScore,
        };
      })
      .sort((a, b) => b._hotScore - a._hotScore);  // best overall value first

    // Global stats
    const prices   = withPrices.map(i => i._price);
    const avgPrice = mean(prices);

    // Shape items for the frontend
    const shaped = underpriced.map(item => ({
      id:              item.id,
      title:           item.title,
      price:           item._price,
      currency:        item.price?.currency_code ?? 'EUR',
      discount:        item._discount,
      estimatedProfit: item._estimatedProfit,
      buyCost:         Math.round(totalBuyCost(item._price) * 100) / 100,
      hearts:          item.favourite_count ?? item.favourites_count ?? 0,
      freshness:       Math.round(item._freshness * 100),  // 0-100
      ageDays:         Math.round(item._ageDays * 10) / 10,
      ageMinutes:      Math.round(item._ageMinutes * 10) / 10,
      isNew:           item._isNew,
      isHot:           item._isHot,
      likeVelocity:    Math.round(item._likeVelocity * 100) / 100,
      brandBoost:      item._brandBoost,  // 0-10
      hotScore:        Math.round(item._hotScore * 10) / 10,
      image:           item.photos?.[0]?.url ?? item.photo?.url ?? null,
      url:             item.url ?? `${baseUrl}/items/${item.id}`,
      brand:           item.brand_title ?? '',
      size:            item.size_title ?? '',
      condition:       item.status ?? '',
      groupMean:       Math.round(item._groupMean * 100) / 100,
      groupSize:       item._groupSize,
      groupLabel:      item._groupLabel,
    }));

    res.json({
      items:        shaped,
      avgPrice:     Math.round(avgPrice * 100) / 100,
      totalFetched: withPrices.length,
      currency:     withPrices[0]?.price?.currency_code ?? 'EUR',
    });
  } catch (err) {
    console.error(`[${domain}] Error:`, err.message);
    // If the page crashed, clear it so next request gets a fresh one
    delete _pages[domain];
    res.status(502).json({ error: 'api_error', message: `Failed to reach Vinted: ${err.message}` });
  }
});

app.listen(PORT, async () => {
  console.log(`\n✅  Vinted Finder running at http://localhost:${PORT}\n`);
  console.log('Pre-warming Chrome session...');
  console.log('A Chrome window will open — Cloudflare should pass automatically.\n');
  getVintedPage('uk', VINTED_DOMAINS.uk).catch(e => console.error('Pre-warm failed:', e.message));
});
