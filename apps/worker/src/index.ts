import { PolymarketClient } from '@forecast/provider-polymarket';

const client = new PolymarketClient({
  gammaBaseUrl: process.env.POLYMARKET_GAMMA_BASE_URL ?? 'https://gamma-api.polymarket.com',
  timeoutMs: Number(process.env.POLYMARKET_REQUEST_TIMEOUT_MS ?? 10_000),
});

const intervalMs = Number(process.env.POLYMARKET_SYNC_INTERVAL_MS ?? 60_000);

async function syncOnce(): Promise<void> {
  const startedAt = Date.now();
  try {
    const events = await client.listEvents({ limit: 20, active: true });
    console.log(JSON.stringify({ level: 'info', event: 'provider_sync_completed', provider: 'polymarket', records: events.length, durationMs: Date.now() - startedAt, timestamp: new Date().toISOString() }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'provider_sync_failed', provider: 'polymarket', message: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
  }
}

await syncOnce();
setInterval(() => void syncOnce(), intervalMs);
