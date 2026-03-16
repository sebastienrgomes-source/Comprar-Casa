import { load } from "cheerio";
import { interceptJsonAndHtml, fetchHtml, extractJsonLd, parsePrice, slugify, safeUrl, roomsFromTitle, dedup } from "../scraper.js";

const BASE = "https://www.kwportugal.pt";

// KW Portugal: Next.js App Router (RSC). Data in self.__next_f stream.
// The featured properties are in dataProperty[], search results via Puppeteer.

function buildUrl(type, zone, minRooms, maxPrice) {
  const url = new URL(`${BASE}/imoveis/`);
  url.searchParams.set("negocio", type === "rent" ? "arrendamento" : "venda");
  url.searchParams.set("categoria", "apartamento");
  if (zone) url.searchParams.set("localizacao", slugify(zone));
  if (maxPrice < Number.MAX_SAFE_INTEGER) url.searchParams.set("preco_max", maxPrice);
  if (minRooms > 0) url.searchParams.set("quartos_min", minRooms);
  return url.toString();
}

// ── Extract from self.__next_f RSC stream ────────────────────────────────────
function extractFromRsc(html, listingType) {
  const items = [];
  // Look for dataProperty arrays in the RSC payload
  const regex = /"dataProperty"\s*:\s*(\[[\s\S]*?\])/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      const arr = JSON.parse(m[1]);
      for (const item of arr) {
        if (!item.id && !item.priceProperty) continue;
        const price = parsePrice(String(item.priceProperty || item.price || 0));
        if (!price) continue;
        const title = item.titleProperty || item.typeProperty || item.name || "";
        const addr = item.addressProperty || item.address || "";
        const parts = String(addr).split(",").map((s) => s.trim()).filter(Boolean);
        const href = item.url || item.href || (item.id ? `/imovel/${item.id}` : "");
        items.push({
          id: `kw-${item.id || String(Math.random()).slice(2)}`,
          source: "KW Portugal",
          title: String(title).trim(),
          zone: parts[0] || "",
          city: parts[1] || parts[0] || "",
          rooms: roomsFromTitle(String(title)),
          price,
          listingType,
          url: href ? safeUrl(href, BASE) : "",
        });
      }
    } catch {}
  }
  return items;
}

// ── JSON API interception ─────────────────────────────────────────────────────
function findListingsInJson(responses, listingType) {
  for (const { data } of responses) {
    const candidates = [
      data?.dataProperty, data?.results, data?.items,
      data?.properties, data?.listings,
      data?.data?.results, data?.data?.items, data?.data?.dataProperty,
    ].filter(Array.isArray);

    for (const arr of candidates) {
      if (arr.length === 0) continue;
      const s = arr[0];
      const hasPrice =
        s?.price !== undefined || s?.priceProperty !== undefined ||
        s?.Price !== undefined || s?.preco !== undefined;
      if (!hasPrice) continue;

      return arr.map((item) => {
        const priceRaw = item.price ?? item.priceProperty ?? item.Price ?? item.preco ?? 0;
        const price = typeof priceRaw === "number" ? priceRaw : parsePrice(String(priceRaw));
        const title = item.title || item.titleProperty || item.typeProperty || item.name || "";
        const rawRooms = item.rooms ?? item.quartos ?? "";
        const addr = item.address || item.addressProperty || item.local || "";
        const parts = String(addr).split(",").map((s) => s.trim()).filter(Boolean);
        const href = item.url || item.href || (item.id ? `/imovel/${item.id}` : "");
        return {
          id: `kw-${String(item.id || href).replace(/[^a-z0-9]/gi, "-").toLowerCase() || Math.random().toString(36).slice(2)}`,
          source: "KW Portugal",
          title: String(title).trim(),
          zone: parts[0] || "",
          city: parts[1] || parts[0] || "",
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
  "[class*='property-card']", "[class*='imovel-card']",
  "[class*='listing-card']", "[class*='card-imovel']",
  ".entry", "article",
].join(", ");

function scrapeDom(html, listingType) {
  const $ = load(html);
  const items = [];

  $(CARD_SEL).each((_, el) => {
    const $el = $(el);
    if ($el.closest("nav, header, footer").length) return;
    const titleEl = $el.find("h1 a, h2 a, h3 a, .entry-title a, [class*='title'] a").first();
    const title = titleEl.text().trim() || $el.find("h1, h2, h3, .entry-title").first().text().trim();
    if (!title || title.length < 5) return;
    const price = parsePrice($el.find("[class*='price'], [class*='preco'], .price").first().text());
    if (!price) return;
    const href = safeUrl(titleEl.attr("href") || $el.find("a").first().attr("href"), BASE);
    const parts = $el.find("[class*='location'], [class*='local'], address").first().text().trim().split(",").map((s) => s.trim()).filter(Boolean);
    items.push({
      id: `kw-${(href || String(Math.random())).replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`,
      source: "KW Portugal",
      title,
      zone: parts[0] || "",
      city: parts[1] || parts[0] || "",
      rooms: roomsFromTitle(title),
      price,
      listingType,
      url: href && href.includes("kwportugal.pt") ? href : "",
    });
  });
  return items;
}

export const kwPortugalProvider = {
  name: "KW Portugal",
  async search(filters) {
    const types = filters.listingType === "both" ? ["buy", "rent"] : [filters.listingType];
    const zones = filters.zones.length > 0 ? filters.zones.slice(0, 2) : [""];
    const results = [];

    for (const type of types) {
      for (const zone of zones) {
        try {
          const url = buildUrl(type, zone, filters.minRooms, filters.maxPrice);

          // Try plain fetch first (RSC data in stream)
          let html = null;
          try { html = await fetchHtml(url); } catch {}

          if (html) {
            const fromRsc = extractFromRsc(html, type);
            if (fromRsc.length > 0) { results.push(...fromRsc); continue; }
            // Also try JSON-LD
            const entries = extractJsonLd(html);
            for (const entry of entries) {
              if (!entry.name) continue;
              const price = parsePrice(String(entry.price || entry.offers?.price || ""));
              if (!price) continue;
              const addr = entry.address || {};
              results.push({
                id: `kw-jld-${entry["@id"]?.split("/").pop() || Math.random().toString(36).slice(2)}`,
                source: "KW Portugal",
                title: entry.name,
                zone: addr.addressRegion || addr.addressLocality || "",
                city: addr.addressLocality || "",
                rooms: roomsFromTitle(entry.name),
                price,
                listingType: type,
                url: safeUrl(entry.url || entry["@id"] || "", BASE),
              });
            }
          }

          // Puppeteer fallback
          const { jsonResponses, html: puppHtml } = await interceptJsonAndHtml(url, { waitMs: 5000 });
          const fromJson = findListingsInJson(jsonResponses, type);
          if (fromJson.length > 0) { results.push(...fromJson); continue; }
          const fromDom = scrapeDom(puppHtml, type);
          results.push(...fromDom);
        } catch (err) {
          console.error(`[KW Portugal] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
