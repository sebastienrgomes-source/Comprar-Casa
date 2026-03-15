import { fetchHtml, extractNextData, parsePrice, dedup } from "../scraper.js";

const BASE = "https://www.imovirtual.com";

// Imovirtual é Next.js — dados em __NEXT_DATA__
// roomsNumber no site é uma string: ONE, TWO, THREE, FOUR, FOUR_OR_MORE
const ROOMS_STR_TO_NUM = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FOUR_OR_MORE: 4 };
const ROOMS_NUM_TO_STR = { 1: "ONE", 2: "TWO", 3: "THREE", 4: "FOUR" };

function buildUrl(type, zone, minRooms, maxPrice) {
  const typeSlug = type === "rent" ? "arrendar" : "comprar";
  const url = new URL(`${BASE}/pt/resultados/${typeSlug}/apartamento/`);
  if (zone) url.searchParams.set("locations[0][location_type]", "district");
  if (maxPrice < Number.MAX_SAFE_INTEGER) url.searchParams.set("price[to]", maxPrice);
  if (minRooms > 0) {
    url.searchParams.set("roomsNumber[]", ROOMS_NUM_TO_STR[Math.min(minRooms, 4)] || "FOUR");
  }
  if (zone) {
    // Imovirtual aceita localização por query param genérico
    const encoded = encodeURIComponent(zone);
    return `${BASE}/pt/resultados/${typeSlug}/apartamento/?nrAdsPerPage=72&price[to]=${maxPrice < Number.MAX_SAFE_INTEGER ? maxPrice : ""}&roomsNumber[]=${minRooms > 0 ? (ROOMS_NUM_TO_STR[Math.min(minRooms, 4)] || "FOUR") : "ONE"}`;
  }
  return url.toString();
}

function extractListings(nextData, listingType) {
  const items = nextData?.props?.pageProps?.data?.searchAds?.items || [];

  return items
    .map((ad) => {
      const price = ad.totalPrice?.value ?? 0;
      const roomsStr = ad.roomsNumber ?? "";
      const rooms = ROOMS_STR_TO_NUM[roomsStr] !== undefined ? ROOMS_STR_TO_NUM[roomsStr] : (parseInt(roomsStr, 10) || 0);
      const city = ad.location?.address?.city?.name || "";
      const province = ad.location?.address?.province?.name || city;
      const href = (ad.href || "").replace("[lang]", "pt");

      return {
        id: `imovirtual-${ad.id}`,
        source: "Imovirtual",
        title: ad.title || "",
        zone: city,
        city: province,
        rooms,
        price,
        listingType,
        url: href ? `${BASE}/${href}` : `${BASE}/pt/`,
      };
    })
    .filter((l) => l.title && l.price > 0);
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
            results.push(...extractListings(nextData, type));
          } else {
            console.warn(`[Imovirtual] Sem __NEXT_DATA__ em ${url}`);
          }
        } catch (err) {
          console.error(`[Imovirtual] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
