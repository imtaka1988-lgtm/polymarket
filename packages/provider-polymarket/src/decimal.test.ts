import assert from 'node:assert/strict';
import test from 'node:test';
import { averageDecimalStrings } from './decimal.js';

test('averages decimal prices without floating-point drift', () => {
  assert.equal(averageDecimalStrings('0.1', '0.2'), '0.15');
  assert.equal(averageDecimalStrings('0.4', '0.55'), '0.475');
  assert.equal(averageDecimalStrings('1.0000', '0'), '0.5');
  assert.equal(averageDecimalStrings('invalid', '0.5'), null);
});
