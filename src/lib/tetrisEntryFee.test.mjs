import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ENTRY_FEE, MAX_ENTRY_FEE, MIN_ENTRY_FEE, parseEntryFee, shouldReserveTetrisStake } from './tetrisEntryFee.ts';

test('Tetris defaults to a free match and accepts zero as the minimum', () => {
  assert.equal(DEFAULT_ENTRY_FEE, 0);
  assert.equal(MIN_ENTRY_FEE, 0);
  assert.equal(MAX_ENTRY_FEE, 0);
  assert.equal(parseEntryFee(0), 0);
  assert.equal(parseEntryFee('0'), 0);
  assert.equal(shouldReserveTetrisStake(0), false);
});

test('Tetris rejects malformed entry fee values', () => {
  for (const value of [null, undefined, '', '  ', 'not-a-number', true, [], -1, 101, 0.5, '1.5', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(parseEntryFee(value), null, `reject ${String(value)}`);
  }
});

test('Tetris rejects paid matches and never reserves a stake', () => {
  for (const value of [1, '1', 100, '100']) {
    assert.equal(parseEntryFee(value), null, `reject paid fee ${String(value)}`);
    assert.equal(shouldReserveTetrisStake(Number(value)), false);
  }
});
