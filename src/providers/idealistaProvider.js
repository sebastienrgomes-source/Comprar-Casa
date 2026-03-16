import { load } from "cheerio";
import { fetchHtml, fetchWithPuppeteer, extractJsonLd, parsePrice, slugify, safeUrl, roomsFromTitle, dedup } from "../scraper.js";

const BASE = "https://www.idealista.pt";

function buildUrl(type, zone, minRooms, maxPrice) {
  const typeSlug = type === "rent" ? "arrendar-casas" : "comprar-casas";
  const zoneSlug = zone ? `${slugify(zone)}/` : "";
  const url = new URL(`${BASE}/${typeSlug}/${zoneSlug}`);
  if (maxPrice < Number.MAX_SAFE_INTEGER) url.searchParams.set("priceMax", maxPrice);
  if (minRooms > 0) url.searchParams.set("rooms", minRooms);
  return url.toString();
}

// ── HTML scraper (Cheerio) ────────────────────────────────────────────────────
function scrapeHtml(html, listingType) {
  const $ = load(html);
  const items = [];

  // Idealista uses <article class="item"> or <article class="item item-multimedia-push">
  $("article.item, article[class*='item']").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find(".item-title a, a.item-link, h2 a, h3 a").first();
    const priceEl = $el.find(".item-price, [class*='price']").first();
    const locationEl = $el.find(".item-location address, .item-detail-location, [class*='location']").first();

    const title = titleEl.text().trim();
    const price = parsePrice(priceEl.text());
    const href = safeUrl(titleEl.attr("href"), BASE);
    if (!title || !price) return;

    let rooms = roomsFromTitle(title);
    $el.find(".item-detail span, [class*='detail'] span").each((_, d) => {
      const t = $(d).text().trim();
      const m = t.match(/(\d+)\s*quarto/i);
      if (m && !rooms) rooms = parseInt(m[1], 10);
    });

    const locText = locationEl.text().trim();
    const parts = locText.split(",").map((s) => s.trim()).filter(Boolean);

    items.push({
      id: `idealista-${(href || String(Math.random())).replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`,
      source: "Idealista",
      title,
      zone: parts[0] || "",
      city: parts[1] || parts[0] || "",
      rooms,
      price,
      listingType,
      url: href && href.includes("idealista.pt") ? href : "",
    });
  });

  // Also try JSON-LD if HTML scraping fails (Idealista sometimes injects it)
  if (items.length === 0) {
    for (const entry of extractJsonLd(html)) {
      if (!entry.name) continue;
      const price = parsePrice(String(entry.price || entry.offers?.price || ""));
      if (!price) continue;
      const addr = entry.address || entry.availableAtOrFrom?.address || {};
      items.push({
        id: `idealista-jld-${entry["@id"]?.split("/").pop() || Math.random().toString(36).slice(2)}`,
        source: "Idealista",
        title: entry.name,
        zone: addr.addressRegion || addr.addressLocality || "",
        city: addr.addressLocality || "",
        rooms: roomsFromTitle(entry.name),
        price,
        listingType,
        url: safeUrl(entry.url || entry["@id"] || "", BASE),
      });
    }
  }

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

          // Attempt 1: plain HTTP fetch with realistic headers
          let html = null;
          try {
            html = await fetchHtml(url, {
              Referer: `${BASE}/`,
              "Sec-Fetch-Dest": "document",
              "Sec-Fetch-Mode": "navigate",
              "Sec-Fetch-Site": "same-origin",
            });
          } catch (err) {
            if (err.message.includes("403") || err.message.includes("429") || err.message.includes("406")) {
              console.log(`[Idealista] Fetch bloqueado (${err.message}), a tentar Puppeteer...`);
            } else {
              throw err;
            }
          }

          let found = html ? scrapeHtml(html, type) : [];

          // Attempt 2: Puppeteer if blocked or no results
          if (found.length === 0) {
            html = await fetchWithPuppeteer(url, {
              waitForSelector: "article.item, [class*='item-list']",
              waitMs: 2000,
            });
            found = scrapeHtml(html, type);
          }

          results.push(...found);
        } catch (err) {
          console.error(`[Idealista] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
