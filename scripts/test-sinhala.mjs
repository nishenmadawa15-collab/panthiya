#!/usr/bin/env node
// Day-1 Sinhala gate (design §2.1, task 1.1).
//
// Panthiya lives or dies on whether the cheapest model can actually read Sinhala. If it cannot
// pull "Kasun" and "Dilmi" and "yesterday" and "absent" out of a sentence a teacher would really
// type, then M1 through M6 are built on sand. So this runs BEFORE the agent work, not after.
//
// Zero npm dependencies: it shells out to the AWS CLI, because the AWS SDK only exists inside the
// Lambda runtime, not on a laptop.
//
//   node scripts/test-sinhala.mjs                       # all candidates
//   node scripts/test-sinhala.mjs --model amazon.nova-lite-v1:0
//
// Cost: 5 short prompts per model, a few hundred tokens each. Fractions of a cent.
// It still calls a paid API, so it prints what it is about to spend and waits for --yes.
//
// WHAT A PASS IS ALLOWED TO MEAN. Five milestones rest on this verdict, so the one thing this
// script must never do is read a non-answer as "the model handled Sinhala". The ways a non-answer
// can arrive are each named and counted apart from the passes:
//
//   - an empty completion, or a response shape `invoke` cannot read, scores NO REPLY. It used to
//     score PASS on the one case with no `expect` list, which is the false green that would have
//     sent M1–M6 off on an unmeasured model.
//   - an English refusal to the tutor case scores LOOK: that case asserts the Sinhala block
//     itself, because "no forbidden substring appeared" is satisfied by any reply at all.
//   - a call that never answered — throttle, AccessDenied, wrong region, a hung socket — is
//     counted as `errored`, never as a failed case, and a model whose calls all failed prints
//     NO VERDICT rather than 0/5. 0/5 reads as "this model cannot do Sinhala", which is the same
//     lie in the other direction and costs the same decision.
//   - every call has a deadline (`INVOKE_TIMEOUT_MS`), because the owner is at the keyboard
//     paying for this run and a silent hang is worse than a stated failure.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REGION = process.env.AWS_REGION ?? 'ap-south-1';

/** One call's ceiling. A Bedrock answer to a 300-token prompt takes seconds; a minute is already a fault. */
export const INVOKE_TIMEOUT_MS = 60_000;

/** The output ceiling asked of every model. Named once because `invoke` also has to report it. */
export const MAX_TOKENS = 300;

/**
 * The stop reasons that mean the ceiling above cut the reply off, across all three shapes:
 * Nova says `max_tokens`, Claude says `max_tokens`, the Chat Completions shape says `length`.
 */
const CUT_OFF = new Set(['max_tokens', 'length']);

/** Cheapest first. The first one that passes wins — there is no prize for a better model here. */
export const DEFAULT_CANDIDATES = [
  'amazon.nova-micro-v1:0',
  'amazon.nova-lite-v1:0',
  'anthropic.claude-3-5-haiku-20241022-v1:0',
];

/**
 * `--yes` and `--model <id>`, and nothing else.
 *
 * `--model` with no value used to read as `--model undefined`, which crashed inside the summary
 * after five confusing "CALL FAILED" lines. It is a usage error and is said as one.
 */
export function parseArgs(argv = []) {
  // Anything flag-shaped that is not one of the two is a usage error, said out loud.
  //
  // Silently ignoring it was a money bug, not a cosmetic one: `--model=amazon.nova-lite-v1:0`
  // (the `--flag=value` form this script does not parse) and `--mdoel nova` both left `only`
  // null, so a run the operator aimed at ONE model quietly called all three candidates — three
  // times the Bedrock spend they asked for, and not a word about the word they got wrong. No
  // model id starts with `-`, so this cannot swallow a value.
  for (const a of argv) {
    if (a.startsWith('-') && a !== '--yes' && a !== '--model') {
      throw new Error(`unknown option "${a}" — this script takes --yes and --model <id>, `
        + 'and does not understand the --flag=value form.');
    }
  }

  const i = argv.indexOf('--model');
  if (i < 0) return { yes: argv.includes('--yes'), only: null };

  const next = argv[i + 1];
  if (!next || next.startsWith('-')) {
    throw new Error('--model needs a model id, e.g. --model amazon.nova-lite-v1:0');
  }
  return { yes: argv.includes('--yes'), only: next };
}

/**
 * Each case is a real thing a Sri Lankan teacher or student would send.
 * `expect` lists substrings that MUST appear in the model's JSON reply for the case to pass
 * automatically. Anything subtler is left for a human to read — hence the printed replies.
 */
export const CASES = [
  {
    id: 'attendance-sinhala',
    why: 'the headline demo: mark two absences from one Sinhala sentence',
    prompt: 'ඊයේ පන්තියට කසුන්, දිල්මි ආවේ නැහැ',
    instruction: 'Extract attendance. Reply ONLY with JSON: {"intent":"","students":[],"when":"","status":""}. Use English for keys and for the status value (present/absent). Keep student names in the Latin alphabet.',
    expect: ['attendance', 'asun', 'ilmi', 'absent'],
  },
  {
    id: 'fee-sinhala',
    why: 'money: a misread amount would corrupt the ledger',
    prompt: 'නිමල් නොවැම්බර් මාසෙට 2500 ගෙව්වා',
    instruction: 'Extract the fee payment. Reply ONLY with JSON: {"intent":"","student":"","amount":0,"period":""}. Use the Latin alphabet for the name and an English month name.',
    expect: ['fee', 'imal', '2500', 'ovem'],
  },
  {
    id: 'query-sinhala',
    why: 'reading a question, not just an instruction',
    prompt: 'මේ මාසේ ගාස්තු ගෙවලා නැති අය කවුද?',
    instruction: 'Classify this request. Reply ONLY with JSON: {"intent":"","period":"this_month"}. The intent should describe listing unpaid fees.',
    expect: ['npaid', 'fee'],
  },
  {
    id: 'attendance-tamil',
    why: 'Tamil must work as well as Sinhala, not as an afterthought',
    prompt: 'நேற்று வகுப்புக்கு கசுன் வரவில்லை',
    instruction: 'Extract attendance. Reply ONLY with JSON: {"intent":"","students":[],"when":"","status":""}. Keep student names in the Latin alphabet.',
    expect: ['attendance', 'asu', 'absent'],
  },
  {
    id: 'tutor-sinhala',
    why: 'can it write natural Sinhala back, not just read it?',
    prompt: '2x + 5 = 17 කියන එක විසඳන්නේ කොහොමද?',
    instruction: 'Reply in Sinhala with ONE short hint about the first step. Do NOT give the final answer and do NOT state the value of x.',
    // Judged by eye, plus two hard automatic rules: the answer must not appear, and the reply has
    // to be in Sinhala. `expectScript` is the Sinhala block (U+0D80–U+0DFF) rather than any
    // particular wording, because the case asks whether Sinhala came back at all. Without it an
    // empty completion and an English "I can't help with that" both satisfied every rule this
    // case had, and both scored PASS.
    expect: [],
    expectScript: /[඀-෿]/u,
    scriptName: 'Sinhala',
    mustNotContain: ['x = 6', 'x=6', 'x නම් 6', '= 6'],
  },
];

/**
 * Whether this reply counts as the model having handled this case.
 *
 * Returns the label that gets printed, so "what the script decided" and "what the script shows"
 * cannot drift apart. The rule that matters: a case carrying no automatic assertion at all can
 * never PASS — it is LOOK by construction, so adding a case and forgetting its `expect` list
 * cannot manufacture a green.
 */
export function score(c, reply) {
  const text = typeof reply === 'string' ? reply : '';

  if (text.trim() === '') {
    return {
      ok: false,
      label: 'NO REPLY',
      missing: [],
      leaked: [],
      problems: ['nothing came back — an empty completion is not a pass'],
    };
  }

  const lower = text.toLowerCase();
  const missing = (c.expect ?? []).filter((e) => !lower.includes(e.toLowerCase()));
  const leaked = (c.mustNotContain ?? []).filter((bad) => text.includes(bad));

  const problems = [];
  if (c.expectScript && !c.expectScript.test(text)) {
    problems.push(`the reply contains no ${c.scriptName ?? 'expected'} characters`);
  }
  if (!(c.expect?.length || c.expectScript)) {
    problems.push('this case asserts nothing automatically — read it yourself');
  }

  const ok = missing.length === 0 && leaked.length === 0 && problems.length === 0;
  return { ok, label: ok ? 'PASS' : 'LOOK', missing, leaked, problems };
}

/** One line a human can act on, out of whatever the AWS CLI threw. */
export function failureLine(err) {
  const first = String(err?.message ?? err).split('\n')[0] || 'no message';
  if (err?.killed) return `no answer in ${INVOKE_TIMEOUT_MS} ms — the call was given up on`;
  return err?.code && !first.includes(err.code) ? `${err.code}: ${first}` : first;
}

export function invoke(modelId, text, run = execFileSync) {
  const dir = join(tmpdir(), 'panthiya-sinhala');
  mkdirSync(dir, { recursive: true });
  const inFile = join(dir, 'in.json');
  const outFile = join(dir, 'out.json');

  // Both names are reused for every case of every model, so any answer left behind by an earlier
  // call goes first. A call that exits 0 without writing would otherwise be scored against the
  // previous model's reply — a PASS for a case that was never answered.
  rmSync(outFile, { force: true });

  // Nova, Claude and OpenAI each take a different request shape.
  //
  // ponytail: the OpenAI branch is the Chat Completions shape these models take on Bedrock, and
  // it is the one thing here nobody has run. If it comes back 400 on the body rather than on the
  // prompt, the fallback is `aws bedrock-runtime converse`, which is model-agnostic and would let
  // all three branches collapse into one — worth doing then, not before, because converse would
  // change the two shapes that are already known to work.
  const body = modelId.startsWith('anthropic.')
    ? { anthropic_version: 'bedrock-2023-05-31', max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: [{ type: 'text', text }] }] }
    : modelId.startsWith('openai.')
      ? { messages: [{ role: 'user', content: text }], max_completion_tokens: MAX_TOKENS, temperature: 0 }
      : { messages: [{ role: 'user', content: [{ text }] }], inferenceConfig: { maxTokens: MAX_TOKENS, temperature: 0 } };

  writeFileSync(inFile, JSON.stringify(body));
  run('aws', ['bedrock-runtime', 'invoke-model',
    '--model-id', modelId, '--region', REGION,
    '--body', `fileb://${inFile}`, '--cli-binary-format', 'raw-in-base64-out',
    outFile], { stdio: ['ignore', 'ignore', 'inherit'], timeout: INVOKE_TIMEOUT_MS });

  const raw = JSON.parse(readFileSync(outFile, 'utf8'));
  rmSync(dir, { recursive: true, force: true });

  const { parts, stop, text: textOf } = replyShape(modelId, raw);

  // A response shape this script cannot read is a call that produced no answer, not a model that
  // failed a case. Returning '' for it scored the case NO REPLY — a *failed* case — so a renamed
  // field at the Bedrock end would have printed "0/5 passed", which is exactly the "this model
  // cannot do Sinhala" lie the header of this file promises not to tell. It throws, and `main`
  // counts it `errored`, so five of them print NO VERDICT.
  if (!Array.isArray(parts)) {
    throw new Error(`${modelId}: no readable reply in the response — the shape that came back is `
      + `not one this script knows (top-level keys: ${Object.keys(raw ?? {}).join(', ') || 'none'}). `
      + 'Fix the shape in `replyShape` and re-run; nothing here is a verdict about Sinhala.');
  }

  // Truncation, which is the one that would have gone green. A fragment contains no mistakes yet,
  // and every automatic rule in `score` is satisfied by having less text rather than more:
  // `{"intent":"fee","student":"Nimal","amount":2500,"period":"Novem` holds all four substrings
  // `fee-sinhala` asserts, and a Sinhala hint cut off before its verb still has Sinhala in it and
  // still does not contain `x = 6` — so a cut-off tutor reply was EASIER to pass than a complete
  // one. Confirmed 2026-11-20 by driving `invoke` + `score` with a `max_tokens` response: both
  // cases scored PASS. A fragment is not an answer, so it gets no verdict either way.
  if (CUT_OFF.has(String(stop))) {
    throw new Error(`${modelId}: the reply was cut off at the ${MAX_TOKENS}-token ceiling `
      + `(stop reason "${stop}") — a fragment is not an answer, so this case has no verdict. `
      + 'Raise MAX_TOKENS in this script and re-run.');
  }

  return textOf();
}

/**
 * Where each response shape keeps the reply, and where it says why it stopped.
 *
 * Exported so a test can pin all three without a Bedrock call. `parts` is the container that must
 * exist for the response to be readable at all — it is checked separately from the text, because
 * "the field is gone" and "the model said nothing" are different events with different fixes.
 *
 * ponytail: still three hand-written shapes rather than `bedrock-runtime converse`. Ceiling and
 * upgrade path unchanged — see the note on the request bodies above.
 */
export function replyShape(modelId, raw) {
  if (modelId.startsWith('anthropic.')) {
    return { parts: raw?.content, stop: raw?.stop_reason,
      text: () => raw.content.map((c) => c?.text ?? '').join('') };
  }
  if (modelId.startsWith('openai.')) {
    return { parts: raw?.choices, stop: raw?.choices?.[0]?.finish_reason,
      text: () => raw.choices[0]?.message?.content ?? '' };
  }
  return { parts: raw?.output?.message?.content, stop: raw?.stopReason,
    text: () => raw.output.message.content.map((c) => c?.text ?? '').join('') };
}

/**
 * The closing block, as lines, so a test can read exactly what a run concludes.
 *
 * `errored` never merges into the pass count and never into the fail count: a call that did not
 * land has no verdict, and both "4/5" and "0/5" would be claims this run cannot support.
 */
export function summaryLines(summary) {
  const bar = '='.repeat(70);
  const lines = ['', bar, 'Summary', bar];

  for (const s of summary) {
    const ran = s.total - s.errored;
    lines.push(`  ${s.modelId.padEnd(45)} ${s.passed}/${s.total} passed`
      + (s.errored ? `   ${s.errored} call${s.errored === 1 ? '' : 's'} never answered` : ''));
    if (s.errored === s.total) {
      lines.push(`    NO VERDICT — all ${s.total} calls failed. This says nothing about its Sinhala,`);
      lines.push('    in either direction. Fix the call (model access, region, throttling) and re-run.');
    } else if (s.errored) {
      lines.push(`    PARTIAL — ${ran} of ${s.total} cases actually ran; the other ${s.errored} have no verdict.`);
    }
  }

  const clean = summary.find(isClean);
  lines.push('', clean
    ? `  Cleanest candidate: ${clean.modelId} — ${clean.passed}/${clean.total}, every call answered.`
    : '  NO CANDIDATE PASSED EVERY CASE WITH EVERY CALL ANSWERED — the gate is not green.');

  lines.push(`
A PASS is necessary, not sufficient. Read the Sinhala replies yourself before deciding — an
automatic check cannot tell fluent Sinhala from Sinhala-shaped nonsense.

Record the decision and your reasoning in docs/BUILD-LOG.md, then tick task 1.1 in
.kiro/specs/panthiya/tasks.md.`);

  return lines;
}

/**
 * Is the gate green? One candidate that passed every case with every call answered.
 *
 * Separate from `summaryLines` because it is also the exit code, and the two must not be able to
 * disagree: a printed "NO CANDIDATE PASSED" with a 0 exit status is the same false green in a
 * different place.
 */
export const gateIsGreen = (summary) => summary.some(isClean);

/**
 * A candidate this run can stand behind: every case passed, every call answered, and there was
 * something to answer.
 *
 * `total > 0` is the condition that was missing, and it is the whole predicate on an empty suite:
 * with no cases, "no case failed" and "no call errored" are both vacuously true, so `gateIsGreen`
 * returned **true** and the script exited 0 announcing a "Cleanest candidate — 0/0, every call
 * answered". Confirmed 2026-11-20. One predicate, used by both the printed verdict and the exit
 * code, so the two cannot drift apart — which is the reason given where `gateIsGreen` is defined.
 */
export const isClean = (s) => s.total > 0 && s.errored === 0 && s.passed === s.total;

function main(argv) {
  const { yes, only } = parseArgs(argv);
  const candidates = only ? [only] : DEFAULT_CANDIDATES;

  console.log(`Day-1 Sinhala gate — region ${REGION}`);
  console.log(`Candidates: ${candidates.join(', ')}`);

  if (candidates.some((m) => m.startsWith('openai.')) && !REGION.startsWith('us-')) {
    console.log(`
⚠  An OpenAI model is in the list but the region is ${REGION}. These models are served from the
   US regions, and asking the wrong region fails with a message that reads as if the model does
   not exist. Set AWS_REGION=us-east-1 (or us-west-2) for this run.
   Why this matters: Bedrock Managed Agents runs OpenAI models, so if the challenge means BMA
   (docs/NEXT-SESSION.md §0a) this gate has to pass on one of them, not on Nova.`);
  }
  console.log(`${CASES.length} prompts per model, ~300 output tokens each. Expected cost: well under US$0.05 total.\n`);

  if (!yes) {
    console.log('This calls a paid Bedrock API. Re-run with --yes to proceed.');
    console.log('Prompts that would be sent:');
    for (const c of CASES) console.log(`  [${c.id}] ${c.prompt}`);
    return 0;
  }

  const summary = [];

  for (const modelId of candidates) {
    console.log(`\n${'='.repeat(70)}\n${modelId}\n${'='.repeat(70)}`);
    let passed = 0;
    let errored = 0;

    for (const c of CASES) {
      let reply;
      try {
        reply = invoke(modelId, `${c.instruction}\n\n${c.prompt}`);
      } catch (err) {
        errored += 1;
        console.log(`\n[${c.id}] CALL FAILED — ${failureLine(err)}`);
        console.log('  No verdict for this case. If this says AccessDenied, enable model access');
        console.log('  for this model in this region; if it says ThrottlingException, wait and re-run.');
        continue;
      }

      const { label, ok, missing, leaked, problems } = score(c, reply);
      if (ok) passed += 1;

      console.log(`\n[${c.id}] ${label}  — ${c.why}`);
      console.log(`  sent : ${c.prompt}`);
      console.log(`  got  : ${reply.trim().replace(/\n/g, '\n         ')}`);
      if (missing.length) console.log(`  missing expected: ${missing.join(', ')}`);
      for (const p of problems) console.log(`  ${p}`);
      if (leaked.length) console.log(`  LEAKED THE ANSWER: ${leaked.join(', ')}  <-- disqualifying`);
    }

    summary.push({ modelId, passed, errored, total: CASES.length });
  }

  for (const line of summaryLines(summary)) console.log(line);

  // Non-zero unless some candidate passed every case with every call answered, so a run whose
  // calls all failed cannot be mistaken for a green one by anything reading the exit code.
  return gateIsGreen(summary) ? 0 : 1;
}

// Importable for the tests; only runs when invoked directly. `pathToFileURL` rather than a
// string-built `file://` URL, for the Windows reason given in scripts/redteam-cli.mjs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    // Words, not a stack trace: this script's whole output is a verdict a human reads.
    console.error(`test-sinhala: ${failureLine(err)}`);
    process.exitCode = 2;
  }
}
