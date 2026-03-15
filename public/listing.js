const detailEl = document.querySelector("#detail");

function formatPrice(value, listingType) {
  const amount = new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);

  return listingType === "rent" ? `${amount}/mês` : amount;
}

function listingTypeLabel(listingType) {
  return listingType === "buy" ? "Compra" : "Arrendamento";
}

function renderDetail(listing) {
  const externalLink = listing.url
    ? `<a class="link" href="${listing.url}" target="_blank" rel="noreferrer">Abrir anúncio original</a>`
    : '<span class="muted">Link externo indisponível.</span>';

  detailEl.innerHTML = `
    <div>
      <h1 class="detail-title">${listing.title}</h1>
      <div class="meta">
        <span class="chip">${listing.source}</span>
        <span class="chip">${listing.city} - ${listing.zone}</span>
        <span class="chip">${listing.rooms} quartos</span>
        <span class="chip">${listingTypeLabel(listing.listingType)}</span>
      </div>
      <div class="detail-price">${formatPrice(listing.price, listing.listingType)}</div>
    </div>
    <dl class="detail-grid">
      <dt>Zona</dt>
      <dd>${listing.zone}</dd>
      <dt>Cidade</dt>
      <dd>${listing.city}</dd>
      <dt>Quartos</dt>
      <dd>${listing.rooms}</dd>
      <dt>Tipo</dt>
      <dd>${listingTypeLabel(listing.listingType)}</dd>
      <dt>Fonte</dt>
      <dd>${listing.source}</dd>
    </dl>
    <div class="detail-actions">
      ${externalLink}
    </div>
  `;
}

async function loadListing() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    detailEl.innerHTML = "<p class=\"status\">Anúncio não encontrado.</p>";
    return;
  }

  try {
    const response = await fetch(`/api/listings/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    renderDetail(data.listing);
  } catch (error) {
    detailEl.innerHTML = "<p class=\"status\">Erro ao carregar o anúncio.</p>";
  }
}

loadListing();
