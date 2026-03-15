import { load } from "cheerio";
import { fetchHtml, parsePrice, slugify, safeUrl, roomsFromTitle, dedup } from "../scraper.js";

const BASE = "https://www.era.pt";

function buildUrl(type, zone, minRooms, maxPrice) {
  const typeSlug = type === "rent" ? "arrendar" : "comprar";
  const url = new URL(`${BASE}/${typeSlug}/apartamentos/`);
  if (zone) url.searchParams.set("municipio", slugify(zone));
  if (maxPrice < Number.MAX_SAFE_INTEGER) url.searchParams.set("preco_max", maxPrice);
  if (minRooms > 0) url.searchParams.set("tipologia_min", `T${minRooms}`);
  return url.toString();
}

function scrape(html, listingType) {
  const $ = load(html);
  const items = [];

  $(["[class*='property']", "[class*='imovel']", "[class*='card']", "article"].join(", ")).each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("h2 a, h3 a, [class*='title'] a, a[class*='title']").first();
    const priceEl = $el.find("[class*='price'], [class*='preco'], .price, .valor").first();
    const locationEl = $el.find("[class*='location'], [class*='local'], [class*='zone']").first();

    const title = titleEl.text().trim();
    const price = parsePrice(priceEl.text());
    const href = safeUrl(titleEl.attr("href") || $el.find("a").first().attr("href"), BASE);
    if (!title || !price) return;

    const locText = locationEl.text().trim();
    const parts = locText.split(",").map((s) => s.trim());
    items.push({
      id: `era-${(href || String(Math.random())).replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`,
      source: "ERA",
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

export const eraProvider = {
  name: "ERA",
  async search(filters) {
    const types = filters.listingType === "both" ? ["buy", "rent"] : [filters.listingType];
    const zones = filters.zones.length > 0 ? filters.zones.slice(0, 2) : [""];
    const results = [];

    for (const type of types) {
      for (const zone of zones) {
        try {
          const url = buildUrl(type, zone, filters.minRooms, filters.maxPrice);
          const html = await fetchHtml(url);
          results.push(...scrape(html, type));
        } catch (err) {
          console.error(`[ERA] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
