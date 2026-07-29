import assert from 'node:assert/strict';
import test from 'node:test';
import { runEventsKeysetSync } from './events-keyset-sync.js';
import type { EventsKeysetSyncStore, EventsSyncCheckpoint, EventsSyncPageCommit } from './types.js';

class MemoryStore implements EventsKeysetSyncStore {
  checkpoint: EventsSyncCheckpoint | null = null;
  commits: EventsSyncPageCommit[] = [];

  async loadCheckpoint(): Promise<EventsSyncCheckpoint | null> { return this.checkpoint; }
  async startRun(): Promise<string> { return 'run-1'; }
  async commitPage(input: EventsSyncPageCommit): Promise<void> {
    this.commits.push(input);
    this.checkpoint = {
      querySignature: input.querySignature,
      nextCursor: input.page.nextCursor,
      pagesProcessed: input.cumulativePages,
      eventsProcessed: input.cumulativeEvents,
      updatedAt: input.page.fetchedAt,
    };
  }
  async completeRun(): Promise<void> {}
  async failRun(): Promise<void> {}
}

test('sync persists each page before advancing and stops on final cursor', async () => {
  const pages = [
    {
      events: [{ id: '1', title: 'One', markets: [] }],
      nextCursor: 'next', requestCursor: null, requestUrl: 'https://example.test/1',
      fetchedAt: '2026-07-29T12:00:00.000Z', rawPayload: { events: [] },
    },
    {
      events: [{ id: '2', title: 'Two', markets: [] }],
      nextCursor: null, requestCursor: 'next', requestUrl: 'https://example.test/2',
      fetchedAt: '2026-07-29T12:01:00.000Z', rawPayload: { events: [] },
    },
  ];
  const client = {
    listEventsKeyset: async () => {
      const page = pages.shift();
      if (page === undefined) throw new Error('unexpected extra page request');
      return page;
    },
  };
  const store = new MemoryStore();

  const result = await runEventsKeysetSync(client as never, store, { query: { limit: 1 }, maxPages: 10 });
  assert.equal(result.fullyDrained, true);
  assert.equal(result.pagesProcessed, 2);
  assert.equal(store.commits.length, 2);
  assert.equal(store.checkpoint?.nextCursor, null);
});
