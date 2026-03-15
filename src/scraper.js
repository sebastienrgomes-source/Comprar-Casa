const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];

export async function fetchHtml(url, extraHeaders = {}) {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const response = await fetch(url, {
    headers: {
      "User-Agent": ua,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}`);
  }
  return response.text();
}

export function extractNextData(html) {
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function parsePrice(text) {
  if (!text) return 0;
  // Suporta: "285.000 €", "1.450 €/mês", "285000€", "€ 285.000", "285,000"
  const cleaned = String(text)
    .replace(/[€$\s]/g, "")
    .replace(/\/.*$/, "") // remove /mês etc.
    .replace(/\./g, "") // remove separadores de milhar portugueses
    .replace(",", "."); // vírgula decimal
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function safeUrl(href, base) {
  if (!href) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

export function roomsFromTitle(title) {
  const m = String(title).match(/\bT(\d+)\b/i);
  return m ? parseInt(m[1], 10) : 0;
}

export function dedup(listings) {
  const seen = new Set();
  return listings.filter((l) => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });
}
