import assert from 'node:assert/strict';
import test from 'node:test';
import { safeHttpsUrl } from './directoryLinks.ts';

test('business links allow only credential-free HTTPS URLs', () => {
  assert.equal(safeHttpsUrl(' https://example.com/menu '), 'https://example.com/menu');
  assert.equal(safeHttpsUrl('http://example.com/menu'), undefined);
  assert.equal(safeHttpsUrl('javascript:alert(1)'), undefined);
  assert.equal(safeHttpsUrl('https://user:secret@example.com/menu'), undefined);
  assert.equal(safeHttpsUrl('not a URL'), undefined);
  assert.equal(safeHttpsUrl(''), undefined);
  assert.equal(safeHttpsUrl(null), undefined);
});
