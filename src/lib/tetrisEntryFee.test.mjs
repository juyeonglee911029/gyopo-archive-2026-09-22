import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ENTRY_FEE, MAX_ENTRY_FEE, MIN_ENTRY_FEE, parseEntryFee, shouldReserveTetrisStake } from './tetrisEntryFee.ts';

test('Tetris defaults to a free match and accepts zero as the minimum', () => {
  assert.equal(DEFAULT_ENTRY_FEE, 0);
  assert.equal(MIN_ENTRY_FEE, 0);
  assert.equal(parseEntryFee(0), 0);
  assert.equal(parseEntryFee('0'), 0);
  assert.equal(shouldReserveTetrisStake(0), false);
});

test('Tetris accepts whole-dollar fees in range and rejects malformed amounts', () => {
  assert.equal(parseEntryFee(1), 1);
  assert.equal(parseEntryFee(MAX_ENTRY_FEE), MAX_ENTRY_FEE);
  for (const value of [-1, MAX_ENTRY_FEE + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '', 'not-a-number', null]) {
    assert.equal(parseEntryFee(value), null, `reject ${String(value)}`);
  }
  assert.equal(shouldReserveTetrisStake(1), true);
});
