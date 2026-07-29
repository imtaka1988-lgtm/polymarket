import { Module } from '@nestjs/common';
import { DatabasePoolService } from './database-pool.service';
import { HealthController } from './health.controller';
import { MarketReadStore } from './market-read.store';
import { MarketsController } from './markets.controller';
import { PlatformController } from './platform.controller';

@Module({
  controllers: [HealthController, MarketsController, PlatformController],
  providers: [
    DatabasePoolService,
    {
      provide: MarketReadStore,
      inject: [DatabasePoolService],
      useFactory: (database: DatabasePoolService) => new MarketReadStore(database.pool),
    },
  ],
})
export class AppModule {}
