// Offline tests for the BMA probe (docs/NEXT-SESSION.md §0a).
//
// The signer is the part that must not be "probably right": a wrong signature comes back as a 403
// whose message blames the identity, which is exactly the answer this script exists to distinguish
// from an account block. So it is checked against **AWS's own published known answers** — the
// derived-signing-key example and the sigv4 test-suite's get-vanilla case — rather than against
// itself. Everything else is pure functions and an injected network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  sign, signingKey, verdict, parseArgs, plan, credentials, send,
  BMA_REGIONS, SERVICE, MODELS_PATH, SESSIONS_PATH, hostFor,
} from '../../scripts/bma-probe.mjs';

const SOURCE = readFileSync(new URL('../../scripts/bma-probe.mjs', import.meta.url), 'utf8');

// AWS's documented example credentials, used by every one of their signing examples.
const EXAMPLE = {
  AccessKeyId: 'AKIDEXAMPLE',
  SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

test('SigV4: the derived signing key matches the value AWS publishes for its own example', () => {
  // docs.aws.amazon.com — "Examples of how to derive a signing key for Signature Version 4":
  // secret above, 20150830, us-east-1, iam.
  assert.equal(
    signingKey(EXAMPLE.SecretAccessKey, '20150830', 'us-east-1', 'iam').toString('hex'),
    'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9',
  );
});

test('SigV4: get-vanilla from the AWS test suite produces the published signature', () => {
  // GET / on example.amazonaws.com, service "service", region us-east-1, 20150830T123600Z,
  // signed headers host;x-amz-date — which is exactly the shape this probe sends for /v1/models.
  const headers = sign({
    method: 'GET',
    path: '/',
    creds: EXAMPLE,
    host: 'example.amazonaws.com',
    region: 'us-east-1',
    service: 'service',
    now: new Date('2015-08-30T12:36:00Z'),
  });

  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/service\/aws4_request, /);
  assert.match(headers.authorization, /SignedHeaders=host;x-amz-date, /);
  assert.ok(
    headers.authorization.endsWith('Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'),
    `signature did not match the published vector: ${headers.authorization}`,
  );
});

test('SigV4: a session token is signed, not merely sent alongside', () => {
  const withToken = sign({
    method: 'GET', path: MODELS_PATH, host: hostFor('us-east-1'), region: 'us-east-1',
    creds: { ...EXAMPLE, SessionToken: 'FQoDYXdzEXAMPLETOKEN' }, now: new Date('2026-11-18T00:00:00Z'),
  });
  const without = sign({
    method: 'GET', path: MODELS_PATH, host: hostFor('us-east-1'), region: 'us-east-1',
    creds: EXAMPLE, now: new Date('2026-11-18T00:00:00Z'),
  });

  assert.equal(withToken['x-amz-security-token'], 'FQoDYXdzEXAMPLETOKEN');
  assert.match(withToken.authorization, /SignedHeaders=host;x-amz-date;x-amz-security-token,/);
  // A temporary credential signed as if it were a long-lived one is rejected, so the two signatures
  // must differ — this is the assertion that would catch the token being left out of the canonical
  // headers while still appearing in the request.
  assert.notEqual(withToken.authorization, without.authorization);
});

test('SigV4: a body is hashed into the signature and declares its content type', () => {
  const base = {
    method: 'POST', path: SESSIONS_PATH, host: hostFor('us-east-1'), region: 'us-east-1',
    creds: EXAMPLE, now: new Date('2026-11-18T00:00:00Z'),
  };
  const a = sign({ ...base, body: '{"probe":"a"}' });
  const b = sign({ ...base, body: '{"probe":"b"}' });

  assert.equal(a['content-type'], 'application/json');
  assert.match(a.authorization, /SignedHeaders=content-type;host;x-amz-date,/);
  assert.notEqual(a.authorization, b.authorization, 'the payload hash is not reaching the signature');
});

test('the signed Region and the endpoint Region are always the same one', () => {
  // A mismatch here is the classic SigV4 own-goal, and its error message blames the credentials.
  for (const region of BMA_REGIONS) {
    const headers = sign({
      method: 'GET', path: MODELS_PATH, host: hostFor(region), region,
      creds: EXAMPLE, now: new Date('2026-11-18T00:00:00Z'),
    });
    assert.equal(headers.host, `${SERVICE}.${region}.api.aws`);
    assert.ok(headers.authorization.includes(`/${region}/${SERVICE}/aws4_request`));
  }
});

test('the three preview Regions are the documented ones, and ap-south-1 is not among them', () => {
  assert.deepEqual(BMA_REGIONS, ['us-east-1', 'us-west-2', 'us-east-2']);
  assert.ok(!BMA_REGIONS.includes('ap-south-1'));
  assert.match(plan('ap-south-1'), /not one of the three preview Regions/);
  assert.doesNotMatch(plan('us-east-1'), /not one of the three preview Regions/);
});

test('a 403 that names the identity is our IAM; one that names the account is not', () => {
  const ours = verdict(403, 'User: arn:aws:iam::477013660512:user/panthiya-dev is not authorized to perform: bedrock-mantle:ListModels');
  assert.equal(ours.tag, 'OUR IAM, NOT THE ACCOUNT');
  assert.ok(ours.lines.join(' ').includes('Conclude NOTHING about the challenge'));

  const theirs = verdict(403, 'This feature is not available for accounts without prior service usage.');
  assert.equal(theirs.tag, 'ACCOUNT BLOCKED');

  // The distinction is the whole value of this script, so the two must never collapse together.
  assert.notEqual(ours.tag, theirs.tag);
});

test('a ValidationException is read as proof of authorisation, not as a failure', () => {
  const v = verdict(400, '{"__type":"ValidationException","message":"1 validation error detected"}');
  assert.match(v.tag, /AUTHORISED/);
});

test('an ambiguous denial is reported as ambiguous rather than guessed', () => {
  const v = verdict(403, 'Forbidden');
  assert.equal(v.tag, 'UNCLEAR — READ THE MESSAGE');
  assert.ok(v.lines.join(' ').includes('do not average them'));
});

test('200 points at the Sinhala gate, because a reachable service still decides nothing about the model', () => {
  const v = verdict(200, '{"data":[{"id":"openai.gpt-oss-120b-1:0"}]}');
  assert.equal(v.tag, 'REACHABLE');
  assert.ok(v.lines.join(' ').includes('test-sinhala.mjs'));
});

test('404 is a path-or-Region problem and says so, instead of blaming the account', () => {
  const v = verdict(404, 'Not Found');
  assert.equal(v.tag, 'WRONG PATH OR REGION');
  assert.ok(!v.lines.join(' ').toLowerCase().includes('eligib'));
});

test('nothing is sent without --yes, and the create probe is off by default', () => {
  assert.deepEqual(parseArgs([]), { region: process.env.AWS_REGION ?? 'us-east-1', yes: false, createProbe: false });
  assert.equal(parseArgs(['--yes']).yes, true);
  assert.equal(parseArgs(['--yes']).createProbe, false);
  assert.equal(parseArgs(['--yes', '--create-probe']).createProbe, true);
  assert.equal(parseArgs(['--region', 'us-west-2']).region, 'us-west-2');
});

test('credentials come from the CLI, and a missing key is an error rather than an unsigned request', () => {
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    return JSON.stringify({ Version: 1, AccessKeyId: 'AKIA', SecretAccessKey: 'secret' });
  };
  assert.equal(credentials(run).AccessKeyId, 'AKIA');
  assert.deepEqual(calls[0], ['configure', 'export-credentials', '--format', 'process']);

  assert.throws(() => credentials(() => JSON.stringify({ Version: 1 })), /no_credentials/);
});

test('the request really goes to the signed host and path, with the body attached', async () => {
  const seen = [];
  const fakeNet = (options, onResponse) => {
    seen.push(options);
    const res = { on: (event, fn) => { if (event === 'end') fn(); return res; } };
    onResponse(res);
    return { on: () => {}, write: (b) => seen.push({ wrote: b }), end: () => {} };
  };

  await send({ method: 'POST', path: SESSIONS_PATH, body: '{"probe":"x"}', creds: EXAMPLE, region: 'us-west-2' }, fakeNet);
  assert.equal(seen[0].host, 'bedrock-mantle.us-west-2.api.aws');
  assert.equal(seen[0].path, SESSIONS_PATH);
  assert.equal(seen[0].headers['content-length'], 13);
  assert.ok(seen[0].headers.authorization.includes('/us-west-2/bedrock-mantle/'));
  assert.deepEqual(seen[1], { wrote: '{"probe":"x"}' });
});

test('the script never prints a credential, and never takes one from argv', () => {
  // Source guard: the one way this script could do real harm is by logging a secret into a terminal
  // that ends up in a screenshot or a build log.
  for (const field of ['SecretAccessKey', 'SessionToken', 'AccessKeyId']) {
    const printed = new RegExp(`console\\.(log|error)\\([^)]*${field}`);
    assert.doesNotMatch(SOURCE, printed, `${field} appears inside a console call`);
  }
  assert.doesNotMatch(SOURCE, /--access-key|--secret/, 'credentials must not be accepted as flags');
  assert.ok(SOURCE.includes("'configure', 'export-credentials'"), 'credentials should come from the CLI');
});

test('the write call is behind its own flag, and the read call is the default', () => {
  // Two separate guards, because "read-only by default" is a promise made to the user in the plan
  // text and is the reason this is allowed to run without asking.
  assert.ok(SOURCE.includes('if (createProbe)'), 'the POST must be conditional');
  const main = SOURCE.slice(SOURCE.indexOf('async function main'));
  assert.ok(
    main.indexOf(`path: MODELS_PATH`) < main.indexOf(`path: SESSIONS_PATH`),
    'the read-only call should happen first',
  );
});
