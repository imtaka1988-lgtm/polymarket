export interface MarketTokenSubscriptionDelta {
  added: string[];
  removed: string[];
  current: string[];
}

export class MarketTokenSubscriptionRegistry {
  private readonly tokenIds = new Set<string>();

  constructor(initialTokenIds: Iterable<string> = []) {
    this.add(initialTokenIds);
  }

  get size(): number {
    return this.tokenIds.size;
  }

  has(tokenId: string): boolean {
    return this.tokenIds.has(normalizeTokenId(tokenId));
  }

  snapshot(): string[] {
    return [...this.tokenIds].sort();
  }

  add(tokenIds: Iterable<string>): MarketTokenSubscriptionDelta {
    const added: string[] = [];
    for (const tokenId of normalizeTokenIds(tokenIds)) {
      if (this.tokenIds.has(tokenId)) continue;
      this.tokenIds.add(tokenId);
      added.push(tokenId);
    }
    return { added: added.sort(), removed: [], current: this.snapshot() };
  }

  remove(tokenIds: Iterable<string>): MarketTokenSubscriptionDelta {
    const removed: string[] = [];
    for (const tokenId of normalizeTokenIds(tokenIds)) {
      if (!this.tokenIds.delete(tokenId)) continue;
      removed.push(tokenId);
    }
    return { added: [], removed: removed.sort(), current: this.snapshot() };
  }

  replace(tokenIds: Iterable<string>): MarketTokenSubscriptionDelta {
    const next = new Set(normalizeTokenIds(tokenIds));
    const added = [...next].filter((tokenId) => !this.tokenIds.has(tokenId)).sort();
    const removed = [...this.tokenIds].filter((tokenId) => !next.has(tokenId)).sort();

    this.tokenIds.clear();
    for (const tokenId of next) this.tokenIds.add(tokenId);

    return { added, removed, current: this.snapshot() };
  }
}

function normalizeTokenIds(tokenIds: Iterable<string>): string[] {
  const normalized = new Set<string>();
  for (const tokenId of tokenIds) {
    const value = normalizeTokenId(tokenId);
    if (value.length > 0) normalized.add(value);
  }
  return [...normalized];
}

function normalizeTokenId(tokenId: string): string {
  return tokenId.trim();
}
