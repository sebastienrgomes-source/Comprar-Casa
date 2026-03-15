import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function read(filename, fallback) {
  ensureDir();
  const p = join(DATA_DIR, filename);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}

function write(filename, data) {
  ensureDir();
  writeFileSync(join(DATA_DIR, filename), JSON.stringify(data, null, 2), "utf-8");
}

// ── IDs de anúncios já vistos (para detetar novos) ──────────────────────────
export function getSeenIds() {
  return new Set(read("seen.json", []));
}

export function markAsSeen(ids) {
  const seen = getSeenIds();
  for (const id of ids) seen.add(id);
  write("seen.json", [...seen]);
}

// ── Alertas guardados ────────────────────────────────────────────────────────
export function getAlerts() {
  return read("alerts.json", []);
}

export function saveAlert(alert) {
  const alerts = getAlerts();
  const id = alert.id || `alert-${Date.now()}`;
  const full = { ...alert, id, createdAt: alert.createdAt || new Date().toISOString() };
  const idx = alerts.findIndex((a) => a.id === id);
  if (idx >= 0) {
    alerts[idx] = full;
  } else {
    alerts.push(full);
  }
  write("alerts.json", alerts);
  return full;
}

export function deleteAlert(id) {
  const alerts = getAlerts().filter((a) => a.id !== id);
  write("alerts.json", alerts);
  return alerts;
}

// ── Novos anúncios (não lidos) ───────────────────────────────────────────────
export function getNewListings() {
  return read("new-listings.json", []);
}

export function addNewListings(listings) {
  const existing = getNewListings();
  const existingIds = new Set(existing.map((l) => l.id));
  const toAdd = listings.filter((l) => !existingIds.has(l.id));
  if (toAdd.length > 0) {
    write("new-listings.json", [...existing, ...toAdd]);
  }
  return toAdd.length;
}

export function clearNewListings() {
  write("new-listings.json", []);
}
