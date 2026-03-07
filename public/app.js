/* ── Categories to auto-scan ─────────────────────────────────────────── */
const CATEGORIES = [
  // Footwear — high resale demand
  { id: 'nike',       label: 'Nike Sneakers',   q: 'Nike sneakers',       group: 'Footwear'      },
  { id: 'jordan',     label: 'Air Jordan',      q: 'Air Jordan',          group: 'Footwear'      },
  { id: 'adidas',     label: 'Adidas',          q: 'Adidas',              group: 'Footwear'      },
  { id: 'newbalance', label: 'New Balance',     q: 'New Balance',         group: 'Footwear'      },
  { id: 'timberland', label: 'Timberland',      q: 'Timberland',          group: 'Footwear'      },
  { id: 'drmartens',  label: 'Dr. Martens',     q: 'Dr Martens',          group: 'Footwear'      },
  // Luxury & premium
  { id: 'gucci',      label: 'Gucci',           q: 'Gucci',               group: 'Luxury'        },
  { id: 'lv',         label: 'Louis Vuitton',   q: 'Louis Vuitton',       group: 'Luxury'        },
  { id: 'burberry',   label: 'Burberry',        q: 'Burberry',            group: 'Luxury'        },
  { id: 'moncler',    label: 'Moncler',         q: 'Moncler',             group: 'Luxury'        },
  { id: 'stone',      label: 'Stone Island',    q: 'Stone Island',        group: 'Luxury'        },
  // Streetwear
  { id: 'supreme',    label: 'Supreme',         q: 'Supreme',             group: 'Streetwear'    },
  { id: 'offwhite',   label: 'Off-White',       q: 'Off-White',           group: 'Streetwear'    },
  { id: 'palace',     label: 'Palace',          q: 'Palace skateboards',  group: 'Streetwear'    },
  { id: 'stussy',     label: 'Stüssy',          q: 'Stussy',              group: 'Streetwear'    },
  { id: 'northface',  label: 'North Face',      q: 'The North Face',      group: 'Streetwear'    },
  // Gaming & Collectibles
  { id: 'pokemon',    label: 'Pokémon Cards',   q: 'Pokemon cards',       group: 'Gaming'        },
  { id: 'lego',       label: 'LEGO',            q: 'LEGO set',            group: 'Gaming'        },
  { id: 'switch',     label: 'Nintendo Switch', q: 'Nintendo Switch',     group: 'Gaming'        },
  { id: 'ps5',        label: 'PlayStation',     q: 'PlayStation 5',       group: 'Gaming'        },
  { id: 'xbox',       label: 'Xbox',            q: 'Xbox Series',         group: 'Gaming'        },
  // Tech & Electronics
  { id: 'airpods',    label: 'AirPods',         q: 'Apple AirPods',       group: 'Tech'          },
  { id: 'dyson',      label: 'Dyson',           q: 'Dyson',               group: 'Tech'          },
  { id: 'sonyheadphones', label: 'Sony Headphones', q: 'Sony headphones', group: 'Tech'          },
  // Sports
  { id: 'football',   label: 'Football Shirt',  q: 'football shirt',      group: 'Sports'        },
  { id: 'patagonia',  label: 'Patagonia',       q: 'Patagonia',           group: 'Sports'        },
  // Watches & Vintage
  { id: 'seiko',      label: 'Seiko Watch',     q: 'Seiko watch',         group: 'Watches'       },
  { id: 'casio',      label: 'Casio Watch',     q: 'Casio watch',         group: 'Watches'       },
  { id: 'vintagecam', label: 'Vintage Camera',  q: 'vintage film camera', group: 'Vintage'       },
  { id: 'vinylrecord', label: 'Vinyl Records',  q: 'vinyl record',        group: 'Vintage'       },
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
const errorBanner    = document.getElementById('errorBanner');
const emptyState     = document.getElementById('emptyState');
const resultsGrid    = document.getElementById('resultsGrid');

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
  resultsGrid.innerHTML = '';
  // Reset chip states
  CATEGORIES.forEach(c => {
    const el = document.getElementById('chip-' + c.id);
    if (el) { el.classList.remove('done', 'scanning'); }
  });
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
function renderCard(item, currency, rank) {
  const hasImg = item.image && item.image.trim() !== '';
  const imgHtml = hasImg
    ? `<img src="${escHtml(item.image)}" alt="${escHtml(item.title)}" loading="lazy" />`
    : `<div class="no-img"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;

  const brandBadge = item.brand     ? `<span class="badge">${escHtml(item.brand)}</span>`     : '';
  const sizeBadge  = item.size      ? `<span class="badge">${escHtml(item.size)}</span>`      : '';
  const condBadge  = item.condition ? `<span class="badge">${escHtml(item.condition)}</span>` : '';
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

  // Size demand badge
  const sizeDemandBadge = item.sizeDemand >= 2
    ? `<span class="badge badge-size-hot" title="Best resale size">📐 Best size</span>`
    : item.sizeDemand >= 1
    ? `<span class="badge badge-size-ok" title="Good resale size">📐 Good size</span>`
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

  const profitStr  = item.estimatedProfit != null ? fmt(item.estimatedProfit, currency) : '';
  const compLine   = item.groupMean
    ? `<div class="card-comp">vs ${item.groupSize} similar · avg ${fmt(item.groupMean, currency)}</div>`
    : '';

  return `
    <a class="deal-card" href="${escHtml(item.url)}" target="_blank" rel="noopener noreferrer">
      <div class="card-img-wrap">
        ${imgHtml}
        <div class="discount-badge">-${item.discount}% vs avg</div>
        ${hotBadge}${newBadge}
        ${rankBadge}
      </div>
      <div class="card-body">
        <div class="card-title">${escHtml(item.title)}</div>
        <div class="card-meta">${brandBadge}${sizeBadge}${condBadge}${heartsBadge}${brandBoostBadge}${hiddenBrandBadge}${velBadge}${sizeDemandBadge}</div>
        ${mispriceBadge}
        <div class="freshness-bar-wrap" title="${freshnessLabel}">
          <div class="freshness-bar" style="width:${f}%;background:${freshnessColor}"></div>
        </div>
        <div class="freshness-label" style="color:${freshnessColor}">${freshnessLabel}</div>
        <div class="card-price-row">
          <span class="card-price">${fmt(item.price, currency)}</span>
          <span class="card-was">avg ${fmt(item.groupMean ?? 0, currency)}</span>
        </div>
        ${compLine}
        ${profitStr ? `<div class="profit-pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> ~${profitStr} profit after fees</div>` : ''}
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

scanBtn.addEventListener('click', async () => {
  const toScan = CATEGORIES.filter(c => selectedCategories.has(c.id));
  if (toScan.length === 0) { showError('Select at least one category.'); return; }

  const domain     = domainSelect.value;
  const minProfit   = parseFloat(minProfitInput.value) || 8;
  const minHearts   = parseInt(minHeartsInput.value)   || 0;
  const maxPrice    = parseFloat(maxPriceInput.value)  || 0;   // 0 = no limit
  const maxAgeDays  = parseFloat(maxAgeSelect.value)   || 0;
  const pages       = pagesSelect.value;

  abortScan = false;
  clearUI();
  setLoading(true);
  showSkeletons(16);

  // Show stats bar immediately
  statsBar.hidden = false;
  statTotal.textContent      = '0';
  statCategories.textContent = `0 / ${toScan.length}`;
  statDeals.textContent      = '0';
  statBest.textContent       = '—';

  let allDeals    = [];
  let totalScanned = 0;
  let doneCount   = 0;
  let defaultCurrency = 'EUR';

  // Card bucket so we can incrementally render
  const seenIds = new Set();

  function flushCards(currency) {
    allDeals.sort((a, b) => (b.hotScore ?? 0) - (a.hotScore ?? 0));
    resultsGrid.innerHTML = allDeals
      .map((item, i) => renderCard(item, currency, i + 1))
      .join('');
  }

  for (const cat of toScan) {
    if (abortScan) break;
    try {
      const data = await scanCategory(cat, domain, minProfit, minHearts, maxPrice, maxAgeDays, pages);
      defaultCurrency = data.currency || defaultCurrency;
      totalScanned += data.totalFetched || 0;
      doneCount++;

      // Add new unique deals
      for (const item of (data.items || [])) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          allDeals.push(item); // item already carries groupMedian/groupSize/groupLabel from server
        }
      }

      // Live stats
      statTotal.textContent      = totalScanned.toLocaleString();
      statCategories.textContent = `${doneCount} / ${toScan.length}`;
      statDeals.textContent      = allDeals.length.toLocaleString();

      if (allDeals.length > 0) {
        const best = allDeals.reduce((a, b) => (b.hotScore ?? 0) > (a.hotScore ?? 0) ? b : a);
        statBest.textContent = best.estimatedProfit != null
          ? `~${fmt(best.estimatedProfit, defaultCurrency)} profit ♥${best.hearts ?? 0}`
          : `-${best.discount}% off`;
      }

      // Replace skeletons on first hit, then update
      if (doneCount === 1) resultsGrid.innerHTML = '';
      flushCards(defaultCurrency);

    } catch (err) {
      const chip = document.getElementById('chip-' + cat.id);
      if (chip) { chip.classList.remove('scanning'); chip.classList.add('done'); }
      doneCount++;
      statCategories.textContent = `${doneCount} / ${toScan.length}`;
    }

    // Small delay between requests to be polite to the API
    if (!abortScan) await sleep(400);
  }

  setLoading(false);

  if (allDeals.length === 0) {
    resultsGrid.innerHTML = '';
    emptyState.hidden = false;
  }
});
