import { load } from "cheerio";
import { interceptJsonAndHtml, parsePrice, slugify, safeUrl, roomsFromTitle, dedup } from "../scraper.js";

const BASE = "https://www.era.pt";

// ERA Portugal: React SPA over DotNetNuke (DNN) framework.
// #rootContainer-410 renders listings via window.renderSearchList() after JS loads.
// We use Puppeteer + JSON interception to get the data.

function buildUrl(type, zone, minRooms, maxPrice) {
  const typeSlug = type === "rent" ? "arrendar" : "comprar";
  const url = new URL(`${BASE}/${typeSlug}/apartamentos/`);
  if (zone) url.searchParams.set("localizacao", slugify(zone));
  if (maxPrice < Number.MAX_SAFE_INTEGER) url.searchParams.set("preco_max", maxPrice);
  if (minRooms > 0) url.searchParams.set("tipologia_min", `T${minRooms}`);
  return url.toString();
}

// ── Try to find listing data in intercepted JSON responses ───────────────────
function findListingsInJson(responses, listingType) {
  const items = [];

  for (const { data } of responses) {
    const candidates = [
      data?.Results,
      data?.results,
      data?.Items,
      data?.items,
      data?.Properties,
      data?.properties,
      data?.Imoveis,
      data?.imoveis,
      data?.data?.results,
      data?.data?.items,
    ].filter(Array.isArray);

    for (const arr of candidates) {
      if (arr.length === 0) continue;
      const sample = arr[0];
      // Must look like a property listing
      const hasPrice =
        sample?.Price !== undefined ||
        sample?.price !== undefined ||
        sample?.Preco !== undefined ||
        sample?.preco !== undefined ||
        sample?.Valor !== undefined;

      if (!hasPrice) continue;

      for (const item of arr) {
        const priceRaw =
          item.Price ?? item.price ?? item.Preco ?? item.preco ?? item.Valor ?? 0;
        const price = typeof priceRaw === "number" ? priceRaw : parsePrice(String(priceRaw));
        if (!price) continue;

        const title =
          item.Title || item.title || item.Titulo || item.titulo ||
          item.Designation || item.Name || item.name || "";
        const rawRooms =
          item.Rooms ?? item.rooms ?? item.Quartos ?? item.quartos ??
          item.Typology ?? item.tipologia ?? "";
        const rooms = typeof rawRooms === "number" ? rawRooms : roomsFromTitle(String(rawRooms));

        const addr = item.Address || item.address || item.Local || item.local || {};
        const zone =
          item.Parish || item.Freguesia || addr.Parish || addr.Freguesia ||
          addr.City || addr.Locality || item.Zone || item.Zona || "";
        const city =
          item.County || item.Concelho || addr.County || addr.Concelho ||
          addr.District || addr.Distrito || zone;

        const href =
          item.Url || item.url || item.Link || item.link || item.DetailUrl ||
          (item.Id ? `/comprar/apartamento/${item.Id}` : "");
        const url = href ? safeUrl(href, BASE) : "";

        items.push({
          id: `era-${String(item.Id || item.id || item.Code || url).replace(/[^a-z0-9]/gi, "-").toLowerCase() || Math.random().toString(36).slice(2)}`,
          source: "ERA",
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

// ── Fallback: parse the rendered DOM ────────────────────────────────────────
const CARD_SELECTORS = [
  "#rootContainer-410 [class*='card']",
  "#rootContainer-410 [class*='property']",
  "#rootContainer-410 [class*='imovel']",
  "#rootContainer-410 article",
  "[class*='property-card']",
  "[class*='imovel-card']",
  "[class*='listing-card']",
  "[class*='search-result']",
  "article[class*='card']",
  "article",
].join(", ");

function scrapeDom(html, listingType) {
  const $ = load(html);
  const items = [];

  $(CARD_SELECTORS).each((_, el) => {
    const $el = $(el);
    if ($el.closest("nav, header, footer, script").length) return;

    const titleEl = $el
      .find("h1 a, h2 a, h3 a, [class*='title'] a, [class*='nome'] a, [class*='name'] a")
      .first();
    const title =
      titleEl.text().trim() ||
      $el.find("h1, h2, h3, [class*='title'], [class*='designation']").first().text().trim();
    if (!title || title.length < 5) return;

    const priceEl = $el
      .find("[class*='price'], [class*='Price'], [class*='preco'], [class*='valor'], .price, .valor")
      .first();
    const price = parsePrice(priceEl.text());
    if (!price) return;

    const href = safeUrl(
      titleEl.attr("href") || $el.find("a[href]").first().attr("href"),
      BASE
    );
    const locEl = $el
      .find("[class*='location'], [class*='local'], [class*='zone'], [class*='morada'], address")
      .first();
    const locText = locEl.text().trim();
    const parts = locText.split(",").map((s) => s.trim()).filter(Boolean);

    items.push({
      id: `era-${(href || String(Math.random())).replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase()}`,
      source: "ERA",
      title,
      zone: parts[0] || "",
      city: parts[1] || parts[0] || "",
      rooms: roomsFromTitle(title),
      price,
      listingType,
      url: href && href.includes("era.pt") ? href : "",
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
          console.log(`[ERA] A carregar (Puppeteer): ${url}`);

          // Wait extra time for DNN React module to render (#rootContainer-410)
          const { jsonResponses, html } = await interceptJsonAndHtml(url, { waitMs: 7000 });

          const fromJson = findListingsInJson(jsonResponses, type);
          if (fromJson.length > 0) {
            console.log(`[ERA] ${fromJson.length} resultados via API JSON`);
            results.push(...fromJson);
            continue;
          }

          const fromDom = scrapeDom(html, type);
          if (fromDom.length > 0) {
            console.log(`[ERA] ${fromDom.length} resultados via DOM`);
            results.push(...fromDom);
          } else {
            console.warn(`[ERA] Sem resultados para tipo=${type}, zona=${zone || "—"}`);
          }
        } catch (err) {
          console.error(`[ERA] Erro (${type}, ${zone || "—"}):`, err.message);
        }
      }
    }

    return dedup(results);
  },
};
