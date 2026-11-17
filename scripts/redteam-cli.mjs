#!/usr/bin/env node
// Run the 36-case red-team suite from a terminal (task 5.6, requirements 11.2-11.5).
//
// The browser page (task 5.5) is what a judge watches. This is what gets used while fixing the
// leaks it finds: it is scriptable, its output diffs between runs, and it needs one terminal
// rather than three browser logins. The two must agree about every verdict, which is why every
// verdict here comes out of `backend/functions/redteam/score.mjs` — the same `scoreCase` the page
// posts to, imported rather than reimplemented. A second scorer would not be a convenience, it
// would be the bug: "36/36 blocked" on screen and "34/36" in the terminal means one of them is
// lying and nobody can tell which from the outside.
//
//   node scripts/redteam-cli.mjs                          # cost preview, calls nothing
//   node scripts/redteam-cli.mjs --yes                    # the live run (spends money)
//   node scripts/redteam-cli.mjs --dry-run                # re-score the last recording, free
//   node scripts/redteam-cli.mjs --dry-run --show-replies
//   node scripts/redteam-cli.mjs --yes --off policyCheck  # withdraw a layer's credit (req 11.5)
//
// Environment, all of it:
//
//   PANTHIYA_API_BASE         https://…  the deployed HTTP API, no trailing slash
//   PANTHIYA_TOKEN_TEACHER    a Cognito ID token for a teacher session
//   PANTHIYA_TOKEN_PARENT     …for a parent session
//   PANTHIYA_TOKEN_STUDENT    …for a student session
//
// WHY TOKENS COME FROM THE ENVIRONMENT AND NOWHERE ELSE. `POST /chat` takes the role from the
// verified JWT (requirement 1.3), so the 18 parent cases and the 16 student cases cannot be run
// under the teacher's token — see `runOneCase`. A token passed as an argument lands in shell
// history and in the process list; a token in a file lands in the repository. The environment is
// the one channel that does neither. The parent and student demo logins do not exist yet, so a
// run today reaches two cases and honestly errors the other 34 rather than quietly re-roling them.
//
// EXIT CODE. Non-zero when anything leaked or errored, so this can gate a deploy. An errored case
// is not a blocked case: it is a case whose verdict we do not have, and reporting "we never found
// out" as "we are safe" is the failure mode this whole suite exists to catch.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { scoreCase, normaliseLayers, totalsFrom, LAYERS, ATTRIBUTABLE }
  from '../backend/functions/redteam/score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASES = join(ROOT, 'tests', 'redteam', 'cases.json');

// `*.local.json` is already in .gitignore, so a recording cannot be committed by accident.
const RECORDING = join(ROOT, 'tests', 'redteam', 'last-run.local.json');

/** A rough per-message figure: one InvokeAgent round trip plus one policyCheck call, Nova-class. */
const USD_PER_MESSAGE = 0.003;

/** API Gateway abandons an integration at 29s, so a slower answer than this is already lost. */
const TIMEOUT_MS = 40_000;

const ROLES = ['teacher', 'parent', 'student'];

// --- the suite ---------------------------------------------------------------------------------

/**
 * The 36 cases, read straight off disk.
 *
 * This script runs from a checkout, so the file is simply there. `backend/functions/redteam/` may
 * NOT do this: `tests/redteam/` sits outside every function's `CodeUri`, so the same read is the
 * ENOENT that `tests/unit/packaging.test.mjs` exists to catch, and a copy under `backend/` would
 * be a second source of truth for the one file in this feature that must never drift. That is why
 * the page sends the case it ran and the Lambda validates only its shape. Here, reading the
 * generated file is precisely what keeps the terminal run and the page run the *same* suite.
 */
export function loadCases(path = CASES) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data.cases) || data.cases.length !== data.count) {
    throw new Error(`${path} is malformed: count says ${data.count}, found ${data.cases?.length}`);
  }
  return data.cases;
}

const messageCount = (cases) => cases.reduce((n, c) => n + c.messages.length, 0);

// --- arguments ---------------------------------------------------------------------------------

/**
 * Argument handling, the same shape as `scripts/test-sinhala.mjs`.
 *
 * ponytail: `indexOf` over an array of strings. No parser library, no config file. Ceiling: a flag
 * takes at most one value and `--flag=value` is not understood. Lift it when this grows a flag
 * that needs a list, not before.
 */
export function parseArgs(argv = []) {
  const valueOf = (flag) => {
    const next = argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
    return next && !next.startsWith('-') ? next : undefined;
  };

  const off = (valueOf('--off') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  return {
    yes: argv.includes('--yes'),
    dryRun: argv.includes('--dry-run'),
    // `--dry-run <path>` re-scores one recording; bare `--dry-run` re-scores the last run.
    recording: valueOf('--dry-run') ?? valueOf('--record') ?? RECORDING,
    showReplies: argv.includes('--show-replies'),
    // An unknown layer name or a non-boolean is refused by `normaliseLayers` rather than
    // defaulted, for the reason requirement 11.5 gives: a layer that quietly stays on takes
    // credit it was switched out of, and inflates the score in the one direction that matters.
    layers: normaliseLayers(off.length ? Object.fromEntries(off.map((l) => [l, false])) : undefined),
  };
}

/**
 * One token per role, or undefined where that demo login does not exist yet.
 *
 * Deliberately not collapsed into a single "the token": the shape of this object is what makes
 * running a case under the wrong role impossible to write by accident.
 */
export function tokensFromEnv(env = process.env) {
  return Object.fromEntries(ROLES.map((r) => [r, env[`PANTHIYA_TOKEN_${r.toUpperCase()}`] || undefined]));
}

// --- HTTP, injected ----------------------------------------------------------------------------

/**
 * The default HTTP dependency, injected everywhere else so the tests need no network, no AWS and
 * no credentials — the same split `chat/index.mjs` keeps from `chat/orchestrate.mjs`.
 *
 * A thrown fetch (DNS, TLS, the timeout) comes back as `status: 0`, which `layerOfTurn` reads as
 * `chat_error`. It must never come back as a 200 with no `blockedBy`, because that is the exact
 * signature of layer 1 holding the line, and it would credit the role gate for a request that
 * never left the laptop.
 */
export async function postChat({ url, token, body }) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { status: 0, body: { reason: String(err?.name ?? 'fetch_failed').toLowerCase() } };
  }

  try {
    return { status: res.status, body: await res.json() };
  } catch {
    return { status: res.status, body: null };
  }
}

/** The per-turn metadata `score.mjs` accepts. The reply's text is deliberately not part of it. */
const turnOf = (status, body) => ({
  status,
  blockedBy: typeof body?.blockedBy === 'string' ? body.blockedBy : null,
  reason: typeof body?.reason === 'string' ? body.reason : null,
  replyLength: typeof body?.reply === 'string' ? body.reply.length : null,
});

// --- running ------------------------------------------------------------------------------------

/**
 * Execute one case and score it.
 *
 * The role rule, the one thing in this file worth being pedantic about: the token is looked up by
 * `c.role` and there is no fallback. A privacy question answered legitimately from a teacher
 * session and then counted as a pass would be worse than never running the case, so a missing
 * token is recorded as the 401 that such a call would in fact have returned, `score.mjs` turns
 * that into `error`, and nothing is sent. `role` is handed to `post` as well, purely so a test can
 * assert which token each case travelled under.
 *
 * Multi-message cases (B7, C6) need no session plumbing: `chat/index.mjs` derives the Bedrock
 * session id from the verified `sub` and the Colombo date, so consecutive calls under one token
 * are already one conversation — which is the point of those two cases.
 */
export async function runOneCase({ c, tokens, layers, apiBase, post }) {
  const token = tokens[c.role];
  const turns = [];
  const replies = [];

  if (!token) {
    turns.push(turnOf(401, { reason: 'no_token_for_role' }));
  } else {
    for (const message of c.messages) {
      // `lang` only selects which localisation of a refusal comes back, and the suite records no
      // expected language, so no verdict depends on it.
      const { status, body } = await post({
        url: `${apiBase}/chat`,
        token,
        role: c.role,
        body: { message, lang: 'en' },
      });
      turns.push(turnOf(status, body));
      replies.push(typeof body?.reply === 'string' ? body.reply : null);
      // An errored turn ends the case: the later messages of B7 and C6 only mean anything once
      // the earlier ones have landed.
      if (status !== 200) break;
    }
  }

  return {
    caseId: c.id,
    section: c.section,
    caseRole: c.role,
    noToken: !token,
    ...scoreCase({ caseRole: c.role, sessionRole: c.role, layers, turns }),
    // Kept in memory for this process only, printed solely under `--show-replies`, and never
    // written to the recording. See `report`.
    replies,
  };
}

/**
 * The live run, case by case, printing a running tally as it goes (requirement 11.3).
 *
 * `onLine` rather than `console.log` so the tests can read the tally without capturing stdout,
 * and so a caller that wants the suite without the noise can pass a sink.
 */
export async function runSuite({ cases, tokens, layers, apiBase, post, onLine = () => {} }) {
  const rows = [];

  for (const c of cases) {
    const row = await runOneCase({ c, tokens, layers, apiBase, post });
    rows.push(row);
    const running = totalsFrom(rows);
    onLine(`${row.caseId.padEnd(4)}${row.caseRole.padEnd(9)}${row.verdict.padEnd(9)}`
      + `${String(row.blockedBy ?? '-').padEnd(14)}${row.reason.padEnd(24)}`
      + `${running.blocked}/${running.ran} blocked`);
  }

  return { rows, totals: totalsFrom(rows) };
}

/**
 * Score a recorded run instead of calling anything.
 *
 * This is what makes the tool testable and demoable for free, and it is why a live run writes a
 * recording: the recording holds only the per-turn metadata `score.mjs` already accepts — status,
 * `blockedBy`, reason, reply *length* — so it is also the artefact that makes two runs diffable
 * without putting a single child's name or injection payload on disk.
 */
export function scoreRecorded({ cases, recorded, layers }) {
  return cases.map((c) => {
    // A case absent from the recording is not a pass. `status: 0` scores it `error`.
    const turns = recorded?.outcomes?.[c.id] ?? [turnOf(0, { reason: 'not_recorded' })];
    return {
      caseId: c.id,
      section: c.section,
      caseRole: c.role,
      noToken: false,
      ...scoreCase({ caseRole: c.role, sessionRole: c.role, layers, turns }),
      replies: [],
    };
  });
}

/** What a run leaves behind: turn metadata only, keyed by case id. No reply text, ever. */
export const recordingOf = ({ rows, layers }) => ({
  startedAt: new Date().toISOString(),
  layers,
  outcomes: Object.fromEntries(rows.map((r) => [r.caseId, r.turns])),
});

// --- reporting ---------------------------------------------------------------------------------

/**
 * The closing breakdown, returned as lines so a test can read exactly what was printed.
 *
 * `errored` is its own column and is never folded into `blocked`. Rolling it in would turn "we
 * could not reach /chat for 34 cases" into "2 blocked, 0 leaked" — a green run that proves
 * nothing, and the precise arithmetic that makes a scoreboard worth distrusting.
 *
 * WHY REPLY TEXT IS OPT-IN. A reply can carry a child's name or the payload of a successful
 * injection, and printing it by default puts both into a terminal scrollback and into whatever CI
 * log captures this; `policy-check/index.mjs` logs nothing at all for the same reason. The two
 * verdicts a human genuinely has to read are `needsEye` — held by the agent's own refusal, which
 * no check inspected (requirement 11.4) — and `leaked`, which is the thing being fixed. So
 * `--show-replies` prints those and nothing else.
 */
export function report({ rows, totals, layers, showReplies = false }) {
  const bar = '='.repeat(70);
  const lines = ['', bar, 'Red-team suite — results', bar];

  lines.push(`  layers     ${LAYERS.map((l) => `${l}:${layers[l] ? 'on' : 'off'}`).join('  ')}`);
  lines.push(`  ran        ${totals.ran}`);
  lines.push(`  blocked    ${totals.blocked}`);
  lines.push(`  leaked     ${totals.leaked}`);
  lines.push(`  errored    ${totals.errored}`);
  lines.push(`  needsEye   ${totals.needsEye}`);

  lines.push('', '  held by layer:');
  for (const layer of ATTRIBUTABLE) {
    lines.push(`    ${layer.padEnd(14)}${totals.byLayer[layer]}`);
  }

  const by = (verdict) => rows.filter((r) => r.verdict === verdict);

  if (by('leaked').length) {
    lines.push('', '  LEAKED — read these and fix them:');
    for (const r of by('leaked')) lines.push(`    ${r.caseId.padEnd(4)}${r.caseRole.padEnd(9)}${r.reason}`);
  }

  if (by('error').length) {
    lines.push('', '  ERRORED — no verdict, not a pass:');
    for (const r of by('error')) {
      const why = r.noToken ? `no PANTHIYA_TOKEN_${r.caseRole.toUpperCase()}` : r.reason;
      lines.push(`    ${r.caseId.padEnd(4)}${r.caseRole.padEnd(9)}${why}`);
    }
  }

  const needsEye = rows.filter((r) => r.needsEye);
  if (needsEye.length) {
    lines.push('', '  NEEDS A HUMAN EYE — held by the agent\'s own refusal, not by a check:');
    for (const r of needsEye) lines.push(`    ${r.caseId.padEnd(4)}${r.caseRole.padEnd(9)}${r.reason}`);
    // "live" is not padding: a recording holds no reply text, so a dry run cannot show one even
    // with the flag. Reading these replies costs another run, and the hint should say so.
    if (!showReplies) lines.push('    Re-run live with --show-replies to read these replies.');
  }

  if (showReplies) {
    const toShow = rows.filter((r) => r.needsEye || r.verdict === 'leaked');
    for (const r of toShow) {
      for (const [i, text] of r.replies.entries()) {
        if (typeof text === 'string') lines.push(`    ${r.caseId} turn ${i + 1}: ${text.replace(/\s+/g, ' ')}`);
      }
    }
  }

  return lines;
}

/** Leaked or errored means the suite did not pass. Used as the process exit code. */
export const exitCodeFrom = (totals) => (totals.leaked > 0 || totals.errored > 0 ? 1 : 0);

// --- entry point -------------------------------------------------------------------------------

async function main(argv) {
  const opts = parseArgs(argv);
  const cases = loadCases();
  const tokens = tokensFromEnv();
  const apiBase = (process.env.PANTHIYA_API_BASE ?? '').replace(/\/+$/, '');

  if (opts.dryRun) {
    let recorded;
    try {
      recorded = JSON.parse(readFileSync(opts.recording, 'utf8'));
    } catch {
      console.error(`No recording at ${opts.recording}.`);
      console.error('Run the suite live once with --yes, or pass --dry-run <path>.');
      return 2;                                  // a usage problem, not a leak
    }

    console.log(`Dry run — re-scoring ${opts.recording} (${recorded.startedAt ?? 'unknown time'}).`);
    console.log('Nothing is called and nothing is spent.\n');

    const rows = scoreRecorded({ cases, recorded, layers: opts.layers });
    const totals = totalsFrom(rows);
    for (const line of report({ rows, totals, layers: opts.layers, showReplies: opts.showReplies })) {
      console.log(line);
    }
    return exitCodeFrom(totals);
  }

  const messages = messageCount(cases);
  const missing = ROLES.filter((r) => cases.some((c) => c.role === r) && !tokens[r]);

  console.log(`Red-team suite — ${cases.length} cases, ${messages} messages to POST ${apiBase || '<unset>'}/chat`);
  console.log(`Each message is at least one InvokeAgent round trip plus one policyCheck call.`);
  console.log(`Rough cost: ~US$${(messages * USD_PER_MESSAGE).toFixed(2)} for a full run.\n`);

  for (const r of ROLES) {
    const n = cases.filter((c) => c.role === r).length;
    console.log(`  ${r.padEnd(9)}${String(n).padStart(2)} cases   ${tokens[r] ? 'token present' : `NO TOKEN — these ${n} will be scored 'error'`}`);
  }

  if (missing.length) {
    console.log(`\nMissing: ${missing.map((r) => `PANTHIYA_TOKEN_${r.toUpperCase()}`).join(', ')}.`);
    console.log('Those cases will NOT be re-run under another role — a privacy question answered');
    console.log("from a teacher session would score as a pass, which is worse than not running it.");
  }

  if (!apiBase) {
    console.error('\nPANTHIYA_API_BASE is not set. Nothing to call.');
    return 2;
  }

  if (!opts.yes) {
    console.log('\nThis calls a paid API. Re-run with --yes to proceed, or --dry-run to re-score');
    console.log('the last recording for free.');
    return 0;
  }

  console.log('');
  const { rows, totals } = await runSuite({
    cases, tokens, layers: opts.layers, apiBase, post: postChat, onLine: (l) => console.log(l),
  });

  writeFileSync(opts.recording, JSON.stringify(recordingOf({ rows, layers: opts.layers }), null, 2) + '\n');

  for (const line of report({ rows, totals, layers: opts.layers, showReplies: opts.showReplies })) {
    console.log(line);
  }
  console.log(`\n  recording: ${opts.recording}  (turn metadata only — no reply text)`);

  return exitCodeFrom(totals);
}

// Only when run as a script, so the tests can import every function above without executing it.
// `pathToFileURL` rather than string-building a `file://` URL: this repo is developed on Windows,
// where `C:\…` and `/C:/…` would never compare equal and the suite would silently never run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
