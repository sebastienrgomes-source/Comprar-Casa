const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
];

export function randomUa() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Plain HTTP fetch ──────────────────────────────────────────────────────────
export async function fetchHtml(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": randomUa(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
  return response.text();
}

// ── JSON-LD extraction ────────────────────────────────────────────────────────
export function extractJsonLd(html) {
  const entries = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      const d = JSON.parse(m[1]);
      (Array.isArray(d) ? d : [d]).forEach((item) => entries.push(item));
    } catch {}
  }
  return entries;
}

// ── __NEXT_DATA__ extraction ──────────────────────────────────────────────────
export function extractNextData(html) {
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

// ── Puppeteer browser singleton ───────────────────────────────────────────────
let _browser = null;

export async function getBrowser() {
  if (_browser) {
    try {
      await _browser.pages(); // throws if disconnected
      return _browser;
    } catch {
      _browser = null;
    }
  }
  const puppeteer = (await import("puppeteer")).default;
  _browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--no-first-run",
      "--window-size=1280,900",
    ],
  });
  _browser.on("disconnected", () => { _browser = null; });
  return _browser;
}

// ── Puppeteer: load page and return rendered HTML ─────────────────────────────
export async function fetchWithPuppeteer(url, { waitForSelector, waitMs = 2500 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(randomUa());
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8" });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    if (waitForSelector) {
      try { await page.waitForSelector(waitForSelector, { timeout: 8000 }); } catch {}
    }
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    return await page.content();
  } finally {
    await page.close();
  }
}

// ── Puppeteer: intercept JSON API responses + get rendered HTML ───────────────
const JSON_SKIP = ["analytics", "google", "gtm", "criteo", "facebook", "doubleclick", "twitter", ".png", ".jpg", ".css", ".woff", ".svg"];

export async function interceptJsonAndHtml(url, { waitMs = 5000 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const jsonResponses = [];

  page.on("response", (response) => {
    const ct = response.headers()["content-type"] || "";
    const rUrl = response.url();
    if (ct.includes("application/json") && !JSON_SKIP.some((s) => rUrl.includes(s))) {
      response.json().then((json) => jsonResponses.push({ url: rUrl, data: json })).catch(() => {});
    }
  });

  try {
    await page.setUserAgent(randomUa());
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8" });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, waitMs));
    const html = await page.content();
    return { jsonResponses, html };
  } finally {
    await page.close();
  }
}

// ── Price parsing ─────────────────────────────────────────────────────────────
export function parsePrice(text) {
  if (!text) return 0;
  const cleaned = String(text)
    .replace(/[€$\s\u00a0]/g, "")
    .replace(/\/.*$/, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

// ── String utilities ──────────────────────────────────────────────────────────
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
  try { return new URL(href, base).toString(); } catch { return ""; }
}

export function roomsFromTitle(title) {
  const m = String(title).match(/\bT(\d+)/i);
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
