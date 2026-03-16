import { load } from "cheerio";
import { interceptJsonAndHtml, parsePrice, slugify, safeUrl, roomsFromTitle, dedup } from "../scraper.js";

const BASE = "https://www.zome.pt";

// Zome: Nuxt.js SPA (Vue). Data loaded via API after hydration.
// URL: /pt/pesquisar/comprar-casa/apartamento/t{rooms}/l1-{city}

function buildUrl(type, zone, minRooms) {
  const typeSlug = type === "rent" ? "arrendar-casa" : "comprar-casa";
  const roomsSlug = minRooms > 0 ? `/t${minRooms}` : "";
  const zoneSlug = zone ? `/l1-${slugify(zone)}` : "";
  return `${BASE}/pt/pesquisar/${typeSlug}/apartamento${roomsSlug}${zoneSlug}`;
}

// ── JSON interception ─────────────────────────────────────────────────────────
function findListingsInJson(responses, listingType) {
  for (const { data } of responses) {
    const candidates = [
      data?.results, data?.data?.results, data?.listings, data?.items,
      data?.properties, data?.imoveis, data?.anuncios,
      data?.data?.listings, data?.data?.items, data?.data?.properties,
    ].filter(Array.isArray);

    for (const arr of candidates) {
      if (arr.length === 0) continue;
      const s = arr[0];
      const hasPrice =
        s?.price !== undefined || s?.preco !== undefined ||
        s?.Price !== undefined || s?.salePrice !== undefined || s?.rentPrice !== undefined;
      if (!hasPrice) continue;

      return arr.map((item) => {
        const priceRaw =
          item.price ?? item.salePrice ?? item.rentPrice ?? item.preco ??
          item.Price ?? item.SalePrice ?? 0;
        const price = typeof priceRaw === "number" ? priceRaw : parsePrice(String(priceRaw));
        const title =
          item.title || item.Title || item.name || item.Name ||
          item.designation || item.Designation || "";
        const rawRooms = item.rooms ?? item.Rooms ?? item.typology ?? item.tipologia ?? "";
        const addr = item.address || item.Address || item.location || {};
        const zone =
          addr.parish || addr.locality || addr.city || item.zone || item.Zone || "";
        const city = addr.county || addr.district || zone;
        const href = item.url || item.Url || item.href || item.link || "";
        return {
          id: `zome-${String(item.id || item.Id || href).replace(/[^a-z0-9]/gi, "-").toLowerCase() || Math.random().toString(36).slice(2)}`,
          source: "Zome",
          title: String(title).trim(),
          zone: String(zone).trim(),
          city: String(city).trim(),
          rooms: typeof rawRooms === "number" ? rawRooms : roomsFromTitle(String(rawRooms)),
          price,
          listingType,
          url: href ? safeUrl(href, BASE) : "",
        };
      }).filter((l) => l.title && l.price > 0);
    }
  }
  return [];
}

// ── DOM fallback ──────────────────────────────────────────────────────────────
const CARD_SEL = [
  "[class*='property-card']", "[class*='PropertyCard']",
  "[class*='listing-card']", "[class*='imovel']",
  "[class*='card-property']", "article",
].join(", ");

function scrapeDom(html, listingType) {
  const $ = load(html);
  const items = [];

  $(CARD_SEL).each((_, el) => {
    const $el = $(el);
    if ($el.closest("nav, header, footer").length) return;
    const titleEl = $el.find("h1 a, h2 a, h3 a, [class*='title'] a").first();
    const title = titleEl.text().trim() || $el.find("h1, h2, h3").first().text().trim();
    if (!title || title.length < 5) return;
    const price = parsePrice($el.find("[class*='price'], [class*='preco']").first().text());
    if (!price) return;
    const href = safeUrl(titleEl.attr("href") || $el.find("a").first().attr("href"), BASE);
    const parts = $el.find("[class*='location'], [class*='local'], address").first().text().trim().split(",").map((s) => s.trim()).filter(Boolean);
    items.push({
      id: `zome-${(href || String(Math.random())).replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`,
      source: "Zome",
      title,
      zone: parts[0] || "",
      city: parts[1] || parts[0] || "",
      rooms: roomsFromTitle(title),
      price,
      listingType,
      url: href && href.includes("zome.pt") ? href : "",
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
          const { jsonResponses, html } = await interceptJsonAndHtml(url, { waitMs: 5000 });
          const fromJson = findListingsInJson(jsonResponses, type);
          const found = fromJson.length > 0 ? fromJson : scrapeDom(html, type);
          results.push(...found);
        } catch (err) {
          console.error(`[Zome] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
