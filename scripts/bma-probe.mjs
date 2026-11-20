#!/usr/bin/env node
// Can this account reach Bedrock Managed Agents (BMA, powered by OpenAI)?  — docs/NEXT-SESSION.md §0a
//
// Yesterday's blocker was about Bedrock Agents *Classic*: `CreateAgent` returns AccessDeniedException
// on accounts without prior service usage, and there is no exception process. BMA is a different
// service — its own endpoint, its own IAM namespace, its own model family — and nothing in its
// documentation mentions an allowlist. The handoff says one signed request settles it. This is that
// request, so nobody has to hand-roll SigV4 at one in the morning.
//
//   node scripts/bma-probe.mjs                        # says what it would do, calls nothing
//   node scripts/bma-probe.mjs --yes                  # GET /v1/models — read-only, free
//   node scripts/bma-probe.mjs --yes --region us-west-2
//   node scripts/bma-probe.mjs --yes --create-probe    # ALSO one deliberately invalid
//                                                      # CreateAgentSession; see the warning below
//
// Zero npm dependencies, like the rest of this repo: SigV4 is ~40 lines of node:crypto, and the AWS
// SDK only exists inside the Lambda runtime. Credentials come from the AWS CLI, which is already how
// scripts/test-sinhala.mjs reaches Bedrock, so a profile, SSO or an assumed role all work unchanged.
//
// Reading the result is the whole point, so `verdict()` spells the outcomes out: a 403 here has two
// opposite meanings — our own IAM policy, or the account — and only the message text separates them.

import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { request } from 'node:https';

/** The three preview Regions, from the BMA user guide. ap-south-1 is deliberately not one of them. */
export const BMA_REGIONS = ['us-east-1', 'us-west-2', 'us-east-2'];
export const SERVICE = 'bedrock-mantle';
export const MODELS_PATH = '/v1/models';
export const SESSIONS_PATH = '/openai/v1/agents/sessions';

export const hostFor = (region) => `${SERVICE}.${region}.api.aws`;

// ---------------------------------------------------------------------------------------------
// SigV4. Nothing clever: the canonical request, the string to sign, the four-step key, the header.
// `now` and `service` are arguments rather than constants so the AWS test-suite vector can be run
// against this exact code — see tests/unit/bma-probe.test.mjs. A signer with no known-answer test
// is a signer that fails at the endpoint with a message that blames the account.
// ---------------------------------------------------------------------------------------------

const sha256 = (data) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();

/** The derived signing key, exported because AWS publishes a known answer for it. */
export function signingKey(secret, dateStamp, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), service), 'aws4_request');
}

export function sign({ method, path, body = '', creds, host, region, service = SERVICE, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20261118T204500Z
  const dateStamp = amzDate.slice(0, 8);

  const headers = {
    host,
    'x-amz-date': amzDate,
    ...(creds.SessionToken ? { 'x-amz-security-token': creds.SessionToken } : {}),
    ...(body ? { 'content-type': 'application/json' } : {}),
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map((k) => `${k}:${String(headers[k]).trim()}\n`).join('');

  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, sha256(body)].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(creds.SecretAccessKey, dateStamp, region, service))
    .update(stringToSign, 'utf8')
    .digest('hex');

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${creds.AccessKeyId}/${scope}, `
      + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ---------------------------------------------------------------------------------------------
// The outside world, injected so the tests need no credentials and no network.
// ---------------------------------------------------------------------------------------------

const awsCli = (argv) => execFileSync('aws', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Credentials from the CLI, never from argv and never printed. */
export function credentials(run = awsCli) {
  const out = run(['configure', 'export-credentials', '--format', 'process']);
  const creds = JSON.parse(out);
  if (!creds.AccessKeyId || !creds.SecretAccessKey) throw new Error('no_credentials');
  return creds;
}

/**
 * How long one request may hang before it is abandoned.
 *
 * A preview endpoint that does not resolve is the likeliest outcome of this whole script, and a
 * probe that sits there forever is indistinguishable from a probe that is thinking about it.
 */
export const SEND_TIMEOUT_MS = 15_000;

export function send({ method, path, body = '', creds, region, timeout = SEND_TIMEOUT_MS }, net = request) {
  const host = hostFor(region);
  const headers = {
    ...sign({ method, path, body, creds, host, region }),
    ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
  };
  return new Promise((resolve, reject) => {
    const req = net({ host, path, method, headers, timeout }, (res) => {
      // Decode as UTF-8 here rather than per chunk: `text += chunk` stringifies each Buffer on its
      // own, so a multi-byte character landing on a chunk boundary arrives as two replacement
      // characters. The body is the whole verdict, and a mangled denial reads like a different one.
      res.setEncoding('utf8');
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    // `timeout` only tells the socket when to fire this event; closing the request is ours to do.
    req.on('timeout', () => req.destroy(Object.assign(
      new Error(`no response in ${timeout} ms`), { code: 'ETIMEDOUT' },
    )));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------------------------
// The verdicts. A status code on its own would be worse than nothing here.
// ---------------------------------------------------------------------------------------------

export function verdict(status, text = '') {
  const lower = text.toLowerCase();

  if (status >= 200 && status < 300) {
    // A 2xx is not by itself a model list, and this branch used to assume it was: an empty body,
    // a captive-portal HTML page, a truncated payload and an error document that happened to
    // arrive with a 200 all printed "REACHABLE … pick a model from the list above" with nothing
    // above to pick from. Confirmed 2026-11-20. The body has to actually hold models.
    let models = null;
    try {
      const parsed = JSON.parse(text);
      // The OpenAI-compatible shape BMA answers with: {"data":[{"id":"openai.gpt-oss-120b-1:0"}]}.
      if (Array.isArray(parsed?.data)) models = parsed.data;
    } catch { /* not JSON at all, handled just below */ }

    if (models === null) {
      return {
        ok: false,
        tag: 'ANSWERED 2xx, BUT NOT WITH A MODEL LIST',
        lines: [
          `The call came back HTTP ${status} and the body is not a model list `
          + `(${text.trim() ? 'it is printed above' : 'it is empty'}).`,
          'Something between here and BMA answered: a proxy, a redirect, a truncated response, or a',
          'changed response shape. This is NOT a verdict about the account in either direction.',
          'Read the body above, then run this again from a network that does not intercept HTTPS.',
        ],
      };
    }

    if (models.length === 0) {
      return {
        ok: false,
        tag: 'REACHABLE, BUT THE MODEL LIST IS EMPTY',
        lines: [
          'Signing and authorisation both worked — the account can talk to BMA — but it offers no',
          'models here, so there is nothing to run the Sinhala gate against and Option C is not yet',
          'on the table. Try another preview Region, or check model access for this account.',
        ],
      };
    }

    return {
      ok: true,
      tag: 'REACHABLE',
      lines: [
        `This account can sign into BMA and the endpoint answered with ${models.length} model`
        + `${models.length === 1 ? '' : 's'}. Option C is on the table.`,
        'Next: pick a model from the list above and re-run the Sinhala gate against it —',
        '  node scripts/test-sinhala.mjs --yes --model <openai model id>  (with AWS_REGION set to this Region)',
        'The gate decides the model. Nothing else is allowed to.',
      ],
    };
  }

  if (status === 403 || status === 400) {
    // Two opposite failures share these codes, and only the wording separates them.
    const ourPolicy = lower.includes('not authorized to perform')
      || lower.includes('explicit deny')
      || lower.includes('no identity-based policy');
    const eligibility = lower.includes('prior service usage')
      || lower.includes('maintenance')
      || lower.includes('allowlist')
      || lower.includes('not enabled for this account')
      || lower.includes('not available for accounts');

    if (/validation/i.test(text)) {
      return {
        ok: true,
        tag: 'AUTHORISED — the body was simply wrong',
        lines: [
          'A ValidationException is good news: the request got past authorisation and only the body',
          'failed its schema. That is the sharp answer to "can this account use BMA?" — yes.',
        ],
      };
    }
    if (ourPolicy && !eligibility) {
      return {
        ok: false,
        tag: 'OUR IAM, NOT THE ACCOUNT',
        lines: [
          'The denial names the IAM identity rather than the account, so this is almost certainly our',
          'own policy. AmazonBedrockFullAccess predates this service and probably does not cover the',
          `${SERVICE}: namespace at all.`,
          'Fix: add bedrock-mantle:* (or ListModels / CreateAgentSession / GetAgentSession) to the',
          'panthiya-dev user and run this again. Conclude NOTHING about the challenge from this result.',
        ],
      };
    }
    if (eligibility) {
      return {
        ok: false,
        tag: 'ACCOUNT BLOCKED',
        lines: [
          'The message is about the account rather than the identity, so BMA looks as unavailable here',
          'as Agents Classic is. If the challenge requires BMA, that is an eligibility problem, and it',
          'is worth knowing today rather than on Dec 1.',
          'Record the exact message in docs/BUILD-LOG.md before doing anything else.',
        ],
      };
    }
    return {
      ok: false,
      tag: 'UNCLEAR — READ THE MESSAGE',
      lines: [
        'The body above decides this. Does it name the IAM identity (our policy) or the account',
        '(eligibility)? Those lead to opposite decisions, so do not average them.',
      ],
    };
  }

  if (status === 404) {
    return {
      ok: false,
      tag: 'WRONG PATH OR REGION',
      lines: [
        // AWS lists unavailable preview access as a cause of 404 on this endpoint, which is why this
        // is not simply "wrong URL": it is the one status that can also mean the gate is shut.
        `Three readings, and the body above decides between them: ${MODELS_PATH} is no longer the`,
        'discovery path; this Region is not serving the preview; or preview access is not available',
        'to this account, which AWS documents as a cause of 404 on this endpoint.',
        `The user guide lists ${BMA_REGIONS.join(', ')}. Re-read it before changing this script:`,
        'docs.aws.amazon.com/bedrock/latest/userguide/bedrock-managed-agents-openai.html',
      ],
    };
  }

  return { ok: false, tag: 'UNEXPECTED', lines: ['Not a documented outcome. Paste the status and body into the build log.'] };
}

/**
 * The third outcome, and the one the verdicts above must never be allowed to absorb: no answer at
 * all.
 *
 * `bedrock-mantle.<region>.api.aws` is a preview host name, so a DNS failure is an ordinary result
 * here — and an unhandled rejection printed a stack trace instead of a verdict, which reads like
 * an account block to anyone who has just spent an evening being denied by Agents Classic. It is
 * neither verdict. It is a request that never arrived.
 */
export function networkFailure(err, region) {
  const code = err?.code ?? err?.name ?? 'error';
  const host = hostFor(region);
  const unresolved = code === 'ENOTFOUND' || code === 'EAI_AGAIN';

  return {
    ok: false,
    tag: 'NO ANSWER — A NETWORK ERROR, NOT A VERDICT',
    lines: [
      `Nothing came back from https://${host}: ${code} — ${err?.message ?? err}`,
      'This is not a denial. It says nothing about our IAM policy and nothing about the account,',
      'so do not record it as either one.',
      ...(unresolved ? [
        `${host} did not resolve. For a preview endpoint the usual causes are a Region that is not`,
        `serving BMA (the user guide lists ${BMA_REGIONS.join(', ')}), a host name AWS has since`,
        'changed, or no DNS from this machine at all. Check the user guide before editing this',
        'script: docs.aws.amazon.com/bedrock/latest/userguide/bedrock-managed-agents-openai.html',
      ] : [
        'Check the network, then re-run. If it keeps timing out from one Region, try another of',
        `the three: ${BMA_REGIONS.join(', ')}.`,
      ]),
      'Nothing was created, deleted or spent, and the question is still open.',
    ],
  };
}

export function parseArgs(argv) {
  /**
   * The value after a flag, or the fallback — and never the next flag.
   *
   * `argv[argv.indexOf(name) + 1]` unguarded is the bug `scripts/demo-users.mjs` and
   * `backend/seed/seed.mjs` both carry a paragraph about, and it was still here: `--region --yes`
   * made the region the string **"--yes"**, and a trailing `--region` made it `undefined`. Either
   * way this script then signed for `https://bedrock-mantle.--yes.api.aws`, failed to resolve it,
   * and reported a network verdict about a host that was never BMA. Confirmed 2026-11-20.
   */
  const value = (name, fallback) => {
    const i = argv.indexOf(name);
    const next = i >= 0 ? argv[i + 1] : undefined;
    return next && !next.startsWith('-') ? next : fallback;
  };
  return {
    region: value('--region', process.env.AWS_REGION ?? 'us-east-1'),
    yes: argv.includes('--yes'),
    createProbe: argv.includes('--create-probe'),
  };
}

export function plan(region) {
  const lines = [`BMA probe — region ${region}, endpoint https://${hostFor(region)}`];
  if (!BMA_REGIONS.includes(region)) {
    lines.push(
      '',
      `⚠  ${region} is not one of the three preview Regions (${BMA_REGIONS.join(', ')}).`,
      '   A 404 from here would mean nothing at all. Pass --region us-east-1.',
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const { region, yes, createProbe } = parseArgs(process.argv.slice(2));
  console.log(plan(region));

  if (!yes) {
    console.log(`
What --yes would do:

  GET https://${hostFor(region)}${MODELS_PATH}        signed as service "${SERVICE}"

A read-only model-discovery call. It creates nothing, deletes nothing and spends nothing.
Credentials are read from the AWS CLI and none are printed.

  --create-probe additionally sends one POST ${SESSIONS_PATH} with a deliberately
  incomplete body. The point is the error: a ValidationException proves this account IS authorised
  (the request got as far as being checked), while AccessDenied proves it is not. It is the sharper
  signal — but it is a write call to a service nobody here has used, so it is off by default and
  Nishen says yes before it runs.

  Neither call is the whole story. A real session also needs a role_arn, iam:PassRole on it, and
  bedrock-mantle:CallWithBearerToken, so a 400 from the create probe is expected and is not a
  verdict by itself — the verdict is which kind of error comes back.

Re-run with --yes.`);
    return;
  }

  let creds;
  try {
    creds = credentials();
  } catch (err) {
    const message = String(err.stderr ?? err.message).split('\n')[0];
    console.error(`\nCould not read credentials from the AWS CLI: ${message}`);
    console.error('Run `aws login --region ap-south-1` first, as panthiya-dev (PANTHIYA_SETUP.md §4). Nothing was sent.');
    process.exitCode = 2;
    return;
  }

  /** Prints the network-error report and returns true, so a caller can stop without a stack. */
  const reportNoAnswer = (err, what) => {
    const { tag, lines } = networkFailure(err, region);
    console.error(`\n${what} → no response`);
    console.error(`\n${tag}`);
    for (const l of lines) console.error(`  ${l}`);
    process.exitCode = 3;
    return true;
  };

  let models;
  try {
    models = await send({ method: 'GET', path: MODELS_PATH, creds, region });
  } catch (err) {
    reportNoAnswer(err, `GET ${MODELS_PATH}`);
    return;
  }
  console.log(`\nGET ${MODELS_PATH} → HTTP ${models.status}`);
  console.log(models.text.slice(0, 2000) || '(empty body)');

  if (createProbe) {
    const body = JSON.stringify({ probe: 'panthiya-bma-probe' });
    let session;
    try {
      session = await send({ method: 'POST', path: SESSIONS_PATH, body, creds, region });
    } catch (err) {
      // The read call already answered, so this one failing is not the end of the run.
      reportNoAnswer(err, `POST ${SESSIONS_PATH}`);
      session = null;
    }
    if (session) {
      console.log(`\nPOST ${SESSIONS_PATH} (invalid on purpose) → HTTP ${session.status}`);
      console.log(session.text.slice(0, 2000) || '(empty body)');
      const { tag, lines } = verdict(session.status, session.text);
      console.log(`\nVerdict from the create probe: ${tag}`);
      for (const l of lines) console.log(`  ${l}`);
    }
  }

  const { ok, tag, lines } = verdict(models.status, models.text);
  console.log(`\nVerdict: ${tag}`);
  for (const l of lines) console.log(`  ${l}`);

  // The exit code follows the verdict, which it did not before: every HTTP outcome exited 0, so
  // `node scripts/bma-probe.mjs --yes && <next step>` carried on after ACCOUNT BLOCKED and after
  // OUR IAM, NOT THE ACCOUNT. `test-sinhala.mjs` and `redteam-cli.mjs` both derive their exit code
  // from the printed verdict for exactly this reason, and this is the first script of the evening.
  //
  // 1 is shared with the "this script broke" path at the bottom. Both mean do not proceed, and the
  // text says which: that path says so in those words.
  process.exitCode = ok ? 0 : 1;

  console.log(`
Whatever this says, write the exact status and message into docs/BUILD-LOG.md. It answers the
largest open question in the project, and a remembered paraphrase of it is worth nothing.

What this probe cannot answer, and only the challenge's own rules can: whether the challenge
requires BMA, Agents Classic, or neither. See docs/NEXT-SESSION.md §0a.`);
}

if (process.argv[1] && process.argv[1].endsWith('bma-probe.mjs')) {
  // The last line of defence against the one failure mode this script must not have: a stack trace
  // where a verdict should be. Anything that reaches here is this script breaking, not an answer.
  await main().catch((err) => {
    console.error(`\nThe probe stopped before it reached a verdict: ${err?.message ?? err}`);
    console.error('That is a bug in this script, not a verdict about our IAM or about the account.');
    process.exitCode = 1;
  });
}
