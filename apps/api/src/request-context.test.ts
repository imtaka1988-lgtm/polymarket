import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestCompletionLog } from './request-context';

test('request completion logs expose bounded operational fields', () => {
  const log = createRequestCompletionLog({
    requestId: 'request-1',
    method: 'GET',
    path: '/api/v1/markets',
    statusCode: 200,
    durationMs: 12.345,
    slowRequestThresholdMs: 1_000,
  });

  assert.deepEqual(
    {
      level: log.level,
      event: log.event,
      requestId: log.requestId,
      method: log.method,
      path: log.path,
      statusCode: log.statusCode,
      durationMs: log.durationMs,
    },
    {
      level: 'info',
      event: 'api_request_completed',
      requestId: 'request-1',
      method: 'GET',
      path: '/api/v1/markets',
      statusCode: 200,
      durationMs: 12.35,
    },
  );
  assert.equal('query' in log, false);
});

test('slow requests and server errors are warning logs', () => {
  assert.equal(
    createRequestCompletionLog({
      requestId: 'slow',
      method: 'GET',
      path: '/api/v1/markets',
      statusCode: 200,
      durationMs: 1_000,
      slowRequestThresholdMs: 1_000,
    }).level,
    'warn',
  );
  assert.equal(
    createRequestCompletionLog({
      requestId: 'failure',
      method: 'GET',
      path: '/api/v1/markets',
      statusCode: 503,
      durationMs: 10,
      slowRequestThresholdMs: 1_000,
    }).level,
    'warn',
  );
});
