const express = require('express');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const path = require('path');

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

// Cookie jar per domain to maintain Vinted sessions
const jarCache = {};
const clientCache = {};
const cookieExpiry = {};
const COOKIE_TTL = 15 * 60 * 1000; // 15 minutes

function getClient(domain) {
  if (!jarCache[domain]) {
    jarCache[domain] = new CookieJar();
    clientCache[domain] = wrapper(axios.create({
      jar: jarCache[domain],
      withCredentials: true,
    }));
  }
  return clientCache[domain];
}

async function ensureSession(baseUrl, domain) {
  const now = Date.now();
  if (cookieExpiry[domain] && now < cookieExpiry[domain]) return;

  const client = getClient(domain);
  try {
    await client.get(baseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
    });
    cookieExpiry[domain] = Date.now() + COOKIE_TTL;
  } catch (e) {
    // Best-effort – proceed even if homepage fails
  }
}

// Mean helper
function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
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
const MIN_GROUP = 4;

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
    maxAgeDays = '0',   // 0 = no limit
    pages      = '2',
    sort       = 'relevance',
  } = req.query;

  if (!q || q.trim() === '') {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  const baseUrl = VINTED_DOMAINS[domain] || VINTED_DOMAINS.com;
  const client = getClient(domain);

  try {
    await ensureSession(baseUrl, domain);

    const ORDER_MAP = {
      relevance: 'relevance',
      newest:    'newest_first',
      price_asc: 'price_low_to_high',
      price_desc: 'price_high_to_low',
    };

    const orderBy = ORDER_MAP[sort] || 'relevance';
    const maxPages = Math.min(parseInt(pages) || 2, 5);

    let allItems = [];

    for (let page = 1; page <= maxPages; page++) {
      const response = await client.get(`${baseUrl}/api/v2/catalog/items`, {
        params: {
          search_text: q.trim(),
          per_page: 96,
          page,
          order: orderBy,
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': baseUrl,
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 12000,
      });

      const items = response.data?.items || [];
      allItems = allItems.concat(items);

      // Stop early if fewer items than requested (last page)
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

    const underpriced = annotated
      .filter(item => {
        if (item._groupMean == null) return false;
        const hearts = item.favourite_count ?? item.favourites_count ?? 0;
        if (hearts < minHeartsVal) return false;
        if (maxAgeDaysVal > 0 && Number(item.id) < minIdCutoff) return false;  // age gate
        const buyCost = totalBuyCost(item._price);
        return (item._groupMean - buyCost) >= minProfitVal;
      })
      .map(item => {
        const buyCost = totalBuyCost(item._price);
        const estimatedProfit = Math.round((item._groupMean - buyCost) * 100) / 100;
        const discount = Math.round(((item._groupMean - item._price) / item._groupMean) * 100);
        const hearts   = item.favourite_count ?? item.favourites_count ?? 0;
        // Freshness: 0 (oldest in batch) → 1 (newest in batch)
        const freshness = (Number(item.id) - minId) / idRange;
        // Composite hotness score: profit weighted by hearts & freshness
        const hotScore  = estimatedProfit * Math.pow(1 + hearts, 0.4) * (0.35 + 0.65 * freshness);
        // Relative age label within this batch
        const isNew     = freshness >= 0.75;
        return { ...item, _estimatedProfit: estimatedProfit, _discount: discount, _freshness: freshness, _hotScore: hotScore, _isNew: isNew };
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
      isNew:           item._isNew,
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
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      // Invalidate cookie cache so next request retries
      cookieExpiry[domain] = 0;
      return res.status(503).json({ error: 'Vinted session expired – please retry in a few seconds.' });
    }
    console.error('Vinted API error:', err.message);
    res.status(502).json({ error: `Failed to reach Vinted: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅  Vinted Finder running at http://localhost:${PORT}\n`);
});
