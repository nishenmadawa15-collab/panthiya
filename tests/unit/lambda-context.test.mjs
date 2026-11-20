// Lambda calls `handler(event, context)`. Five handlers take `(event, provided)` so tests can inject
// fakes, and did `provided ?? realDeps()` -- which in Lambda received the runtime's context object,
// never undefined, so the real deps were never loaded. Found on the first live call, 2026-11-20:
// every allowed read returned 500 ("Cannot read properties of undefined (reading 'classes')") while
// every offline test passed, because every offline test injects. These tests call the way Lambda does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromCaller } from '../../backend/lib/injected.mjs';

const lambdaContext = () => ({
  awsRequestId: 'req-1',
  functionName: 'panthiya-ReadFunction-x',
  getRemainingTimeInMillis: () => 3000,
});

test('fromCaller: a Lambda context is not injected deps; a fake, or nothing, passes through', () => {
  assert.equal(fromCaller(lambdaContext()), undefined);
  assert.equal(fromCaller(undefined), undefined);
  const fake = { query: () => {}, tables: {} };
  assert.equal(fromCaller(fake), fake);
});

test('every handler that accepts injected deps neutralises the Lambda context first', () => {
  for (const fn of ['read', 'actions-parent', 'actions-teacher', 'redteam', 'voice']) {
    const src = readFileSync(new URL(`../../backend/functions/${fn}/index.mjs`, import.meta.url), 'utf8');
    assert.match(src, /export const handler = async \(event, context\) => \{\s*const provided = fromCaller\(context\);/,
      `${fn}: the handler's second argument reaches \`provided ?? deps()\` unfiltered`);
  }
});

test('read handler called the Lambda way reaches the real DynamoDB path, not the context', async () => {
  const { handler } = await import('../../backend/functions/read/index.mjs');
  const event = {
    routeKey: 'GET /teacher/audit',
    requestContext: { authorizer: { jwt: { claims: { sub: 'u-1', 'cognito:groups': '[teacher]' } } } },
  };
  // Offline there is no AWS SDK, so the real path ends in a missing-module error. What must never
  // come back is the TypeError from reading `tables` off the Lambda context.
  await assert.rejects(() => handler(event, lambdaContext()), (e) => {
    assert.doesNotMatch(String(e?.message), /reading '(classes|students|tables)'/,
      'the Lambda context was used as deps');
    return true;
  });
});
