import { load } from "cheerio";
import { fetchHtml, parsePrice, slugify, safeUrl, roomsFromTitle, dedup } from "../scraper.js";

const BASE = "https://www.idealista.pt";

function buildUrl(type, zone, minRooms, maxPrice) {
  const typeSlug = type === "rent" ? "arrendar-casas" : "comprar-casas";
  const zoneSlug = zone ? `${slugify(zone)}/` : "";
  const url = new URL(`${BASE}/${typeSlug}/${zoneSlug}`);
  if (maxPrice < Number.MAX_SAFE_INTEGER) url.searchParams.set("priceMax", maxPrice);
  if (minRooms > 0) url.searchParams.set("rooms", minRooms);
  return url.toString();
}

function scrape(html, listingType) {
  const $ = load(html);
  const items = [];

  $("article.item, section.items-container article").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find(".item-title a, a.item-link").first();
    const priceEl = $el.find(".item-price").first();
    const locationEl = $el.find(".item-location address, .item-detail-location").first();

    const title = titleEl.text().trim();
    const price = parsePrice(priceEl.text());
    const href = safeUrl(titleEl.attr("href"), BASE);
    if (!title || !price || !href) return;

    let rooms = roomsFromTitle(title);
    $el.find(".item-detail span").each((_, d) => {
      const t = $(d).text().trim();
      const m = t.match(/(\d+)\s*quarto/i);
      if (m && !rooms) rooms = parseInt(m[1], 10);
    });

    const locText = locationEl.text().trim();
    const parts = locText.split(",").map((s) => s.trim());
    items.push({
      id: `idealista-${href.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`,
      source: "Idealista",
      title,
      zone: parts[0] || "",
      city: parts[1] || parts[0] || "",
      rooms,
      price,
      listingType,
      url: href,
    });
  });

  return items;
}

export const idealistaProvider = {
  name: "Idealista",
  async search(filters) {
    const types = filters.listingType === "both" ? ["buy", "rent"] : [filters.listingType];
    const zones = filters.zones.length > 0 ? filters.zones.slice(0, 3) : [""];
    const results = [];

    for (const type of types) {
      for (const zone of zones) {
        try {
          const url = buildUrl(type, zone, filters.minRooms, filters.maxPrice);
          const html = await fetchHtml(url);
          results.push(...scrape(html, type));
        } catch (err) {
          console.error(`[Idealista] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
