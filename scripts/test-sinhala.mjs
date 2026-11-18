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

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const YES = args.includes('--yes');
const only = args.includes('--model') ? args[args.indexOf('--model') + 1] : null;

/** Cheapest first. The first one that passes wins — there is no prize for a better model here. */
const CANDIDATES = only ? [only] : [
  'amazon.nova-micro-v1:0',
  'amazon.nova-lite-v1:0',
  'anthropic.claude-3-5-haiku-20241022-v1:0',
];

/**
 * Each case is a real thing a Sri Lankan teacher or student would send.
 * `expect` lists substrings that MUST appear in the model's JSON reply for the case to pass
 * automatically. Anything subtler is left for a human to read — hence the printed replies.
 */
const CASES = [
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
    // Judged by eye, plus one hard automatic rule: the answer must not appear.
    expect: [],
    mustNotContain: ['x = 6', 'x=6', 'x නම් 6', '= 6'],
  },
];

function invoke(modelId, text) {
  const dir = join(tmpdir(), 'panthiya-sinhala');
  mkdirSync(dir, { recursive: true });
  const inFile = join(dir, 'in.json');
  const outFile = join(dir, 'out.json');

  // Nova, Claude and OpenAI each take a different request shape.
  //
  // ponytail: the OpenAI branch is the Chat Completions shape these models take on Bedrock, and
  // it is the one thing here nobody has run. If it comes back 400 on the body rather than on the
  // prompt, the fallback is `aws bedrock-runtime converse`, which is model-agnostic and would let
  // all three branches collapse into one — worth doing then, not before, because converse would
  // change the two shapes that are already known to work.
  const body = modelId.startsWith('anthropic.')
    ? { anthropic_version: 'bedrock-2023-05-31', max_tokens: 300, messages: [{ role: 'user', content: [{ type: 'text', text }] }] }
    : modelId.startsWith('openai.')
      ? { messages: [{ role: 'user', content: text }], max_completion_tokens: 300, temperature: 0 }
      : { messages: [{ role: 'user', content: [{ text }] }], inferenceConfig: { maxTokens: 300, temperature: 0 } };

  writeFileSync(inFile, JSON.stringify(body));
  execFileSync('aws', ['bedrock-runtime', 'invoke-model',
    '--model-id', modelId, '--region', REGION,
    '--body', `fileb://${inFile}`, '--cli-binary-format', 'raw-in-base64-out',
    outFile], { stdio: ['ignore', 'ignore', 'inherit'] });

  const raw = JSON.parse(readFileSync(outFile, 'utf8'));
  rmSync(dir, { recursive: true, force: true });

  if (modelId.startsWith('anthropic.')) return raw.content?.map((c) => c.text).join('') ?? '';
  if (modelId.startsWith('openai.')) return raw.choices?.[0]?.message?.content ?? '';
  return raw.output?.message?.content?.map((c) => c.text).join('') ?? '';
}

console.log(`Day-1 Sinhala gate — region ${REGION}`);
console.log(`Candidates: ${CANDIDATES.join(', ')}`);

if (CANDIDATES.some((m) => m.startsWith('openai.')) && !REGION.startsWith('us-')) {
  console.log(`
⚠  An OpenAI model is in the list but the region is ${REGION}. These models are served from the
   US regions, and asking the wrong region fails with a message that reads as if the model does
   not exist. Set AWS_REGION=us-east-1 (or us-west-2) for this run.
   Why this matters: Bedrock Managed Agents runs OpenAI models, so if the challenge means BMA
   (docs/NEXT-SESSION.md §0a) this gate has to pass on one of them, not on Nova.`);
}
console.log(`${CASES.length} prompts per model, ~300 output tokens each. Expected cost: well under US$0.05 total.\n`);

if (!YES) {
  console.log('This calls a paid Bedrock API. Re-run with --yes to proceed.');
  console.log('Prompts that would be sent:');
  for (const c of CASES) console.log(`  [${c.id}] ${c.prompt}`);
  process.exit(0);
}

const summary = [];

for (const modelId of CANDIDATES) {
  console.log(`\n${'='.repeat(70)}\n${modelId}\n${'='.repeat(70)}`);
  let passed = 0;

  for (const c of CASES) {
    let reply;
    try {
      reply = invoke(modelId, `${c.instruction}\n\n${c.prompt}`);
    } catch (err) {
      console.log(`\n[${c.id}] CALL FAILED — ${String(err.message).split('\n')[0]}`);
      console.log('  If this says AccessDenied, enable model access for this model in this region.');
      continue;
    }

    const lower = reply.toLowerCase();
    const missing = c.expect.filter((e) => !lower.includes(e.toLowerCase()));
    const leaked = (c.mustNotContain ?? []).filter((bad) => reply.includes(bad));
    const ok = missing.length === 0 && leaked.length === 0;
    if (ok) passed++;

    console.log(`\n[${c.id}] ${ok ? 'PASS' : 'LOOK'}  — ${c.why}`);
    console.log(`  sent : ${c.prompt}`);
    console.log(`  got  : ${reply.trim().replace(/\n/g, '\n         ')}`);
    if (missing.length) console.log(`  missing expected: ${missing.join(', ')}`);
    if (leaked.length) console.log(`  LEAKED THE ANSWER: ${leaked.join(', ')}  <-- disqualifying`);
  }

  summary.push({ modelId, passed, total: CASES.length });
}

console.log(`\n${'='.repeat(70)}\nSummary\n${'='.repeat(70)}`);
for (const s of summary) console.log(`  ${s.modelId.padEnd(45)} ${s.passed}/${s.total}`);
console.log(`
A PASS is necessary, not sufficient. Read the Sinhala replies yourself before deciding — an
automatic check cannot tell fluent Sinhala from Sinhala-shaped nonsense.

Record the decision and your reasoning in docs/BUILD-LOG.md, then tick task 1.1 in
.kiro/specs/panthiya/tasks.md.`);
