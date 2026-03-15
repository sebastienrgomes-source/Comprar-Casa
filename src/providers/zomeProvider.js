import { load } from "cheerio";
import { fetchHtml, parsePrice, slugify, safeUrl, roomsFromTitle, dedup } from "../scraper.js";

const BASE = "https://www.zome.pt";

// Zome URL: /pt/pesquisar/comprar-casa|arrendar-casa/apartamento/t{rooms}/l1-{city}
function buildUrl(type, zone, minRooms) {
  const typeSlug = type === "rent" ? "arrendar-casa" : "comprar-casa";
  const roomsSlug = minRooms > 0 ? `/t${minRooms}` : "";
  const zoneSlug = zone ? `/l1-${slugify(zone)}` : "";
  return `${BASE}/pt/pesquisar/${typeSlug}/apartamento${roomsSlug}${zoneSlug}`;
}

function scrape(html, listingType) {
  const $ = load(html);
  const items = [];

  $(["[class*='property']", "[class*='imovel']", "[class*='listing']", "article"].join(", ")).each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("h2 a, h3 a, [class*='title'] a").first();
    const priceEl = $el.find("[class*='price'], [class*='preco']").first();
    const locationEl = $el.find("[class*='location'], [class*='local']").first();

    const title = titleEl.text().trim();
    const price = parsePrice(priceEl.text());
    const href = safeUrl(titleEl.attr("href") || $el.find("a").first().attr("href"), BASE);
    if (!title || !price) return;

    const locText = locationEl.text().trim();
    const parts = locText.split(",").map((s) => s.trim());
    items.push({
      id: `zome-${(href || String(Math.random())).replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`,
      source: "Zome",
      title,
      zone: parts[0] || "",
      city: parts[1] || parts[0] || "",
      rooms: roomsFromTitle(title),
      price,
      listingType,
      url: href,
    });
  });

  return items;
}

export const zomeProvider = {
  name: "Zome",
  async search(filters) {
    const types = filters.listingType === "both" ? ["buy", "rent"] : [filters.listingType];
    const zones = filters.zones.length > 0 ? filters.zones.slice(0, 2) : [""];
    const results = [];

    for (const type of types) {
      for (const zone of zones) {
        try {
          const url = buildUrl(type, zone, filters.minRooms);
          const html = await fetchHtml(url);
          results.push(...scrape(html, type));
        } catch (err) {
          console.error(`[Zome] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
