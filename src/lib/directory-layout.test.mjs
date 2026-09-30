import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const page = readFileSync(join(root, 'src/app/directory/page.tsx'), 'utf8');
const places = readFileSync(join(root, 'src/lib/directoryPlaces.ts'), 'utf8');
const links = readFileSync(join(root, 'src/lib/directoryLinks.ts'), 'utf8');
const submitRoute = readFileSync(join(root, 'src/app/api/directory/submit/route.ts'), 'utf8');

test('directory detail retains and displays the complete body or description', () => {
  const start = page.indexOf("selectedDirectory && directoryTab === 'info'");
  const end = page.indexOf('{placeError &&', start);
  assert.ok(start >= 0 && end > start, 'directory info panel exists');

  const infoPanel = page.slice(start, end);
  assert.match(page, /const selectedDescription = selectedDirectory\?\.body\?\.trim\(\) \|\| selectedDirectory\?\.desc\?\.trim\(\);/);
  assert.match(infoPanel, /selectedDescription && <section[\s\S]*?업체 소개[\s\S]*?whitespace-pre-wrap break-words/);
});

test('directory category filter uses the canonical business categories', () => {
  assert.match(page, /const categories = \['전체', \.\.\.DIRECTORY_CATEGORIES\];/);
  assert.doesNotMatch(page, /directories\.map\(\(directory\) => directory\.category\)/);
});

test('directory links show verified Place hours and label user-submitted menus', () => {
  assert.match(places, /regularOpeningHours/);
  assert.match(places, /hoursSource: currentHours\?\.length \? 'current' : regularHours\?\.length \? 'regular'/);
  assert.match(places, /websiteUri/);
  assert.match(page, /selectedPlace\.hoursSource === 'regular'/);
  assert.match(page, /selectedMenuUrl && <a/);
  assert.match(page, /selectedWebsiteUrl && <a/);
  assert.match(page, /메뉴·서비스 링크 \(HTTPS, 선택\)/);
  assert.match(page, /등록자 제공 메뉴·서비스 링크 \(미검증\)/);
  assert.match(page, /Google Places에서 검증되지 않습니다/);
  assert.match(links, /url\.protocol === 'https:' && !url\.username && !url\.password/);
  assert.match(submitRoute, /safeHttpsUrl\(menuUrlInput\)/);
  assert.match(submitRoute, /body\.menuUrl\.length > 2048/);
  assert.doesNotMatch(places, /\bmenuUrl\b/);
});
