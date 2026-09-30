import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const sourceRoot = new URL('../', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
    return nextResolve(specifier, context);
  },
});

const { isGenuineDirectoryListing, isGenuineJobListing } = await import('./sourcepreview.ts');

test('remote-work employment tags keep structured job listings visible', () => {
  const remoteJob = { title: 'Customer Support Associate', company: 'Example Company', location: 'Remote', country: 'USA', tag: '원격근무', body: '' };
  assert.equal(isGenuineJobListing(remoteJob), true);
  assert.equal(isGenuineJobListing({ ...remoteJob, company: '', location: '' }), false);
});

test('directory imports require a business identity and usable local details', () => {
  const business = {
    title: 'Thalia부속',
    url: 'https://hanintoday.com.br/businesses/1',
    entityType: 'business',
    tag: '기타',
    phone: '1132238170',
    address: 'Bom Retiro · Rua Júlio Conceição, 407',
  };
  assert.equal(isGenuineDirectoryListing(business), true);
  assert.equal(isGenuineDirectoryListing({ ...business, entityType: 'organization' }), false);
  assert.equal(isGenuineDirectoryListing({ ...business, title: '쌍파울루 연합교회' }), false);
  assert.equal(isGenuineDirectoryListing({ ...business, tag: '공공기관·단체' }), false);
  assert.equal(isGenuineDirectoryListing({ ...business, address: '', phone: '11995030750' }), false);
  assert.equal(isGenuineDirectoryListing({ ...business, url: 'http://hanintoday.com.br/businesses/1' }), false);
});
