import { Controller, Get, Inject, NotFoundException, Param, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './request-context';
import { API_VERSION, assertUuid, parseMarketListQuery } from './api-contract';
import { MarketReadStore } from './market-read.store';

@Controller('markets')
export class MarketsController {
  constructor(@Inject(MarketReadStore) private readonly store: MarketReadStore) {}

  @Get()
  async listMarkets(
    @Query('limit') limit: string | string[] | undefined,
    @Query('status') status: string | string[] | undefined,
    @Query('cursor') cursor: string | string[] | undefined,
    @Req() request: ApiRequest,
  ): Promise<object> {
    const query = parseMarketListQuery({ limit, status, cursor });
    const result = await this.store.listMarkets(query);
    return {
      data: result.markets,
      pagination: {
        limit: query.limit,
        hasNextPage: result.hasNextPage,
        nextCursor: result.nextCursor,
      },
      meta: meta(request),
    };
  }

  @Get(':id/prices')
  async getMarketPrices(@Param('id') id: string, @Req() request: ApiRequest): Promise<object> {
    const prices = await this.store.getMarketPrices(assertUuid(id));
    if (prices === null) throw marketNotFound();
    return { data: prices, meta: meta(request) };
  }

  @Get(':id')
  async getMarket(@Param('id') id: string, @Req() request: ApiRequest): Promise<object> {
    const market = await this.store.getMarket(assertUuid(id));
    if (market === null) throw marketNotFound();
    return { data: market, meta: meta(request) };
  }
}

function marketNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'MARKET_NOT_FOUND',
    message: 'market does not exist or is not publicly visible',
  });
}

function meta(request: ApiRequest): object {
  return {
    apiVersion: API_VERSION,
    requestId: request.requestId,
    generatedAt: new Date().toISOString(),
  };
}
