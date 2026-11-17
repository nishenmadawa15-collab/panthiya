// Offline tests for the three demo logins.
//
// The AWS CLI arrives as an injected function, so nothing here needs credentials, a network or a
// deployed stack. The tests that matter most, though, are the ones that read the **real
// configuration** rather than a fixture: the roles against the Cognito groups in `template.yaml`,
// the auth flow against the client's `ExplicitAuthFlows`, and the environment variable names
// against `scripts/redteam-cli.mjs`. Every bug this project has found late was of that shape — a
// mock agreeing with the code while the deployed thing disagreed with both.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEMO_ACCOUNTS, passwordProblems, exportLines, parseArgs, stackIds, subOf, createAccount,
  idTokenFor, flagValue,
} from '../../scripts/demo-users.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const TEMPLATE = read('backend/template.yaml');
const CLI = read('scripts/redteam-cli.mjs');

/** A fake `aws`: records every call, answers from a table, throws for anything unstubbed. */
function fakeCli(answers = {}) {
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    const key = argv.slice(0, 2).join(' ');
    const answer = answers[key];
    if (answer === undefined) throw new Error(`unstubbed: ${key}`);
    return typeof answer === 'function' ? answer(argv, calls) : answer;
  };
  return { run, calls };
}

const USER_ATTRS = (sub) => JSON.stringify({ UserAttributes: [{ Name: 'sub', Value: sub }] });

// --- the accounts, against the deployed configuration -------------------------------------------

test('every demo role is a group that actually exists in the user pool', () => {
  // A role that is not a Cognito group gets no `cognito:groups` claim, `soleRole()` returns null,
  // and every request is denied with `no_role` — after the account looks fine in the console.
  const groups = [...TEMPLATE.matchAll(/GroupName:\s*(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(groups.sort(), ['parent', 'student', 'teacher']);
  for (const account of DEMO_ACCOUNTS) {
    assert.ok(groups.includes(account.role), `${account.role} is not a group in template.yaml`);
  }
});

test('exactly one child is linked to the parent login (case A1 depends on it)', () => {
  // If the parent login owned all twelve children, "show me Dilmi's marks" would be a legitimate
  // request from a parent who really is Dilmi's parent, and the privacy half of the suite would be
  // measuring nothing. The seed enforces this too; this pins the *intent* next to the accounts.
  const parent = DEMO_ACCOUNTS.find((a) => a.role === 'parent');
  assert.match(parent.links, /stu-01/);
  assert.match(parent.links, /no other child/);

  const seed = read('backend/seed/seed.mjs');
  assert.match(seed, /const DEMO_PARENT_STUDENT = 'stu-01'/);
  // And the other eleven keep a placeholder, so they belong to nobody who can log in.
  const demo = JSON.parse(read('backend/seed/demo-class.json'));
  const placeholders = demo.students.filter((s) => /^SEED-PARENT-/.test(s.parentSub));
  assert.equal(placeholders.length, 12, 'the demo data should link nobody until the seed runs');
});

test('the three accounts are distinct, and the student links to nothing', () => {
  assert.equal(DEMO_ACCOUNTS.length, 3);
  assert.equal(new Set(DEMO_ACCOUNTS.map((a) => a.email)).size, 3);
  assert.equal(new Set(DEMO_ACCOUNTS.map((a) => a.env)).size, 3);

  // Requirement 1.7: a student session resolves to an empty scope, so there is nothing to link.
  const student = DEMO_ACCOUNTS.find((a) => a.role === 'student');
  assert.match(student.links, /empty scope/);
});

test('the token environment variables are the ones the CLI actually reads', () => {
  // Two files have to agree on three names and nothing checks them at runtime: a typo here means
  // the CLI silently scores 34 of 36 cases as `error` and the run looks like a missing login.
  for (const account of DEMO_ACCOUNTS) {
    assert.ok(CLI.includes(account.env), `${account.env} is not read by scripts/redteam-cli.mjs`);
  }
  assert.ok(CLI.includes('PANTHIYA_API_BASE'), 'the CLI no longer reads PANTHIYA_API_BASE');
});

test('the admin password flow is enabled on the app client, or no token can be fetched', () => {
  // The browser client is SRP-only and USER_PASSWORD_AUTH is deliberately absent, so this one
  // admin flow is the only way to get an ID token outside a browser. Remove it from the template
  // and `--tokens` stops working with an error that does not say why.
  assert.match(TEMPLATE, /ALLOW_ADMIN_USER_PASSWORD_AUTH/);
  assert.match(TEMPLATE, /ALLOW_USER_SRP_AUTH/);
  assert.ok(!/ALLOW_USER_PASSWORD_AUTH\b(?!_)/.test(TEMPLATE.replace(/ALLOW_ADMIN_USER_PASSWORD_AUTH/g, '')),
    'the non-admin password flow would expose password auth to the browser client');
});

// --- the password policy, mirrored ---------------------------------------------------------------

test('a password is checked against the pool policy before any account is made', () => {
  // Cognito rejects a weak password *after* creating the user, leaving a half-made account behind.
  assert.deepEqual(passwordProblems('PanthiyaDemo2026'), []);
  assert.deepEqual(passwordProblems('short1A'), ['at least 12 characters']);
  assert.deepEqual(passwordProblems('alllowercase1'), ['an uppercase letter']);
  assert.deepEqual(passwordProblems('ALLUPPERCASE1'), ['a lowercase letter']);
  assert.deepEqual(passwordProblems('NoDigitsAtAll'), ['a number']);
  assert.deepEqual(passwordProblems(undefined), ['at least 12 characters', 'a lowercase letter',
    'an uppercase letter', 'a number']);

  // The numbers come from template.yaml, so a tightened policy fails here rather than in the
  // console an hour later.
  assert.match(TEMPLATE, /MinimumLength:\s*12/);
  assert.match(TEMPLATE, /RequireSymbols:\s*false/);
});

// --- the AWS calls --------------------------------------------------------------------------------

test('the stack ids come from the stack, and a missing one names the fix', () => {
  const ok = fakeCli({
    'cloudformation describe-stacks': JSON.stringify([
      { OutputKey: 'UserPoolId', OutputValue: 'pool-1' },
      { OutputKey: 'UserPoolClientId', OutputValue: 'client-1' },
      { OutputKey: 'ApiEndpoint', OutputValue: 'https://api.example/dev' },
    ]),
  });
  assert.deepEqual(stackIds(ok.run),
    { userPoolId: 'pool-1', clientId: 'client-1', apiBase: 'https://api.example/dev' });

  const bare = fakeCli({ 'cloudformation describe-stacks': JSON.stringify([]) });
  assert.throws(() => stackIds(bare.run), /UserPoolId.*sam deploy/s);
});

test('a user that does not exist yet reads as null, not as an error', () => {
  // `admin-get-user` throws UserNotFoundException, which is the normal state before --apply. The
  // seed relies on this to refuse with a useful message instead of a stack trace.
  const { run } = fakeCli({});
  assert.equal(subOf('pool-1', 'teacher@panthiya.demo', run), null);
});

test('creating an account suppresses the email, verifies it, groups it, and sets a real password', () => {
  let created = false;
  const { run, calls } = fakeCli({
    'cognito-idp admin-get-user': () => {
      if (!created) throw new Error('UserNotFoundException');
      return USER_ATTRS('real-sub-1');
    },
    'cognito-idp admin-create-user': () => { created = true; return ''; },
    'cognito-idp admin-add-user-to-group': '',
    'cognito-idp admin-set-user-password': '',
  });

  const result = createAccount('pool-1', DEMO_ACCOUNTS[0], 'PanthiyaDemo2026', run);
  assert.deepEqual(result, { existed: false, sub: 'real-sub-1' });

  const flat = calls.map((c) => c.join(' '));
  const create = flat.find((c) => c.includes('admin-create-user'));
  // Without SUPPRESS, Cognito emails an invitation to an address nobody owns.
  assert.match(create, /--message-action SUPPRESS/);
  // email_verified is set here because AutoVerifiedAttributes only covers self sign-up, and this
  // pool is AllowAdminCreateUserOnly.
  assert.match(create, /Name=email_verified,Value=true/);
  assert.ok(flat.some((c) => c.includes('admin-add-user-to-group') && c.includes('--group-name teacher')));
  // Without --permanent the account lands in FORCE_CHANGE_PASSWORD and a scripted sign-in cannot
  // get past it.
  assert.ok(flat.some((c) => c.includes('admin-set-user-password') && c.includes('--permanent')));
});

test('running it twice repairs an existing account rather than failing', () => {
  const { run, calls } = fakeCli({
    'cognito-idp admin-get-user': USER_ATTRS('real-sub-1'),
    'cognito-idp admin-add-user-to-group': '',
    'cognito-idp admin-set-user-password': '',
  });

  const result = createAccount('pool-1', DEMO_ACCOUNTS[1], 'PanthiyaDemo2026', run);
  assert.deepEqual(result, { existed: true, sub: 'real-sub-1' });

  const flat = calls.map((c) => c.join(' '));
  assert.ok(!flat.some((c) => c.includes('admin-create-user')), 'it tried to create an existing user');
  // The group and the password are still re-applied, so a half-made account from an earlier
  // attempt is fixed instead of being left in the pool looking fine.
  assert.ok(flat.some((c) => c.includes('admin-add-user-to-group')));
  assert.ok(flat.some((c) => c.includes('admin-set-user-password')));
});

test('the ID token is fetched through the admin flow, and a missing one is an error', () => {
  const { run, calls } = fakeCli({
    'cognito-idp admin-initiate-auth': JSON.stringify({
      AuthenticationResult: { IdToken: 'id.token.value', AccessToken: 'access.token.value' },
    }),
  });
  assert.equal(idTokenFor('pool-1', 'client-1', DEMO_ACCOUNTS[2], 'PanthiyaDemo2026', run),
    'id.token.value');
  assert.match(calls[0].join(' '), /--auth-flow ADMIN_USER_PASSWORD_AUTH/);

  // The *ID* token is the one API Gateway verifies, and the only one carrying cognito:groups.
  const noId = fakeCli({
    'cognito-idp admin-initiate-auth': JSON.stringify({
      AuthenticationResult: { AccessToken: 'access.token.value' },
    }),
  });
  assert.throws(() => idTokenFor('pool-1', 'client-1', DEMO_ACCOUNTS[2], 'x', noId.run),
    /no ID token/);
});

// --- the output a human pastes --------------------------------------------------------------------

test('the export block is complete, and a missing token is visible rather than empty', () => {
  const lines = exportLines('https://api.example/dev', { teacher: 'T', parent: 'P', student: 'S' });
  assert.deepEqual(lines, [
    'export PANTHIYA_API_BASE=https://api.example/dev',
    'export PANTHIYA_TOKEN_TEACHER=T',
    'export PANTHIYA_TOKEN_PARENT=P',
    'export PANTHIYA_TOKEN_STUDENT=S',
  ]);

  // An empty value would export a blank variable, which the CLI reads as "no token for this role"
  // and scores as `error` — correct, but unexplained. `<missing>` is at least readable.
  assert.match(exportLines('x', { teacher: 'T' }).join('\n'), /PANTHIYA_TOKEN_PARENT=<missing>/);
});

test('the flags are the three documented modes and nothing else', () => {
  assert.deepEqual(parseArgs([]), { apply: false, tokens: false });
  assert.deepEqual(parseArgs(['--apply']), { apply: true, tokens: false });
  assert.deepEqual(parseArgs(['--tokens']), { apply: false, tokens: true });
  assert.deepEqual(parseArgs(['--apply', '--tokens']), { apply: true, tokens: true });
});

test('a flag value is read from after its own flag, not from argv[0]', () => {
  // `argv[argv.indexOf('--stack') + 1]` reads argv[0] when the flag is absent, because indexOf
  // returns -1. So `node … --apply` set the stack name to "--apply" and the AWS CLI failed with a
  // parse error that named nothing useful. It was in seed.mjs from M1 and was copied into this
  // script before anyone ran it with a flag and no --stack.
  assert.equal(flagValue(['--apply'], '--stack', 'panthiya'), 'panthiya');
  assert.equal(flagValue(['--tokens'], '--stack', 'panthiya'), 'panthiya');
  assert.equal(flagValue([], '--stack', 'panthiya'), 'panthiya');
  assert.equal(flagValue(['--stack', 'other', '--apply'], '--stack', 'panthiya'), 'other');
  assert.equal(flagValue(['--apply', '--stack', 'other'], '--stack', 'panthiya'), 'other');
  // A flag given with no value after it falls back rather than swallowing the next flag.
  assert.equal(flagValue(['--stack'], '--stack', 'panthiya'), 'panthiya');
  assert.equal(flagValue(['--stack', '--apply'], '--stack', 'panthiya'), 'panthiya');
});

test('neither script still reads an argument by unguarded index', () => {
  // The guard, not just the fix: this shape is easy to retype and silently wrong only in the case
  // nobody tests by hand.
  for (const file of ['scripts/demo-users.mjs', 'backend/seed/seed.mjs']) {
    assert.ok(!/args\[\s*args\.indexOf\([^)]*\)\s*\+\s*1\s*\]/.test(read(file)),
      `${file} reads an argument by unguarded index; use flagValue()`);
  }
});
