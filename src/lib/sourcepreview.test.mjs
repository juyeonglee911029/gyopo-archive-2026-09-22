import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const sourceRoot = new URL('../', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
    return nextResolve(specifier, context);
  },
});

const { isGenuineJobListing } = await import('./sourcepreview.ts');

test('remote-work employment tags keep structured job listings visible', () => {
  const remoteJob = { title: 'Customer Support Associate', company: 'Example Company', location: 'Remote', country: 'USA', tag: '원격근무', body: '' };
  assert.equal(isGenuineJobListing(remoteJob), true);
  assert.equal(isGenuineJobListing({ ...remoteJob, company: '', location: '' }), false);
});
