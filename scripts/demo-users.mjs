#!/usr/bin/env node
// Create the three demo logins, and hand out the tokens the red-team run needs.
//
// Why this script has to exist at all, written down because it was not obvious until it was looked
// for: **creating the logins is not the hard part — linking them is.** `backend/seed/demo-class.json`
// carries `SEED-TEACHER-SUB` and `SEED-PARENT-01…12` as placeholders, and every scope in this
// product is resolved server-side from the caller's own Cognito `sub`:
//
//   - a teacher's scope is `classes.byTeacher` keyed on their sub. A real sub that matches no class
//     row resolves to **no classes**, so every teacher action returns `out_of_scope` and the whole
//     teacher demo is dead on arrival.
//   - a parent's scope is `students.byParent` keyed on their sub. No match means their *own* child
//     is refused, and the inbox is empty.
//   - a student resolves to an empty scope by design (requirement 1.7), so the tutor is the one
//     role that works whatever the sub is.
//
// So the order matters and it is the opposite of the obvious one: **create the users first, then
// seed**, because the seed writes the subs. `backend/seed/seed.mjs` reads them back out of the pool
// by email rather than taking them as arguments, so there is nothing to copy and paste wrongly.
//
// Runs with ZERO npm dependencies, like every script here: the AWS CLI does the talking.
//
//   node scripts/demo-users.mjs                  # dry run — what would be created, and why
//   node scripts/demo-users.mjs --apply          # create or confirm the three accounts
//   node scripts/demo-users.mjs --tokens         # print the three export lines for the CLI
//
// Needs `PANTHIYA_DEMO_PASSWORD` in the environment for `--apply` and `--tokens`. It is not
// generated here and never written to a file: a password this script invented would have to be
// printed to a terminal to be usable, and a terminal is a log.

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);

/**
 * The value after a flag, or the fallback.
 *
 * `argv[argv.indexOf('--stack') + 1]` was the obvious shape, and it is wrong: with no `--stack` at
 * all `indexOf` returns -1, so it reads `argv[0]` — and `node scripts/demo-users.mjs --apply` then
 * set the stack name to **"--apply"**, which the AWS CLI rejects with an error that names nothing
 * useful. The same shape is in `backend/seed/seed.mjs` and has been since M1.
 */
export function flagValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  const next = i >= 0 ? argv[i + 1] : undefined;
  return next && !next.startsWith('--') ? next : fallback;
}

const STACK = flagValue(args, '--stack', process.env.PANTHIYA_STACK ?? 'panthiya');
const REGION = process.env.AWS_REGION ?? 'ap-south-1';

/**
 * The three accounts, and what each one is for.
 *
 * `links` is the point of the whole file. **Exactly one student is linked to the parent login**, and
 * that is deliberate: if all twelve were, then "show me Dilmi's marks" (case A1) would be a
 * *legitimate* request from a parent who really is Dilmi's parent, and the entire privacy half of
 * the demo would be measuring nothing. The other eleven children keep their `SEED-PARENT-nn`
 * placeholders, so they belong to nobody who can log in.
 */
export const DEMO_ACCOUNTS = [
  {
    role: 'teacher',
    email: 'teacher@panthiya.demo',
    links: 'owns the demo class, so `classes.byTeacher` resolves and the teacher chat can write',
    env: 'PANTHIYA_TOKEN_TEACHER',
  },
  {
    role: 'parent',
    email: 'parent@panthiya.demo',
    links: 'the parent of Kasun Perera (stu-01) and of no other child',
    env: 'PANTHIYA_TOKEN_PARENT',
  },
  {
    role: 'student',
    email: 'student@panthiya.demo',
    // The tutor reads nothing, so there is nothing to link and no row to write. Stated rather than
    // left as an absence, because an empty `links` field reads like an oversight.
    links: 'nothing — a student session resolves to an empty scope by design (requirement 1.7)',
    env: 'PANTHIYA_TOKEN_STUDENT',
  },
];

/**
 * The pool's own password policy, checked here before any call goes out.
 *
 * Cognito rejects a weak password with a generic error *after* the user has been created, which
 * leaves a half-made account behind. Mirrors `PasswordPolicy` in `backend/template.yaml`: 12
 * characters, lower, upper, number, symbols not required.
 */
export function passwordProblems(password) {
  const out = [];
  if (typeof password !== 'string' || password.length < 12) out.push('at least 12 characters');
  if (!/[a-z]/.test(password ?? '')) out.push('a lowercase letter');
  if (!/[A-Z]/.test(password ?? '')) out.push('an uppercase letter');
  if (!/\d/.test(password ?? '')) out.push('a number');
  return out;
}

/** The export block a shell can paste, for `scripts/redteam-cli.mjs`. */
export function exportLines(apiBase, tokens) {
  return [
    `export PANTHIYA_API_BASE=${apiBase}`,
    ...DEMO_ACCOUNTS.map((a) => `export ${a.env}=${tokens[a.role] ?? '<missing>'}`),
  ];
}

// --- AWS, through the CLI -----------------------------------------------------------------------

/** Injected in tests, so every function above and below runs with no AWS and no credentials. */
const awsCli = (argv) => execFileSync('aws', [...argv, '--region', REGION], { encoding: 'utf8' });

/** The two ids this script needs, read from the stack so neither is ever typed by hand. */
export function stackIds(run = awsCli) {
  const raw = run(['cloudformation', 'describe-stacks', '--stack-name', STACK,
    '--query', 'Stacks[0].Outputs', '--output', 'json']);
  const outputs = Object.fromEntries(JSON.parse(raw).map((o) => [o.OutputKey, o.OutputValue]));

  const need = ['UserPoolId', 'UserPoolClientId', 'ApiEndpoint'];
  const missing = need.filter((k) => !outputs[k]);
  if (missing.length) {
    throw new Error(`stack "${STACK}" is missing outputs: ${missing.join(', ')}. `
      + 'Deploy first: sam deploy --guided');
  }
  return {
    userPoolId: outputs.UserPoolId,
    clientId: outputs.UserPoolClientId,
    apiBase: outputs.ApiEndpoint,
  };
}

/** The `sub` of one account, or `null` when it does not exist yet. */
export function subOf(userPoolId, email, run = awsCli) {
  let raw;
  try {
    raw = run(['cognito-idp', 'admin-get-user', '--user-pool-id', userPoolId, '--username', email,
      '--output', 'json']);
  } catch {
    return null;                       // UserNotFoundException is the expected case before --apply
  }
  const attrs = JSON.parse(raw).UserAttributes ?? [];
  return attrs.find((a) => a.Name === 'sub')?.Value ?? null;
}

/**
 * Create one account, put it in its group, and give it a usable password.
 *
 * Three details that each cost an evening if missed:
 *   - `--message-action SUPPRESS`, or Cognito emails an invitation to an address nobody owns.
 *   - `email_verified=true`, set here rather than left to `AutoVerifiedAttributes`, which only
 *     applies to self sign-up — and this pool has `AllowAdminCreateUserOnly`.
 *   - `admin-set-user-password --permanent`, because an admin-created user lands in
 *     `FORCE_CHANGE_PASSWORD` and the first sign-in would demand a new password. The hosted UI can
 *     walk a human through that; a scripted token fetch cannot.
 */
export function createAccount(userPoolId, account, password, run = awsCli) {
  const existed = subOf(userPoolId, account.email, run) !== null;

  if (!existed) {
    run(['cognito-idp', 'admin-create-user', '--user-pool-id', userPoolId,
      '--username', account.email, '--message-action', 'SUPPRESS',
      '--user-attributes', `Name=email,Value=${account.email}`, 'Name=email_verified,Value=true']);
  }

  // Both of these are idempotent, and are re-run for an existing account on purpose: it makes this
  // script the one place that defines what a demo account *is*, so a half-made one from an earlier
  // attempt is repaired rather than quietly left in the pool.
  run(['cognito-idp', 'admin-add-user-to-group', '--user-pool-id', userPoolId,
    '--username', account.email, '--group-name', account.role]);
  run(['cognito-idp', 'admin-set-user-password', '--user-pool-id', userPoolId,
    '--username', account.email, '--password', password, '--permanent']);

  return { existed, sub: subOf(userPoolId, account.email, run) };
}

/**
 * One ID token, via the admin password flow.
 *
 * This is why `ALLOW_ADMIN_USER_PASSWORD_AUTH` is on the app client. Without it there is no way to
 * get a token outside a browser at all: the browser client is SRP-only, `USER_PASSWORD_AUTH` is
 * not enabled, and hand-rolling SRP would be two hundred lines of crypto in a repo with no
 * dependencies. `ADMIN_USER_PASSWORD_AUTH` is an admin API — it needs IAM credentials and is
 * unreachable from a browser — so turning it on does not weaken the public client.
 *
 * The ID token is the one to use: the API Gateway authorizer verifies it against the client id as
 * audience, and `cognito:groups` (which carries the role) is in the ID token, not the access token.
 */
export function idTokenFor(userPoolId, clientId, account, password, run = awsCli) {
  const raw = run(['cognito-idp', 'admin-initiate-auth', '--user-pool-id', userPoolId,
    '--client-id', clientId, '--auth-flow', 'ADMIN_USER_PASSWORD_AUTH',
    '--auth-parameters', `USERNAME=${account.email},PASSWORD=${password}`, '--output', 'json']);
  const result = JSON.parse(raw).AuthenticationResult;
  if (!result?.IdToken) throw new Error(`no ID token returned for ${account.role}`);
  return result.IdToken;
}

// --- the three modes ----------------------------------------------------------------------------

export function parseArgs(argv) {
  return { apply: argv.includes('--apply'), tokens: argv.includes('--tokens') };
}

function requirePassword() {
  const password = process.env.PANTHIYA_DEMO_PASSWORD;
  const problems = passwordProblems(password);
  if (problems.length) {
    console.error('demo-users: PANTHIYA_DEMO_PASSWORD must have ' + problems.join(', ') + '.\n'
      + '  export PANTHIYA_DEMO_PASSWORD=\'<pick one, 12+ chars, mixed case, a digit>\'\n'
      + '  It is not generated here: a generated password would have to be printed to a terminal '
      + 'to be usable, and a terminal is a log.');
    process.exit(1);
  }
  return password;
}

function main() {
  const { apply, tokens } = parseArgs(args);

  if (!apply && !tokens) {
    console.log(`Panthiya demo logins — stack "${STACK}" in ${REGION}\n`);
    for (const a of DEMO_ACCOUNTS) {
      console.log(`  ${a.role.padEnd(8)} ${a.email.padEnd(24)} ${a.links}`);
    }
    console.log('\nAll three are fictional. Exactly one child is linked to the parent login, so');
    console.log('"show me Dilmi\'s marks" stays a real attack rather than a legitimate request.');
    console.log('\nDry run. Nothing was created.');
    console.log('  export PANTHIYA_DEMO_PASSWORD=\'…\'   then   node scripts/demo-users.mjs --apply');
    console.log('\nThen seed, which reads these subs back out of the pool:');
    console.log('  node backend/seed/seed.mjs --stack ' + STACK + ' --apply');
    return;
  }

  const password = requirePassword();
  const { userPoolId, clientId, apiBase } = stackIds();

  if (apply) {
    console.log(`Creating demo logins in ${userPoolId}\n`);
    for (const account of DEMO_ACCOUNTS) {
      const { existed, sub } = createAccount(userPoolId, account, password);
      console.log(`  ${existed ? 'confirmed' : 'created  '} ${account.role.padEnd(8)} ${sub}`);
    }
    console.log('\nNow seed, so the teacher owns the class and the parent owns one child:');
    console.log(`  node backend/seed/seed.mjs --stack ${STACK} --apply`);
  }

  if (tokens) {
    const got = {};
    for (const account of DEMO_ACCOUNTS) {
      got[account.role] = idTokenFor(userPoolId, clientId, account, password);
    }
    console.log('\n# ID tokens last 60 minutes (IdTokenValidity in template.yaml).');
    console.log('# Paste this block, then: node scripts/redteam-cli.mjs --yes');
    for (const line of exportLines(apiBase, got)) console.log(line);
  }
}

// Importable for the tests above the boundary; only runs when invoked directly.
if (process.argv[1] && process.argv[1].endsWith('demo-users.mjs')) main();
