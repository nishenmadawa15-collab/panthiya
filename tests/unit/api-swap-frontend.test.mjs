// Deploy evening must be a paste, not an edit.
//
// Four "SWAP POINT"s used to sit in the front-end: `redteam.js`, `student.js` and `teacher.js` held
// mock bodies that a human had to replace with fetch() calls, at night, under time pressure, with
// money already spent. The real call is now the implementation in every one of them and the mock is
// the fallback, chosen automatically from `configured()` in auth.js — the same "are the four deploy
// outputs pasted in" check the sign-in panel already uses. So the whole of A8 is four values into
// `CONFIG`.
//
// WHAT THIS FILE PINS, and why each one is worth a test:
//
//   1. With `CONFIG` still placeholders, every data function answers from the mock and **no request
//      is made**. A page that starts calling a placeholder host shows a demo audience a stack of
//      console errors, and the offline demo is the only demo there is until the stack is up.
//   2. With `CONFIG` real, every data function goes to the API. A function that still answers from
//      the mock after the paste is the failure this lane exists to remove — and it is invisible,
//      because mock data looks like data.
//   3. One request per call, ever. A retry on a 401 re-sends a token the authorizer has already
//      rejected; a retry on a 400 re-sends a message the server has already refused.
//   4. A failed call surfaces the server's own sentence unchanged, and an internal error string
//      never reaches the screen dressed up as one.
//
// No AWS, no network, no DOM, no dependencies: `globalThis.fetch` is a stub that records what it
// was handed, and the four page scripts are importable in Node because each boots itself only
// behind `typeof document !== 'undefined'`.
//
// HOW THE TWO CONFIG STATES FIT IN ONE FILE. `MOCKING` is read once per module, at import, which is
// right for a constant that cannot change while a page is open. A query string makes a second
// module instance (`teacher.js?real` is not `teacher.js`), so the placeholder half of the corpus is
// imported first and the real half after `CONFIG` is filled in. Both halves share the one `auth.js`
// instance, because a bare `./auth.js` specifier resolves the same from either.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ApiError, CONFIG, bodyOrThrow, configured, serverSentence } from '../../frontend/assets/auth.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

/* ---------------------------------------------------------------------------------------------
   The fetch stub. Nothing in this file is allowed to reach a network.
   --------------------------------------------------------------------------------------------- */

const calls = [];
let answer = { status: 200, body: {} };
let thrown = null;

/** A Response as `bodyOrThrow()` reads one: `status`, `ok`, and a `json()` that may reject. */
const responseOf = ({ status, body }) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => {
    if (body === '<<not json>>') throw new SyntaxError('Unexpected token <');
    return body;
  },
});

globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), ...init });
  if (thrown) throw thrown;
  return responseOf(answer);
};

function expect({ status = 200, body = {} } = {}, err = null) {
  calls.length = 0;
  answer = { status, body };
  thrown = err;
}

/** Packs are not loaded in Node, so `t()` warns and returns ''. Keep the log readable. */
const quietly = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
};

/* ---------------------------------------------------------------------------------------------
   Both halves of the corpus: the same four modules, unconfigured and configured.
   --------------------------------------------------------------------------------------------- */

// Both halves are *driven*, never observed: `CONFIG` is set to placeholders here rather than
// assumed to hold them, so this file passes before the deploy and after it. A test that only works
// while the values are unpasted would go red on deploy evening and tell nobody anything.
const PLACEHOLDERS = {
  domain: 'REPLACE_AFTER_DEPLOY.auth.ap-south-1.amazoncognito.com',
  clientId: 'REPLACE_AFTER_DEPLOY',
  userPoolId: 'REPLACE_AFTER_DEPLOY',
  apiBase: 'https://REPLACE_AFTER_DEPLOY.execute-api.ap-south-1.amazonaws.com/dev',
};

Object.assign(CONFIG, PLACEHOLDERS);
assert.equal(configured(), false, 'configured() reads the placeholder sentinel as a real value');

const mocked = {
  teacher: await import('../../frontend/assets/teacher.js?mocking'),
  student: await import('../../frontend/assets/student.js?mocking'),
  redteam: await import('../../frontend/assets/redteam.js?mocking'),
};

Object.assign(CONFIG, {
  domain: 'panthiya.auth.ap-south-1.amazoncognito.com',
  clientId: 'client-abc123',
  userPoolId: 'ap-south-1_AbCd1234',
  apiBase: 'https://api123.execute-api.ap-south-1.amazonaws.com/dev',
});
assert.equal(configured(), true, 'configured() does not see the four pasted values');

const live = {
  teacher: await import('../../frontend/assets/teacher.js?live'),
  student: await import('../../frontend/assets/student.js?live'),
  redteam: await import('../../frontend/assets/redteam.js?live'),
};

const API = 'https://api123.execute-api.ap-south-1.amazonaws.com/dev';

/**
 * Every call this front-end makes.
 *
 * `session: true` means the call goes under this browser's own sign-in, which nothing in Node has:
 * with `CONFIG` real those must refuse rather than send, and that refusal is itself the proof they
 * are no longer the mock — a mock answers with data whether anybody has signed in or not. The two
 * that carry their own credential are the red-team chat call (a token per role, task 2.3) and the
 * S3 PUT (the presigned URL *is* the capability), and those do send.
 */
const surface = (mods) => [
  { what: 'teacher sendMessage', session: true, call: () => mods.teacher.sendMessage('Nimal paid 2500 for November') },
  { what: 'teacher loadAudit', session: true, call: () => mods.teacher.loadAudit() },
  { what: 'teacher voiceUploadUrl', session: true, call: () => mods.teacher.voiceUploadUrl(new Blob(['x'], { type: 'audio/webm;codecs=opus' })) },
  { what: 'teacher voiceTranscript (start)', session: true, call: () => mods.teacher.voiceTranscript({ key: 'voice/k/u.webm', lang: 'en' }) },
  { what: 'teacher voiceTranscript (poll)', session: true, call: () => mods.teacher.voiceTranscript({ jobName: 'panthiya-k-u', lang: 'en' }) },
  { what: 'student askTutor', session: true, call: () => mods.student.askTutor('I am stuck on 2x + 5 = 17') },
  { what: 'redteam postRun', session: true, call: () => mods.redteam.postRun({ layers: {}, case: { id: 'A1', role: 'parent' }, sessionRole: 'parent', turns: [{ status: 200 }] }) },
  { what: 'teacher putAudio', session: false, call: () => mods.teacher.putAudio({ key: 'voice/k/u.webm', url: 'https://bucket.s3.ap-south-1.amazonaws.com/voice/k/u.webm?X-Amz-Signature=x', contentType: 'audio/webm' }, new Blob(['x'])) },
  { what: 'redteam postChat', session: false, call: () => mods.redteam.postChat({ testCase: { id: 'A1', section: 'A', role: 'parent' }, message: 'x', token: 'tok-parent', lang: 'en', last: true }) },
];

/* =============================================================================================
   1. Unconfigured: the mock answers, and nothing is sent.
   ============================================================================================= */

test('placeholders: every call answers from the mock, and not one request is made', async () => {
  for (const { what, call } of surface(mocked)) {
    expect();
    const value = await quietly(call).catch((err) => err);

    assert.ok(!(value instanceof Error), `${what} failed while CONFIG is placeholders: ${value?.message}`);
    assert.deepEqual(calls, [], `${what} made a request to a placeholder host: ${calls[0]?.url}`);
    assert.ok(value !== undefined && value !== null, `${what} answered nothing, so the offline demo shows an empty screen`);
  }
});

test('placeholders: the mock answers keep the shapes each screen renders', async () => {
  expect();
  assert.equal((await quietly(() => mocked.teacher.sendMessage('x'))).replyKey, 'chat.mock_reply');
  assert.equal((await mocked.teacher.loadAudit()).entries.length, 5);
  assert.equal((await mocked.teacher.loadLedger()).month, '2026-11');
  // `hint` first and `example` after, so the demo shows both shapes a real reply can have; which
  // of the two this call gets depends on how many came before it in this process.
  assert.ok(['hint', 'example'].includes((await quietly(() => mocked.student.askTutor('x'))).mock));

  const chat = await quietly(() => mocked.redteam.postChat({
    testCase: { id: 'B1', section: 'B', role: 'teacher' }, message: 'x', token: 'mock-teacher', lang: 'en', last: true,
  }));
  assert.equal(chat.status, 200);
  assert.equal(chat.body.blockedBy, 'guardrail', 'the mock no longer shows a blocked case on the scoreboard');
  assert.deepEqual(calls, []);
});

/* =============================================================================================
   2. Configured: every call goes to the API. This is the half that used to need an editor.
   ============================================================================================= */

test('configured: every call leaves the mock behind, and none of them is made twice', async () => {
  for (const { what, session, call } of surface(live)) {
    expect();
    const value = await quietly(call).catch((err) => err);

    if (session) {
      // Nothing has signed in here, so the real call refuses. A mock would have answered with data.
      assert.ok(value instanceof ApiError,
        `${what} answered ${JSON.stringify(value)} with CONFIG real; it is still the mock`);
      assert.deepEqual(calls, [], `${what} sent a request with no token on it`);
    } else {
      assert.equal(calls.length, 1,
        `${what} made ${calls.length} requests with CONFIG real; it is still the mock, or it retried`);
      assert.ok(calls[0].url.startsWith('https://'), `${what} called ${calls[0].url}`);
      assert.ok(!(value instanceof Error), `${what} failed on a 200: ${value?.message}`);
    }
  }
});

test('configured: a request that fails is not sent again, on any status', async () => {
  // One attempt, whatever came back. A retry on a 401 re-sends a token the authorizer has already
  // rejected; a retry on a 400 re-sends a message the server has already refused; a retry on a 502
  // pays for a second model call. None of the three is ever right here.
  for (const status of [400, 401, 403, 429, 500, 502, 503]) {
    expect({ status, body: { error: 'nope' } });
    await quietly(() => live.redteam.postChat({
      testCase: { id: 'A1', section: 'A', role: 'parent' }, message: 'x', token: 'tok', lang: 'en', last: true,
    })).catch(() => {});
    assert.equal(calls.length, 1, `a ${status} was retried`);

    expect({ status, body: { error: 'nope' } });
    await quietly(() => live.teacher.putAudio(
      { key: 'voice/k/u.webm', url: 'https://bucket.s3.ap-south-1.amazonaws.com/voice/k/u.webm?X-Amz-Signature=x', contentType: 'audio/webm' },
      new Blob(['x']),
    )).catch(() => {});
    assert.equal(calls.length, 1, `the recording upload retried a ${status}`);
  }
});

test('configured: the recording PUT carries the capability and no token', async () => {
  expect({ status: 200, body: {} });
  const slot = { key: 'voice/k/u.webm', url: 'https://bucket.s3.ap-south-1.amazonaws.com/voice/k/u.webm?X-Amz-Signature=x', contentType: 'audio/webm' };
  const out = await live.teacher.putAudio(slot, new Blob(['0123456789']));

  assert.equal(calls[0].url, slot.url, 'the recording went somewhere other than its presigned URL');
  assert.equal(calls[0].method, 'PUT');
  const sent = new Headers(calls[0].headers);
  assert.equal(sent.get('content-type'), 'audio/webm', 'the signed content type was not sent');
  assert.equal(sent.get('authorization'), null,
    'an ID token was sent to S3, which has no use for one — the presigned URL is the capability');
  assert.deepEqual(out, { ok: true, bytes: 10, key: slot.key });

  // And a refused upload is a failure the caller can say something about, not a silent success.
  expect({ status: 403, body: '<<not json>>' });
  await assert.rejects(() => live.teacher.putAudio(slot, new Blob(['x'])), ApiError,
    'a refused upload was reported as a success, so the page would wait for a transcript of nothing');
});

test('configured: the chat request is the one scripts/redteam-cli.mjs sends', async () => {
  // Byte-for-byte the CLI's request, because two tools reporting different verdicts for one run is
  // worse than either of them being wrong on its own: same URL, same body fields, same bearer.
  expect({ status: 200, body: { reply: 'no', blockedBy: null, role: 'parent' } });

  const out = await live.redteam.postChat({
    testCase: { id: 'A1', section: 'A', role: 'parent' },
    message: 'What did Dilmi get in the test?',
    token: 'tok-parent',
    lang: 'en',
    last: true,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/chat`);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].body), { message: 'What did Dilmi get in the test?', lang: 'en' });
  assert.deepEqual(out, { status: 200, body: { reply: 'no', blockedBy: null, role: 'parent' } });

  // The case's own token, never the signed-in session's: the no-fallback rule of task 2.3.
  const sent = new Headers(calls[0].headers);
  assert.equal(sent.get('authorization'), 'Bearer tok-parent');
  assert.equal(sent.get('content-type'), 'application/json');
});

test('configured: a chat call that never left the browser is status 0, never a 200', async () => {
  // A 200 with no `blockedBy` is the signature of layer 1 holding the line. Reporting a thrown
  // fetch as one would credit role scoping for a request that never reached AWS.
  for (const err of [new TypeError('Failed to fetch'), new DOMException('aborted', 'AbortError')]) {
    expect({}, err);
    const out = await live.redteam.postChat({
      testCase: { id: 'A1', section: 'A', role: 'parent' }, message: 'x', token: 'tok', lang: 'en', last: true,
    });
    assert.equal(out.status, 0, 'a thrown fetch was reported as something other than status 0');
    assert.equal(out.body.blockedBy, undefined, 'a thrown fetch invented a blocking layer');
    assert.equal(calls.length, 1, 'a thrown fetch was retried');
  }
});

test('configured: a case with no token for its role is the 401 it would have been, unsent', async () => {
  // Re-roling it onto the teacher's token would score a legitimately-answered question as a pass.
  for (const token of [null, undefined, '']) {
    expect();
    const out = await live.redteam.postChat({
      testCase: { id: 'A1', section: 'A', role: 'parent' }, message: 'x', token, lang: 'en', last: true,
    });
    assert.equal(out.status, 401);
    assert.equal(out.body.reason, 'no_token_for_role');
    assert.deepEqual(calls, [], 'a case with no token was still sent');
  }
});

test('configured: a call with no signed-in session is refused loudly and never sent', async () => {
  // Nothing in Node has signed in, which is also the deploy-evening case: CONFIG pasted, sign-in
  // not done yet. The page must say so rather than quietly showing mock data as if it were live.
  for (const { what, call } of [
    { what: 'teacher loadAudit', call: () => live.teacher.loadAudit() },
    { what: 'teacher sendMessage', call: () => live.teacher.sendMessage('x') },
    { what: 'student askTutor', call: () => live.student.askTutor('x') },
    { what: 'redteam postRun', call: () => live.redteam.postRun({ layers: {}, case: { id: 'A1', role: 'parent' }, sessionRole: 'parent', turns: [] }) },
  ]) {
    calls.length = 0;
    await assert.rejects(() => quietly(call), ApiError, `${what} did not refuse an unauthenticated call`);
    assert.deepEqual(calls, [], `${what} sent a request with no token on it`);
  }
});

/* =============================================================================================
   3. The one place a failure is turned into something a reader sees.
   ============================================================================================= */

test('a failure carries the server\'s own sentence, unchanged, and is never retried', async () => {
  const sinhala = 'පන්තියට තවම මේ භාෂාව කථාවෙන් තේරුම් ගත නොහැක. කිසිවක් සුරැකුණේ නැත — කරුණාකර එය ලියන්න.';

  const corpus = [
    // [response, the sentence a page may show, what the case is]
    [{ status: 400, body: { error: 'bad_json', message: 'Invalid request body' } }, 'Invalid request body', 'a 400 with a sentence'],
    [{ status: 403, body: { message: sinhala } }, sinhala, 'a non-ASCII sentence survives unedited'],
    [{ status: 429, body: { message: '  Too Many Requests  ' } }, 'Too Many Requests', 'whitespace from a proxy is trimmed, the words are not'],
    [{ status: 400, body: { error: 'message_too_long' } }, '', 'a code is not a sentence, so the page uses its own string'],
    [{ status: 502, body: { error: 'agent_unavailable', reason: 'tool_loop_exhausted' } }, '', 'a reason code is not a sentence either'],
    [{ status: 500, body: '<<not json>>' }, '', 'a proxy HTML error page is not readable text'],
    [{ status: 401, body: { message: 'Unauthorized' } }, 'Unauthorized', 'the authorizer\'s own word'],
    [{ status: 403, body: { message: 42 } }, '', 'a non-string message is not shown'],
    [{ status: 403, body: null }, '', 'no body at all'],
  ];

  for (const [response, sentence, what] of corpus) {
    const err = await bodyOrThrow(responseOf(response)).then(() => null, (e) => e);
    assert.ok(err instanceof ApiError, `${what}: a failure was not reported as a failure`);
    assert.equal(serverSentence(err), sentence, `${what}: the server's message was reworded, dropped or invented`);
  }

  // A 2xx is the body, and an unparsable 2xx is not a failure the user can act on.
  assert.deepEqual(await bodyOrThrow(responseOf({ status: 200, body: { reply: 'hi' } })), { reply: 'hi' });
  assert.equal(await bodyOrThrow(responseOf({ status: 204, body: '<<not json>>' })), null);

  // And an internal error string never passes for the server's words.
  assert.equal(serverSentence(new Error('message too long')), '');
  assert.equal(serverSentence(new TypeError('Failed to fetch')), '');
  assert.equal(serverSentence(null), '');
});

/* =============================================================================================
   4. The contracts a Node test cannot send: pinned where they are written.
   ============================================================================================= */

test('every endpoint a page calls is one backend/template.yaml serves', () => {
  const template = read('backend/template.yaml');
  const paths = new Set([...template.matchAll(/Path:\s*(\/\S+)/g)].map((m) => m[1]));

  // Comments out, code in: the note in `loadLedger()` names the call it *would* make if a ledger
  // read existed, and scanning the prose would read that as a path this page already calls.
  const pages = ['teacher.js', 'student.js', 'redteam.js'].map((n) => [
    n, read(`frontend/assets/${n}`).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 '),
  ]);
  const called = [];
  for (const [name, src] of pages) {
    // `api('/teacher/audit')` and fetch(`${apiBase()}/chat`) — both forms, the path either way.
    for (const [, path] of src.matchAll(/\bapi\(\s*'(\/[^']+)'/g)) called.push([name, path]);
    for (const [, path] of src.matchAll(/apiBase\(\)\}(\/[^`'"?]+)/g)) called.push([name, path]);
  }

  assert.ok(called.length >= 7, `only ${called.length} API calls found; the pages cannot be live`);
  for (const [name, path] of called) {
    assert.ok(paths.has(path), `assets/${name} calls ${path}, which template.yaml does not serve`);
  }

  // The fee ledger is the known gap: there is no ledger read to call, and the mock says so rather
  // than a fetch to a path that would 404. Delete this assertion when the route exists.
  assert.ok(![...paths].some((p) => p.includes('ledger')), 'a ledger route exists now: loadLedger() can stop being the mock');
  assert.match(read('frontend/assets/teacher.js'), /export async function loadLedger[\s\S]{0,200}MOCK\.ledger/,
    'loadLedger() changed; if it is real now, so is this test');
});

/* =============================================================================================
   What a /chat answer draws on the teacher's screen.

   A held reply is a 200 carrying `reply: null` and a `blockedBy`, and until `chat.blocked` existed
   it drew an **empty bubble** — the same class of defect as the blank sentence beside the red-team
   error tile, which reached the screen a judge watches. The corpus is every shape `handleChat` can
   answer a 200 with, because the three outcomes must not collapse into each other: a block is not
   an error, an error is not a block, and neither is a reply.
   ============================================================================================= */

test('a held reply says it was held; an empty one is an error, not a block', () => {
  const held = { side: 'panthiya', key: 'chat.blocked' };

  // Every layer that can set `blockedBy` with no reply text. `guardrail` and `policyCheck` are the
  // two a teacher can really hit; `model_filter` is the one no layer of ours held, and it is still
  // a held reply as far as this screen is concerned — it was not answered and nothing was recorded.
  for (const blockedBy of ['guardrail', 'policyCheck', 'distress', 'model_filter', 'role-gate']) {
    assert.deepEqual(live.teacher.replyEntry({ reply: null, blockedBy }), held,
      `a reply held by ${blockedBy} draws a blank bubble`);
    assert.deepEqual(live.teacher.replyEntry({ reply: '', blockedBy }), held, 'an empty string is not a reply');
    assert.deepEqual(live.teacher.replyEntry({ reply: '   ', blockedBy }), held, 'whitespace is not a reply');
    assert.deepEqual(live.teacher.replyEntry({ blockedBy }), held, 'an absent `reply` field is not a reply');
  }

  // A reply AND a layer: the wellbeing path answers that way, and the server's own words are what
  // the teacher should read. Never replaced by `chat.blocked`, never edited.
  assert.deepEqual(live.teacher.replyEntry({ reply: 'That sounds hard.', blockedBy: 'distress' }),
    { side: 'panthiya', text: 'That sounds hard.' },
    'a reply that came with a layer was thrown away and described instead of shown');
  assert.deepEqual(live.teacher.replyEntry({ reply: 'Noted. Nimal has paid.', blockedBy: null }),
    { side: 'panthiya', text: 'Noted. Nimal has paid.' });

  // Neither: `null`, so submitMessage() takes the error path. NOT `chat.blocked` — nothing held
  // this one, something broke — and not a blank bubble either.
  for (const answer of [{}, { reply: null }, { reply: '', blockedBy: null }, { reply: null, blockedBy: '' }, undefined]) {
    assert.equal(live.teacher.replyEntry(answer), null,
      `${JSON.stringify(answer)} was drawn as a message; a 200 with nothing in it is an error`);
  }

  // The mock's pack key still answers while CONFIG is placeholders, and is never preferred over a
  // real reply or a real block.
  assert.deepEqual(mocked.teacher.replyEntry({ replyKey: 'chat.mock_reply' }), { side: 'panthiya', key: 'chat.mock_reply' });
  assert.deepEqual(live.teacher.replyEntry({ replyKey: 'chat.mock_reply', blockedBy: 'guardrail' }), held);
  assert.deepEqual(live.teacher.replyEntry({ replyKey: 'chat.mock_reply', reply: 'real' }), { side: 'panthiya', text: 'real' });

  // The string it names has to exist in all three packs, or the bubble is blank again.
  for (const lang of ['si', 'ta', 'en']) {
    const pack = JSON.parse(read(`frontend/i18n/${lang}.json`));
    assert.equal(typeof pack['chat.blocked'], 'string', `chat.blocked is missing from ${lang}.json`);
    assert.ok(pack['chat.blocked'].trim() !== '', `chat.blocked is empty in ${lang}.json`);
  }
  // And it must say the two things a teacher acts on: it was not answered, and nothing was recorded.
  const en = JSON.parse(read('frontend/i18n/en.json'))['chat.blocked'].toLowerCase();
  assert.ok(en.includes('did not answer'), 'chat.blocked does not say the message was not answered');
  assert.ok(en.includes('nothing was recorded'), 'chat.blocked does not say nothing was recorded');

  // The send path uses it rather than drawing the fields itself.
  const submit = read('frontend/assets/teacher.js');
  const body = submit.slice(submit.indexOf('async function submitMessage'), submit.indexOf('6. Fee ledger'));
  assert.match(body, /replyEntry\(await sendMessage\(text\)\)/, 'submitMessage() no longer goes through replyEntry()');
  assert.ok(!/state\.messages\.push\(\{ side: 'panthiya'/.test(body),
    'submitMessage() builds the reply bubble by hand again, so the three outcomes can drift apart');
});

test('every status line a failed call reaches prefers the server\'s sentence to ours', () => {
  // `bodyOrThrow()` carries the words out; these are the places that put them on screen. Both ends
  // are needed: a page that catches the error and shows only its own key has thrown away a sentence
  // the server wrote in the teacher's own language.
  for (const [name, surfaces] of [['teacher.js', 2], ['student.js', 1], ['redteam.js', 1]]) {
    const code = read(`frontend/assets/${name}`).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

    assert.equal((code.match(/serverSentence\(err\)/g) ?? []).length, surfaces,
      `assets/${name} does not hand every failed call's own sentence to its status line`);
    assert.equal((code.match(/[Mm]essage\s*\|\|/g) ?? []).length, surfaces,
      `assets/${name} renders a status key over the top of a server sentence, or shows neither`);
  }

  // The voice note was already doing this before any of them, and still is (requirement 3.6).
  assert.match(read('frontend/assets/teacher.js'), /export function transcriptFailure/);
});

test('a page that reads on load waits for the sign-in callback first', () => {
  // Arriving from the hosted UI means a `?code=` still to exchange, so `authHeader()` is null for
  // the first moments of the page. The teacher screen is the only one that calls on load — the
  // other two call from a button — and without the wait its audit read fails with "could not load"
  // just before the session arrives, on a page that then looks signed in. `ready` is the promise
  // auth.js exports for this, and this test is why nobody has to rediscover that at 1am.
  const start = read('frontend/assets/teacher.js');
  const body = start.slice(start.indexOf('async function start()'));

  assert.match(start, /import \{[\s\S]*?\bready\b[\s\S]*?\} from '\.\/auth\.js';/,
    'teacher.js does not import `ready` from auth.js');
  assert.ok(body.indexOf('await ready') > 0, 'start() does not wait for the sign-in callback');
  assert.ok(body.indexOf('await ready') < body.indexOf('await loadAudit()'),
    'the audit log is read before the sign-in has finished, so a fresh page load fails for no reason');
});

test('the per-role token is the one thing a page sends by hand, and it is never stored', () => {
  for (const name of ['teacher.js', 'student.js', 'redteam.js']) {
    const code = read(`frontend/assets/${name}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    // Authorization is built from a live token and nothing else: no storage read, ever.
    assert.ok(!/(localStorage|sessionStorage)/.test(code), `assets/${name} reads browser storage for a credential`);
    for (const line of code.split('\n')) {
      if (!/Bearer|Authorization|authHeader/.test(line)) continue;
      assert.ok(!/setItem|getItem/.test(line), `assets/${name} puts a token in storage: ${line.trim()}`);
    }
  }

  // The red-team page is the only one that sends a token it was handed rather than the session's.
  // Sliced, not the whole file: a failure here should print the function, not 40KB of scoreboard.
  const redteam = read('frontend/assets/redteam.js');
  const post = redteam.slice(redteam.indexOf('export async function postChat'), redteam.indexOf('export async function postRun'));
  assert.match(post, /Authorization: `Bearer \$\{token\}`/, 'postChat() no longer sends the case\'s own token');
  assert.ok(!/Authorization: `Bearer \$\{(idToken|session)/.test(redteam),
    'the red-team page sends the signed-in session\'s token for a case that is not its role');
});
