import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const page = readFileSync(join(root, 'src/app/directory/page.tsx'), 'utf8');

test('directory detail retains and displays the complete body or description', () => {
  const start = page.indexOf("selectedDirectory && directoryTab === 'info'");
  const end = page.indexOf('{placeError &&', start);
  assert.ok(start >= 0 && end > start, 'directory info panel exists');

  const infoPanel = page.slice(start, end);
  assert.match(page, /const selectedDescription = selectedDirectory\?\.body\?\.trim\(\) \|\| selectedDirectory\?\.desc\?\.trim\(\);/);
  assert.match(infoPanel, /selectedDescription && <section[\s\S]*?업체 소개[\s\S]*?whitespace-pre-wrap break-words/);
});
