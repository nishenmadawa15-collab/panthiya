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
import { StringDecoder } from 'node:string_decoder';

import {
  sign, signingKey, verdict, parseArgs, plan, credentials, send, networkFailure,
  BMA_REGIONS, SERVICE, MODELS_PATH, SESSIONS_PATH, SEND_TIMEOUT_MS, hostFor,
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

/**
 * A fake `https.request`, faithful on the three points that matter here: the response arrives in
 * chunks, `setEncoding` decodes them the way node's own `IncomingMessage` does, and `error` and
 * `timeout` are events rather than return values.
 *
 * The decoding is not pedantry. `text += chunk` stringifies each Buffer separately, so a Sinhala
 * or Tamil character — or the `—` in an AWS error message — split across two chunks becomes two
 * replacement characters, in the one piece of text this whole script exists to have read.
 */
function fakeNet({ status = 200, chunks = [], error = null, hangs = false } = {}) {
  const seen = { options: null, wrote: [], destroyed: null, encoding: null };

  const net = (options, onResponse) => {
    seen.options = options;
    const on = {};
    const req = {
      on: (event, fn) => { on[event] = fn; return req; },
      write: (b) => seen.wrote.push(b),
      destroy: (err) => { seen.destroyed = err; on.error?.(err); },
      end: () => queueMicrotask(() => {
        if (error) return on.error?.(error);
        if (hangs) return on.timeout?.();              // what a real socket timeout looks like
        let decoder = null;
        const handlers = {};
        onResponse({
          statusCode: status,
          setEncoding: (enc) => { seen.encoding = enc; decoder = new StringDecoder(enc); },
          on: (event, fn) => { handlers[event] = fn; },
        });
        for (const chunk of chunks) handlers.data?.(decoder ? decoder.write(chunk) : chunk);
        handlers.end?.();
      }),
    };
    return req;
  };

  return { net, seen };
}

test('the request really goes to the signed host and path, with the body attached', async () => {
  const { net, seen } = fakeNet();

  await send({ method: 'POST', path: SESSIONS_PATH, body: '{"probe":"x"}', creds: EXAMPLE, region: 'us-west-2' }, net);
  assert.equal(seen.options.host, 'bedrock-mantle.us-west-2.api.aws');
  assert.equal(seen.options.path, SESSIONS_PATH);
  assert.equal(seen.options.headers['content-length'], 13);
  assert.ok(seen.options.headers.authorization.includes('/us-west-2/bedrock-mantle/'));
  assert.deepEqual(seen.wrote, ['{"probe":"x"}']);
});

test('a body split across chunks is decoded as UTF-8, not once per chunk', () => {
  // The em dash AWS uses in its own denial messages, cut in half by the chunk boundary.
  const whole = Buffer.from('{"message":"not authorized — ask IAM"}', 'utf8');
  const split = [whole.subarray(0, 24), whole.subarray(24)];
  const { net, seen } = fakeNet({ status: 403, chunks: split });
  return send({ method: 'GET', path: MODELS_PATH, creds: EXAMPLE, region: 'us-east-1' }, net)
    .then(({ text }) => {
      assert.equal(seen.encoding, 'utf8', 'send must ask the response to decode itself');
      assert.equal(text, whole.toString('utf8'));
      assert.ok(!text.includes('�'), `a character was mangled across the chunk boundary: ${text}`);
    });
});

// A deadline of its own, because the failure this pins is a promise that never settles: without
// it, deleting the timeout handling would hang the suite rather than fail it, and a guard that
// hangs is worse than one that cannot fail.
test('a request that never answers is a rejection, not a hang', { timeout: 5_000 }, async () => {
  const { net, seen } = fakeNet({ hangs: true });
  await assert.rejects(
    () => send({ method: 'GET', path: MODELS_PATH, creds: EXAMPLE, region: 'us-east-1', timeout: 25 }, net),
    (err) => err.code === 'ETIMEDOUT',
  );
  assert.equal(seen.options.timeout, 25, 'the timeout has to reach the request, or nothing fires it');
  assert.ok(seen.destroyed, 'a timed-out request must be closed, not left open');
  assert.ok(SEND_TIMEOUT_MS > 0 && SEND_TIMEOUT_MS <= 60_000, 'the default timeout should be a wait a person will sit through');
});

test('a network error rejects, and is reported as neither verdict', async () => {
  // The confirmed defect: no handling at all here printed a stack trace where the verdict goes,
  // for a preview host name whose likeliest answer is ENOTFOUND. A reader who has just been denied
  // by Agents Classic reads a stack trace as another denial.
  const dns = Object.assign(new Error('getaddrinfo ENOTFOUND bedrock-mantle.us-east-1.api.aws'), { code: 'ENOTFOUND' });
  const { net } = fakeNet({ error: dns });
  await assert.rejects(
    () => send({ method: 'GET', path: MODELS_PATH, creds: EXAMPLE, region: 'us-east-1' }, net),
    (err) => err.code === 'ENOTFOUND',
  );

  const report = networkFailure(dns, 'us-east-1');
  const text = `${report.tag}\n${report.lines.join('\n')}`;

  // Distinct from both verdicts, and from the "unclear" one, because they lead to decisions.
  for (const other of [verdict(403, 'is not authorized to perform'), verdict(403, 'without prior service usage'), verdict(403, 'Forbidden')]) {
    assert.notEqual(report.tag, other.tag);
  }
  assert.match(report.tag, /NETWORK ERROR, NOT A VERDICT/);
  assert.match(text, /ENOTFOUND/, 'the cause belongs in the report, not in a stack trace');
  assert.match(text, /not a denial/i);
  assert.match(text, /says nothing about our IAM policy and nothing about the account/);
  assert.match(text, /Nothing was created, deleted or spent/);
  // It must not read as an eligibility finding, which is the misreading that costs the most.
  assert.doesNotMatch(text, /ACCOUNT BLOCKED|not available for accounts|allowlist/);
});

test('a timeout is reported in the same words, and names a Region to try instead', () => {
  const report = networkFailure(Object.assign(new Error('no response in 15000 ms'), { code: 'ETIMEDOUT' }), 'us-east-1');
  assert.match(report.tag, /NOT A VERDICT/);
  assert.match(report.lines.join('\n'), /ETIMEDOUT/);
  assert.match(report.lines.join('\n'), new RegExp(BMA_REGIONS[1]));
});

test('no failure path can print a stack trace instead of a verdict', () => {
  // Source guard: the value of this script is the verdict, and the three ways it can end without
  // one — no credentials, no answer, a bug in here — each have to say so in words.
  assert.ok(/await main\(\)\.catch\(/.test(SOURCE), 'the top-level await must not reject');
  assert.ok(SOURCE.includes("req.on('error', reject)"), 'the request error has to become a rejection');
  assert.ok(SOURCE.includes("req.on('timeout'"), 'a hung request has to be given up on');
  assert.ok(SOURCE.includes('networkFailure(err, region)'), 'main must turn a failed send into the report');
  const main = SOURCE.slice(SOURCE.indexOf('async function main'));
  assert.equal(
    (main.match(/await send\(/g) ?? []).length,
    (main.match(/try \{\n\s*(models|session) = await send\(/g) ?? []).length,
    'every send in main must be inside a try, or one of them can still reject to the top',
  );
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

// --- a 2xx is not a model list ------------------------------------------------------------------

test('a 2xx that carries no model list is not REACHABLE', () => {
  // The branch read the status and nothing else, so every one of these printed "REACHABLE … pick a
  // model from the list above" with nothing above to pick from, and exited 0. Confirmed
  // 2026-11-20. A 200 from a captive portal or an HTTPS-intercepting network is the realistic one.
  const notAList = [
    ['an empty body', ''],
    ['whitespace', '  \n '],
    ['a captive portal', '<html><body>200 OK</body></html>'],
    ['an error document with a 200', '{"message":"Service Unavailable"}'],
    ['a truncated payload', '{"data":[{"id":"openai.gpt-oss-1'],
    ['the list under another key', '{"models":[{"id":"openai.gpt-oss-120b-1:0"}]}'],
    ['data that is not a list', '{"data":{"id":"openai.gpt-oss-120b-1:0"}}'],
    ['a bare list', '[{"id":"openai.gpt-oss-120b-1:0"}]'],
  ];

  for (const [label, body] of notAList) {
    for (const status of [200, 201, 204]) {
      const v = verdict(status, body);
      assert.equal(v.ok, false, `${label} at HTTP ${status} must not be a green verdict`);
      assert.match(v.tag, /NOT WITH A MODEL LIST/, `${label} at HTTP ${status}`);
      assert.ok(v.lines.some((l) => /NOT a verdict about the account/.test(l)),
        `${label}: it must not be read as a verdict in either direction`);
    }
  }

  // An authorised account that simply offers nothing here is its own outcome: signing worked, so
  // it is not a denial, but there is no model to run the gate against either.
  const empty = verdict(200, '{"data":[]}');
  assert.equal(empty.ok, false);
  assert.match(empty.tag, /MODEL LIST IS EMPTY/);
  assert.ok(empty.lines.some((l) => /Signing and authorisation both worked/.test(l)));

  // And the real answer still reads as it did, now with the count in it.
  const good = verdict(200, '{"data":[{"id":"openai.gpt-oss-120b-1:0"},{"id":"openai.gpt-oss-20b-1:0"}]}');
  assert.equal(good.ok, true);
  assert.equal(good.tag, 'REACHABLE');
  assert.match(good.lines[0], /2 models/);
});

test('every verdict says whether it is green, so the exit code cannot contradict the text', () => {
  // Each HTTP outcome exited 0 before this, so `bma-probe --yes && <next step>` carried on after
  // ACCOUNT BLOCKED. The flag is what `main` now sets the exit code from.
  const outcomes = [
    [200, '{"data":[{"id":"m"}]}', true],
    [200, '', false],
    [200, '{"data":[]}', false],
    [400, '{"__type":"ValidationException","message":"1 validation error detected"}', true],
    [403, 'User: arn:aws:iam::1:user/panthiya-dev is not authorized to perform: bedrock-mantle:ListModels', false],
    [403, 'This feature is not available for accounts without prior service usage.', false],
    [403, 'Forbidden', false],
    [404, 'Not Found', false],
    [500, 'Internal Server Error', false],
    [418, 'teapot', false],
  ];

  for (const [status, text, expected] of outcomes) {
    const v = verdict(status, text);
    assert.equal(typeof v.ok, 'boolean', `HTTP ${status} has no ok flag, so main cannot act on it`);
    assert.equal(v.ok, expected, `HTTP ${status} ${text.slice(0, 40)} -> ${v.tag}`);
    assert.ok(v.tag && v.lines.length, 'a verdict with no words is not a verdict');
  }

  // A network error is never green: it is the absence of an answer.
  assert.equal(networkFailure(Object.assign(new Error('getaddrinfo ENOTFOUND'),
    { code: 'ENOTFOUND' }), 'us-east-1').ok, false);
});

test('--region never swallows the next flag, and never signs for an undefined host', () => {
  // The bug `demo-users.mjs` and `seed.mjs` each carry a paragraph about, still live here:
  // `--region --yes` made the region the string "--yes" and a trailing `--region` made it
  // `undefined`, and the probe then signed for `bedrock-mantle.--yes.api.aws` and reported a
  // network verdict about a host that was never BMA. Confirmed 2026-11-20.
  const fallback = process.env.AWS_REGION ?? 'us-east-1';
  for (const argv of [['--region'], ['--yes', '--region'], ['--region', '--yes'],
    ['--region', '--create-probe', '--yes'], ['--region', '-x']]) {
    const { region } = parseArgs(argv);
    assert.equal(region, fallback, `${argv.join(' ')} must fall back, not take a flag as a region`);
    assert.doesNotMatch(hostFor(region), /undefined|--/, 'the host must be resolvable');
  }

  // A real region is still read, and the other two flags are unaffected by the guard.
  assert.equal(parseArgs(['--region', 'us-west-2']).region, 'us-west-2');
  assert.equal(parseArgs(['--region', 'us-west-2', '--yes']).yes, true);
  assert.equal(parseArgs(['--yes', '--region', 'us-east-2', '--create-probe']).createProbe, true);
  for (const r of BMA_REGIONS) assert.equal(parseArgs(['--region', r]).region, r);
});
