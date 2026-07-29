export class PolymarketHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = 'PolymarketHttpError';
  }
}

export class PolymarketPayloadError extends Error {
  constructor(message: string, readonly requestUrl: string) {
    super(message);
    this.name = 'PolymarketPayloadError';
  }
}
