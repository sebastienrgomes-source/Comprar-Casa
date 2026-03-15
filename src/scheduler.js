import { providers } from "./providers/index.js";
import { getSeenIds, markAsSeen, getAlerts, addNewListings } from "./store.js";

// ── Clientes SSE ligados ─────────────────────────────────────────────────────
const sseClients = new Set();

export function addSseClient(res) {
  sseClients.add(res);
  res.on("close", () => {
    sseClients.delete(res);
  });
}

function broadcast(eventName, data) {
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ── Verificação de novos anúncios ────────────────────────────────────────────
async function checkNewListings() {
  const alerts = getAlerts();
  if (alerts.length === 0) return;

  console.log(`[Scheduler] A verificar ${alerts.length} alerta(s)...`);
  const seenIds = getSeenIds();
  const found = [];

  for (const alert of alerts) {
    const filters = {
      zones: alert.zones || [],
      minRooms: alert.minRooms || 0,
      maxPrice: alert.maxPrice || Number.MAX_SAFE_INTEGER,
      listingType: alert.listingType || "both",
    };

    const results = await Promise.allSettled(providers.map((p) => p.search(filters)));

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const listing of result.value) {
        if (!seenIds.has(listing.id)) {
          found.push({ ...listing, _alertId: alert.id, _alertLabel: alert.label });
          seenIds.add(listing.id); // evitar duplicados entre alertas
        }
      }
    }
  }

  if (found.length > 0) {
    markAsSeen(found.map((l) => l.id));
    const added = addNewListings(found);
    if (added > 0) {
      console.log(`[Scheduler] ${added} novo(s) anúncio(s) encontrado(s). A enviar notificação...`);
      broadcast("new-listings", {
        count: added,
        listings: found.slice(0, 10),
      });
    }
  } else {
    console.log("[Scheduler] Nenhum anúncio novo.");
  }
}

// ── Iniciar scheduler ────────────────────────────────────────────────────────
export function startScheduler() {
  const INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
  setInterval(checkNewListings, INTERVAL_MS);
  // Primeira verificação 10 segundos após arranque
  setTimeout(checkNewListings, 10_000);
  console.log("[Scheduler] Iniciado. Verifica novos anúncios a cada 30 minutos.");
}
