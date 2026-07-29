export interface PolymarketClientOptions {
  gammaBaseUrl: string;
  timeoutMs: number;
}

export interface ListEventsOptions {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
}

export interface PolymarketEvent {
  id: string;
  slug?: string;
  title: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
  startDate?: string;
  endDate?: string;
  updatedAt?: string;
  markets?: unknown[];
  [key: string]: unknown;
}

export class PolymarketClient {
  constructor(private readonly options: PolymarketClientOptions) {}

  async listEvents(options: ListEventsOptions = {}): Promise<PolymarketEvent[]> {
    const url = new URL('/events', this.options.gammaBaseUrl);
    url.searchParams.set('limit', String(options.limit ?? 20));
    url.searchParams.set('offset', String(options.offset ?? 0));
    if (options.active !== undefined) url.searchParams.set('active', String(options.active));
    if (options.closed !== undefined) url.searchParams.set('closed', String(options.closed));

    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'event-forecast-lab/0.1' },
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Polymarket Gamma request failed: ${response.status} ${response.statusText}`);
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('Polymarket Gamma returned a non-array events payload');
    return body.filter(isPolymarketEvent);
  }
}

function isPolymarketEvent(value: unknown): value is PolymarketEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === 'string' && typeof event.title === 'string';
}
