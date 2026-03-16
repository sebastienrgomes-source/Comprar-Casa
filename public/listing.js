const detailEl = document.querySelector('#detail');

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

function renderDetail(listing) {
  document.title = `${listing.title} · CasaSearch`;

  const externalLink = listing.url
    ? `<a class="link" href="${escapeHtml(listing.url)}" target="_blank" rel="noreferrer">
        Abrir anúncio original
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>`
    : '<span class="muted">Link externo indisponível.</span>';

  detailEl.innerHTML = `
    <div>
      <h1 class="detail-title">${escapeHtml(listing.title)}</h1>
      <div class="meta" style="margin:.5rem 0 .75rem">
        <span class="chip chip-source" data-source="${escapeHtml(listing.source)}">${escapeHtml(listing.source)}</span>
        <span class="chip">${escapeHtml(listing.city)} · ${escapeHtml(listing.zone)}</span>
        <span class="chip">${listing.rooms} quartos</span>
        <span class="chip">${typeLabel(listing.listingType)}</span>
      </div>
      <div class="detail-price">${formatPrice(listing.price, listing.listingType)}</div>
    </div>
    <dl class="detail-grid">
      <dt>Zona</dt>     <dd>${escapeHtml(listing.zone)}</dd>
      <dt>Cidade</dt>   <dd>${escapeHtml(listing.city)}</dd>
      <dt>Quartos</dt>  <dd>${listing.rooms}</dd>
      <dt>Tipo</dt>     <dd>${typeLabel(listing.listingType)}</dd>
      <dt>Fonte</dt>    <dd>${escapeHtml(listing.source)}</dd>
    </dl>
    <div class="detail-actions">
      ${externalLink}
    </div>
  `;
}

async function loadListing() {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    detailEl.innerHTML = '<p class="muted">Anúncio não encontrado.</p>';
    return;
  }
  try {
    const res = await fetch(`/api/listings/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderDetail(data.listing);
  } catch {
    detailEl.innerHTML = '<p class="muted">Erro ao carregar o anúncio.</p>';
  }
}

loadListing();
