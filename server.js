const express = require('express');
const { chromium } = require('playwright');
const { spawn }    = require('child_process');
const http         = require('http');
const https        = require('https');
const path = require('path');
const fs   = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));
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
};

function brandScore(brandName) {
  const key = (brandName || '').toLowerCase().trim();
  return BRAND_SCORES[key] ?? 0;
}

// All brand names as a sorted-by-length list for hidden brand scanning
// (longest first so 'carhartt wip' matches before 'carhartt')
const BRAND_NAMES_SORTED = Object.keys(BRAND_SCORES).sort((a, b) => b.length - a.length);

// Keyword clues: phrases that strongly indicate a brand even when the brand
// name itself is NOT written in the listing title/description.
// Sorted longest-first so more-specific phrases match before shorter ones.
const BRAND_KEYWORD_CLUES = [
  // Supreme
  { brand: 'supreme',        score: 10, phrases: ['box logo', 'bogo hoodie', 'bogo tee', 'bogo crewneck', 'sup box'] },
  // Air Jordan / Jordan
  { brand: 'air jordan',     score: 10, phrases: ['jumpman', 'jordan 1', 'jordan 3', 'jordan 4', 'jordan 11', 'retro jordan', 'aj1', 'aj4', 'aj11'] },
  // BAPE
  { brand: 'bape',           score: 10, phrases: ['a bathing ape', 'baby milo', 'ape head', 'shark hoodie', 'bape camo', 'ape camo'] },
  // Off-White
  { brand: 'off-white',      score: 10, phrases: ['off white hoodie', 'off white tee', 'virgil abloh', 'industrial belt', 'arrow hoodie', 'off-white belt'] },
  // Balenciaga
  { brand: 'balenciaga',     score: 10, phrases: ['triple s', 'speed trainer'] },
  // Louis Vuitton
  { brand: 'louis vuitton',  score: 10, phrases: ['lv monogram', 'damier canvas', 'speedy bag', 'neverfull', 'lv belt', 'lv wallet', 'lv bag', 'monogram canvas'] },
  // Gucci
  { brand: 'gucci',          score: 10, phrases: ['gg monogram', 'gg canvas', 'gg logo', 'gucci belt', 'gucci bag', 'interlocking g'] },
  // Moncler
  { brand: 'moncler',        score: 10, phrases: ['moncler badge', 'moncler patch', 'moncler logo'] },
  // Stone Island
  { brand: 'stone island',   score: 9,  phrases: ['compass badge', 'compass patch', 'stone badge', 'stone patch'] },
  // Burberry
  { brand: 'burberry',       score: 9,  phrases: ['nova check', 'burberry check', 'burberry plaid', 'knight logo', 'tb monogram'] },
  // Canada Goose
  { brand: 'canada goose',   score: 9,  phrases: ['arctic programme', 'expedition parka canada', 'cg patch'] },
  // Arc'teryx
  { brand: "arc'teryx",      score: 9,  phrases: ['arcteryx', 'arc\'teryx', 'leaf jacket', 'beta sl', 'beta ar', 'beta lt', 'atom lt', 'atom ar'] },
  // Fear of God
  { brand: 'fear of god',    score: 9,  phrases: ['fog essentials', 'fog hoodie', 'fog tee', 'essentials hoodie fear', 'essentials pullover'] },
  // The North Face
  { brand: 'the north face', score: 8,  phrases: ['tnf jacket', 'tnf hoodie', 'tnf coat', 'tnf gilet', 'tnf puffer', 'north face logo', 'nuptse puffer', 'nuptse jacket'] },
  // Nike
  { brand: 'nike',           score: 8,  phrases: ['just do it', 'swoosh logo', 'air max 90', 'air max 95', 'air max 97', 'air force 1', 'af1', 'dunk low', 'dunk high', 'sb dunk', 'tn air', 'nike tn', 'tech fleece'] },
  // Adidas
  { brand: 'adidas',         score: 7,  phrases: ['trefoil logo', 'stan smith', 'ultraboost', 'ultra boost', 'nmd r1', '3 stripe', 'three stripe', 'three stripes', 'adidas originals'] },
  // Carhartt
  { brand: 'carhartt wip',   score: 8,  phrases: ['carhartt wip', 'chase hoodie', 'nimbus pullover', 'carhartt detroit', 'carhartt michigan'] },
  // Ralph Lauren
  { brand: 'ralph lauren',   score: 7,  phrases: ['polo bear', 'polo pony logo', 'rl logo', 'polo ralph', 'ralph lauren polo'] },
  // Patagonia
  { brand: 'patagonia',      score: 8,  phrases: ['better sweater', 'fleece patagonia', 'retro pile', 'synchilla', 'nano puff', 'down sweater patagonia'] },
];
// Sort longest phrase first for greedy matching
BRAND_KEYWORD_CLUES.forEach(e => e.phrases.sort((a, b) => b.length - a.length));

/**
 * Scan title + description for:
 *   1. Any known brand name (word-boundary match, handles punctuation)
 *   2. Any keyword clue phrase that implies a brand even without the name
 * Returns { brand, score } for the best match, or null.
 */
function detectHiddenBrand(title, description, officialBrand) {
  const haystack = ((title || '') + ' ' + (description || '')).toLowerCase();
  const official = (officialBrand || '').toLowerCase().trim();

  // --- Pass 1: keyword clues (title only — clues are strong signals) ---
  const titleLower = (title || '').toLowerCase();
  for (const entry of BRAND_KEYWORD_CLUES) {
    if (official === entry.brand || official.includes(entry.brand) || entry.brand.includes(official)) continue;
    for (const phrase of entry.phrases) {
      // require phrase surrounded by non-alphanumeric or string boundaries
      const re = new RegExp(`(?:^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`);
      if (re.test(titleLower) || re.test(haystack)) {
        return entry.brand;
      }
    }
  }

  // --- Pass 2: literal brand name in title/description (not already tagged) ---
  for (const b of BRAND_NAMES_SORTED) {
    if (official === b || official.includes(b) || (b.length > 4 && official.includes(b))) continue;
    if (BRAND_SCORES[b] < 5) continue;
    // Match brand name not surrounded by alphanumeric chars (handles punctuation like "supreme!" or "(supreme)")
    const re = new RegExp(`(?:^|[^a-z0-9])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`);
    if (re.test(haystack)) return b;
  }

  return null;
}

// Size demand map — higher = sells faster / broader audience
const SIZE_DEMAND = {
  'm': 2, 'l': 2,
  'xl': 1, 's': 1,
  'xxl': 0.5, 'xs': 0.5,
  // EU numeric — approximate mapping to M/L range
  '38': 1, '40': 2, '42': 2, '44': 1, '46': 0.5,
  // US numeric
  '10': 1, '12': 2, '14': 2,
};

function sizeDemandScore(sizeTitle) {
  const key = (sizeTitle || '').toLowerCase().trim();
  return SIZE_DEMAND[key] ?? 0;
}

// Vinted condition slug → resale-value multiplier
// Applied to estimatedProfit so poorer condition items score lower.
const CONDITION_MULTIPLIER = {
  'new_with_tags':    1.00,
  'new_without_tags': 0.95,
  'very_good':        0.85,
  'good':             0.70,
  'satisfactory':     0.50,
};

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
const ESTIMATED_POSTAGE = 2.50;

function totalBuyCost(price) {
  return price + (price * PROTECTION_RATE + PROTECTION_FLAT) + ESTIMATED_POSTAGE;
}

// -----------------------------------------------------------------------
// eBay UK sold-price scraper
// Fetches the mean sold/completed price for a search query from eBay UK.
// Results are cached in memory for 2 hours to avoid hammering eBay.
// -----------------------------------------------------------------------
const EBAY_CACHE     = new Map();  // key -> { mean, count, cachedAt }
const EBAY_CACHE_TTL = 2 * 60 * 60 * 1000;  // 2 hours

function fetchEbaySoldMean(query) {
  const key = query.toLowerCase().trim();
  const hit = EBAY_CACHE.get(key);
  if (hit && Date.now() - hit.cachedAt < EBAY_CACHE_TTL) return Promise.resolve(hit);

  const qs  = new URLSearchParams({ _nkw: query, LH_Sold: '1', LH_Complete: '1', _sop: '13', _ipg: '60' }).toString();
  const url = `https://www.ebay.co.uk/sch/i.html?${qs}`;

  return new Promise(resolve => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept': 'text/html',
      },
      timeout: 10000,
    }, res => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let html = '';
      res.setEncoding('utf8');
      res.on('data', c => { html += c; });
      res.on('end', () => {
        // Split on the class marker and grab the first price-like value after each
        const parts = html.split('s-item__price');
        const prices = [];
        for (let i = 1; i < parts.length; i++) {
          const snippet = parts[i].substring(0, 150);
          const m = snippet.match(/[£$€]\s*([\d,]+\.?\d*)/);
          if (m) {
            const p = parseFloat(m[1].replace(/,/g, ''));
            if (p >= 1 && p <= 5000) prices.push(p);
          }
        }
        if (prices.length < 3) { resolve(null); return; }
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const result = { mean: Math.round(avg * 100) / 100, count: prices.length, cachedAt: Date.now() };
        EBAY_CACHE.set(key, result);
        console.log(`[eBay] "${query}" → £${result.mean} avg from ${result.count} sold listings`);
        resolve(result);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
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

  // Kick off eBay sold-price fetch in parallel with the Vinted scrape
  const ebayPromise = fetchEbaySoldMean(q.trim());

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
      return res.json({
        items: [],
        avgPrice: 0,
        medianPrice: 0,
        totalFetched: 0,
        filterStats: {
          totalFetched: 0,
          pricedItems: 0,
          filteredHearts: 0,
          filteredMaxPrice: 0,
          filteredAge: 0,
          filteredMoncler: 0,
          filteredSellerTrust: 0,
          filteredNoMarketRef: 0,
          filteredLowSpread: 0,
          passedBySpread: 0,
          passedByKnitFallback: 0,
          passedByOpportunityFallback: 0,
          passedTotal: 0,
        },
      });
    }

    // Parse prices (Vinted returns price as a string like "12.50")
    const withPrices = allItems.map(item => ({
      ...item,
      _price: parseFloat(item.price?.amount ?? item.price ?? 0),
    })).filter(item => item._price > 0);

    if (withPrices.length === 0) {
      return res.json({
        items: [],
        avgPrice: 0,
        medianPrice: 0,
        totalFetched: allItems.length,
        filterStats: {
          totalFetched: allItems.length,
          pricedItems: 0,
          filteredHearts: 0,
          filteredMaxPrice: 0,
          filteredAge: 0,
          filteredMoncler: 0,
          filteredSellerTrust: 0,
          filteredNoMarketRef: 0,
          filteredLowSpread: 0,
          passedBySpread: 0,
          passedByKnitFallback: 0,
          passedByOpportunityFallback: 0,
          passedTotal: 0,
        },
      });
    }

    const minProfitVal  = Math.max(parseFloat(minProfit) || 8, 0);
    const minHeartsVal  = Math.max(parseInt(minHearts)   || 0, 0);
    const maxPriceVal   = Math.max(parseFloat(maxPrice)  || 0, 0);  // 0 = no limit
    const maxAgeDaysVal = Math.max(parseFloat(maxAgeDays) || 0, 0);

    // ── Moncler authenticity gate ────────────────────────────────────────
    // Fakes are rampant. Require at least 2 of these signals to pass:
    //   1. Auth keywords in title/description (barcode, qr, serial, certificate, etc.)
    //   2. At least 3 photos (genuine sellers photograph the auth tag)
    //   3. Price >= £80 (fakes are always suspiciously cheap)
    const MONCLER_AUTH_KEYWORDS = [
      'authenticity', 'authentic', 'certificate', 'auth card', 'barcode',
      'qr code', 'qr tag', 'serial', 'hologram', 'dust bag', 'original tag',
      'original receipt', 'receipt', 'guarantee card', 'care card',
    ];
    function isMonclerItem(item) {
      const brand = (item.brand_title || '').toLowerCase();
      const title = (item.title || '').toLowerCase();
      return brand.includes('moncler') || title.includes('moncler');
    }
    function passesMonclerCheck(item) {
      if (!isMonclerItem(item)) return true; // not Moncler — no restriction
      const text = ((item.title || '') + ' ' + (item.description ?? item.short_description ?? '')).toLowerCase();
      const photoCount = item.photos?.length ?? (item.photo ? 1 : 0);
      const hasAuthKeyword = MONCLER_AUTH_KEYWORDS.some(kw => text.includes(kw));
      const hasEnoughPhotos = photoCount >= 3;
      const hasMinPrice = item._price >= 80;
      const signals = (hasAuthKeyword ? 1 : 0) + (hasEnoughPhotos ? 1 : 0) + (hasMinPrice ? 1 : 0);
      return signals >= 2;
    }

    // ── Similarity-based comparison ──────────────────────────────────────
    const { annotated } = buildComparisonGroups(withPrices);
    const queryMeanPrice = mean(withPrices.map(i => i._price));

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

    // ── Repost / repeated-listing detection ─────────────────────────────
    // Same seller listing the same brand 3+ times in one batch is a signal
    // the item isn't moving. Flag it so the UI can warn the user.
    const _repostCount = new Map();
    for (const item of annotated) {
      const k = `${item.user?.id ?? '?'}|${(item.brand_title || '').toLowerCase()}`;
      _repostCount.set(k, (_repostCount.get(k) ?? 0) + 1);
    }

    // Resolve eBay sold mean before filtering so it can act as fallback market value.
    const ebay = await ebayPromise.catch(() => null);
    const ebayMean = ebay?.mean ?? null;

    const filterStats = {
      totalFetched: allItems.length,
      pricedItems: withPrices.length,
      filteredHearts: 0,
      filteredMaxPrice: 0,
      filteredAge: 0,
      filteredMoncler: 0,
      filteredSellerTrust: 0,
      filteredNoMarketRef: 0,
      filteredLowSpread: 0,
      passedBySpread: 0,
      passedByKnitFallback: 0,
      passedByOpportunityFallback: 0,
      passedTotal: 0,
    };

    const KNITWEAR_RE = /(knit|jumper|sweater|v neck|crew neck|cable|fair isle|quarter zip|roll neck|turtleneck)/;

    function marketReference(item) {
      return Math.max(item._groupMean ?? 0, ebayMean ?? 0, queryMeanPrice ?? 0);
    }

    function baseCandidateChecks(item, countStats = false) {
      const hearts = item.favourite_count ?? item.favourites_count ?? 0;
      if (hearts < minHeartsVal) { if (countStats) filterStats.filteredHearts++; return false; }
      if (maxPriceVal > 0 && item._price > maxPriceVal) { if (countStats) filterStats.filteredMaxPrice++; return false; }
      if (maxAgeDaysVal > 0 && Number(item.id) < minIdCutoff) { if (countStats) filterStats.filteredAge++; return false; }
      if (!passesMonclerCheck(item)) { if (countStats) filterStats.filteredMoncler++; return false; }
      const sellerRep = item.user?.feedback_reputation ?? 0.5;
      const sellerSales = item.user?.positive_feedback_count ?? 0;
      if (sellerRep < 0.6 && sellerSales < 3) { if (countStats) filterStats.filteredSellerTrust++; return false; }
      if (marketReference(item) <= 0) { if (countStats) filterStats.filteredNoMarketRef++; return false; }
      return true;
    }

    function decorateCandidate(item, sourceMode = 'strict') {
      const marketRef = marketReference(item);
      const buyCost = totalBuyCost(item._price);
      const estimatedProfit = Math.round(Math.max(marketRef - buyCost, 0) * 100) / 100;
      const discount = marketRef > 0
        ? Math.round(((marketRef - item._price) / marketRef) * 100)
        : 0;
      const hearts   = item.favourite_count ?? item.favourites_count ?? 0;
      const ageDays    = (maxId - Number(item.id)) / ID_PER_DAY;
      const ageMinutes = (maxId - Number(item.id)) / ID_PER_MINUTE;
      const freshness = Math.max(0, 1 - ageDays / 30);
      const likeVelocity = ageMinutes > 0.5 ? hearts / ageMinutes : hearts * 2;
      const bScore     = brandScore(item.brand_title);
      const brandBoost = bScore / 10;
      const hiddenBrand = detectHiddenBrand(
        item.title,
        item.description ?? item.short_description ?? '',
        item.brand_title
      );
      const hiddenBrandScore = hiddenBrand ? (BRAND_SCORES[hiddenBrand] ?? 0) : 0;
      const isPremiumBrand     = bScore >= 8 || hiddenBrandScore >= 8;
      const isMispricedPremium = isPremiumBrand && item._groupMean > 0 && item._price < item._groupMean * 0.5;
      const szDemand = sizeDemandScore(item.size_title);
      const isHot  = ageMinutes < 5;
      const isNew  = ageDays < 1;
      const condKey = (item.status_slug ?? item.status ?? '').toLowerCase().replace(/\s+/g, '_');
      const condMultiplier = CONDITION_MULTIPLIER[condKey] ?? 0.80;
      const conditionAdjustedProfit = Math.round(estimatedProfit * condMultiplier * 100) / 100;
      const sellerRep   = item.user?.feedback_reputation ?? 0.5;
      const sellerSales = item.user?.positive_feedback_count ?? 0;
      const sellerTrust = (sellerRep >= 0.95 && sellerSales >= 20) ? 'high'
                        : (sellerRep >= 0.80 && sellerSales >= 5)  ? 'ok'
                        : 'low';
      const _repostKey = `${item.user?.id ?? '?'}|${(item.brand_title || '').toLowerCase()}`;
      const isRepost   = (_repostCount.get(_repostKey) ?? 0) >= 3;
      const discountedProfit = conditionAdjustedProfit * 0.6;
      const hotScore =
        Math.pow(1 + hearts, 0.7)
        * (1 + discount / 100)
        * (0.4 + 0.6 * freshness)
        * (1 + 0.3 * brandBoost)
        + discountedProfit * 0.5
        + Math.min(likeVelocity, 5) * 3
        + szDemand * 2
        + (isMispricedPremium ? 20 : 0)
        + (hiddenBrand ? hiddenBrandScore * 1.5 : 0)
        + (sourceMode === 'opportunity' ? 12 : 0);

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
        _hiddenBrand: hiddenBrand,
        _isMispricedPremium: isMispricedPremium,
        _sizeDemand: szDemand,
        _condMultiplier: condMultiplier,
        _conditionAdjustedProfit: conditionAdjustedProfit,
        _sellerRep: sellerRep,
        _sellerSales: sellerSales,
        _sellerTrust: sellerTrust,
        _isRepost: isRepost,
        _sourceMode: sourceMode,
      };
    }

    const underpriced = annotated
      .filter(item => {
        if (!baseCandidateChecks(item, true)) return false;
        const buyCost = totalBuyCost(item._price);
        const marketRef = marketReference(item);
        const spread = marketRef - buyCost;
        if (spread >= minProfitVal) {
          filterStats.passedBySpread++;
          filterStats.passedTotal++;
          return true;
        }

        // Knitwear opportunity fallback: include deeply discounted RL knit pieces
        // even when fee-adjusted spread is thin, because these are often resold in bundles
        // or via better timing/seasonality than the strict fee model captures.
        const txt = `${item.title || ''} ${item.description ?? item.short_description ?? ''}`.toLowerCase();
        const isKnitwear = KNITWEAR_RE.test(txt);
        const discountPct = marketRef > 0 ? ((marketRef - item._price) / marketRef) * 100 : 0;
        if (isKnitwear && discountPct >= 20 && item._price <= marketRef * 0.8) {
          filterStats.passedByKnitFallback++;
          filterStats.passedTotal++;
          return true;
        }

        filterStats.filteredLowSpread++;
        return false;
      })
      .map(item => decorateCandidate(item, 'strict'))
      .sort((a, b) => b._hotScore - a._hotScore);  // best overall value first

    let finalCandidates = underpriced;
    if (finalCandidates.length === 0) {
      finalCandidates = annotated
        .filter(item => {
          if (!baseCandidateChecks(item, false)) return false;
          const txt = `${item.title || ''} ${item.description ?? item.short_description ?? ''}`.toLowerCase();
          if (!KNITWEAR_RE.test(txt)) return false;
          const marketRef = marketReference(item);
          const discountPct = marketRef > 0 ? ((marketRef - item._price) / marketRef) * 100 : 0;
          return discountPct >= 10 || item._price <= marketRef * 0.9;
        })
        .map(item => decorateCandidate(item, 'opportunity'))
        .sort((a, b) => (b._discount - a._discount) || (b._freshness - a._freshness) || (a._price - b._price))
        .slice(0, 24);

      filterStats.passedByOpportunityFallback = finalCandidates.length;
      filterStats.passedTotal = finalCandidates.length;
    }

    // Global stats
    const prices   = withPrices.map(i => i._price);
    const avgPrice = mean(prices);

    // Shape items for the frontend
    const shaped = finalCandidates.map(item => ({
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
      brandBoost:           item._brandBoost,       // 0-10
      hiddenBrand:          item._hiddenBrand ?? null,
      isMispricedPremium:   item._isMispricedPremium ?? false,
      sizeDemand:           item._sizeDemand ?? 0,
      hotScore:             Math.round(item._hotScore * 10) / 10,
      image:           item.photos?.[0]?.url ?? item.photo?.url ?? null,
      url:             item.url ?? `${baseUrl}/items/${item.id}`,
      brand:           item.brand_title ?? '',
      size:            item.size_title ?? '',
      condition:       item.status ?? '',
      condMultiplier:  item._condMultiplier ?? 1,
      conditionAdjustedProfit: item._conditionAdjustedProfit ?? item._estimatedProfit,
      sellerRep:       Math.round((item._sellerRep ?? 0.5) * 100),  // 0-100 pct
      sellerSales:     item._sellerSales ?? 0,
      sellerTrust:     item._sellerTrust ?? 'ok',
      isRepost:        item._isRepost ?? false,
      sourceMode:      item._sourceMode ?? 'strict',
      groupMean:       Math.round(item._groupMean * 100) / 100,
      groupSize:       item._groupSize,
      groupLabel:      item._groupLabel,
      ebaySoldMean:    ebay ? ebay.mean  : null,
      ebaySoldCount:   ebay ? ebay.count : null,
      ebayProfit:      ebay ? Math.round((ebay.mean - totalBuyCost(item._price)) * 100) / 100 : null,
    }));

    res.json({
      items:        shaped,
      avgPrice:     Math.round(avgPrice * 100) / 100,
      totalFetched: withPrices.length,
      currency:     withPrices[0]?.price?.currency_code ?? 'EUR',
      filterStats,
    });
  } catch (err) {
    console.error(`[${domain}] Error:`, err.message);
    // If the page crashed, clear it so next request gets a fresh one
    delete _pages[domain];
    res.status(502).json({ error: 'api_error', message: `Failed to reach Vinted: ${err.message}` });
  }
});

// -----------------------------------------------------------------------
// Persistent deal store — saved to deals.json (gitignored)
// Unseen items expire after 3 days; viewed items expire 7 days after last click.
// -----------------------------------------------------------------------
const DEALS_FILE = path.join(__dirname, 'deals.json');
const MAX_SAVED  = 100;

function loadDeals() {
  try { return JSON.parse(fs.readFileSync(DEALS_FILE, 'utf8')); }
  catch { return {}; }
}
function persistDeals(deals) { fs.writeFileSync(DEALS_FILE, JSON.stringify(deals, null, 2)); }
// Keep only the top MAX_SAVED deals by estimatedProfit.
// Preserves the __deleted blocklist so it is never pruned away.
function pruneDeals(deals) {
  const blocklist = deals.__deleted ?? {};
  const entries = Object.entries(deals).filter(([k]) => k !== '__deleted');
  if (entries.length > MAX_SAVED) {
    const top = entries
      .sort((a, b) => (b[1].estimatedProfit ?? 0) - (a[1].estimatedProfit ?? 0))
      .slice(0, MAX_SAVED);
    const result = Object.fromEntries(top);
    result.__deleted = blocklist;
    return result;
  }
  const result = Object.fromEntries(entries);
  result.__deleted = blocklist;
  return result;
}

// Merge the current scan's results into saved deals.
// Existing deals not in this scan are kept until displaced by better ones.
// Skips any item whose ID is in the __deleted blocklist (manually deleted by user).
app.post('/api/deals/save', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'array expected' });
  const old = loadDeals();
  const blocklist = old.__deleted ?? {};
  const now = new Date().toISOString();
  // Start with all existing non-deleted deals
  const merged = {};
  for (const [id, deal] of Object.entries(old)) {
    if (id === '__deleted') continue;
    if (blocklist[id]) continue;
    merged[id] = deal;
  }
  // Layer new scan results on top (updates existing + adds new)
  for (const item of req.body) {
    if (!item.id) continue;
    if (blocklist[item.id]) continue;
    merged[item.id] = {
      ...item,
      firstSeen: old[item.id]?.firstSeen ?? now,
      seenCount: old[item.id]?.seenCount ?? 0,
    };
  }
  merged.__deleted = blocklist;
  const pruned = pruneDeals(merged);
  persistDeals(pruned);
  const count = Object.keys(pruned).filter(k => k !== '__deleted').length;
  res.json({ saved: count });
});

// Called when user clicks a deal — resets the expiry clock
app.post('/api/deals/:id/seen', (req, res) => {
  const deals = loadDeals();
  if (deals[req.params.id]) {
    deals[req.params.id].lastSeen  = new Date().toISOString();
    deals[req.params.id].seenCount = (deals[req.params.id].seenCount || 0) + 1;
    persistDeals(deals);
  }
  res.json({ ok: true });
});

// Manual delete — user explicitly removed a deal.
// The ID is added to __deleted so scans never re-add it.
app.delete('/api/deals/:id', (req, res) => {
  const deals = loadDeals();
  const id = req.params.id;
  if (!deals[id]) return res.status(404).json({ error: 'not found' });
  delete deals[id];
  if (!deals.__deleted) deals.__deleted = {};
  deals.__deleted[id] = new Date().toISOString();
  persistDeals(deals);
  res.json({ ok: true });
});

// Return all saved deals sorted by estimatedProfit
app.get('/api/deals/saved', (req, res) => {
  const deals = loadDeals();
  const sorted = Object.entries(deals)
    .filter(([k]) => k !== '__deleted')
    .map(([, v]) => v)
    .sort((a, b) => (b.estimatedProfit ?? 0) - (a.estimatedProfit ?? 0));
  res.json({ deals: sorted, total: sorted.length });
});

// -----------------------------------------------------------------------
// Server-side background auto-scan
// Runs every 30 minutes regardless of whether the browser tab is open.
// -----------------------------------------------------------------------
const SCAN_CATEGORIES = [
  { q: 'Ralph Lauren cable knit jumper' },
  { q: 'Ralph Lauren v neck sweater' },
  { q: 'Ralph Lauren crew neck jumper' },
  { q: 'Ralph Lauren chunky knit jumper' },
  { q: 'Ralph Lauren wool sweater' },
  { q: 'Ralph Lauren merino sweater' },
  { q: 'Ralph Lauren quarter zip knit' },
  { q: 'Ralph Lauren fair isle jumper' },
  { q: 'Ralph Lauren heavy knit jumper' },
  { q: 'Ralph Lauren knit jumper' },
  { q: 'Polo Ralph Lauren sweater' },
  { q: 'Polo Ralph Lauren jumper' },
];

const SERVER_SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const AUTO_SCAN_CATEGORY_TIMEOUT_MS = 20_000;
let lastServerScan  = null;
let nextServerScanAt = null;
let serverScanRunning = false;
let serverAutoScanTimer = null;

function scheduleNextAutoScan(delayMs = SERVER_SCAN_INTERVAL_MS) {
  if (serverAutoScanTimer) clearTimeout(serverAutoScanTimer);
  nextServerScanAt = Date.now() + delayMs;
  serverAutoScanTimer = setTimeout(async () => {
    nextServerScanAt = null;
    try {
      await serverAutoScan();
    } finally {
      scheduleNextAutoScan(SERVER_SCAN_INTERVAL_MS);
    }
  }, delayMs);
}

function fetchSearchResult(q, domain = 'uk') {
  return new Promise(resolve => {
    const params = new URLSearchParams({
      q, domain,
      minProfit: '1', minHearts: '0', maxPrice: '0', maxAgeDays: '0',
      pages: '1', sort: 'newest',
    }).toString();
    const req = http.get(`http://127.0.0.1:${PORT}/api/search?${params}`, { timeout: 90000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function serverAutoScan() {
  if (serverScanRunning) return;
  serverScanRunning = true;
  console.log(`\n[Auto-scan] Starting background scan (${SCAN_CATEGORIES.length} categories)...`);

  try {
    const allDeals = [];
    const seenIds  = new Set();

    for (const cat of SCAN_CATEGORIES) {
      try {
        const data = await Promise.race([
          fetchSearchResult(cat.q),
          new Promise(resolve => setTimeout(() => resolve(null), AUTO_SCAN_CATEGORY_TIMEOUT_MS)),
        ]);
        if (data && Array.isArray(data.items)) {
          for (const item of data.items) {
            if (!seenIds.has(item.id)) { seenIds.add(item.id); allDeals.push(item); }
          }
        }
        console.log(`[Auto-scan] "${cat.q}" → ${data?.items?.length ?? 0} deals`);
      } catch (err) {
        console.error(`[Auto-scan] Error for "${cat.q}":`, err.message);
      }
    }

    if (allDeals.length > 0) {
      const old = loadDeals();
      const blocklist = old.__deleted ?? {};
      const now = new Date().toISOString();
      // Start with all existing non-deleted deals
      const merged = {};
      for (const [id, deal] of Object.entries(old)) {
        if (id === '__deleted') continue;
        if (blocklist[id]) continue;
        merged[id] = deal;
      }
      // Layer new scan results on top
      for (const item of allDeals) {
        if (!item.id) continue;
        if (blocklist[item.id]) continue;
        merged[item.id] = {
          ...item,
          firstSeen: old[item.id]?.firstSeen ?? now,
          seenCount: old[item.id]?.seenCount ?? 0,
        };
      }
      merged.__deleted = blocklist;
      const pruned = pruneDeals(merged);
      persistDeals(pruned);
      const count = Object.keys(pruned).filter(k => k !== '__deleted').length;
      console.log(`[Auto-scan] Done — saved ${count} deals.\n`);
    } else {
      console.log('[Auto-scan] No deals found this cycle.\n');
    }

    lastServerScan = new Date().toISOString();
  } catch (err) {
    console.error('[Auto-scan] Fatal error:', err.message);
  } finally {
    serverScanRunning = false;
  }
}

// Expose scan status so the frontend can show a live countdown
app.get('/api/scan/status', (req, res) => {
  res.json({
    running:  serverScanRunning,
    lastScan: lastServerScan,
    nextScanMs: nextServerScanAt ? Math.max(0, nextServerScanAt - Date.now()) : null,
  });
});

// Re-arm the server-side auto-scan so the next background run happens
// 30 minutes after the user's latest Ralph Lauren search.
app.post('/api/scan/rearm', (req, res) => {
  scheduleNextAutoScan(SERVER_SCAN_INTERVAL_MS);
  res.json({ ok: true, nextScanMs: SERVER_SCAN_INTERVAL_MS });
});

app.listen(PORT, async () => {
  console.log(`\n✅  Vinted Finder running at http://localhost:${PORT}\n`);
  console.log('Pre-warming Chrome session...');
  console.log('A Chrome window will open — Cloudflare should pass automatically.\n');
  getVintedPage('uk', VINTED_DOMAINS.uk).catch(e => console.error('Pre-warm failed:', e.message));

  // Start the background cycle once the user has run a Ralph Lauren search.
  // Until then, the server stays warm but idle.
  nextServerScanAt = null;
});
