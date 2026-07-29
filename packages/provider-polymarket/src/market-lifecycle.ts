import { PolymarketPayloadError } from './errors.js';
import {
  asBoolean,
  asFiniteNumber,
  asIsoDateString,
  asString,
  isPolymarketMarketRaw,
  parseStringArray,
} from './parsers.js';
import type { PolymarketMarketLifecycleSnapshot, PolymarketMarketRaw } from './types.js';

export function parseMarketLifecycleSnapshot(
  value: unknown,
  requestUrl: string,
): PolymarketMarketLifecycleSnapshot {
  if (!isPolymarketMarketRaw(value)) {
    throw new PolymarketPayloadError(
      'Gamma market lifecycle payload lacked a usable id or question',
      requestUrl,
    );
  }

  const labels = parseRequiredArray(value.outcomes, 'outcomes', requestUrl);
  const prices = parseOptionalArray(value.outcomePrices, 'outcomePrices', requestUrl);
  const tokenIds = parseOptionalArray(value.clobTokenIds, 'clobTokenIds', requestUrl);
  if (prices.length > 0 && prices.length !== labels.length) {
    throw new PolymarketPayloadError(
      'Gamma market outcomePrices length did not match outcomes',
      requestUrl,
    );
  }
  if (tokenIds.length > 0 && tokenIds.length !== labels.length) {
    throw new PolymarketPayloadError(
      'Gamma market clobTokenIds length did not match outcomes',
      requestUrl,
    );
  }

  const outcomes = labels.map((label, index) => ({
    label,
    price: parseProbability(prices[index]),
    tokenId: tokenIds[index]?.trim() || null,
  }));
  const closed = asBoolean(value.closed);

  return {
    providerMarketId: asString(value.id) ?? 'unknown-market',
    question: value.question,
    active: asBoolean(value.active),
    closed,
    archived: asBoolean(value.archived),
    acceptingOrders: asBoolean(value.acceptingOrders),
    closedAt: asIsoDateString(value.closedTime),
    sourceUpdatedAt: asIsoDateString(value.updatedAt),
    providerResolutionStatus: asString(value.umaResolutionStatus),
    outcomes,
    winningTokenId: closed === true ? findWinningTokenId(outcomes) : null,
    raw: value as PolymarketMarketRaw,
  };
}

function parseRequiredArray(value: unknown, field: string, requestUrl: string): string[] {
  const parsed = parseStringArray(value);
  if (parsed.error !== null || parsed.values.length === 0) {
    throw new PolymarketPayloadError(
      `Gamma market ${field} was invalid or empty: ${parsed.error ?? 'empty array'}`,
      requestUrl,
    );
  }
  return parsed.values;
}

function parseOptionalArray(value: unknown, field: string, requestUrl: string): string[] {
  const parsed = parseStringArray(value);
  if (parsed.error !== null) {
    throw new PolymarketPayloadError(
      `Gamma market ${field} was invalid: ${parsed.error}`,
      requestUrl,
    );
  }
  return parsed.values;
}

function parseProbability(value: string | undefined): string | null {
  if (value === undefined) return null;
  const numeric = asFiniteNumber(value);
  if (numeric === null || numeric < 0 || numeric > 1) return null;
  return value.trim();
}

function findWinningTokenId(
  outcomes: Array<{ price: string | null; tokenId: string | null }>,
): string | null {
  if (
    outcomes.length < 2 ||
    outcomes.some((outcome) => outcome.price === null || outcome.tokenId === null)
  ) {
    return null;
  }
  const winners = outcomes.filter((outcome) => Number(outcome.price) === 1);
  const losers = outcomes.filter((outcome) => Number(outcome.price) === 0);
  if (winners.length !== 1 || losers.length !== outcomes.length - 1) return null;
  return winners[0]?.tokenId ?? null;
}
