import { normalizePolymarketEvent } from './normalizer.js';
import type { PolymarketClient } from './polymarket-client.js';
import type {
  EventsKeysetSyncResult,
  EventsKeysetSyncStore,
  ListEventsKeysetOptions,
} from './types.js';

export interface RunEventsKeysetSyncOptions {
  query: ListEventsKeysetOptions;
  maxPages?: number;
  resume?: boolean;
  onProgress?: (progress: {
    pageNumber: number;
    pageEvents: number;
    cumulativeEvents: number;
    nextCursor: string | null;
    warningCount: number;
  }) => void;
}

export async function runEventsKeysetSync(
  client: PolymarketClient,
  store: EventsKeysetSyncStore,
  options: RunEventsKeysetSyncOptions,
): Promise<EventsKeysetSyncResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const queryWithoutCursor = removeCursor(options.query);
  const querySignature = createEventsQuerySignature(queryWithoutCursor);
  const checkpoint = options.resume === false ? null : await store.loadCheckpoint(querySignature);
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  let requestCursor = checkpoint?.nextCursor ?? options.query.afterCursor ?? null;
  let pagesProcessed = checkpoint?.pagesProcessed ?? 0;
  let eventsProcessed = checkpoint?.eventsProcessed ?? 0;
  let pagesThisRun = 0;
  let warningCount = 0;
  let runId: string | null = null;

  try {
    runId = await store.startRun({ querySignature, startedAt });

    while (pagesThisRun < maxPages) {
      const page = await client.listEventsKeyset({
        ...queryWithoutCursor,
        ...(requestCursor === null ? {} : { afterCursor: requestCursor }),
      });

      if (page.requestCursor !== requestCursor) {
        throw new Error('events keyset client returned a page for an unexpected request cursor');
      }
      if (page.nextCursor !== null && page.nextCursor === requestCursor) {
        throw new Error('events keyset cursor did not advance; sync stopped to prevent an infinite loop');
      }

      const normalizedEvents = page.events.map(normalizePolymarketEvent);
      const warnings = normalizedEvents.flatMap((event) => event.warnings);
      const committedPages = pagesProcessed + 1;
      const committedEvents = eventsProcessed + page.events.length;

      await store.commitPage({
        provider: 'polymarket',
        resourceType: 'events',
        querySignature,
        runId,
        pageNumber: committedPages,
        page,
        normalizedEvents,
        warnings,
        cumulativePages: committedPages,
        cumulativeEvents: committedEvents,
      });

      pagesThisRun += 1;
      pagesProcessed = committedPages;
      eventsProcessed = committedEvents;
      warningCount += warnings.length;

      options.onProgress?.({
        pageNumber: pagesProcessed,
        pageEvents: page.events.length,
        cumulativeEvents: eventsProcessed,
        nextCursor: page.nextCursor,
        warningCount: warnings.length,
      });

      requestCursor = page.nextCursor;
      if (requestCursor === null) break;
    }

    const fullyDrained = requestCursor === null;
    const completedAt = new Date().toISOString();
    await store.completeRun({
      runId,
      querySignature,
      completedAt,
      pagesProcessed,
      eventsProcessed,
      warningCount,
      fullyDrained,
      nextCursor: requestCursor,
    });

    return {
      querySignature,
      pagesProcessed: pagesThisRun,
      eventsProcessed: eventsProcessed - (checkpoint?.eventsProcessed ?? 0),
      warningCount,
      fullyDrained,
      nextCursor: requestCursor,
      durationMs: Date.now() - startedAtMs,
    };
  } catch (error) {
    await store.failRun({
      runId,
      querySignature,
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      pagesProcessed,
      eventsProcessed,
    });
    throw error;
  }
}

export function createEventsQuerySignature(query: ListEventsKeysetOptions): string {
  return `polymarket:events-keyset:v1:${stableStringify(query)}`;
}

function removeCursor(query: ListEventsKeysetOptions): ListEventsKeysetOptions {
  const { afterCursor: _afterCursor, ...rest } = query;
  return rest;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
