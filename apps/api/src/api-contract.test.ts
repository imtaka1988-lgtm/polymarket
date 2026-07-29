import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { decodeMarketCursor, encodeMarketCursor, parseMarketListQuery } from './api-contract';

test('v1 market cursor round-trips without losing the stable sort tuple', () => {
  const cursor = {
    version: 1 as const,
    updatedAt: '2026-07-29T12:00:00.000Z',
    id: '11111111-1111-4111-8111-111111111111',
  };

  assert.deepEqual(decodeMarketCursor(encodeMarketCursor(cursor)), cursor);
});

test('market list query applies bounded defaults and public status validation', () => {
  assert.deepEqual(
    parseMarketListQuery({
      limit: undefined,
      status: undefined,
      cursor: undefined,
    }),
    {
      limit: 20,
      statuses: ['open'],
      cursor: null,
    },
  );
  assert.deepEqual(
    parseMarketListQuery({
      limit: '100',
      status: 'open,closed',
      cursor: undefined,
    }).statuses,
    ['open', 'closed'],
  );

  assertApiProblem(
    () =>
      parseMarketListQuery({
        limit: '101',
        status: undefined,
        cursor: undefined,
      }),
    'INVALID_LIMIT',
  );
  assertApiProblem(
    () =>
      parseMarketListQuery({
        limit: undefined,
        status: 'draft',
        cursor: undefined,
      }),
    'INVALID_STATUS',
  );
  assertApiProblem(
    () =>
      parseMarketListQuery({
        limit: undefined,
        status: undefined,
        cursor: 'not-a-cursor',
      }),
    'INVALID_CURSOR',
  );
});

function assertApiProblem(action: () => unknown, expectedCode: string): void {
  assert.throws(action, (error: unknown) => {
    if (!(error instanceof BadRequestException)) return false;
    const response = error.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      response.code === expectedCode
    );
  });
}
