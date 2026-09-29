import assert from 'node:assert/strict';
import test from 'node:test';
import { canReadyTetrisMatch, DEFAULT_ENTRY_FEE, MAX_ENTRY_FEE, MIN_ENTRY_FEE, parseEntryFee, shouldReserveTetrisStake } from './tetrisEntryFee.ts';

test('Tetris defaults to a free match and accepts zero as the minimum', () => {
  assert.equal(DEFAULT_ENTRY_FEE, 0);
  assert.equal(MIN_ENTRY_FEE, 0);
  assert.equal(parseEntryFee(0), 0);
  assert.equal(parseEntryFee('0'), 0);
  assert.equal(shouldReserveTetrisStake(0), false);
  assert.equal(canReadyTetrisMatch(0), true);
  assert.equal(canReadyTetrisMatch(1), false);
});

test('Tetris rejects malformed entry fee values', () => {
  for (const value of [null, undefined, '', '  ', 'not-a-number', true, [], -1, 101, 0.5, '1.5', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(parseEntryFee(value), null, `reject ${String(value)}`);
  }
});

test('Tetris accepts the bounded whole-dollar stake range and reserves positive fees', () => {
  assert.equal(MAX_ENTRY_FEE, 100);
  for (const [value, expected] of [[1, 1], ['1', 1], [MAX_ENTRY_FEE, MAX_ENTRY_FEE], [String(MAX_ENTRY_FEE), MAX_ENTRY_FEE]]) {
    assert.equal(parseEntryFee(value), expected, `accept ${String(value)}`);
  }
  assert.equal(shouldReserveTetrisStake(1), true);
  assert.equal(shouldReserveTetrisStake(MAX_ENTRY_FEE), true);
  assert.equal(canReadyTetrisMatch(MAX_ENTRY_FEE), false);
});
