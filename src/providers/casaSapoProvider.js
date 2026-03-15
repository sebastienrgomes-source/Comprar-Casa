import { load } from "cheerio";
import { fetchHtml, parsePrice, slugify, dedup } from "../scraper.js";

const BASE = "https://casa.sapo.pt";

// Casa Sapo: URL com filtros confirmados
// px = preço máximo, t = nº mínimo de quartos
function buildUrl(type, zone, minRooms, maxPrice) {
  const typeSlug = type === "rent" ? "arrendar-casas" : "comprar-casas";
  const zoneSlug = zone ? `${slugify(zone)}/` : "";
  const url = new URL(`${BASE}/${typeSlug}/${zoneSlug}`);
  if (maxPrice < Number.MAX_SAFE_INTEGER) url.searchParams.set("px", maxPrice);
  if (minRooms > 0) url.searchParams.set("t", minRooms);
  return url.toString();
}

function extractRooms(text) {
  // "Apartamento T1+1" → 1, "T2" → 2, "T3" → 3
  const m = String(text).match(/\bT(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function extractListingUrl(el, $) {
  // A URL real está embutida no link do tracker como parâmetro "l="
  let url = "";
  el.find("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    // O tracker tem o URL real em "l=" — pode estar encoded ou não
    const matchEncoded = href.match(/[?&]l=(https?%3A%2F%2F[^&"]+)/i);
    const matchRaw = href.match(/[?&]l=(https?:\/\/casa\.sapo\.pt[^&"]+)/i);
    const candidate = matchEncoded ? decodeURIComponent(matchEncoded[1]) : (matchRaw ? matchRaw[1] : "");
    if (candidate) {
      url = candidate.split("?")[0]; // remover parâmetros de tracking
      return false; // break
    }
  });
  return url;
}

function scrape(html, listingType) {
  const $ = load(html);
  const items = [];

  $(".property").each((_, el) => {
    const $el = $(el);

    // Título vem do atributo title do primeiro link com title
    const rawTitle = $el.find("a[title]").first().attr("title") || "";
    const title = rawTitle.replace(/^Ver\s+/i, "").trim();
    if (!title) return;

    // Preço
    const priceText = $el.find(".property-price-value").first().text().trim();
    const price = parsePrice(priceText);
    if (!price) return;

    // Localização: "Santa Maria Maior, Lisboa, Distrito de Lisboa"
    const locText = $el.find(".property-location").first().text().trim();
    const locParts = locText.split(",").map((s) => s.trim());
    const zone = locParts[0] || "";
    const city = locParts[1] || locParts[0] || "";

    // Quartos a partir do tipo: "Apartamento T2"
    const typeText = $el.find(".property-type").first().text().trim();
    const rooms = extractRooms(typeText) || extractRooms(title);

    // URL real (extraída do link de tracker)
    const url = extractListingUrl($el, $);

    // ID a partir do atributo id do .property: "property_<guid>"
    const rawId = $el.attr("id") || "";
    const id = `casasapo-${rawId.replace("property_", "") || Math.random().toString(36).slice(2)}`;

    items.push({ id, source: "Casa Sapo", title, zone, city, rooms, price, listingType, url });
  });

  return items;
}

export const casaSapoProvider = {
  name: "Casa Sapo",
  async search(filters) {
    const types = filters.listingType === "both" ? ["buy", "rent"] : [filters.listingType];
    const zones = filters.zones.length > 0 ? filters.zones.slice(0, 2) : [""];
    const results = [];

    for (const type of types) {
      for (const zone of zones) {
        try {
          const url = buildUrl(type, zone, filters.minRooms, filters.maxPrice);
          const html = await fetchHtml(url, { Referer: "https://casa.sapo.pt/" });
          results.push(...scrape(html, type));
        } catch (err) {
          console.error(`[Casa Sapo] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
