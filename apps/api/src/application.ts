import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiExceptionFilter } from './api-exception.filter';
import { AppModule } from './app.module';
import { requestContext } from './request-context';

export async function createApiApplication(
  options: {
    logger?: false | ('log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal')[];
  } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: options.logger ?? ['log', 'error', 'warn'],
  });
  app.setGlobalPrefix('api/v1');
  app.use(requestContext);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: corsOrigins(),
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    credentials: false,
  });
  app.enableShutdownHooks();
  return app;
}

function corsOrigins(): string[] {
  return (process.env.API_CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
