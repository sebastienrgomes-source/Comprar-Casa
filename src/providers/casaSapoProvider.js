import { load } from "cheerio";
import { fetchHtml, fetchWithPuppeteer, interceptJsonAndHtml, extractJsonLd, parsePrice, slugify, safeUrl, roomsFromTitle, dedup } from "../scraper.js";

const BASE = "https://casa.sapo.pt";

function buildUrl(type, zone, minRooms, maxPrice) {
  const typeSlug = type === "rent" ? "arrendar-casas" : "comprar-casas";
  const zoneSlug = zone ? `${slugify(zone)}/` : "";
  const url = new URL(`${BASE}/${typeSlug}/${zoneSlug}`);
  if (maxPrice < Number.MAX_SAFE_INTEGER) url.searchParams.set("px", maxPrice);
  if (minRooms > 0) url.searchParams.set("t", minRooms);
  return url.toString();
}

// ── Cheerio parser — works on both plain fetch HTML and Puppeteer-rendered HTML
function scrapeHtml(html, listingType) {
  const $ = load(html);
  const items = [];

  // Casa Sapo wraps each listing in #property_{guid} with class="property"
  // After JS loads, price/location are populated inside these containers.
  $(".property").each((_, el) => {
    const $el = $(el);

    // Title: from a[title] attribute or any heading link
    const rawTitle =
      $el.find("a[title]").first().attr("title") ||
      $el.find("h2 a, h3 a, h2, h3").first().text().trim();
    const title = rawTitle.replace(/^Ver\s+/i, "").trim();
    if (!title) return;

    // Price: try multiple class patterns
    const priceText =
      $el.find(".property-price-value").first().text().trim() ||
      $el.find("[class*='price']").first().text().trim() ||
      $el.find("[class*='preco']").first().text().trim() ||
      $el.find("[class*='valor']").first().text().trim();
    const price = parsePrice(priceText);
    if (!price) return;

    // Location
    const locText =
      $el.find(".property-location").first().text().trim() ||
      $el.find("[class*='location']").first().text().trim() ||
      $el.find("address").first().text().trim();
    const locParts = locText.split(",").map((s) => s.trim()).filter(Boolean);
    const zone = locParts[0] || "";
    const city = locParts[1] || locParts[0] || "";

    // Rooms: from type label or title
    const typeText = $el.find(".property-type, [class*='type']").first().text().trim();
    const rooms = roomsFromTitle(typeText) || roomsFromTitle(title);

    // URL: decode from tracker link or use direct link
    let url = "";
    $el.find("a[href]").each((_, a) => {
      const href = $(a).attr("href") || "";
      // Tracker URL contains real URL as "?l=https://..." parameter
      const mEnc = href.match(/[?&]l=(https?%3A%2F%2F[^&"]+)/i);
      const mRaw = href.match(/[?&]l=(https?:\/\/casa\.sapo\.pt[^&"]+)/i);
      const candidate = mEnc
        ? decodeURIComponent(mEnc[1]).split("?")[0]
        : mRaw
        ? mRaw[1].split("?")[0]
        : "";
      if (candidate.includes("sapo.pt")) { url = candidate; return false; }
      // Direct casa.sapo.pt listing link
      if (href.startsWith("/") && (href.includes("/comprar-") || href.includes("/arrendar-"))) {
        url = `${BASE}${href.split("?")[0]}`;
        return false;
      }
    });

    // ID from element id attribute or URL slug
    const rawId = ($el.attr("id") || "").replace("property_", "");
    const id = `casasapo-${rawId || url.split("/").filter(Boolean).pop() || Math.random().toString(36).slice(2)}`;

    items.push({ id, source: "Casa Sapo", title, zone, city, rooms, price, listingType, url });
  });

  // Fallback: JSON-LD (some pages have it)
  if (items.length === 0) {
    for (const entry of extractJsonLd(html)) {
      if (entry["@type"] !== "Offer" || !entry.name) continue;
      const price = parsePrice(String(entry.price || ""));
      if (!price) continue;
      const addr = entry.availableAtOrFrom?.address || {};
      items.push({
        id: `casasapo-jld-${String(entry["@id"] || Math.random()).split("/").pop()}`,
        source: "Casa Sapo",
        title: entry.name.replace(/^Ver\s+/i, "").trim(),
        zone: addr.addressRegion || addr.addressLocality || "",
        city: addr.addressLocality || "",
        rooms: roomsFromTitle(entry.name),
        price,
        listingType,
        url: entry.url || entry["@id"] || "",
      });
    }
  }

  return items;
}

// ── Intercept any JSON API responses Casa Sapo makes ─────────────────────────
function findListingsInJson(responses, listingType) {
  for (const { data } of responses) {
    const candidates = [
      data?.results, data?.data?.results, data?.items, data?.listings,
      data?.properties, data?.imoveis, data?.anuncios,
    ].filter(Array.isArray);
    for (const arr of candidates) {
      if (arr.length === 0) continue;
      const s = arr[0];
      if (!s?.price && !s?.preco && !s?.Price) continue;
      return arr.map((item) => {
        const priceRaw = item.price ?? item.preco ?? item.Price ?? 0;
        const price = typeof priceRaw === "number" ? priceRaw : parsePrice(String(priceRaw));
        const title = item.title || item.titulo || item.name || "";
        const addr = item.address || item.local || {};
        const zone = addr.parish || addr.locality || item.zone || "";
        const city = addr.county || addr.city || zone;
        return {
          id: `casasapo-${String(item.id || Math.random()).slice(0, 20)}`,
          source: "Casa Sapo",
          title: String(title).trim(),
          zone: String(zone).trim(),
          city: String(city).trim(),
          rooms: typeof item.rooms === "number" ? item.rooms : roomsFromTitle(String(title)),
          price,
          listingType,
          url: item.url ? safeUrl(item.url, BASE) : "",
        };
      }).filter((l) => l.title && l.price > 0);
    }
  }
  return [];
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

          // Attempt 1: plain fetch (fast, no JS)
          let found = [];
          try {
            const html = await fetchHtml(url, { Referer: `${BASE}/` });
            found = scrapeHtml(html, type);
          } catch (err) {
            if (!err.message.includes("429") && !err.message.includes("403")) throw err;
            console.log(`[Casa Sapo] Fetch bloqueado, a usar Puppeteer...`);
          }

          if (found.length > 0) {
            results.push(...found);
            continue;
          }

          // Attempt 2: Puppeteer (handles JS lazy-loading + intercepts API)
          console.log(`[Casa Sapo] A usar Puppeteer para ${url}`);
          const { jsonResponses, html: puppHtml } = await interceptJsonAndHtml(url, { waitMs: 4000 });

          const fromJson = findListingsInJson(jsonResponses, type);
          if (fromJson.length > 0) {
            console.log(`[Casa Sapo] ${fromJson.length} via API JSON`);
            results.push(...fromJson);
          } else {
            const fromDom = scrapeHtml(puppHtml, type);
            console.log(`[Casa Sapo] ${fromDom.length} via DOM renderizado`);
            results.push(...fromDom);
          }
        } catch (err) {
          console.error(`[Casa Sapo] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
