// The AgentCore Runtime entrypoint, driven over real HTTP with no AWS.
//
// The point of these tests is the *service contract*, not the orchestration: `runToolLoop` already
// has 23 tests of its own, and `runTurn` is injected here. What is new and unproven on this path is
// the four things AWS's contract fixes — the two paths, the ping body, and the rule that every
// outcome is an HTTP 200 carrying a code — and the thing that is ours: that no error text and no
// attacker-chosen string escapes in a response.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  createHandler, start, outcomeOf, parseInvocation, OUTCOME_CODES, PORT, MAX_BODY_BYTES,
} from '../../backend/agentcore/server.mjs';
import { MAX_MESSAGE } from '../../backend/functions/chat/orchestrate.mjs';

/** A valid invocation body, so each test can vary one thing and nothing else. */
const invocation = (over = {}) => ({
  input: {
    prompt: 'ගුරුතුමා, Nimal ට ලකුණු 75',
    sessionAttributes: { sub: 'u-1', role: 'teacher', lang: 'si', today: '2026-11-20' },
    ...over,
  },
});

// ONE server for the whole file, with a swappable `runTurn`.
//
// The first version started a fresh listening server per request, which is ~40 listen/close cycles
// for this file — and under `node --test`, which runs test files concurrently, that was
// intermittently failing with `UND_ERR_SOCKET` in the full suite while passing when the file ran
// alone. A flaky test is worse than no test (and this repo has just spent three days learning that
// a green suite proves less than it looks like), so the churn is the thing to remove rather than
// the symptom to retry.
let runTurn = async () => { throw new Error('no runTurn set for this test'); };
let shared;

async function server() {
  shared ??= await start({ runTurn: (req) => runTurn(req) }, { port: 0, host: '127.0.0.1' });
  return shared;
}

after(() => shared && new Promise((resolve) => shared.close(resolve)));

/** Run one request against the shared server. */
async function call(deps, { path = '/invocations', method = 'POST', body = invocation() } = {}) {
  runTurn = deps.runTurn;
  const { port } = (await server()).address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    ...(method === 'POST'
      ? { headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }
      : {}),
  });
  return { status: res.status, json: await res.json() };
}

const ok = (reply) => ({ runTurn: async () => reply });
const throws = (err) => ({ runTurn: async () => { throw err; } });

// --- the contract AWS fixes --------------------------------------------------------------------

test('the serving port is the contract default, so protocolConfiguration is not needed', () => {
  assert.equal(PORT, 8080);
});

test('GET /ping answers 200 {"status":"Healthy"} — required by the contract', async () => {
  const { status, json } = await call(ok('ignored'), { path: '/ping', method: 'GET' });
  assert.equal(status, 200);
  assert.deepEqual(json, { status: 'Healthy' });
});

test('/ping does NOT send time_of_last_update — the documented session-leak footgun', async () => {
  // AWS: a ping that advances this field on every call prevents the idle timeout from ever firing,
  // so sessions live to MaxLifetime and keep billing memory. The absence of the key is the fix,
  // which makes it exactly the kind of thing that gets "helpfully" added back later.
  const { json } = await call(ok('x'), { path: '/ping', method: 'GET' });
  assert.ok(!('time_of_last_update' in json));
});

test('a reply comes back under output.reply, the documented response shape', async () => {
  const { status, json } = await call(ok('ලකුණු 75 සටහන් කළා.'));
  assert.equal(status, 200);
  assert.deepEqual(json, { output: { reply: 'ලකුණු 75 සටහන් කළා.' } });
});

test('an unknown path is 404 and never reaches runTurn', async () => {
  let called = false;
  const { status } = await call({ runTurn: async () => { called = true; return 'x'; } }, { path: '/invoke' });
  assert.equal(status, 404);
  assert.equal(called, false);
});

test('GET /invocations is not a POST and does not run a turn', async () => {
  let called = false;
  const { status } = await call(
    { runTurn: async () => { called = true; return 'x'; } },
    { path: '/invocations', method: 'GET' },
  );
  assert.equal(status, 404);
  assert.equal(called, false);
});

// --- every outcome is a 200, because a 4xx/5xx is swallowed as 424 with an empty body -----------

test('a guardrail intervention is a 200 carrying guardrail_intervened, not an HTTP error', async () => {
  // The whole reason for the 200: AgentCore reports a container 4xx/5xx to the caller as
  // `424 RuntimeClientError` with an empty body, so a status code would lose this code — and the
  // red-team scoreboard attributes defence layer 2 from precisely this code.
  const err = Object.assign(new Error('x'), { name: 'GuardrailIntervened', guardrailAction: 'INTERVENED' });
  const { status, json } = await call(throws(err));
  assert.equal(status, 200);
  assert.deepEqual(json, { output: { error: 'guardrail_intervened' } });
});

test('the model provider\'s own filter is content_filtered, NOT guardrail_intervened', async () => {
  // Layer 2 must not be credited for a block it did not make: on the default deployment
  // (GuardrailId: "") there is no guardrail at all, and orchestrate.mjs separates these two for
  // that exact reason.
  const err = Object.assign(new Error('x'), { name: 'ContentFiltered', code: 'content_filtered' });
  const { json } = await call(throws(err));
  assert.deepEqual(json, { output: { error: 'content_filtered' } });
});

test('each LoopError code survives the hop under its own name', async () => {
  for (const code of ['tool_loop_exhausted', 'reply_truncated', 'no_role', 'tool_use_without_id']) {
    const { json } = await call(throws(Object.assign(new Error('loop'), { name: 'LoopError', code })));
    assert.deepEqual(json, { output: { error: code } }, code);
  }
});

test('an unrecognised error collapses to agent_unavailable and leaks no message', async () => {
  const err = new Error('ValidationException: table panthiya-fees-prod does not exist');
  const { json } = await call(throws(err));
  assert.deepEqual(json, { output: { error: 'agent_unavailable' } });
});

test('no error path puts the error text anywhere in the response', async () => {
  // The discipline `deny()` in backend/lib/auth.mjs holds to: an echoed error is a reflected
  // payload, and a DynamoDB message names infrastructure.
  const secret = 'arn:aws:dynamodb:ap-south-1:123456789012:table/panthiya-fees';
  const { json } = await call(throws(new Error(secret)));
  assert.ok(!JSON.stringify(json).includes(secret));
  assert.ok(!JSON.stringify(json).includes('aws'));
});

test('an empty or blank reply is refused rather than returned as success', async () => {
  for (const reply of ['', '   ', null, undefined, 42]) {
    const { json } = await call(ok(reply));
    assert.deepEqual(json, { output: { error: 'agent_unavailable' } }, String(reply));
  }
});

test('every code this server can emit is in the closed set', async () => {
  // The mirror of DENY_CODES: if a new branch ever returns a code that is not declared, the
  // caller's adapter has no mapping for it and the turn reports as a generic failure.
  for (const err of [
    new Error('x'),
    Object.assign(new Error('x'), { guardrailAction: 'INTERVENED' }),
    Object.assign(new Error('x'), { name: 'ContentFiltered' }),
    Object.assign(new Error('x'), { code: 'reply_truncated' }),
    Object.assign(new Error('x'), { code: 'something_invented' }),
  ]) {
    assert.ok(OUTCOME_CODES.has(outcomeOf(err)), outcomeOf(err));
  }
});

// --- the trust boundary ------------------------------------------------------------------------

test('a payload with no role never reaches runTurn', async () => {
  // Fail closed, and before the model: the role gate in the action Lambdas is the one that counts,
  // but a turn with no role would spend tokens to be refused later.
  let called = false;
  const deps = { runTurn: async () => { called = true; return 'x'; } };
  for (const attrs of [
    undefined,
    {},
    { sub: 'u-1' },
    { sub: 'u-1', role: 'admin' },
    { sub: 'u-1', role: 'TEACHER' },   // not normalised here: auth.mjs lowercases, this only checks
    { role: 'teacher' },               // a role with no subject is not an identity
    { sub: '', role: 'teacher' },
  ]) {
    const { status, json } = await call(deps, { body: invocation({ sessionAttributes: attrs }) });
    assert.equal(status, 200);
    assert.deepEqual(json, { output: { error: 'bad_input' } }, JSON.stringify(attrs));
  }
  assert.equal(called, false);
});

test('the prompt must be present and within MAX_MESSAGE', async () => {
  let called = false;
  const deps = { runTurn: async () => { called = true; return 'x'; } };
  for (const prompt of ['', '   ', undefined, 7, 'a'.repeat(MAX_MESSAGE + 1)]) {
    const { json } = await call(deps, { body: invocation({ prompt }) });
    assert.deepEqual(json, { output: { error: 'bad_input' } }, String(prompt).slice(0, 20));
  }
  assert.equal(called, false);
  // And the boundary itself is allowed, so the limit is not off by one against handleChat's.
  const { json } = await call(ok('fine'), { body: invocation({ prompt: 'a'.repeat(MAX_MESSAGE) }) });
  assert.deepEqual(json, { output: { reply: 'fine' } });
});

test('the documented un-nested payload is refused rather than half-understood', async () => {
  // AWS names this as the cause of a 422: `{"prompt": ...}` instead of `{"input": {"prompt": ...}}`.
  const { json } = await call(ok('x'), { body: { prompt: 'hello', sessionAttributes: { sub: 'u', role: 'teacher' } } });
  assert.deepEqual(json, { output: { error: 'bad_input' } });
});

test('a body that is not JSON is a code, not a crash', async () => {
  const { status, json } = await call(ok('x'), { body: 'not json at all' });
  assert.equal(status, 200);
  assert.deepEqual(json, { output: { error: 'bad_input' } });
});

test('an oversized body is refused and runTurn never sees it', async () => {
  let called = false;
  const big = JSON.stringify({ input: { prompt: 'a', sessionAttributes: { sub: 'u', role: 'teacher' }, pad: 'x'.repeat(MAX_BODY_BYTES * 2) } });
  const { status, json } = await call(
    { runTurn: async () => { called = true; return 'x'; } },
    { body: big },
  );
  assert.equal(status, 200);
  assert.deepEqual(json, { output: { error: 'bad_input' } });
  assert.equal(called, false);
});

test('sessionAttributes are passed through untouched — identity is never rebuilt here', async () => {
  // design §3.1: the role is decided by the JWT authorizer and our chat Lambda. This server is a
  // courier for it and must not normalise, default or infer any part of it, because a courier that
  // edits the envelope is a second place a role can be wrong.
  let seen;
  const attrs = { sub: 'u-9', role: 'parent', lang: 'ta', today: '2026-12-01' };
  await call(
    { runTurn: async (req) => { seen = req; return 'ok'; } },
    { body: invocation({ prompt: 'ask', sessionAttributes: attrs }) },
  );
  assert.deepEqual(seen.sessionAttributes, attrs);
  assert.equal(seen.prompt, 'ask');
});

test('parseInvocation is pure and returns null rather than throwing', () => {
  assert.equal(parseInvocation(undefined), null);
  assert.equal(parseInvocation(null), null);
  assert.equal(parseInvocation({}), null);
  assert.equal(parseInvocation({ input: null }), null);
  assert.deepEqual(
    parseInvocation({ input: { prompt: '  hi  ', sessionAttributes: { sub: 'u', role: 'student' } } }),
    { prompt: 'hi', sessionAttributes: { sub: 'u', role: 'student' } },
  );
});

test('createHandler needs no AWS and no network to exist', () => {
  assert.equal(typeof createHandler({ runTurn: async () => '' }), 'function');
});
