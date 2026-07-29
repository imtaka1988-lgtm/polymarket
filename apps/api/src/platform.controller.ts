import { Controller, Get, Req } from '@nestjs/common';
import { API_VERSION } from './api-contract';
import { MarketReadStore } from './market-read.store';
import type { ApiRequest } from './request-context';

@Controller('platform')
export class PlatformController {
  constructor(private readonly store: MarketReadStore) {}

  @Get('data-status')
  async getDataStatus(@Req() request: ApiRequest): Promise<object> {
    return {
      data: await this.store.getPlatformDataStatus(),
      meta: {
        apiVersion: API_VERSION,
        requestId: request.requestId,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
