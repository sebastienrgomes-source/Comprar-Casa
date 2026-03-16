import { load } from "cheerio";
import { interceptJsonAndHtml, parsePrice, slugify, safeUrl, roomsFromTitle, dedup } from "../scraper.js";

const BASE = "https://www.remax.pt";

// REMAX Portugal: Next.js SSG shell with empty results.
// Actual listings are fetched client-side — we intercept the JSON API call.

function buildUrl(type, zones) {
  const typeSlug = type === "rent" ? "arrendar" : "comprar";
  // District slug in the path (e.g. /pt/comprar/imoveis/habitacao/lisboa)
  const district = zones.length > 0 ? slugify(zones[0]) : "";
  const path = district
    ? `/pt/${typeSlug}/imoveis/habitacao/${district}`
    : `/pt/${typeSlug}/imoveis/habitacao`;
  return `${BASE}${path}`;
}

// ── Try to find listing data in intercepted JSON responses ───────────────────
// REMAX API: PaginatedMultiMatchSearch returns { results: [...], total, ... }
// Item fields: listingPrice, listingTitle (ref#), numberOfBedrooms,
//              regionName1 (district), regionName2 (municipality), regionName3 (parish),
//              descriptions[{languageCode:"PT", description:"<html>"}], id
function findListingsInJson(responses, listingType) {
  const items = [];

  for (const { data } of responses) {
    const candidates = [
      data?.results,
      data?.items,
      data?.listings,
      data?.data?.results,
      data?.data?.items,
      data?.searchResults?.results,
      data?.properties,
      data?.imoveis,
    ].filter(Array.isArray);

    for (const arr of candidates) {
      if (arr.length === 0) continue;
      const sample = arr[0];
      const hasPrice =
        sample?.listingPrice !== undefined ||
        sample?.price !== undefined ||
        sample?.preco !== undefined ||
        sample?.valor !== undefined ||
        sample?.totalPrice !== undefined;

      if (!hasPrice) continue;

      for (const item of arr) {
        const priceRaw =
          item.listingPrice ?? item.price ?? item.preco ?? item.valor ?? item.totalPrice ?? 0;
        const price = typeof priceRaw === "number" ? priceRaw : parsePrice(String(priceRaw));
        if (!price) continue;

        // Title: first meaningful line from PT description (strip HTML), or fallback
        const ptDesc = item.descriptions?.find((d) => d.languageCode === "PT");
        const descText = ptDesc?.description
          ? ptDesc.description.replace(/<[^>]+>/g, "").split(/\n/).map((l) => l.trim()).find((l) => l.length > 4) || ""
          : "";
        const rooms = item.numberOfBedrooms ?? 0;
        const title =
          descText ||
          item.title || item.titulo || item.name || item.designation ||
          `Apartamento T${rooms} em ${item.regionName2 || item.regionName1 || "Portugal"}`;

        const zone = item.regionName3 || item.regionName2 || "";
        const city = item.regionName2 || item.regionName1 || "";

        // URL: listingTitle holds the reference slug (e.g. "124151197-145")
        const ref = item.listingTitle || String(item.id || "");
        const url = ref ? `${BASE}/pt/imovel/${ref}` : "";

        items.push({
          id: `remax-${String(item.id || ref).replace(/[^a-z0-9]/gi, "-").toLowerCase() || Math.random().toString(36).slice(2)}`,
          source: "REMAX",
          title: String(title).trim(),
          zone: String(zone).trim(),
          city: String(city).trim(),
          rooms,
          price,
          listingType,
          url,
        });
      }

      if (items.length > 0) return items;
    }
  }

  return items;
}

// ── Fallback: parse the fully-rendered DOM with Cheerio ─────────────────────
const CARD_SELECTORS = [
  "[class*='property-card']",
  "[class*='PropertyCard']",
  "[class*='listing-card']",
  "[class*='ListingCard']",
  "[class*='search-result']",
  "[class*='property-item']",
  "[class*='p-card']",
  "[data-listing-id]",
  "[data-property-id]",
  "article",
].join(", ");

function scrapeDom(html, listingType) {
  const $ = load(html);
  const items = [];

  $(CARD_SELECTORS).each((_, el) => {
    const $el = $(el);
    // Skip nav, header, footer elements
    if ($el.closest("nav, header, footer, script").length) return;

    const titleEl = $el.find("h1 a, h2 a, h3 a, h4 a, [class*='title'] a, [class*='Title'] a").first();
    const title = titleEl.text().trim() || $el.find("h1, h2, h3, h4").first().text().trim();
    if (!title || title.length < 5) return;

    const priceEl = $el.find("[class*='price'], [class*='Price'], [class*='preco'], .valor, [data-price]").first();
    const price = parsePrice(priceEl.text());
    if (!price) return;

    const href = safeUrl(
      titleEl.attr("href") || $el.find("a[href]").first().attr("href"),
      BASE
    );

    const locEl = $el.find("[class*='location'], [class*='Location'], [class*='local'], [class*='zone'], address").first();
    const locText = locEl.text().trim();
    const parts = locText.split(",").map((s) => s.trim()).filter(Boolean);

    items.push({
      id: `remax-${(href || String(Math.random())).replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`,
      source: "REMAX",
      title,
      zone: parts[0] || "",
      city: parts[1] || parts[0] || "",
      rooms: roomsFromTitle(title),
      price,
      listingType,
      url: href && href.includes("remax.pt") ? href : "",
    });
  });

  return items;
}

export const remaxProvider = {
  name: "REMAX",
  async search(filters) {
    const types = filters.listingType === "both" ? ["buy", "rent"] : [filters.listingType];
    const zones = filters.zones.length > 0 ? filters.zones.slice(0, 2) : [""];
    const results = [];

    for (const type of types) {
      try {
        const url = buildUrl(type, zones);
        console.log(`[REMAX] A carregar (Puppeteer): ${url}`);

        const { jsonResponses, html } = await interceptJsonAndHtml(url, { waitMs: 6000 });

        // Strategy 1: intercepted JSON API responses
        const fromJson = findListingsInJson(jsonResponses, type);
        if (fromJson.length > 0) {
          console.log(`[REMAX] ${fromJson.length} resultados via API JSON`);
          results.push(...fromJson);
          continue;
        }

        // Strategy 2: parse the fully-rendered DOM
        const fromDom = scrapeDom(html, type);
        if (fromDom.length > 0) {
          console.log(`[REMAX] ${fromDom.length} resultados via DOM`);
          results.push(...fromDom);
        } else {
          console.warn(`[REMAX] Sem resultados para tipo=${type}, zonas=${zones.join(",")}`);
        }
      } catch (err) {
        console.error(`[REMAX] Erro:`, err.message);
      }
    }

    return dedup(results);
  },
};
