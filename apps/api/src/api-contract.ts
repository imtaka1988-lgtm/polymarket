import { BadRequestException } from '@nestjs/common';

export const API_VERSION = 'v1' as const;
export const PUBLIC_MARKET_STATUSES = [
  'open',
  'suspended',
  'closed',
  'resolving',
  'resolved',
] as const;

export type PublicMarketStatus = (typeof PUBLIC_MARKET_STATUSES)[number];

export interface MarketCursor {
  version: 1;
  updatedAt: string;
  id: string;
}

export interface ParsedMarketListQuery {
  limit: number;
  statuses: PublicMarketStatus[];
  cursor: MarketCursor | null;
}

export interface CurrentPriceDto {
  bid: string | null;
  ask: string | null;
  midpoint: string | null;
  lastTrade: string | null;
  bidCapturedAt: string | null;
  askCapturedAt: string | null;
  midpointCapturedAt: string | null;
  lastTradeCapturedAt: string | null;
  latestSource: string | null;
  latestSourceAt: string | null;
}

export interface MarketOutcomeDto {
  id: string;
  label: string;
  sortOrder: number;
  price: CurrentPriceDto | null;
}

export interface MarketSummaryDto {
  id: string;
  title: string;
  kind: string;
  status: PublicMarketStatus;
  opensAt: string | null;
  closesAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
  provider: {
    name: string;
    marketId: string;
  } | null;
  outcomes: MarketOutcomeDto[];
}

export interface MarketDetailDto extends MarketSummaryDto {
  rules: string | null;
  schemaVersion: number;
}

export interface ProviderComponentStatusDto {
  name: string;
  status: string;
  consecutiveFailures: number;
  lastAttemptAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
}

export interface ProviderAlertDto {
  code: string;
  severity: string;
  component: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface PlatformDataStatusDto {
  status: 'healthy' | 'degraded' | 'unavailable';
  readOnly: boolean;
  provider: 'polymarket';
  lastSuccessfulAt: string | null;
  components: ProviderComponentStatusDto[];
  openAlerts: ProviderAlertDto[];
}

export function parseMarketListQuery(input: {
  limit: string | string[] | undefined;
  status: string | string[] | undefined;
  cursor: string | string[] | undefined;
}): ParsedMarketListQuery {
  const rawLimit = readSingleQueryValue(input.limit, 'limit');
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  if (
    rawLimit !== undefined &&
    (!/^[1-9]\d*$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 100)
  ) {
    throw invalidRequest('INVALID_LIMIT', 'limit must be an integer from 1 to 100');
  }

  const rawStatus = readSingleQueryValue(input.status, 'status') ?? 'open';
  const statuses =
    rawStatus === 'all'
      ? [...PUBLIC_MARKET_STATUSES]
      : rawStatus
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
  if (
    statuses.length === 0 ||
    new Set(statuses).size !== statuses.length ||
    statuses.some((status) => !isPublicMarketStatus(status))
  ) {
    throw invalidRequest(
      'INVALID_STATUS',
      `status must be all or a unique comma-separated subset of ${PUBLIC_MARKET_STATUSES.join(',')}`,
    );
  }

  const rawCursor = readSingleQueryValue(input.cursor, 'cursor');
  return {
    limit,
    statuses: statuses as PublicMarketStatus[],
    cursor: rawCursor === undefined ? null : decodeMarketCursor(rawCursor),
  };
}

export function encodeMarketCursor(cursor: MarketCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeMarketCursor(value: string): MarketCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.updatedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.updatedAt)) ||
      typeof parsed.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id)
    ) {
      throw new Error('invalid cursor fields');
    }
    return {
      version: 1,
      updatedAt: new Date(parsed.updatedAt).toISOString(),
      id: parsed.id,
    };
  } catch {
    throw invalidRequest('INVALID_CURSOR', 'cursor is not a valid v1 market cursor');
  }
}

export function assertUuid(value: string, field = 'id'): string {
  if (!UUID_PATTERN.test(value)) {
    throw invalidRequest('INVALID_ID', `${field} must be a UUID`);
  }
  return value;
}

export function invalidRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

function readSingleQueryValue(
  value: string | string[] | undefined,
  field: string,
): string | undefined {
  if (Array.isArray(value)) {
    throw invalidRequest('DUPLICATE_QUERY_PARAMETER', `${field} may only be supplied once`);
  }
  return value;
}

function isPublicMarketStatus(value: string): value is PublicMarketStatus {
  return (PUBLIC_MARKET_STATUSES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
