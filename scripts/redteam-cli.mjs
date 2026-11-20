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

import { scoreCase, normaliseLayers, totalsFrom, LAYERS, ATTRIBUTABLE, REASONS }
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

  // Checked here, before the cost preview, because the alternative is finding out mid-run.
  //
  // A case with no messages gives `runOneCase` an empty `turns` array, and `scoreCase` reads
  // `turns[turns.length - 1]` — so it throws a TypeError on that case. That throw leaves
  // `runSuite` uncaught, which means `main` never writes the recording and never prints the
  // report: a run that crashed on case 30 of 36 would have spent the money for twenty-nine cases
  // and produced no results at all, because the recording is written after the loop. Refusing a
  // malformed suite before the first call is the cheap half of that; see the report for the other.
  for (const c of data.cases ?? []) {
    const bad = typeof c?.id !== 'string' || !c.id ? 'no id'
      : !ROLES.includes(c.role) ? `role "${c.role}" is not one of ${ROLES.join(', ')}`
        : !Array.isArray(c.messages) || c.messages.length === 0 ? 'no messages to send'
          : c.messages.some((m) => typeof m !== 'string' || !m.trim()) ? 'an empty message'
            : null;
    if (bad) throw new Error(`${path} is malformed: case ${c?.id ?? '<unnamed>'} has ${bad}`);
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

  const offValue = valueOf('--off');

  // `--off` with nothing usable after it is a usage error, not "withdraw nothing".
  //
  // This is requirement 11.5's own failure mode, reached through the argument parser instead of
  // through `normaliseLayers`: `--off --yes`, or `--off` left last on the line, made `valueOf`
  // return undefined, `normaliseLayers(undefined)` turned **every layer back on**, and the run
  // then spent real money producing a score the operator believed had a layer withdrawn from it.
  // An unknown layer name is already refused downstream for exactly this reason — "a layer that
  // quietly stays on takes credit it was switched out of" — and a missing one has to be too.
  // Confirmed 2026-11-20: all three of `--off`, `--off --yes` and `--off --show-replies` returned
  // all layers on.
  if (argv.includes('--off') && offValue === undefined) {
    throw new Error(`--off needs a layer name. One of: ${LAYERS.join(', ')} `
      + '(comma-separated for more than one, e.g. --off guardrail,policyCheck).');
  }

  const off = (offValue ?? '').split(',').map((s) => s.trim()).filter(Boolean);

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

/**
 * The per-turn metadata `score.mjs` accepts. The reply's text is deliberately not part of it.
 *
 * WHY A 200 CAN BE DOWNGRADED TO 0. `score.mjs` reads a 200 with no `blockedBy` as "a reply came
 * through and nothing downstream objected", which is layer 1's signature and scores `blocked`.
 * That is right for a reply, and wrong for a 200 that carries no reply at all: an unparsable body
 * (`postChat` returns `body: null` for one) or a `{}` would be credited to the role gate although
 * nobody got an answer. `chat/orchestrate.mjs` already fails closed on an empty or truncated
 * agent reply by answering 502, so a 200 with nothing in it means something between here and
 * there broke — a proxy, a partial response, a shape change. It is reported as no answer, which
 * `score.mjs` turns into `error`: a case whose verdict we do not have.
 *
 * `role` is the role `chat/orchestrate.mjs` read from the verified JWT (decision 5 of
 * docs/NEXT-SESSION.md §4). It is recorded so the verdict can be scored against the role the
 * server actually saw rather than the one this script assumed — see `runOneCase`.
 */
const turnOf = (status, body) => {
  const blockedBy = typeof body?.blockedBy === 'string' ? body.blockedBy : null;
  const reply = typeof body?.reply === 'string' ? body.reply : null;
  const answered = status !== 200 || blockedBy !== null || (reply !== null && reply.trim() !== '');

  return {
    status: answered ? status : 0,
    blockedBy,
    reason: answered ? (typeof body?.reason === 'string' ? body.reason : null) : 'empty_200_body',
    replyLength: reply === null ? null : reply.length,
    role: typeof body?.role === 'string' ? body.role : null,
  };
};

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
      const turn = turnOf(status, body);
      turns.push(turn);
      replies.push(typeof body?.reply === 'string' ? body.reply : null);
      // An errored turn ends the case: the later messages of B7 and C6 only mean anything once
      // the earlier ones have landed. `turn.status`, not `status`, so a 200 that carried no
      // answer ends it too.
      if (turn.status !== 200) break;
    }
  }

  // The role the server says it saw, which is the one the verdict is scored against. The ceiling
  // named in `score.mjs` — "the runner cannot verify `sessionRole`" — is the expensive one on
  // deploy evening: paste the teacher's token into PANTHIYA_TOKEN_PARENT and all 18 parent
  // privacy cases are answered legitimately from a teacher session and scored `blocked`. With
  // `role` echoed back, `score.mjs` sees the mismatch and scores them `error` instead. A server
  // that does not echo it (an older deploy) falls back to the assumption, which is what this
  // script did for every case before.
  const sessionRole = turns.map((t) => t.role).find((r) => typeof r === 'string') ?? c.role;

  return {
    caseId: c.id,
    section: c.section,
    caseRole: c.role,
    sessionRole,
    noToken: !token,
    ...scoreCase({ caseRole: c.role, sessionRole, layers, turns }),
    /*
     * The RAW per-turn metadata, placed after the spread on purpose, because `scoreCase` also
     * returns a `turns` — its scored *detail*, which carries `layer` and has **no `blockedBy`** —
     * and that is not what a recording may hold.
     *
     * `recordingOf` writes `r.turns` straight to disk, so the detail was what landed there, and
     * `layerOfTurn` reads `blockedBy` to attribute a turn. With the field gone, every re-scored
     * block fell through to "a reply came through and nothing objected" — layer 1's signature —
     * so `--dry-run` moved all 35 policyCheck blocks to `instructions` and flagged every one of
     * them `needsEye`. Confirmed 2026-11-20 by recording a live run of 36 policyCheck blocks and
     * re-scoring it: live `policyCheck: 35`, re-scored `instructions: 35, policyCheck: 0`.
     *
     * The headline count survived that, which is why it went unnoticed; the layer attribution did
     * not — and the layer attribution is the entire point of requirement 11.5, because `--off
     * policyCheck` is supposed to move the score by exactly the number of cases policyCheck alone
     * was holding. On a recording it moved it by zero. This line is what makes the recording the
     * shape its own comment already claims: status, `blockedBy`, reason, reply length, role.
     */
    turns,
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
/**
 * The row a case gets when the runner itself threw, rather than the call failing.
 *
 * Shaped exactly like a scored row, because four things read these rows and none of them should
 * need to know this one is different: `totalsFrom` counts it in the `errored` column, `report`
 * lists it, `recordingOf` writes it, and a later `--dry-run` re-scores it. The single turn is
 * `status: 0`, which `layerOfTurn` reads as `chat_error` — so the recording re-scores to the same
 * `error` verdict rather than quietly losing the case, which would be the same lie as the crash,
 * just harder to notice.
 *
 * `chat_error` and not a new reason code: it already renders on the page and in all three i18n
 * packs, so nothing outside this lane has to change for the row to be readable. `runnerThrew`
 * carries the message for the terminal only — it is not part of the verdict and is not written to
 * disk. It is deliberately NOT called `crashed`: `score.mjs` now has a `chat_crashed` reason code
 * for an HTTP 500 from `/chat`, which is a different event — the service answering badly, rather
 * than this script faulting — and two fields a reader could swap is how the next one of these gets
 * written.
 */
const runnerFaultRow = (c, err, layers) => ({
  caseId: typeof c?.id === 'string' && c.id ? c.id : '<unnamed>',
  section: typeof c?.section === 'string' ? c.section : String(c?.id ?? '').replace(/[0-9]+$/, ''),
  caseRole: typeof c?.role === 'string' ? c.role : 'teacher',
  sessionRole: typeof c?.role === 'string' ? c.role : 'teacher',
  noToken: false,
  verdict: 'error',
  blockedBy: null,
  reason: REASONS.chatError,
  needsEye: false,
  layersRelied: [],
  turns: [turnOf(0, { reason: REASONS.chatError })],
  replies: [],
  runnerThrew: String(err?.message ?? err).split('\n')[0] || 'no message',
  layersAtCrash: layers,
});

export async function runSuite({ cases, tokens, layers, apiBase, post, onLine = () => {} }) {
  const rows = [];

  for (const c of cases) {
    /*
     * One case throwing must not cost the cases already paid for.
     *
     * `main` writes the recording and prints the report AFTER this loop, so an uncaught throw
     * here discarded every verdict the run had bought. Confirmed 2026-11-20: a fault on case 30
     * of 36 lost all twenty-nine completed verdicts — no recording, no scoreboard, exit 3 and a
     * single line of stack trace for US$0.09 of calls. Recording the row and carrying on is the
     * only behaviour that keeps the money's worth of evidence.
     *
     * ponytail: this catch cannot tell a fault in one case from a fault that means the whole run
     * should stop — a credential that has just expired looks the same from in here as a bad case.
     * It does not try: a rejected token does NOT reach this catch (`postChat` turns a thrown fetch
     * into `status: 0` and a 401 is an ordinary response, both of which score `error` without
     * throwing), so what lands here is an unexpected fault and the honest move is to record it.
     * The protection against misreading the result is in `report`, which refuses to let a run with
     * errored cases be quoted as a score. Upgrade path, if it is ever needed: stop after N
     * consecutive crashed cases — worth adding the first time a run actually crashes this way, and
     * not before, because a wrong threshold would abandon a run that was recoverable.
     */
    let row;
    try {
      row = await runOneCase({ c, tokens, layers, apiBase, post });
    } catch (err) {
      row = runnerFaultRow(c, err, layers);
    }
    rows.push(row);
    const running = totalsFrom(rows);
    // Exactly one line per case, crashed ones included: this output is meant to diff between
    // runs, so a fault must widen a line rather than add one.
    onLine(`${row.caseId.padEnd(4)}${row.caseRole.padEnd(9)}${row.verdict.padEnd(9)}`
      + `${String(row.blockedBy ?? '-').padEnd(14)}${row.reason.padEnd(24)}`
      + `${running.blocked}/${running.ran} blocked`
      + (row.runnerThrew ? `   runner threw: ${row.runnerThrew}` : ''));
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
    //
    // An **empty** turn list is treated the same way, and that is not the same test: `?? ` does
    // not fire on `[]`, so a recording carrying `"A1": []` reached `scoreCase`, which reads
    // `turns[turns.length - 1]` and threw a TypeError — a free dry run crashing with a stack
    // trace where a scoreboard goes. Nothing recorded means no verdict, however it is spelled.
    const recordedTurns = recorded?.outcomes?.[c.id];
    const turns = Array.isArray(recordedTurns) && recordedTurns.length
      ? recordedTurns
      : [turnOf(0, { reason: 'not_recorded' })];
    // Scored against the role the recorded run's server reported, for the reason in `runOneCase`:
    // a dry run that re-scores a token mix-up as `blocked` would hide it rather than preserve it.
    const sessionRole = turns.map((t) => t?.role).find((r) => typeof r === 'string') ?? c.role;
    return {
      caseId: c.id,
      section: c.section,
      caseRole: c.role,
      sessionRole,
      noToken: false,
      ...scoreCase({ caseRole: c.role, sessionRole, layers, turns }),
      // The recorded turns, not `scoreCase`'s detail, for the reason given in `runOneCase`: it
      // keeps `recordingOf(scoreRecorded(…))` a round trip rather than a one-way degradation.
      turns,
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

  // Said here, immediately under the tiles, because this is where a number gets copied out of.
  // `blocked` is a count of the cases that were actually scored, so quoting it next to "36" when
  // some cases never got a verdict is the arithmetic this whole file exists to prevent.
  if (totals.errored) {
    lines.push('', `  ⚠  ${totals.errored} of ${totals.ran} cases have NO VERDICT (see ERRORED below).`,
      `     This run scored ${totals.blocked} of the ${totals.ran - totals.errored} cases that ran.`,
      '     Do not quote it as a result for the suite until the errored cases have an answer.');
  }

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
      // The runner itself throwing is its own line: the reason code stays `chat_error` so the
      // page and the i18n packs need nothing, but "the call failed" and "this script has a bug"
      // send an operator to two different places, so the terminal says which it was.
      const why = r.runnerThrew ? `${r.reason} — the runner threw: ${r.runnerThrew}`
        : r.noToken ? `no PANTHIYA_TOKEN_${r.caseRole.toUpperCase()}`
        // Name the env var, because this one is a paste error and nothing else: the token used
        // for a case belonged to a different role, and the run sheet's export block is where it
        // came from.
        : r.reason === 'case_role_mismatch'
          ? `${r.reason} — answered as ${r.sessionRole ?? '?'}; PANTHIYA_TOKEN_${r.caseRole.toUpperCase()} holds the wrong token`
          : r.reason;
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

  // The money has already been spent at this point, so a disk that will not take the recording
  // must not cost the report as well: it is the only place the run's numbers exist.
  let recorded = true;
  try {
    writeFileSync(opts.recording, JSON.stringify(recordingOf({ rows, layers: opts.layers }), null, 2) + '\n');
  } catch (err) {
    recorded = false;
    console.error(`\n  COULD NOT WRITE ${opts.recording}: ${String(err?.message ?? err).split('\n')[0]}`);
    console.error('  The results below are this run\'s only copy — they cannot be re-scored later.');
  }

  for (const line of report({ rows, totals, layers: opts.layers, showReplies: opts.showReplies })) {
    console.log(line);
  }
  if (recorded) console.log(`\n  recording: ${opts.recording}  (turn metadata only — no reply text)`);

  return exitCodeFrom(totals);
}

// Only when run as a script, so the tests can import every function above without executing it.
// `pathToFileURL` rather than string-building a `file://` URL: this repo is developed on Windows,
// where `C:\…` and `/C:/…` would never compare equal and the suite would silently never run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Anything that throws before or around the run — a malformed cases.json, a missing file —
  // would otherwise reach the top as an unhandled rejection and print a stack trace where the
  // scoreboard goes. Exit 3 so it cannot be read as "leaked or errored" (1) or "usage" (2).
  process.exit(await main(process.argv.slice(2)).catch((err) => {
    console.error(`\nredteam-cli could not run: ${String(err?.message ?? err).split('\n')[0]}`);
    console.error('No cases were scored. Nothing above is a result.');
    return 3;
  }));
}
