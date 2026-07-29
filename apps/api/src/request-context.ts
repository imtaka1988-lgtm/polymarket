import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type ApiRequest = Request & { requestId: string };

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  const candidate = request.header('x-request-id');
  const requestId =
    candidate !== undefined && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  (request as ApiRequest).requestId = requestId;
  response.setHeader('x-request-id', requestId);
  response.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const log = createRequestCompletionLog({
      requestId,
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs,
      slowRequestThresholdMs: positiveInteger(
        process.env.API_SLOW_REQUEST_THRESHOLD_MS,
        DEFAULT_SLOW_REQUEST_THRESHOLD_MS,
      ),
    });
    const serialized = JSON.stringify(log);
    if (log.level === 'warn') {
      console.warn(serialized);
    } else {
      console.info(serialized);
    }
  });
  next();
}

export function createRequestCompletionLog(input: {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  slowRequestThresholdMs: number;
}): RequestCompletionLog {
  return {
    level:
      input.durationMs >= input.slowRequestThresholdMs || input.statusCode >= 500 ? 'warn' : 'info',
    event: 'api_request_completed',
    requestId: input.requestId,
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    durationMs: Math.round(input.durationMs * 100) / 100,
    timestamp: new Date().toISOString(),
  };
}

interface RequestCompletionLog {
  level: 'info' | 'warn';
  event: 'api_request_completed';
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 1_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
