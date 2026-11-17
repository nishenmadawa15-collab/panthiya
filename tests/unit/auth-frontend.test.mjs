// Offline checks for the front-end sign-in (task 2.3). No AWS, no network, no dependencies.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. Nothing in this repo has met a real Cognito pool, so the
// redirect, the token exchange and the hosted UI itself can only be verified live. What *can* be
// pinned offline is every rule that is a pure function of a token or a URL — and those are the
// rules that, if wrong, make the live run quietly lie rather than loudly fail:
//
//   - the token never reaches browser storage (requirement 1.1)
//   - a role is read from the token's own claims, and two roles is a denial, not a choice (1.1)
//   - the front-end never sends a role (1.3)
//   - a 60-minute token is expired when it says it is (IdTokenValidity in template.yaml)
//   - `tokenFor(role)` never falls back to another role's token (task 2.3, requirement 1.3)
//
// `auth.js` is importable in Node because nothing at its top level touches `document`: the panel
// is built by `boot()`, which the module's own guard skips when there is no document.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  acceptRoleToken,
  authorizeUrl,
  claimsOf,
  configured,
  expiresAt,
  isExpired,
  issuerOf,
  redirectUriFor,
  roleOf,
} from '../../frontend/assets/auth.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const assets = () => readdirSync(new URL('frontend/assets/', ROOT)).filter((n) => n.endsWith('.js'));

/**
 * Drop comments, so a rule written *about* localStorage is not mistaken for a use of it.
 *
 * ponytail: a regex, not a parser — same ceiling as the one in frontend.test.mjs, with one extra
 * guard it needed the moment this lane put a URL in a string literal: a `//` preceded by `:` is
 * `https://`, not a comment. Fine while no string literal holds a bare `//`.
 */
const stripComments = (js) =>
  js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A token with the claims we want, unsigned — nothing here verifies signatures (that is the API). */
function fakeJwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.signature-not-checked-here`;
}

const idTokenFor = (role, extra = {}) => fakeJwt({
  token_use: 'id',
  'cognito:groups': [role],
  email: `${role}@panthiya.demo`,
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...extra,
});

/* ---------------------------------------------------------------------------------------------
   requirement 1.1 — the token is held in memory and nowhere else
   --------------------------------------------------------------------------------------------- */

test('req 1.1: no front-end script writes to localStorage or a cookie', () => {
  for (const name of assets()) {
    const code = stripComments(read(`frontend/assets/${name}`));

    // i18n.js keeps the language choice in localStorage, which is a preference and not a
    // credential. Everything else must not write there at all.
    if (name !== 'i18n.js') {
      assert.ok(!/localStorage\s*\.\s*setItem/.test(code),
        `frontend/assets/${name} writes to localStorage; a token in storage is a token XSS can read`);
    }
    assert.ok(!/document\s*\.\s*cookie\s*=/.test(code), `frontend/assets/${name} writes a cookie`);
  }
});

test('req 1.1: the only sessionStorage write is the PKCE record, and it carries no token', () => {
  const code = stripComments(read('frontend/assets/auth.js'));

  const writes = [...code.matchAll(/sessionStorage\s*\.\s*setItem\s*\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.deepEqual(writes, ['FLOW_KEY'],
    'auth.js writes something other than the one-time PKCE record to sessionStorage');

  // The record is built in one object literal. It may hold the flow's single-use values and the
  // redirect URI; the moment a token joins them, requirement 1.1 is gone.
  const record = /const flow = \{([^}]*)\}/.exec(code);
  assert.ok(record, 'the PKCE record literal moved; this test can no longer see what it holds');
  assert.deepEqual(
    record[1].split(',').map((line) => line.split(':')[0].trim()).filter(Boolean).sort(),
    ['nonce', 'redirectUri', 'state', 'verifier'],
  );

  // And no other asset puts a token into any storage, under any of its names.
  for (const name of assets()) {
    for (const line of stripComments(read(`frontend/assets/${name}`)).split('\n')) {
      if (!/setItem\s*\(/.test(line)) continue;
      assert.ok(!/token|jwt|bearer/i.test(line),
        `frontend/assets/${name} stores a token: ${line.trim()}`);
    }
  }
});

test('req 1.1: the markup on every role page declares the in-memory rule to the reader', () => {
  for (const page of ['teacher', 'parent', 'student', 'redteam']) {
    const html = read(`frontend/${page}/index.html`);
    assert.match(html, /id="auth"/, `frontend/${page}/index.html has no sign-in panel`);
    assert.match(html, /data-i18n="auth\.memory_note"/,
      `frontend/${page}/index.html does not tell the user the sign-in is not kept`);
  }
});

/* ---------------------------------------------------------------------------------------------
   requirement 1.1 / 1.2 — reading claims, and the role inside them
   --------------------------------------------------------------------------------------------- */

test('req 1.2: claimsOf decodes a base64url payload and returns null for anything else', () => {
  const claims = claimsOf(idTokenFor('teacher'));
  assert.equal(claims.email, 'teacher@panthiya.demo');
  assert.equal(claims.token_use, 'id');

  // A non-ASCII claim survives: the decode is UTF-8, not one byte per character.
  assert.equal(claimsOf(fakeJwt({ name: 'නිශේන්' })).name, 'නිශේන්');

  for (const junk of [null, undefined, 42, '', 'not.a', 'a.b.c.d', 'aaa.!!!!.ccc', fakeJwt([1, 2])]) {
    assert.equal(claimsOf(junk), null, `claimsOf accepted ${JSON.stringify(junk)}`);
  }
});

test('req 1.1: roleOf returns the single role, and null when there is not exactly one', () => {
  // Both claim shapes, because backend/lib/auth.mjs handles both and these two readers must not
  // disagree about what a token says.
  assert.equal(roleOf({ 'cognito:groups': ['parent'] }), 'parent');
  assert.equal(roleOf({ 'cognito:groups': '[student]' }), 'student');
  assert.equal(roleOf({ 'cognito:groups': ' Teacher ' }), 'teacher');

  // Two roles is a denial, never a choice in the holder's favour.
  assert.equal(roleOf({ 'cognito:groups': '[teacher, parent]' }), null);
  assert.equal(roleOf({ 'cognito:groups': ['teacher', 'parent'] }), null);

  // A duplicate is still one role.
  assert.equal(roleOf({ 'cognito:groups': ['parent', 'parent'] }), 'parent');

  for (const claims of [{}, null, { 'cognito:groups': [] }, { 'cognito:groups': ['principal'] }]) {
    assert.equal(roleOf(claims), null, `roleOf invented a role from ${JSON.stringify(claims)}`);
  }
});

/* ---------------------------------------------------------------------------------------------
   requirement 1.3 — the front-end reads the role; it never asserts one
   --------------------------------------------------------------------------------------------- */

test('req 1.3: the authorize request is code + PKCE S256 and carries no role', () => {
  const url = new URL(authorizeUrl({
    domain: 'panthiya.auth.ap-south-1.amazoncognito.com',
    clientId: 'client-123',
    redirectUri: 'https://app.example/teacher/',
    state: 'st',
    nonce: 'no',
    challenge: 'ch',
  }));

  assert.equal(url.origin + url.pathname, 'https://panthiya.auth.ap-south-1.amazoncognito.com/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');   // never the implicit flow
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), 'ch');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('nonce'), 'no');
  assert.ok(url.searchParams.get('scope').split(' ').includes('openid'), 'no openid scope, so no ID token');
  assert.equal(url.searchParams.get('role'), null);
});

test('req 1.3: auth.js talks to exactly one endpoint, and sends no role to it', () => {
  const code = stripComments(read('frontend/assets/auth.js'));

  const fetches = [...code.matchAll(/fetch\(\s*`([^`]*)`/g)].map((m) => m[1]);
  assert.deepEqual(fetches, ['https://${CONFIG.domain}/oauth2/token'],
    'auth.js makes a request this test does not know about');

  // The exchange body is the five parameters RFC 7636 asks for. A `role` among them would be the
  // client asserting an identity, which backend/lib/auth.mjs#claimsFromEvent ignores anyway.
  const body = /grant_type: 'authorization_code',[\s\S]*?\}\),/.exec(code);
  assert.ok(body, 'the token-exchange body moved');
  assert.ok(!/\brole\b/.test(body[0]), 'the token exchange sends a role');
});

/* ---------------------------------------------------------------------------------------------
   IdTokenValidity 60 minutes — expiry, and the exact redirect URI
   --------------------------------------------------------------------------------------------- */

test('a 60-minute token expires when it says it does, with a little slack', () => {
  const signedInAt = 1_700_000_000_000;
  const claims = { exp: (signedInAt + 60 * 60 * 1000) / 1000 };

  assert.equal(expiresAt(claims), signedInAt + 3_600_000);
  assert.equal(isExpired(claims, signedInAt), false);
  assert.equal(isExpired(claims, signedInAt + 59 * 60 * 1000), false);
  assert.equal(isExpired(claims, signedInAt + 3_600_000), true);

  // The slack exists so a request is never sent on a token the server has already retired.
  assert.equal(isExpired(claims, signedInAt + 3_600_000 - 1000), true);

  // No exp at all is expired, not immortal.
  assert.equal(isExpired({}, signedInAt), true);
});

test('req 1.1: the redirect URI matches the registered callback byte for byte', () => {
  assert.equal(
    redirectUriFor({ origin: 'https://app.example', pathname: '/teacher/' }),
    'https://app.example/teacher/',
  );
  // The long form of the same page must not produce a second, unregistered URI — Cognito answers
  // that with `redirect_mismatch` on a page that explains nothing.
  assert.equal(
    redirectUriFor({ origin: 'https://app.example', pathname: '/teacher/index.html' }),
    'https://app.example/teacher/',
  );
  assert.equal(redirectUriFor({ origin: 'https://app.example', pathname: '/' }), 'https://app.example/');
});

test('the issuer is derived from the pool id, so there is one fewer value to paste wrongly', () => {
  assert.equal(
    issuerOf('ap-south-1_AbCd1234'),
    'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_AbCd1234',
  );
});

test('configured() is false until the deploy outputs are pasted in', () => {
  // This is what keeps a pre-deploy page showing a sentence instead of a dead button.
  assert.equal(configured(), false);
});

/* ---------------------------------------------------------------------------------------------
   task 2.3 — tokenFor(role) returns that role's token or null, and never another role's
   --------------------------------------------------------------------------------------------- */

test('task 2.3: a token is accepted only for the role its own claims carry', () => {
  const teacher = idTokenFor('teacher');

  const ok = acceptRoleToken(teacher, 'teacher');
  assert.equal(ok.ok, true);
  assert.equal(ok.role, 'teacher');
  assert.equal(ok.token, teacher);

  // The whole point. A teacher token in the parent box would make the parent cases run as a
  // teacher, and a teacher legitimately answering a privacy question would score as a pass.
  assert.deepEqual(acceptRoleToken(teacher, 'parent'), { ok: false, reason: 'role_mismatch' });
  assert.deepEqual(acceptRoleToken(teacher, 'student'), { ok: false, reason: 'role_mismatch' });

  // Whitespace from a paste is trimmed; everything else is refused with a reason.
  assert.equal(acceptRoleToken(`\n  ${teacher}\t`, 'teacher').ok, true);
  assert.deepEqual(acceptRoleToken('garbage', 'teacher'), { ok: false, reason: 'malformed' });
  assert.deepEqual(acceptRoleToken(null, 'teacher'), { ok: false, reason: 'malformed' });

  // An access token carries no cognito:groups, so it could never authorise anything anyway — but
  // it is refused by name, so the operator is told which token to fetch instead of seeing a 401.
  assert.deepEqual(
    acceptRoleToken(fakeJwt({ token_use: 'access', exp: 2 ** 31 }), 'teacher'),
    { ok: false, reason: 'not_an_id_token' },
  );

  assert.deepEqual(
    acceptRoleToken(fakeJwt({ token_use: 'id', exp: 2 ** 31 }), 'teacher'),
    { ok: false, reason: 'no_role' },
  );
  assert.deepEqual(
    acceptRoleToken(fakeJwt({ token_use: 'id', 'cognito:groups': ['teacher', 'parent'], exp: 2 ** 31 }), 'teacher'),
    { ok: false, reason: 'no_role' },
  );
  assert.deepEqual(
    acceptRoleToken(idTokenFor('teacher', { exp: 1 }), 'teacher'),
    { ok: false, reason: 'expired' },
  );
});

test('task 2.3: redteam.js tokenFor() has no path to another role', () => {
  const code = stripComments(read('frontend/assets/redteam.js'));

  const fn = /function tokenFor\(role\) \{([\s\S]*?)\n\}/.exec(code);
  assert.ok(fn, 'tokenFor() moved; this test can no longer read it');

  // A fallback to another role has to name one, or index a map by something other than `role`.
  for (const role of ['teacher', 'parent', 'student']) {
    assert.ok(!fn[1].includes(role), `tokenFor() mentions '${role}'; the only role it may use is \`role\``);
  }
  assert.deepEqual([...fn[1].matchAll(/\[\s*([A-Za-z_$][\w$]*)\s*\]/g)].map((m) => m[1]), ['role'],
    'tokenFor() indexes something by a key other than `role`');

  // One flag ties the mock tokens to the mock replies, so the two halves of the SWAP POINT cannot
  // be taken separately and leave the page scoring mock answers against real tokens.
  assert.equal((code.match(/^const MOCKING = /gm) ?? []).length, 1);
  assert.ok(fn[1].includes('MOCKING'), 'tokenFor() no longer reads MOCKING');
});

test('task 2.3: only the red-team page has a field that can hold another role\'s token', () => {
  for (const page of ['teacher', 'parent', 'student']) {
    const html = read(`frontend/${page}/index.html`);
    assert.ok(!/auth-roles|auth-token-/.test(html),
      `frontend/${page}/index.html has a role-token field; these pages are single-session`);
  }
  assert.match(read('frontend/redteam/index.html'), /id="auth-roles"/);
});
