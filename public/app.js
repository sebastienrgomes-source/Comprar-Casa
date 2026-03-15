// ── Elementos ────────────────────────────────────────────────────────────────
const form = document.querySelector("#searchForm");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const bellBtn = document.querySelector("#bellBtn");
const bellBadge = document.querySelector("#bellBadge");
const saveAlertBtn = document.querySelector("#saveAlertBtn");
const alertsList = document.querySelector("#alertsList");
const alertsEmpty = document.querySelector("#alertsEmpty");
const newListingsPanel = document.querySelector("#newListingsPanel");
const newListingsList = document.querySelector("#newListingsList");
const newCount = document.querySelector("#newCount");
const clearNewBtn = document.querySelector("#clearNewBtn");

// ── Formatação ───────────────────────────────────────────────────────────────
function formatPrice(value, listingType) {
  const amount = new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
  return listingType === "rent" ? `${amount}/mês` : amount;
}

function typeLabel(t) {
  return t === "buy" ? "Compra" : "Arrendamento";
}

// ── Cards de resultados ──────────────────────────────────────────────────────
function renderCard(item, isNew = false) {
  const card = document.createElement("article");
  card.className = `card${isNew ? " card-new" : ""}`;
  card.innerHTML = `
    ${isNew ? '<span class="new-badge">NOVO</span>' : ""}
    <h3 class="card-title">${escapeHtml(item.title)}</h3>
    <div class="meta">
      <span class="chip">${escapeHtml(item.source)}</span>
      <span class="chip">${escapeHtml(item.city)} - ${escapeHtml(item.zone)}</span>
      <span class="chip">${item.rooms} quartos</span>
      <span class="chip">${typeLabel(item.listingType)}</span>
    </div>
    <div>
      <span class="price">${formatPrice(item.price, item.listingType)}</span>
      <a class="link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Ver anúncio</a>
    </div>
  `;
  return card;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Pesquisa ─────────────────────────────────────────────────────────────────
function setStatus(text) {
  statusEl.textContent = text;
}

function collectFilters(formElement) {
  const fd = new FormData(formElement);
  const params = new URLSearchParams();
  const zones = String(fd.get("zones") || "").trim();
  const minRooms = String(fd.get("minRooms") || "0");
  const maxPrice = String(fd.get("maxPrice") || "").trim();
  const listingType = String(fd.get("listingType") || "both");
  if (zones) params.set("zones", zones);
  if (minRooms) params.set("minRooms", minRooms);
  if (maxPrice) params.set("maxPrice", maxPrice);
  params.set("listingType", listingType);
  return params;
}

async function searchListings(event) {
  event.preventDefault();
  resultsEl.innerHTML = "";
  setStatus("A procurar casas em todos os sites...");

  try {
    const params = collectFilters(form);
    const response = await fetch(`/api/search?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data.meta.providersFailed > 0) {
      const names = data.meta.failedProviders.map((p) => p.provider).join(", ");
      console.warn(`[Pesquisa] Sites com erro: ${names}`);
    }

    if (data.results.length === 0) {
      setStatus("Não foram encontradas casas com estes critérios.");
      return;
    }

    setStatus(
      `Encontradas ${data.results.length} casas em ${data.meta.providersOk} fonte(s).` +
        (data.meta.providersFailed > 0 ? ` (${data.meta.providersFailed} site(s) com erro)` : "")
    );
    data.results.forEach((item) => resultsEl.appendChild(renderCard(item)));
  } catch {
    setStatus("Erro ao pesquisar. Verifica se o servidor está a correr.");
  }
}

form.addEventListener("submit", searchListings);

// ── Alertas guardados ────────────────────────────────────────────────────────
function filtersFromForm() {
  const fd = new FormData(form);
  return {
    zones: String(fd.get("zones") || "")
      .split(",")
      .map((z) => z.trim())
      .filter(Boolean),
    minRooms: parseInt(fd.get("minRooms") || "0", 10) || 0,
    maxPrice: parseInt(fd.get("maxPrice") || "", 10) || null,
    listingType: String(fd.get("listingType") || "both"),
  };
}

function alertSummary(alert) {
  const parts = [];
  if (alert.zones?.length > 0) parts.push(alert.zones.join(", "));
  if (alert.minRooms > 0) parts.push(`≥ T${alert.minRooms}`);
  if (alert.maxPrice) parts.push(`≤ ${new Intl.NumberFormat("pt-PT").format(alert.maxPrice)} €`);
  parts.push(alert.listingType === "buy" ? "Compra" : alert.listingType === "rent" ? "Arrendamento" : "Compra + Arrendamento");
  return parts.join(" · ");
}

function renderAlerts(alerts) {
  alertsList.innerHTML = "";
  alertsEmpty.classList.toggle("hidden", alerts.length > 0);
  alerts.forEach((alert) => {
    const li = document.createElement("li");
    li.className = "alert-item";
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(alert.label)}</strong>
        <span class="muted alert-summary">${alertSummary(alert)}</span>
      </div>
      <button class="btn-delete" data-id="${alert.id}" title="Apagar alerta">✕</button>
    `;
    li.querySelector(".btn-delete").addEventListener("click", async () => {
      await fetch(`/api/alerts/${alert.id}`, { method: "DELETE" });
      loadAlerts();
    });
    alertsList.appendChild(li);
  });
}

async function loadAlerts() {
  const res = await fetch("/api/alerts");
  const data = await res.json();
  renderAlerts(data.alerts);
}

saveAlertBtn.addEventListener("click", async () => {
  const label = prompt("Nome para este alerta (ex: 'T2 Porto até 250k'):");
  if (!label?.trim()) return;
  const filters = filtersFromForm();
  await fetch("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...filters, label: label.trim() }),
  });
  loadAlerts();
});

// ── Novos anúncios ───────────────────────────────────────────────────────────
function renderNewListings(listings) {
  newListingsList.innerHTML = "";
  newCount.textContent = listings.length;
  newListingsPanel.classList.toggle("hidden", listings.length === 0);
  bellBadge.textContent = listings.length;
  bellBadge.classList.toggle("hidden", listings.length === 0);

  listings.forEach((item) => {
    const li = document.createElement("li");
    li.className = "alert-item";
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span class="muted alert-summary">${escapeHtml(item.source)} · ${escapeHtml(item.city)} · ${formatPrice(item.price, item.listingType)}</span>
      </div>
      <a class="link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Ver</a>
    `;
    newListingsList.appendChild(li);
  });
}

async function loadNewListings() {
  const res = await fetch("/api/new-listings");
  const data = await res.json();
  renderNewListings(data.listings);
}

clearNewBtn.addEventListener("click", async () => {
  await fetch("/api/new-listings", { method: "DELETE" });
  renderNewListings([]);
});

bellBtn.addEventListener("click", () => {
  newListingsPanel.scrollIntoView({ behavior: "smooth" });
});

// ── SSE: notificações em tempo real ─────────────────────────────────────────
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function showBrowserNotification(count, listings) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const first = listings[0];
  const body =
    first
      ? `${first.title} — ${formatPrice(first.price, first.listingType)}`
      : `${count} novo(s) anúncio(s) encontrado(s)`;
  new Notification(`🏠 ${count} novo(s) anúncio(s)!`, { body, icon: "/favicon.ico" });
}

function connectSse() {
  const es = new EventSource("/api/events");

  es.addEventListener("new-listings", (e) => {
    const data = JSON.parse(e.data);
    loadNewListings();
    showBrowserNotification(data.count, data.listings || []);
  });

  es.addEventListener("error", () => {
    // Reconecta automaticamente após 5 segundos
    es.close();
    setTimeout(connectSse, 5000);
  });
}

// ── Inicialização ────────────────────────────────────────────────────────────
requestNotificationPermission();
loadAlerts();
loadNewListings();
connectSse();
