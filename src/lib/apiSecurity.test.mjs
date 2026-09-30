import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const source = stripTypeScriptTypes(readFileSync(new URL('./apiSecurity.ts', import.meta.url), 'utf8'));
let tokenSequence = 0;

async function harness() {
  let verifier = async () => { throw new Error('Unexpected verifier call'); };
  const context = createContext({
    AbortSignal,
    Request,
    Response,
    URL,
    atob,
    fetch: (...args) => verifier(...args),
    process: { env: {} },
  });
  const writerPreferences = new SyntheticModule(['normalizeAiWritingPrompt'], function () {
    this.setExport('normalizeAiWritingPrompt', (value) => value);
  }, { context });
  const security = new SourceTextModule(source, { context, identifier: new URL('./apiSecurity.ts', import.meta.url).href });
  await security.link((specifier) => {
    assert.equal(specifier, './writerPreferences');
    return writerPreferences;
  });
  await security.evaluate();

  const makeToken = (exp = Math.floor(Date.now() / 1_000) + 600) => {
    tokenSequence += 1;
    const payload = Buffer.from(JSON.stringify({ exp, sub: `user-${tokenSequence}` })).toString('base64url');
    return `header.${payload}.signature-${tokenSequence}`;
  };
  const makeRequest = (token) => new Request('https://gyopo.test/api', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return {
    security: security.namespace,
    setVerifier: (nextVerifier) => { verifier = nextVerifier; },
    makeToken,
    makeRequest,
  };
}

test('missing and expired ID tokens do not call the identity service', async () => {
  const { security, setVerifier, makeToken, makeRequest } = await harness();
  let calls = 0;
  setVerifier(async () => { calls += 1; return Response.json({ users: [] }); });

  assert.equal(await security.authenticateRequest(makeRequest()), null);
  assert.equal(await security.authenticateRequest(makeRequest(makeToken(Math.floor(Date.now() / 1_000) - 10))), null);
  assert.equal(calls, 0);
});

test('valid ID tokens are verified and cached', async () => {
  const { security, setVerifier, makeToken, makeRequest } = await harness();
  let calls = 0;
  setVerifier(async () => {
    calls += 1;
    return Response.json({ users: [{ localId: 'alice', email: 'ALICE@example.com' }] });
  });
  const token = makeToken();

  const first = await security.authenticateRequest(makeRequest(token));
  const cached = await security.authenticateRequest(makeRequest(token));
  assert.equal(first.uid, 'alice');
  assert.equal(first.email, 'alice@example.com');
  assert.equal(first.token, token);
  assert.equal(cached.uid, 'alice');
  assert.equal(calls, 1);
});

test('an explicitly invalid ID token remains an authentication failure', async () => {
  const { security, setVerifier, makeToken, makeRequest } = await harness();
  setVerifier(async () => Response.json({ error: { message: 'INVALID_ID_TOKEN' } }, { status: 400 }));
  assert.equal(await security.authenticateRequest(makeRequest(makeToken())), null);
});

test('an invalid verifier API key is reported as service unavailable, not a login failure', async () => {
  const { security, setVerifier, makeToken, makeRequest } = await harness();
  setVerifier(async () => Response.json({ error: { message: 'API_KEY_INVALID' } }, { status: 400 }));
  await assert.rejects(security.authenticateRequest(makeRequest(makeToken())), (error) => {
    assert.equal(error.name, 'AuthServiceUnavailableError');
    assert.equal(error.status, 503);
    return true;
  });
});

for (const status of [403, 429, 500]) {
  test(`identity service HTTP ${status} is reported as service unavailable`, async () => {
    const { security, setVerifier, makeToken, makeRequest } = await harness();
    setVerifier(async () => Response.json({ error: { message: 'temporary upstream failure' } }, { status }));
    await assert.rejects(security.authenticateRequest(makeRequest(makeToken())), (error) => error.name === 'AuthServiceUnavailableError');
  });
}

test('identity service network failures are reported as service unavailable', async () => {
  const { security, setVerifier, makeToken, makeRequest } = await harness();
  setVerifier(async () => { throw new Error('network unavailable'); });
  await assert.rejects(security.authenticateRequest(makeRequest(makeToken())), (error) => error.name === 'AuthServiceUnavailableError');
});

test('malformed identity service responses are reported as service unavailable', async () => {
  const { security, setVerifier, makeToken, makeRequest } = await harness();
  setVerifier(async () => new Response('not JSON', { status: 200 }));
  await assert.rejects(security.authenticateRequest(makeRequest(makeToken())), (error) => error.name === 'AuthServiceUnavailableError');
});

test('auth response helper preserves unauthorized versus unavailable status', async () => {
  const { security } = await harness();
  const unavailable = security.unauthorizedResponse(new security.AuthServiceUnavailableError());
  const unauthorized = security.unauthorizedResponse(new security.ApiAuthError());

  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('retry-after'), '5');
  assert.equal(unauthorized.status, 401);
});
