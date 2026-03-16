// ── Elementos ─────────────────────────────────────────────────────────────────
const form             = document.querySelector('#searchForm');
const statusBar        = document.querySelector('#statusBar');
const resultsEl        = document.querySelector('#results');
const skeletonsEl      = document.querySelector('#skeletons');
const sortBar          = document.querySelector('#sortBar');
const resultsCount     = document.querySelector('#resultsCount');
const sortSelect       = document.querySelector('#sortSelect');
const bellBtn          = document.querySelector('#bellBtn');
const bellBadge        = document.querySelector('#bellBadge');
const saveAlertBtn     = document.querySelector('#saveAlertBtn');
const alertsList       = document.querySelector('#alertsList');
const alertsEmpty      = document.querySelector('#alertsEmpty');
const newListingsPanel = document.querySelector('#newListingsPanel');
const newListingsList  = document.querySelector('#newListingsList');
const newCount         = document.querySelector('#newCount');
const clearNewBtn      = document.querySelector('#clearNewBtn');
const alertModal       = document.querySelector('#alertModal');
const alertLabelInput  = document.querySelector('#alertLabelInput');
const modalCancelBtn   = document.querySelector('#modalCancelBtn');
const modalSaveBtn     = document.querySelector('#modalSaveBtn');

// ── Estado ────────────────────────────────────────────────────────────────────
let allResults = [];

// ── Formatação ────────────────────────────────────────────────────────────────
function formatPrice(value, listingType) {
  const amount = new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
  return listingType === 'rent' ? `${amount}/mês` : amount;
}

function typeLabel(t) {
  return t === 'buy' ? 'Compra' : 'Arrendamento';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Skeleton loading ──────────────────────────────────────────────────────────
function showSkeletons(count = 4) {
  skeletonsEl.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skel skel-title"></div>
      <div class="skel-chips">
        <div class="skel skel-chip"></div>
        <div class="skel skel-chip"></div>
        <div class="skel skel-chip"></div>
      </div>
      <div class="skel-row">
        <div class="skel skel-price"></div>
        <div class="skel skel-link"></div>
      </div>
    </div>
  `).join('');
  skeletonsEl.classList.remove('hidden');
}

function hideSkeletons() {
  skeletonsEl.classList.add('hidden');
  skeletonsEl.innerHTML = '';
}

// ── Status bar ────────────────────────────────────────────────────────────────
const SVG_SPIN  = `<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>`;
const SVG_CHECK = `<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_ERROR = `<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

function setStatus(text, type = 'loading') {
  statusBar.className = `status-bar ${type}`;
  const icon = type === 'done' ? SVG_CHECK : type === 'error' ? SVG_ERROR : SVG_SPIN;
  statusBar.innerHTML = `${icon}<span>${text}</span>`;
  statusBar.classList.remove('hidden');
}

function hideStatus() {
  statusBar.classList.add('hidden');
}

// ── Cards de resultados ───────────────────────────────────────────────────────
const SVG_EXTERNAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

function renderCard(item, isNew = false, delay = 0) {
  const card = document.createElement('article');
  card.className = `card${isNew ? ' card-new' : ''}`;
  card.style.animationDelay = `${delay}ms`;
  card.innerHTML = `
    ${isNew ? '<span class="new-badge">Novo</span>' : ''}
    <h3 class="card-title">${escapeHtml(item.title)}</h3>
    <div class="meta">
      <span class="chip chip-source" data-source="${escapeHtml(item.source)}">${escapeHtml(item.source)}</span>
      <span class="chip">${escapeHtml(item.city)} · ${escapeHtml(item.zone)}</span>
      <span class="chip">${item.rooms} quartos</span>
      <span class="chip">${typeLabel(item.listingType)}</span>
    </div>
    <div class="card-footer">
      <span class="price">${formatPrice(item.price, item.listingType)}</span>
      <a class="link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
        Ver anúncio ${SVG_EXTERNAL}
      </a>
    </div>
  `;
  return card;
}

// ── Ordenação ─────────────────────────────────────────────────────────────────
function sortResults(results, sortValue) {
  const sorted = [...results];
  if (sortValue === 'price-asc')  sorted.sort((a, b) => a.price - b.price);
  if (sortValue === 'price-desc') sorted.sort((a, b) => b.price - a.price);
  if (sortValue === 'rooms-desc') sorted.sort((a, b) => b.rooms - a.rooms);
  return sorted;
}

function renderResults(results) {
  resultsEl.innerHTML = '';
  results.forEach((item, i) => {
    resultsEl.appendChild(renderCard(item, false, Math.min(i, 8) * 45));
  });
}

sortSelect.addEventListener('change', () => {
  renderResults(sortResults(allResults, sortSelect.value));
});

// ── Pesquisa ──────────────────────────────────────────────────────────────────
function collectFilters() {
  const fd = new FormData(form);
  const params = new URLSearchParams();
  const zones    = String(fd.get('zones') || '').trim();
  const minRooms = String(fd.get('minRooms') || '0');
  const maxPrice = String(fd.get('maxPrice') || '').trim();
  const listingType = String(fd.get('listingType') || 'both');
  if (zones)    params.set('zones', zones);
  if (minRooms) params.set('minRooms', minRooms);
  if (maxPrice) params.set('maxPrice', maxPrice);
  params.set('listingType', listingType);
  return params;
}

async function searchListings(event) {
  event.preventDefault();
  allResults = [];
  resultsEl.innerHTML = '';
  sortBar.classList.add('hidden');
  showSkeletons(4);
  setStatus('A procurar casas em todos os sites...');
  const searchBtn = document.querySelector('#searchBtn');
  searchBtn.disabled = true;

  try {
    const params = collectFilters();
    const response = await fetch(`/api/search?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    hideSkeletons();
    searchBtn.disabled = false;

    if (data.results.length === 0) {
      setStatus('Não foram encontradas casas com estes critérios.', 'done');
      return;
    }

    allResults = data.results;
    renderResults(sortResults(allResults, sortSelect.value));

    const failedNote = data.meta.providersFailed > 0
      ? ` · ${data.meta.providersFailed} site(s) com erro`
      : '';

    setStatus(
      `${data.results.length} imóveis encontrados em ${data.meta.providersOk} fonte(s)${failedNote}`,
      'done'
    );

    resultsCount.innerHTML = `<strong>${data.results.length}</strong> imóveis encontrados`;
    sortBar.classList.remove('hidden');

  } catch {
    hideSkeletons();
    searchBtn.disabled = false;
    setStatus('Erro ao pesquisar. Verifica se o servidor está a correr.', 'error');
  }
}

form.addEventListener('submit', searchListings);

// ── Alertas guardados ─────────────────────────────────────────────────────────
function filtersFromForm() {
  const fd = new FormData(form);
  return {
    zones: String(fd.get('zones') || '')
      .split(',')
      .map((z) => z.trim())
      .filter(Boolean),
    minRooms: parseInt(fd.get('minRooms') || '0', 10) || 0,
    maxPrice: parseInt(fd.get('maxPrice') || '', 10) || null,
    listingType: String(fd.get('listingType') || 'both'),
  };
}

function alertSummary(alert) {
  const parts = [];
  if (alert.zones?.length > 0) parts.push(alert.zones.join(', '));
  if (alert.minRooms > 0) parts.push(`≥ T${alert.minRooms}`);
  if (alert.maxPrice) parts.push(`≤ ${new Intl.NumberFormat('pt-PT').format(alert.maxPrice)} €`);
  parts.push(
    alert.listingType === 'buy'  ? 'Compra' :
    alert.listingType === 'rent' ? 'Arrendamento' :
    'Compra + Arrendamento'
  );
  return parts.join(' · ');
}

function renderAlerts(alerts) {
  alertsList.innerHTML = '';
  alertsEmpty.classList.toggle('hidden', alerts.length > 0);
  alerts.forEach((alert) => {
    const li = document.createElement('li');
    li.className = 'alert-item';
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(alert.label)}</strong>
        <span class="alert-summary">${alertSummary(alert)}</span>
      </div>
      <button class="btn-delete" data-id="${alert.id}" title="Apagar alerta" aria-label="Apagar alerta ${escapeHtml(alert.label)}">✕</button>
    `;
    li.querySelector('.btn-delete').addEventListener('click', async () => {
      await fetch(`/api/alerts/${alert.id}`, { method: 'DELETE' });
      loadAlerts();
    });
    alertsList.appendChild(li);
  });
}

async function loadAlerts() {
  const res = await fetch('/api/alerts');
  const data = await res.json();
  renderAlerts(data.alerts);
}

// ── Modal de alerta ───────────────────────────────────────────────────────────
function openAlertModal() {
  alertLabelInput.value = '';
  alertModal.classList.remove('hidden');
  requestAnimationFrame(() => alertLabelInput.focus());
}

function closeAlertModal() {
  alertModal.classList.add('hidden');
}

async function saveCurrentAlert() {
  const label = alertLabelInput.value.trim();
  if (!label) { alertLabelInput.focus(); return; }
  const filters = filtersFromForm();
  await fetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...filters, label }),
  });
  closeAlertModal();
  loadAlerts();
}

saveAlertBtn.addEventListener('click', openAlertModal);
modalCancelBtn.addEventListener('click', closeAlertModal);
modalSaveBtn.addEventListener('click', saveCurrentAlert);

alertLabelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  saveCurrentAlert();
  if (e.key === 'Escape') closeAlertModal();
});

alertModal.addEventListener('click', (e) => {
  if (e.target === alertModal) closeAlertModal();
});

// ── Novos anúncios ────────────────────────────────────────────────────────────
function renderNewListings(listings) {
  newListingsList.innerHTML = '';
  newCount.textContent = listings.length;
  newListingsPanel.classList.toggle('hidden', listings.length === 0);
  bellBadge.textContent = listings.length;
  bellBadge.classList.toggle('hidden', listings.length === 0);
  bellBtn.classList.toggle('has-new', listings.length > 0);

  listings.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'alert-item';
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span class="alert-summary">${escapeHtml(item.source)} · ${escapeHtml(item.city)} · ${formatPrice(item.price, item.listingType)}</span>
      </div>
      <a class="link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="padding:.3rem .65rem;font-size:.8rem">Ver</a>
    `;
    newListingsList.appendChild(li);
  });
}

async function loadNewListings() {
  const res = await fetch('/api/new-listings');
  const data = await res.json();
  renderNewListings(data.listings);
}

clearNewBtn.addEventListener('click', async () => {
  await fetch('/api/new-listings', { method: 'DELETE' });
  renderNewListings([]);
});

bellBtn.addEventListener('click', () => {
  newListingsPanel.scrollIntoView({ behavior: 'smooth' });
});

// ── SSE: notificações em tempo real ───────────────────────────────────────────
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showBrowserNotification(count, listings) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const first = listings[0];
  const body = first
    ? `${first.title} — ${formatPrice(first.price, first.listingType)}`
    : `${count} novo(s) anúncio(s) encontrado(s)`;
  new Notification(`🏠 ${count} novo(s) anúncio(s)!`, { body, icon: '/favicon.ico' });
}

function connectSse() {
  const es = new EventSource('/api/events');
  es.addEventListener('new-listings', (e) => {
    const data = JSON.parse(e.data);
    loadNewListings();
    showBrowserNotification(data.count, data.listings || []);
  });
  es.addEventListener('error', () => {
    es.close();
    setTimeout(connectSse, 5000);
  });
}

// ── Inicialização ─────────────────────────────────────────────────────────────
requestNotificationPermission();
loadAlerts();
loadNewListings();
connectSse();
