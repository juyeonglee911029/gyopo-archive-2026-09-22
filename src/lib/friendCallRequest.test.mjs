import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('./') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { createFriendCallRequest } = await import('./firebase.ts');
const token = (userId) => `fixture.${Buffer.from(JSON.stringify({ sub: userId })).toString('base64url')}.fixture`;

test('friend call request rejects a caller id that differs from the auth token', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };

  try {
    await assert.rejects(
      createFriendCallRequest('callee', { id: 'caller', name: 'Caller', image: '' }, token('other-user')),
      /통화 요청 계정과 로그인 정보가 일치하지 않습니다/,
    );
    assert.equal(calls, 0, 'an identity mismatch must not write either request document');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('friend call request writes when the caller id matches the auth token', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    return Response.json({ name: 'friendCallRequests/request-id' });
  };

  try {
    await createFriendCallRequest('callee', { id: 'caller', name: 'Caller', image: '' }, token('caller'));
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/friendCallRequests\?documentId=call-request-caller-callee-/);
    assert.equal(requests[0].init.headers.Authorization, `Bearer ${token('caller')}`);
    const fields = JSON.parse(requests[0].init.body).fields;
    assert.equal(fields.callerId.stringValue, 'caller');
    assert.equal(fields.calleeId.stringValue, 'callee');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
