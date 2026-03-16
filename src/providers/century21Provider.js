import { load } from "cheerio";
import { interceptJsonAndHtml, fetchHtml, parsePrice, slugify, safeUrl, roomsFromTitle, dedup } from "../scraper.js";

const BASE = "https://www.century21.pt";

function buildUrl(type, zone, minRooms, maxPrice) {
  const typeSlug = type === "rent" ? "arrendar" : "comprar";
  const url = new URL(`${BASE}/${typeSlug}/`);
  url.searchParams.set("tipo", "apartamentos");
  if (zone) url.searchParams.set("localizacao", zone);
  if (maxPrice < Number.MAX_SAFE_INTEGER)
    url.searchParams.set(`preco_${typeSlug === "comprar" ? "venda" : "renda"}_max`, maxPrice);
  if (minRooms > 0) url.searchParams.set("tipologia", `T${minRooms}`);
  return url.toString();
}

// ── JSON API response hunting ─────────────────────────────────────────────────
// Century 21 API: /api/properties -> { data: [...], total }
// Item fields: price (number), title (object {pt,en,es,fr}), link (URL),
//              number_of_rooms, lat, lng, address (street only, no city)
function findListingsInJson(responses, listingType) {
  for (const { data } of responses) {
    // C21 wraps results in { data: [...], total }; also try direct array
    const arr = Array.isArray(data?.data) ? data.data
      : Array.isArray(data) ? data
      : null;
    if (!arr || arr.length === 0) continue;

    const s = arr[0];
    if (s?.price === undefined) continue;

    return arr.map((item) => {
      const price = typeof item.price === "number" ? item.price : parsePrice(String(item.price || 0));
      if (!price) return null;

      // Title is a multilingual object {pt, en, es, fr}
      const titleObj = item.title && typeof item.title === "object" ? item.title : {};
      const title = titleObj.pt || titleObj.en || titleObj.es || titleObj.fr
        || (typeof item.title === "string" ? item.title : "")
        || item.name || item.designation || "";
      if (!title) return null;

      const rooms = item.number_of_rooms ?? item.rooms ?? 0;
      const url = item.link ? safeUrl(item.link, BASE) : "";

      // C21 API doesn't return city/municipality — zone/city left empty;
      // filterListings will pass these through (no zone data = trust the API filter)
      return {
        id: `c21-${String(item.id || url).replace(/[^a-z0-9]/gi, "-").toLowerCase() || Math.random().toString(36).slice(2)}`,
        source: "Century 21",
        title: String(title).trim(),
        zone: "",
        city: "",
        rooms,
        price,
        listingType,
        url,
      };
    }).filter(Boolean).filter((l) => l.title && l.price > 0);
  }
  return [];
}

// ── DOM fallback ──────────────────────────────────────────────────────────────
const CARD_SEL = [
  "[class*='property-card']", "[class*='PropertyCard']",
  "[class*='listing-card']", "[class*='imovel-card']",
  "[class*='search-result']", "article",
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

    const price = parsePrice($el.find("[class*='price'], [class*='preco'], .price").first().text());
    if (!price) return;

    const href = safeUrl(titleEl.attr("href") || $el.find("a").first().attr("href"), BASE);
    const locText = $el.find("[class*='location'], [class*='local'], address").first().text().trim();
    const parts = locText.split(",").map((s) => s.trim()).filter(Boolean);

    items.push({
      id: `c21-${(href || String(Math.random())).replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`,
      source: "Century 21",
      title,
      zone: parts[0] || "",
      city: parts[1] || parts[0] || "",
      rooms: roomsFromTitle(title),
      price,
      listingType,
      url: href && href.includes("century21.pt") ? href : "",
    });
  });

  return items;
}

export const century21Provider = {
  name: "Century 21",
  async search(filters) {
    const types = filters.listingType === "both" ? ["buy", "rent"] : [filters.listingType];
    const zones = filters.zones.length > 0 ? filters.zones.slice(0, 2) : [""];
    const results = [];

    for (const type of types) {
      for (const zone of zones) {
        try {
          const url = buildUrl(type, zone, filters.minRooms, filters.maxPrice);

          // Try plain fetch first (faster); fall back to Puppeteer if 403
          let html = null;
          try {
            html = await fetchHtml(url, { Referer: `${BASE}/` });
          } catch (err) {
            if (err.message.includes("403") || err.message.includes("429")) {
              console.log(`[Century 21] Fetch bloqueado, a usar Puppeteer...`);
            } else {
              throw err;
            }
          }

          let fromDom = html ? scrapeDom(html, type) : [];

          if (fromDom.length === 0) {
            const { jsonResponses, html: puppHtml } = await interceptJsonAndHtml(url, { waitMs: 5000 });
            const fromJson = findListingsInJson(jsonResponses, type);
            fromDom = fromJson.length > 0 ? fromJson : scrapeDom(puppHtml, type);
          }

          results.push(...fromDom);
        } catch (err) {
          console.error(`[Century 21] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
