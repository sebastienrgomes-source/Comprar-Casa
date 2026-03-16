import { fetchHtml, extractNextData, extractJsonLd, parsePrice, slugify, dedup } from "../scraper.js";

const BASE = "https://www.imovirtual.com";

const ROOMS_STR_TO_NUM = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FOUR_OR_MORE: 4 };
const ROOMS_NUM_TO_STR = { 1: "ONE", 2: "TWO", 3: "THREE", 4: "FOUR" };

// ── URL builder ───────────────────────────────────────────────────────────────
// Imovirtual is Next.js — location in URL path, filters as query params.
function buildUrl(type, zone, minRooms, maxPrice) {
  const typeSlug = type === "rent" ? "arrendar" : "comprar";
  const zoneSlug = zone ? `${slugify(zone)}/` : "";
  const url = new URL(`${BASE}/pt/resultados/${typeSlug}/apartamento/${zoneSlug}`);
  url.searchParams.set("nrAdsPerPage", "72");
  if (maxPrice < Number.MAX_SAFE_INTEGER) url.searchParams.set("price[to]", maxPrice);
  if (minRooms > 0) {
    const roomsStr = ROOMS_NUM_TO_STR[Math.min(minRooms, 4)];
    if (roomsStr) url.searchParams.set("roomsNumber[]", roomsStr);
  }
  return url.toString();
}

// ── Extract from __NEXT_DATA__ ────────────────────────────────────────────────
function extractListings(nextData, listingType) {
  // Try multiple possible paths in the JSON tree
  const items =
    nextData?.props?.pageProps?.data?.searchAds?.items ||
    nextData?.props?.pageProps?.listings?.items ||
    nextData?.props?.pageProps?.ads ||
    nextData?.props?.pageProps?.data?.ads ||
    [];

  return items
    .map((ad) => {
      const price = ad.totalPrice?.value ?? ad.price?.value ?? 0;
      const roomsStr = ad.roomsNumber ?? "";
      const rooms =
        ROOMS_STR_TO_NUM[roomsStr] !== undefined
          ? ROOMS_STR_TO_NUM[roomsStr]
          : parseInt(roomsStr, 10) || 0;

      const city = ad.location?.address?.city?.name || ad.address?.city || "";
      const province = ad.location?.address?.province?.name || ad.address?.province || city;
      const href = (ad.href || ad.url || "").replace("[lang]", "pt");

      return {
        id: `imovirtual-${ad.id || ad.externalId || Math.random().toString(36).slice(2)}`,
        source: "Imovirtual",
        title: ad.title || ad.name || "",
        zone: city,
        city: province,
        rooms,
        price,
        listingType,
        url: href ? `${BASE}/${href.replace(/^\//, "")}` : `${BASE}/pt/`,
      };
    })
    .filter((l) => l.title && l.price > 0);
}

// ── JSON-LD fallback ──────────────────────────────────────────────────────────
function extractFromJsonLd(html, listingType) {
  const entries = extractJsonLd(html);
  const items = [];
  for (const entry of entries) {
    if (!entry.name) continue;
    const price = parsePrice(String(entry.price || entry.offers?.price || ""));
    if (!price) continue;
    const addr = entry.address || entry.availableAtOrFrom?.address || {};
    items.push({
      id: `imovirtual-jld-${entry["@id"]?.split("/").pop() || Math.random().toString(36).slice(2)}`,
      source: "Imovirtual",
      title: entry.name,
      zone: addr.addressRegion || addr.addressLocality || "",
      city: addr.addressLocality || "",
      rooms: parseInt(String(entry.numberOfRooms || 0), 10) || 0,
      price,
      listingType,
      url: entry.url || entry["@id"] || `${BASE}/pt/`,
    });
  }
  return items;
}

export const imovirtualProvider = {
  name: "Imovirtual",
  async search(filters) {
    const types = filters.listingType === "both" ? ["buy", "rent"] : [filters.listingType];
    const zones = filters.zones.length > 0 ? filters.zones.slice(0, 2) : [""];
    const results = [];

    for (const type of types) {
      for (const zone of zones) {
        try {
          const url = buildUrl(type, zone, filters.minRooms, filters.maxPrice);
          const html = await fetchHtml(url);
          const nextData = extractNextData(html);

          if (nextData) {
            const found = extractListings(nextData, type);
            if (found.length > 0) { results.push(...found); continue; }
          }

          // Fallback: JSON-LD
          const jldItems = extractFromJsonLd(html, type);
          if (jldItems.length > 0) results.push(...jldItems);
          else console.warn(`[Imovirtual] Sem dados em ${url}`);
        } catch (err) {
          console.error(`[Imovirtual] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
