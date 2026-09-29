import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('community country column can wrap long names without colliding with titles', () => {
  const page = read('src/app/community/page.tsx');
  assert.match(page, /<div className="col-span-2 text-center">국가<\/div>/);
  assert.match(page, /<div className="col-span-4">제목<\/div>/);
  assert.match(page, /min-w-0 text-center text-xs font-bold md:col-span-2/);
  assert.match(page, /max-w-full whitespace-normal break-words[^>]*>\{post\.country\}/);
  assert.match(page, /col-span-1 min-w-0 md:col-span-4/);
});

test('mobile AI search keeps its input above the persistent bottom navigation', () => {
  const styles = read('src/app/experience-refinements.css');
  const assistantStyles = styles.slice(styles.indexOf('  .assistant-page {'));
  assert.match(assistantStyles, /min-height: calc\(100dvh - var\(--header-height, 80px\) - var\(--bottom-nav-height, 68px\) - env\(safe-area-inset-bottom\)\)/);
  assert.match(assistantStyles, /\.assistant-page \.assistant-workspace > aside\s*\{\s*display: none !important;/);
  assert.match(assistantStyles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(assistantStyles, /\.assistant-page form\[aria-label="GYOPO AI 질문 보내기"\]\s*\{[^}]*position: sticky;[^}]*bottom: calc\(var\(--bottom-nav-height, 68px\) \+ env\(safe-area-inset-bottom\) \+ 8px\)/s);
  assert.match(assistantStyles, /ol\[aria-label="GYOPO AI 대화 기록"\]\s*\{[^}]*max-height: min\(40dvh, 300px\)/s);
});
