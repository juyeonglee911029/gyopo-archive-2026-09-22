import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const composer = readFileSync(join(root, 'src/app/[country]/RegionalPostComposer.tsx'), 'utf8');

test('regional editorial posts use the advanced Writer Studio', () => {
  assert.match(composer, /<WriterComposer/);
  assert.match(composer, /editorialForStorage/);
  assert.doesNotMatch(composer, /<textarea/);
});

test('regional jobs, market items, and business registration keep their dedicated flows', () => {
  assert.match(composer, /category === 'jobs'.*JobPostWriter/);
  assert.match(composer, /category === 'market'.*href="\/market"/);
  assert.match(composer, /category === 'directory'.*href="\/directory\?register=1"/);
});
