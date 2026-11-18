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

export function send({ method, path, body = '', creds, region }, net = request) {
  const host = hostFor(region);
  const headers = {
    ...sign({ method, path, body, creds, host, region }),
    ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
  };
  return new Promise((resolve, reject) => {
    const req = net({ host, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
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
    return {
      tag: 'REACHABLE',
      lines: [
        'This account can sign into BMA and the endpoint answered. Option C is on the table.',
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
        tag: 'AUTHORISED — the body was simply wrong',
        lines: [
          'A ValidationException is good news: the request got past authorisation and only the body',
          'failed its schema. That is the sharp answer to "can this account use BMA?" — yes.',
        ],
      };
    }
    if (ourPolicy && !eligibility) {
      return {
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
      tag: 'UNCLEAR — READ THE MESSAGE',
      lines: [
        'The body above decides this. Does it name the IAM identity (our policy) or the account',
        '(eligibility)? Those lead to opposite decisions, so do not average them.',
      ],
    };
  }

  if (status === 404) {
    return {
      tag: 'WRONG PATH OR REGION',
      lines: [
        `Either ${MODELS_PATH} is no longer the discovery path, or this Region is not serving the preview.`,
        `The user guide lists ${BMA_REGIONS.join(', ')}. Re-read it before changing this script:`,
        'docs.aws.amazon.com/bedrock/latest/userguide/bedrock-managed-agents-openai.html',
      ],
    };
  }

  return { tag: 'UNEXPECTED', lines: ['Not a documented outcome. Paste the status and body into the build log.'] };
}

export function parseArgs(argv) {
  const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
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

Re-run with --yes.`);
    return;
  }

  let creds;
  try {
    creds = credentials();
  } catch (err) {
    const message = String(err.stderr ?? err.message).split('\n')[0];
    console.error(`\nCould not read credentials from the AWS CLI: ${message}`);
    console.error('Run `aws configure` first (PANTHIYA_SETUP.md §4). Nothing was sent.');
    process.exitCode = 2;
    return;
  }

  const models = await send({ method: 'GET', path: MODELS_PATH, creds, region });
  console.log(`\nGET ${MODELS_PATH} → HTTP ${models.status}`);
  console.log(models.text.slice(0, 2000) || '(empty body)');

  if (createProbe) {
    const body = JSON.stringify({ probe: 'panthiya-bma-probe' });
    const session = await send({ method: 'POST', path: SESSIONS_PATH, body, creds, region });
    console.log(`\nPOST ${SESSIONS_PATH} (invalid on purpose) → HTTP ${session.status}`);
    console.log(session.text.slice(0, 2000) || '(empty body)');
    const { tag, lines } = verdict(session.status, session.text);
    console.log(`\nVerdict from the create probe: ${tag}`);
    for (const l of lines) console.log(`  ${l}`);
  }

  const { tag, lines } = verdict(models.status, models.text);
  console.log(`\nVerdict: ${tag}`);
  for (const l of lines) console.log(`  ${l}`);
  console.log(`
Whatever this says, write the exact status and message into docs/BUILD-LOG.md. It answers the
largest open question in the project, and a remembered paraphrase of it is worth nothing.

What this probe cannot answer, and only the challenge's own rules can: whether the challenge
requires BMA, Agents Classic, or neither. See docs/NEXT-SESSION.md §0a.`);
}

if (process.argv[1] && process.argv[1].endsWith('bma-probe.mjs')) await main();
