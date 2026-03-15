import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { providers } from "./src/providers/index.js";
import { addSseClient, startScheduler } from "./src/scheduler.js";
import { getAlerts, saveAlert, deleteAlert, getNewListings, clearNewListings } from "./src/store.js";

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Parsing de filtros ───────────────────────────────────────────────────────
function parseFilters(query) {
  const zones = String(query.zones || "")
    .split(",")
    .map((z) => z.trim())
    .filter(Boolean);
  const minRooms = Math.max(0, parseInt(query.minRooms || "0", 10) || 0);
  const maxPriceRaw = parseInt(query.maxPrice || "", 10);
  const maxPrice = Number.isFinite(maxPriceRaw) ? maxPriceRaw : Number.MAX_SAFE_INTEGER;
  const listingType = ["buy", "rent", "both"].includes(query.listingType) ? query.listingType : "both";
  return { zones, minRooms, maxPrice, listingType };
}

function normalizeZone(zone) {
  return String(zone || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ── Validação de URL dos anúncios ────────────────────────────────────────────
const sourceDomains = {
  Idealista: "idealista.pt",
  Imovirtual: "imovirtual.com",
  "Casa Sapo": "casa.sapo.pt",
  REMAX: "remax.pt",
  ERA: "era.pt",
  "Century 21": "century21.pt",
  Zome: "zome.pt",
  "KW Portugal": "kwportugal.pt",
};

function normalizeListingUrl(listing) {
  const expectedDomain = sourceDomains[listing.source];
  const fallbackUrl = expectedDomain ? `https://${expectedDomain}/` : "";
  const rawUrl = String(listing.url || "").trim();
  if (!rawUrl) return { ...listing, url: fallbackUrl };
  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return { ...listing, url: fallbackUrl };
    const host = parsed.hostname.toLowerCase();
    if (expectedDomain && host !== expectedDomain && !host.endsWith(`.${expectedDomain}`)) {
      return { ...listing, url: fallbackUrl };
    }
    return listing;
  } catch {
    return { ...listing, url: fallbackUrl };
  }
}

// ── Filtro de resultados ─────────────────────────────────────────────────────
function filterListings(listings, filters) {
  const normalizedZones = filters.zones.map(normalizeZone);
  return listings
    .filter((l) => l.rooms >= filters.minRooms)
    .filter((l) => l.price <= filters.maxPrice)
    .filter((l) => filters.listingType === "both" || l.listingType === filters.listingType)
    .filter((l) => {
      if (normalizedZones.length === 0) return true;
      const zone = normalizeZone(l.zone);
      const city = normalizeZone(l.city);
      return normalizedZones.some((z) => zone.includes(z) || city.includes(z));
    })
    .sort((a, b) => a.price - b.price);
}

async function fetchProviderListings(filters) {
  const settled = await Promise.allSettled(providers.map((p) => p.search(filters)));
  const listings = settled.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);
  const failedProviders = settled
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "rejected")
    .map(({ r, i }) => ({ provider: providers[i]?.name || `provider_${i}`, error: r.reason?.message || "unknown" }));
  return { listings, failedProviders, providersOk: settled.length - failedProviders.length };
}

// ── API: pesquisa ────────────────────────────────────────────────────────────
app.get("/api/providers", (_req, res) => {
  res.json({ providers: providers.map((p) => p.name) });
});

app.get("/api/search", async (req, res) => {
  const filters = parseFilters(req.query);
  const { listings, failedProviders, providersOk } = await fetchProviderListings(filters);
  const normalized = listings.map(normalizeListingUrl);
  // Dedup global (mesmo anúncio pode aparecer em múltiplos providers)
  const seenIds = new Set();
  const unique = normalized.filter((l) => {
    if (seenIds.has(l.id)) return false;
    seenIds.add(l.id);
    return true;
  });
  const filtered = filterListings(unique, filters);
  res.json({
    filters,
    results: filtered,
    meta: {
      total: filtered.length,
      providers: providers.length,
      providersOk,
      providersFailed: failedProviders.length,
      failedProviders,
    },
  });
});

app.get("/api/listings/:id", async (req, res) => {
  const { id } = req.params;
  const { listings } = await fetchProviderListings({});
  const listing = listings.find((l) => l.id === id);
  if (!listing) return res.status(404).json({ error: "not_found" });
  res.json({ listing: normalizeListingUrl(listing) });
});

// ── API: alertas ─────────────────────────────────────────────────────────────
app.get("/api/alerts", (_req, res) => {
  res.json({ alerts: getAlerts() });
});

app.post("/api/alerts", (req, res) => {
  const { zones, minRooms, maxPrice, listingType, label } = req.body;
  if (!label) return res.status(400).json({ error: "label obrigatório" });
  const alert = saveAlert({ zones: zones || [], minRooms: minRooms || 0, maxPrice: maxPrice || null, listingType: listingType || "both", label });
  res.status(201).json({ alert });
});

app.delete("/api/alerts/:id", (req, res) => {
  const alerts = deleteAlert(req.params.id);
  res.json({ alerts });
});

// ── API: novos anúncios ──────────────────────────────────────────────────────
app.get("/api/new-listings", (_req, res) => {
  res.json({ listings: getNewListings() });
});

app.delete("/api/new-listings", (_req, res) => {
  clearNewListings();
  res.json({ ok: true });
});

// ── SSE: notificações em tempo real ─────────────────────────────────────────
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  // Keep-alive a cada 25 segundos
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
  res.on("close", () => clearInterval(keepAlive));
  addSseClient(res);
});

// ── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ── Arranque ─────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`Servidor pronto em http://localhost:${port}`);
  startScheduler();
});
