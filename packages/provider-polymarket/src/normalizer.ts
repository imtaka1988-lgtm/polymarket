import type { MarketKind, MarketStatus } from '@forecast/domain';
import {
  asBoolean,
  asFiniteNumber,
  asIsoDateString,
  asString,
  isPolymarketMarketRaw,
  parseStringArray,
} from './parsers.js';
import type {
  NormalizationWarning,
  NormalizedPolymarketEvent,
  NormalizedPolymarketMarket,
  PolymarketEventRaw,
  PolymarketMarketRaw,
} from './types.js';

export function normalizePolymarketEvent(raw: PolymarketEventRaw): NormalizedPolymarketEvent {
  const providerEventId = asString(raw.id) ?? 'unknown-event';
  const warnings: NormalizationWarning[] = [];
  const rawMarkets = Array.isArray(raw.markets) ? raw.markets : [];

  if (raw.markets !== undefined && !Array.isArray(raw.markets)) {
    warnings.push({
      scope: 'event',
      providerId: providerEventId,
      field: 'markets',
      message: 'markets was not an array; event imported without nested markets',
    });
  }

  const markets: NormalizedPolymarketMarket[] = [];
  for (const candidate of rawMarkets) {
    if (!isPolymarketMarketRaw(candidate)) {
      warnings.push({
        scope: 'event',
        providerId: providerEventId,
        field: 'markets',
        message: 'one nested market lacked a usable id or question and was skipped',
      });
      continue;
    }
    markets.push(normalizeMarket(candidate, providerEventId, warnings));
  }

  return {
    providerEventId,
    slug: asString(raw.slug),
    title: raw.title,
    description: asString(raw.description),
    resolutionSource: asString(raw.resolutionSource),
    startsAt: asIsoDateString(raw.startDate),
    endsAt: asIsoDateString(raw.endDate),
    sourceUpdatedAt: asIsoDateString(raw.updatedAt),
    markets,
    raw,
    warnings,
  };
}

function normalizeMarket(
  raw: PolymarketMarketRaw,
  providerEventId: string,
  warnings: NormalizationWarning[],
): NormalizedPolymarketMarket {
  const providerMarketId = asString(raw.id) ?? 'unknown-market';
  const parsedOutcomes = parseStringArray(raw.outcomes);
  const parsedPrices = parseStringArray(raw.outcomePrices);
  const parsedTokenIds = parseStringArray(raw.clobTokenIds);

  addParseWarning(warnings, providerMarketId, 'outcomes', parsedOutcomes.error);
  addParseWarning(warnings, providerMarketId, 'outcomePrices', parsedPrices.error);
  addParseWarning(warnings, providerMarketId, 'clobTokenIds', parsedTokenIds.error);

  if (parsedPrices.values.length > 0 && parsedPrices.values.length !== parsedOutcomes.values.length) {
    warnings.push({
      scope: 'market',
      providerId: providerMarketId,
      field: 'outcomePrices',
      message: `outcome count ${parsedOutcomes.values.length} did not match price count ${parsedPrices.values.length}`,
    });
  }

  if (parsedTokenIds.values.length > 0 && parsedTokenIds.values.length !== parsedOutcomes.values.length) {
    warnings.push({
      scope: 'market',
      providerId: providerMarketId,
      field: 'clobTokenIds',
      message: `outcome count ${parsedOutcomes.values.length} did not match token count ${parsedTokenIds.values.length}`,
    });
  }

  const outcomes = parsedOutcomes.values.map((label, index) => ({
    providerOutcomeId: parsedTokenIds.values[index] ?? null,
    label,
    sortOrder: index,
    indicativePrice: asFiniteNumber(parsedPrices.values[index]),
  }));

  return {
    providerMarketId,
    providerConditionId: asString(raw.conditionId),
    providerEventId,
    kind: inferMarketKind(raw, parsedOutcomes.values),
    status: inferMarketStatus(raw),
    title: raw.question,
    rules: asString(raw.description),
    opensAt: asIsoDateString(raw.startDate),
    closesAt: asIsoDateString(raw.endDate),
    sourceUpdatedAt: asIsoDateString(raw.updatedAt),
    outcomes,
    clobTokenIds: parsedTokenIds.values,
    bestBid: asFiniteNumber(raw.bestBid),
    bestAsk: asFiniteNumber(raw.bestAsk),
    lastTradePrice: asFiniteNumber(raw.lastTradePrice),
    flags: {
      active: asBoolean(raw.active),
      closed: asBoolean(raw.closed),
      archived: asBoolean(raw.archived),
      restricted: asBoolean(raw.restricted),
      acceptingOrders: asBoolean(raw.acceptingOrders),
      enableOrderBook: asBoolean(raw.enableOrderBook),
    },
    raw,
  };
}

function inferMarketKind(raw: PolymarketMarketRaw, outcomes: string[]): MarketKind {
  if (typeof raw.sportsMarketType === 'string' || raw.gameId !== undefined) return 'sports';
  const normalized = outcomes.map((value) => value.trim().toLowerCase());
  if (normalized.length === 2 && normalized.includes('yes') && normalized.includes('no')) return 'binary';
  return outcomes.length > 2 ? 'multi_outcome' : 'binary';
}

function inferMarketStatus(raw: PolymarketMarketRaw): MarketStatus {
  if (asBoolean(raw.archived) === true) return 'archived';
  if (asBoolean(raw.closed) === true) return 'closed';
  if (asBoolean(raw.active) === false) return 'suspended';
  if (asBoolean(raw.acceptingOrders) === true) return 'open';
  return 'pending_review';
}

function addParseWarning(
  warnings: NormalizationWarning[],
  providerId: string,
  field: string,
  error: string | null,
): void {
  if (error === null) return;
  warnings.push({ scope: 'market', providerId, field, message: error });
}
