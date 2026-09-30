import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('PWA manifest and installation icons are complete', () => {
  const manifest = JSON.parse(read('./public/manifest.json'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const bytes = readFileSync(new URL(`./public${icon.src}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  const layout = read('./src/app/layout.tsx');
  assert.match(layout, /rel="manifest" href="\/manifest\.json"/);
  assert.match(layout, /apple-mobile-web-app-capable/);
  assert.match(layout, /apple-touch-icon/);
  assert.match(read('./src/components/layout/AppRuntime.tsx'), /serviceWorker\.register\('\/sw\.js', \{ scope: '\/' \}\)/);
});

test('offline cache excludes APIs and private responses', () => {
  const worker = read('./public/sw.js');
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /request\.mode === 'navigate' && url\.pathname === '\/'/);
  assert.match(worker, /!\/\\b\(\?:private\|no-store\)\\b\/i\.test\(cacheControl\)/);
  assert.match(worker, /const response = await fetch\(request\)[\s\S]*cache\.put\(request, response\.clone\(\)\)/);
});
