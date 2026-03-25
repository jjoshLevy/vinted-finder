/* ── Categories to auto-scan ─────────────────────────────────────────── */
const CATEGORIES = [
  { id: 'rl_cable',      label: 'RL Cable Knit',    q: 'Ralph Lauren cable knit jumper', group: 'Ralph Lauren Knitwear' },
  { id: 'rl_vneck',      label: 'RL V-Neck',        q: 'Ralph Lauren v neck sweater',     group: 'Ralph Lauren Knitwear' },
  { id: 'rl_crewneck',   label: 'RL Crew Neck',     q: 'Ralph Lauren crew neck jumper',   group: 'Ralph Lauren Knitwear' },
  { id: 'rl_chunky',     label: 'RL Chunky Knit',   q: 'Ralph Lauren chunky knit jumper', group: 'Ralph Lauren Knitwear' },
  { id: 'rl_wool',       label: 'RL Wool Sweater',  q: 'Ralph Lauren wool sweater',       group: 'Ralph Lauren Knitwear' },
  { id: 'rl_merino',     label: 'RL Merino',        q: 'Ralph Lauren merino sweater',     group: 'Ralph Lauren Knitwear' },
  { id: 'rl_quarterzip', label: 'RL Quarter Zip',   q: 'Ralph Lauren quarter zip knit',   group: 'Ralph Lauren Knitwear' },
  { id: 'rl_fairisle',   label: 'RL Fair Isle',     q: 'Ralph Lauren fair isle jumper',   group: 'Ralph Lauren Knitwear' },
  { id: 'rl_heavy',      label: 'RL Heavy Knit',    q: 'Ralph Lauren heavy knit jumper',  group: 'Ralph Lauren Knitwear' },
  { id: 'rl_knit',       label: 'RL Knit Jumper',   q: 'Ralph Lauren knit jumper',        group: 'Ralph Lauren Knitwear' },
  { id: 'rl_sweater',    label: 'RL Sweater',       q: 'Polo Ralph Lauren sweater',       group: 'Ralph Lauren Knitwear' },
  { id: 'rl_jumper',     label: 'RL Jumper',        q: 'Polo Ralph Lauren jumper',        group: 'Ralph Lauren Knitwear' },
];

/* ── DOM refs ─────────────────────────────────────────────────────────── */
const scanBtn        = document.getElementById('scanBtn');
const btnText        = scanBtn.querySelector('.btn-text');
const btnSpinner     = scanBtn.querySelector('.btn-spinner');
const domainSelect   = document.getElementById('domainSelect');
const minProfitInput = document.getElementById('minProfitInput');
const minHeartsInput = document.getElementById('minHeartsInput');
const maxPriceInput  = document.getElementById('maxPriceInput');
const maxAgeSelect   = document.getElementById('maxAgeSelect');
const pagesSelect    = document.getElementById('pagesSelect');
const categoryChips  = document.getElementById('categoryChips');
const statsBar       = document.getElementById('statsBar');
const statTotal      = document.getElementById('statTotal');
const statCategories = document.getElementById('statCategories');
const statDeals      = document.getElementById('statDeals');
const statBest       = document.getElementById('statBest');
const filterDebug    = document.getElementById('filterDebug');
const errorBanner    = document.getElementById('errorBanner');
const emptyState     = document.getElementById('emptyState');
const resultsGrid     = document.getElementById('resultsGrid');
const resultSections  = document.getElementById('resultSections');
const gridBestFlips   = document.getElementById('gridBestFlips');
const gridHighDiscount = document.getElementById('gridHighDiscount');
const gridLowComp     = document.getElementById('gridLowComp');
const gridRecent      = document.getElementById('gridRecent');
const dailySummary    = document.getElementById('dailySummary');
const savedDealsBtn   = document.getElementById('savedDealsBtn');
const savedCountEl    = document.getElementById('savedCount');
const savedPanel      = document.getElementById('savedPanel');
const savedGrid       = document.getElementById('savedGrid');
const savedEmpty      = document.getElementById('savedEmpty');
const refreshSavedBtn = document.getElementById('refreshSavedBtn');

/* ── Build category chips (grouped) ───────────────────────────────────── */
let selectedCategories = new Set(CATEGORIES.map(c => c.id));

function buildChips() {
  categoryChips.innerHTML = '';

  // Group headers + chips
  const groups = [...new Set(CATEGORIES.map(c => c.group))];

  // "All" toggle
  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'chip chip-all' + (selectedCategories.size === CATEGORIES.length ? ' active' : '');
  allChip.textContent = 'All';
  allChip.addEventListener('click', () => {
    if (selectedCategories.size === CATEGORIES.length) selectedCategories.clear();
    else CATEGORIES.forEach(c => selectedCategories.add(c.id));
    buildChips();
  });
  categoryChips.appendChild(allChip);

  groups.forEach(group => {
    const groupLabel = document.createElement('span');
    groupLabel.className = 'chip-group-label';
    groupLabel.textContent = group;
    categoryChips.appendChild(groupLabel);

    CATEGORIES.filter(c => c.group === group).forEach(cat => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (selectedCategories.has(cat.id) ? ' active' : '');
      chip.id = 'chip-' + cat.id;
      chip.textContent = cat.label;
      chip.addEventListener('click', () => {
        if (selectedCategories.has(cat.id)) selectedCategories.delete(cat.id);
        else selectedCategories.add(cat.id);
        buildChips();
      });
      categoryChips.appendChild(chip);
    });
  });
}

buildChips();


/* ── Helpers ──────────────────────────────────────────────────────────── */
function fmt(price, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${parseFloat(price).toFixed(2)} ${currency || '€'}`;
  }
}

function setLoading(on) {
  scanBtn.disabled = on;
  btnText.hidden = on;
  btnSpinner.hidden = !on;
  domainSelect.disabled = on;
  minProfitInput.disabled = on;
  minHeartsInput.disabled = on;
  maxPriceInput.disabled  = on;
  maxAgeSelect.disabled = on;
  pagesSelect.disabled = on;
  categoryChips.style.pointerEvents = on ? 'none' : '';
  categoryChips.style.opacity = on ? '0.5' : '';
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.hidden = false;
}

function clearUI() {
  errorBanner.hidden = true;
  emptyState.hidden = true;
  statsBar.hidden = true;
  filterDebug.hidden = true;
  filterDebug.textContent = '';
  resultsGrid.innerHTML = '';
  resultsGrid.hidden = false;
  resultSections.hidden = true;
  // Reset chip states
  CATEGORIES.forEach(c => {
    const el = document.getElementById('chip-' + c.id);
    if (el) { el.classList.remove('done', 'scanning'); }
  });
}

function createEmptyFilterStats() {
  return {
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
  };
}

function mergeFilterStats(total, part) {
  if (!part) return total;
  for (const [k, v] of Object.entries(part)) {
    if (typeof v === 'number') total[k] = (total[k] || 0) + v;
  }
  return total;
}

function renderFilterDebug(stats) {
  if (!stats) { filterDebug.hidden = true; return; }
  filterDebug.hidden = false;
  filterDebug.textContent = [
    `Diagnostics: fetched ${stats.totalFetched}, priced ${stats.pricedItems}, passed ${stats.passedTotal}`,
    `Dropped by profit/spread ${stats.filteredLowSpread}, seller trust ${stats.filteredSellerTrust}, no market ref ${stats.filteredNoMarketRef}`,
    `Dropped by hearts ${stats.filteredHearts}, age ${stats.filteredAge}, max price ${stats.filteredMaxPrice}, moncler gate ${stats.filteredMoncler}`,
    `Pass source: strict spread ${stats.passedBySpread}, knit fallback ${stats.passedByKnitFallback}, opportunity fallback ${stats.passedByOpportunityFallback}`,
  ].join(' | ');
}

/* ── Skeleton placeholders while loading ──────────────────────────────── */
function showSkeletons(count = 12) {
  resultsGrid.innerHTML = Array.from({ length: count }).map(() => `
    <div class="skeleton-card">
      <div class="skeleton-img"></div>
      <div class="skeleton-body">
        <div class="skel skel-title"></div>
        <div class="skel skel-title2"></div>
        <div class="skel skel-price"></div>
      </div>
    </div>
  `).join('');
}

/* ── Card renderer ────────────────────────────────────────────────────── */
function renderCard(item, currency, rank, savedMeta = null) {
  const hasImg = item.image && item.image.trim() !== '';
  const imgHtml = hasImg
    ? `<img src="${escHtml(item.image)}" alt="${escHtml(item.title)}" loading="lazy" />`
    : `<div class="no-img"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;

  const brandBadge = item.brand     ? `<span class="badge">${escHtml(item.brand)}</span>`     : '';
  const sizeBadge  = item.size      ? `<span class="badge">${escHtml(item.size)}</span>`      : '';

  // Human-readable condition label
  const COND_LABELS = {
    'new_with_tags':    'New + tags',
    'new_without_tags': 'Unworn',
    'very_good':        'Very good',
    'good':             'Good',
    'satisfactory':     'Fair',
  };
  const condLabel = COND_LABELS[item.condition] ?? item.condition;
  const condBadge = condLabel ? `<span class="badge">${escHtml(condLabel)}</span>` : '';
  const heartsBadge = item.hearts > 0
    ? `<span class="badge badge-hearts"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>${item.hearts}</span>`
    : '';

  // Brand boost badge for priority brands
  const brandBoostBadge = item.brandBoost >= 7
    ? `<span class="badge badge-brand" title="High-demand brand (score ${item.brandBoost}/10)">🔥 Brand</span>`
    : item.brandBoost >= 4
    ? `<span class="badge badge-brand-mid" title="Good resale brand (score ${item.brandBoost}/10)">★ Brand</span>`
    : '';

  // Hidden brand badge — seller didn't tag the brand in the listing
  const hiddenBrandBadge = item.hiddenBrand
    ? `<span class="badge badge-hidden" title="Brand '${escHtml(item.hiddenBrand)}' found in description but not tagged by seller">👁 Hidden: ${escHtml(item.hiddenBrand)}</span>`
    : '';

  // Premium misprice alert
  const mispriceBadge = item.isMispricedPremium
    ? `<div class="misprice-alert">💎 Premium brand at fast-fashion price</div>`
    : '';

  const opportunityBadge = item.sourceMode === 'opportunity'
    ? `<div class="opportunity-alert">🧶 Knitwear sourcing pick — surfaced on discount/value, not strict spread</div>`
    : '';

  // Size demand badge
  const sizeDemandBadge = item.sizeDemand >= 2
    ? `<span class="badge badge-size-hot" title="Best resale size">📐 Best size</span>`
    : item.sizeDemand >= 1
    ? `<span class="badge badge-size-ok" title="Good resale size">📐 Good size</span>`
    : '';

  // Seller trust badge
  const sellerTrustBadge = item.sellerTrust === 'high'
    ? `<span class="badge badge-trust-high" title="Trusted seller (${item.sellerRep}% positive, ${item.sellerSales} sales)">✓ Trusted</span>`
    : item.sellerTrust === 'low'
    ? `<span class="badge badge-trust-low" title="New/unverified seller (${item.sellerRep}% positive, ${item.sellerSales} sales)">⚠ New seller</span>`
    : '';

  // Repost warning
  const repostWarning = item.isRepost
    ? `<div class="repost-warning">⚠ Not selling — same seller listed this brand multiple times</div>`
    : '';

  // Condition discount note
  const condDiscountNote = (item.condMultiplier != null && item.condMultiplier < 1)
    ? `<div class="cond-discount-note" title="Profit adjusted for ${condLabel} condition (×${item.condMultiplier})">−${Math.round((1 - item.condMultiplier) * 100)}% condition discount applied</div>`
    : '';

  // Saved deal expiry line (only shown in Saved Deals panel)
  const expiryLine = savedMeta
    ? `<div class="expiry-line${savedMeta.urgent ? ' expiry-urgent' : ''}">${savedMeta.text}</div>`
    : '';

  // Like velocity badge
  const velBadge = item.likeVelocity >= 0.5
    ? `<span class="badge badge-velocity" title="Like velocity: ${item.likeVelocity.toFixed(2)}/min">⚡ ${item.likeVelocity >= 1 ? item.likeVelocity.toFixed(1) + '/min' : 'Rising'}</span>`
    : '';

  // Age label — show minutes if < 2 hours
  const ageDays    = item.ageDays   ?? 999;
  const ageMinutes = item.ageMinutes ?? (ageDays * 1440);
  const f          = item.freshness ?? 0;

  let freshnessLabel;
  if (ageMinutes < 1)       freshnessLabel = 'Just listed';
  else if (ageMinutes < 60) freshnessLabel = `~${Math.round(ageMinutes)} min ago`;
  else if (ageDays < 1)     { const h = Math.round(ageMinutes / 60); freshnessLabel = `~${h} hour${h > 1 ? 's' : ''} ago`; }
  else if (ageDays < 2)     freshnessLabel = '~1 day ago';
  else                      freshnessLabel = `~${Math.round(ageDays)} days ago`;

  const freshnessColor = ageMinutes < 60 ? 'var(--accent)' : ageDays < 3 ? 'var(--accent2)' : ageDays < 7 ? '#f0b429' : 'var(--muted)';

  // Overlay badges
  const hotBadge = item.isHot  ? `<div class="hot-badge">🔥 HOT</div>` : '';
  const newBadge = !item.isHot && item.isNew ? `<div class="new-badge">NEW</div>` : '';

  // Rank badge (top 3 get special colours)
  const rankColors = ['#ffd700', '#c0c0c0', '#cd7f32'];
  const rankStyle  = rank <= 3 ? `background:${rankColors[rank - 1]};color:#111` : '';
  const rankBadge  = `<div class="rank-badge" style="${rankStyle}">#${rank}</div>`;

  const profitStr = (item.conditionAdjustedProfit ?? item.estimatedProfit) != null
    ? fmt(item.conditionAdjustedProfit ?? item.estimatedProfit, currency)
    : '';

  // Hidden gem: old listing (7+ days) that is still heavily discounted — nobody noticed
  const hiddenGemBadge = (item.discount >= 50 && ageDays >= 7)
    ? `<div class="hidden-gem-alert">&#128142; Undervalued gem &middot; ${Math.round(ageDays)} days old &middot; nobody noticed</div>`
    : '';

  // Deal score: Profit×10 + Discount%×3 + Brand×5 + Freshness bonus (max 60 for brand new)
  const displayScore = Math.max(0, Math.round(
    (item.conditionAdjustedProfit ?? item.estimatedProfit ?? 0) * 10 +
    (item.discount ?? 0) * 3 +
    (item.brandBoost ?? 0) * 5 +
    Math.max(0, 30 - ageDays) * 2
  ));

  return `
    <a class="deal-card" href="${escHtml(item.url)}" target="_blank" rel="noopener noreferrer" data-deal-id="${escHtml(String(item.id))}">
      <div class="card-img-wrap">
        ${imgHtml}
        ${hotBadge}${newBadge}
        ${rankBadge}
      </div>
      <div class="card-body">
        <div class="card-title">${escHtml(item.title)}</div>
        <div class="card-meta">${brandBadge}${sizeBadge}${condBadge}${heartsBadge}${brandBoostBadge}${hiddenBrandBadge}${velBadge}${sizeDemandBadge}${sellerTrustBadge}</div>
        ${mispriceBadge}${opportunityBadge}${hiddenGemBadge}${repostWarning}${condDiscountNote}
        <div class="card-price-grid">
          <div class="price-col">
            <div class="price-label">Buy price</div>
            <div class="price-val">${fmt(item.price, currency)}</div>
          </div>
          <div class="price-col">
            <div class="price-label">Est. resale</div>
            <div class="price-val price-resale">${item.groupMean ? fmt(item.groupMean, currency) : '&mdash;'}</div>
          </div>
          <div class="price-col">
            <div class="price-label">Profit</div>
            <div class="price-val price-profit">${profitStr || '&mdash;'}</div>
          </div>
        </div>
        ${item.ebaySoldMean != null ? `
        <div class="ebay-row">
          <span class="ebay-chip">&#x1F6CD; eBay UK avg: ${fmt(item.ebaySoldMean, 'GBP')} (${item.ebaySoldCount} sold)${item.ebayProfit != null ? ` &rarr; ~${fmt(item.ebayProfit, 'GBP')} profit` : ''}</span>
        </div>` : ''}
        <div class="card-info-row">
          <span class="info-chip">-${item.discount}% vs avg</span>
          <span class="info-chip">&#9829; ${item.hearts ?? 0}</span>
          <span class="info-chip" style="color:${freshnessColor}">${freshnessLabel}</span>
        </div>
        <div class="card-score-row">
          <span class="deal-score-chip" title="Score = Profit&times;10 + Discount&times;3 + Brand&times;5 + Freshness&times;2">Score ${displayScore}</span>
          ${item.groupSize ? `<span class="comp-chip">vs ${item.groupSize} similar</span>` : ''}
        </div>
        ${expiryLine}
      </div>
    </a>
  `;
}

/* ── XSS sanitiser (no third-party libs needed) ───────────────────────── */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/* Only allow http/https URLs to prevent javascript: injection */
function safeUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? url : '#';
  } catch {
    return '#';
  }
}

/* ── Scan ─────────────────────────────────────────────────────────────── */
let abortScan = false;

async function scanCategory(cat, domain, minProfit, minHearts, maxPrice, maxAgeDays, pages) {
  const chip = document.getElementById('chip-' + cat.id);
  if (chip) chip.classList.add('scanning');

  const params = new URLSearchParams({
    q: cat.q,
    domain,
    minProfit,
    minHearts,
    maxPrice,
    maxAgeDays,
    pages,
    sort: 'relevance',
  });

  const res = await fetch(`/api/search?${params}`);
  const data = await res.json();

  if (chip) { chip.classList.remove('scanning'); chip.classList.add('done'); }

  if (!res.ok) {
    const err = new Error(data.message || data.error || `Error ${res.status}`);
    err.status = res.status;
    err.code   = data.error;
    throw err;
  }
  return data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Core scan function (shared by manual button + auto-scan) ────────── */
async function runScan() {
  const toScan = CATEGORIES.filter(c => selectedCategories.has(c.id));
  if (toScan.length === 0) { showError('Select at least one category.'); return; }

  const domain     = domainSelect.value;
  const minProfit   = parseFloat(minProfitInput.value) || 2;
  const minHearts   = parseInt(minHeartsInput.value)   || 0;
  const maxPrice    = parseFloat(maxPriceInput.value)  || 0;
  const maxAgeDays  = parseFloat(maxAgeSelect.value)   || 0;
  const pages       = pagesSelect.value;

  abortScan = false;
  clearUI();
  setLoading(true);
  showSkeletons(16);

  statsBar.hidden = false;
  statTotal.textContent      = '0';
  statCategories.textContent = `0 / ${toScan.length}`;
  statDeals.textContent      = '0';
  statBest.textContent       = '—';

  let allDeals    = [];
  let totalScanned = 0;
  let doneCount   = 0;
  let defaultCurrency = 'EUR';
  const aggregateFilterStats = createEmptyFilterStats();

  const seenIds = new Set();

  function flushCards(currency) {
    allDeals.sort((a, b) => (b.hotScore ?? 0) - (a.hotScore ?? 0));
    resultsGrid.innerHTML = allDeals
      .map((item, i) => renderCard(item, currency, i + 1))
      .join('');
  }

  try {
    const BATCH = 5;
    for (let i = 0; i < toScan.length; i += BATCH) {
      if (abortScan) break;
      const batch = toScan.slice(i, i + BATCH);

      await Promise.all(batch.map(async cat => {
        try {
          const data = await scanCategory(cat, domain, minProfit, minHearts, maxPrice, maxAgeDays, pages);
          defaultCurrency = data.currency || defaultCurrency;
          totalScanned += data.totalFetched || 0;
          mergeFilterStats(aggregateFilterStats, data.filterStats);
          doneCount++;

          for (const item of (data.items || [])) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              allDeals.push(item);
            }
          }
        } catch (err) {
          const chip = document.getElementById('chip-' + cat.id);
          if (chip) { chip.classList.remove('scanning'); chip.classList.add('done'); }
          doneCount++;
        }
      }));

      statTotal.textContent      = totalScanned.toLocaleString();
      statCategories.textContent = `${doneCount} / ${toScan.length}`;
      statDeals.textContent      = allDeals.length.toLocaleString();
      renderFilterDebug(aggregateFilterStats);

      if (allDeals.length > 0) {
        const best = allDeals.reduce((a, b) => (b.hotScore ?? 0) > (a.hotScore ?? 0) ? b : a);
        statBest.textContent = best.estimatedProfit != null
          ? `~${fmt(best.estimatedProfit, defaultCurrency)} profit ♥${best.hearts ?? 0}`
          : `-${best.discount}% off`;
      }

      if (doneCount <= BATCH) resultsGrid.innerHTML = '';
      flushCards(defaultCurrency);

      if (allDeals.length > 0) await saveDealsToPersistent(allDeals);
    }

    // Refresh saved panel to reflect newly saved deals (keeps it in sync with leaderboard)
    if (allDeals.length > 0) {
      try {
        const { deals: saved } = await fetch('/api/deals/saved').then(r => r.json());
        if (saved && saved.length > 0) {
          savedCountEl.textContent = saved.length;
          savedCountEl.hidden = false;
          renderDailySummary(saved);
          if (!savedPanel.hidden) {
            const currency = saved[0]?.currency || 'EUR';
            savedGrid.innerHTML = saved.map((item, i) =>
              `<div class="saved-card-wrap">${renderCard(item, currency, i + 1)}<button class="delete-deal-btn" data-delete-id="${escHtml(String(item.id))}" title="Remove from saved">&#x2715;</button></div>`
            ).join('');
            savedEmpty.hidden = true;
          }
        }
      } catch (_) {}
    }

    try {
      await fetch('/api/scan/rearm', { method: 'POST' });
      await pollScanStatus();
    } catch (_) {}

    if (allDeals.length === 0) {
      resultsGrid.innerHTML = '';
      emptyState.hidden = false;
    } else {
      resultsGrid.hidden = true;
      renderSections(allDeals, defaultCurrency);
    }
  } finally {
    // Always re-enable the button even if an error occurred
    setLoading(false);
  }
}

scanBtn.addEventListener('click', () => runScan());

/* ── Auto-scan countdown — driven by server schedule ─────────────────── */
const autoLabel = document.getElementById('autoScanLabel');

function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Local target timestamp synced from server every 10 s
let _nextScanTarget = null;
let _lastScanSeen   = null;

// Tick every second to keep the label smooth
setInterval(() => {
  if (!autoLabel) return;
  if (_nextScanTarget == null) { autoLabel.textContent = 'Auto-scan in …'; return; }
  const remaining = _nextScanTarget - Date.now();
  if (remaining <= 0) {
    autoLabel.textContent = 'Auto-scan running…';
  } else {
    autoLabel.textContent = `Next auto-scan in ${formatCountdown(remaining)}`;
  }
}, 1000);

// Poll server every 10 s to sync target time and detect completed scans
async function pollScanStatus() {
  try {
    const st = await fetch('/api/scan/status').then(r => r.json());
    if (st.running) {
      _nextScanTarget = null; // show "running…" until next poll
    } else if (st.nextScanMs != null) {
      _nextScanTarget = Date.now() + st.nextScanMs; // re-sync local target
    }
    // If the server just finished a scan, refresh saved count + summary
    if (st.lastScan && st.lastScan !== _lastScanSeen) {
      _lastScanSeen = st.lastScan;
      try {
        const { deals } = await fetch('/api/deals/saved').then(r => r.json());
        if (deals && deals.length > 0) {
          savedCountEl.textContent = deals.length;
          savedCountEl.hidden = false;
          renderDailySummary(deals);
          if (!savedPanel.hidden) loadSavedDeals();
        }
      } catch (_) {}
    }
  } catch (_) {}
}
setInterval(pollScanStatus, 10_000);
pollScanStatus();

/* ── Persistent deal store ────────────────────────────────────────────── */

async function saveDealsToPersistent(deals) {
  try {
    const res = await fetch('/api/deals/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deals),
    });
    if (!res.ok) { console.error('Save failed:', res.status, await res.text()); return; }
    const { saved } = await res.json();
    savedCountEl.textContent = saved;
    savedCountEl.hidden = saved === 0;
  } catch (err) {
    console.error('Save error:', err);
  }
}

async function loadSavedDeals() {
  savedGrid.innerHTML = '';
  savedEmpty.hidden = true;
  try {
    const { deals } = await fetch('/api/deals/saved').then(r => r.json());
    if (!deals || deals.length === 0) { savedEmpty.hidden = false; return; }
    const currency = deals[0]?.currency || 'EUR';
    savedGrid.innerHTML = deals.map((item, i) =>
      `<div class="saved-card-wrap">${renderCard(item, currency, i + 1)}<button class="delete-deal-btn" data-delete-id="${escHtml(String(item.id))}" title="Remove from saved">&#x2715;</button></div>`
    ).join('');
    savedCountEl.textContent = deals.length;
    savedCountEl.hidden = false;
    renderDailySummary(deals);
  } catch (_) { savedEmpty.hidden = false; }
}

// Delete a saved deal when the ✕ button is clicked
savedGrid.addEventListener('click', async e => {
  const btn = e.target.closest('.delete-deal-btn');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const id = btn.dataset.deleteId;
  try {
    await fetch(`/api/deals/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const wrap = btn.closest('.saved-card-wrap');
    if (wrap) wrap.remove();
    const remaining = savedGrid.querySelectorAll('.saved-card-wrap').length;
    savedCountEl.textContent = remaining;
    savedCountEl.hidden = remaining === 0;
    if (remaining === 0) savedEmpty.hidden = false;
  } catch (_) {}
});

/* ── Section renderer — called after scan completes ─────────────────── */
function renderSections(deals, currency) {
  resultSections.hidden = false;

  const byProfit   = [...deals].sort((a, b) => (b.estimatedProfit ?? 0) - (a.estimatedProfit ?? 0)).slice(0, 10);
  const byDiscount = [...deals].sort((a, b) => (b.discount ?? 0) - (a.discount ?? 0)).slice(0, 10);
  const lowComp    = [...deals].filter(d => (d.hearts ?? 0) < 10)
                               .sort((a, b) => (b.estimatedProfit ?? 0) - (a.estimatedProfit ?? 0))
                               .slice(0, 10);
  const byRecent   = [...deals].sort((a, b) => (b.freshness ?? 0) - (a.freshness ?? 0)).slice(0, 10);

  const fill = (list, grid, secId) => {
    const sec = document.getElementById(secId);
    if (!sec) return;
    if (list.length === 0) { sec.hidden = true; return; }
    sec.hidden = false;
    grid.innerHTML = list.map((item, i) => renderCard(item, currency, i + 1)).join('');
  };

  fill(byProfit,   gridBestFlips,    'secBestFlips');
  fill(byDiscount, gridHighDiscount, 'secHighDiscount');
  fill(lowComp,    gridLowComp,      'secLowComp');
  fill(byRecent,   gridRecent,       'secRecent');
}

/* ── Daily flip summary ──────────────────────────────────────────────── */
function renderDailySummary(deals) {
  if (!deals || deals.length === 0) { dailySummary.hidden = true; return; }
  const currency = deals[0]?.currency || 'EUR';
  const top3 = [...deals].sort((a, b) => (b.estimatedProfit ?? 0) - (a.estimatedProfit ?? 0)).slice(0, 3);
  dailySummary.hidden = false;
  const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
  dailySummary.querySelector('.summary-list').innerHTML = top3.map((item, i) =>
    `<a class="summary-item" href="${escHtml(item.url)}" target="_blank" rel="noopener noreferrer" data-deal-id="${escHtml(String(item.id))}">
      <span class="summary-medal">${medals[i]}</span>
      <span class="summary-name">${escHtml(item.title)}</span>
      ${item.brand ? `<span class="summary-brand">${escHtml(item.brand)}</span>` : ''}
      <span class="summary-profit">~${fmt(item.estimatedProfit ?? 0, currency)} profit</span>
    </a>`
  ).join('');
  const footer = dailySummary.querySelector('.summary-footer');
  footer.textContent = deals.length > 3 ? `+${deals.length - 3} more deals saved` : '';
}

// Toggle the saved deals panel
savedDealsBtn.addEventListener('click', () => {
  const isOpen = !savedPanel.hidden;
  savedPanel.hidden = isOpen;
  savedDealsBtn.classList.toggle('active', !isOpen);
  if (!isOpen) loadSavedDeals();
});

refreshSavedBtn.addEventListener('click', loadSavedDeals);

// Track clicks on any deal card — resets its expiry
document.addEventListener('click', e => {
  const card = e.target.closest('[data-deal-id]');
  if (!card) return;
  navigator.sendBeacon(`/api/deals/${encodeURIComponent(card.dataset.dealId)}/seen`);
});

// Show saved count + daily summary on page load
(async () => {
  try {
    const { deals } = await fetch('/api/deals/saved').then(r => r.json());
    if (deals && deals.length > 0) {
      savedCountEl.textContent = deals.length;
      savedCountEl.hidden = false;
      renderDailySummary(deals);
    }
  } catch (_) {}
})();
