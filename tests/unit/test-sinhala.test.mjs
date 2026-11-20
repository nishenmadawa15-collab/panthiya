// Offline tests for the Day-1 Sinhala gate (scripts/test-sinhala.mjs, task 1.1).
//
// This script's entire output is a verdict that five milestones rest on, and it costs real money
// to produce, so what is pinned here is the one thing it must never do: read a non-answer as
// "the model handled Sinhala". A failed call, an empty completion, an English refusal and a reply
// that leaks the answer each have to come out as themselves.
//
// Nothing here calls AWS. `invoke` takes its runner as an argument, the same injection
// `tests/unit/bma-probe.test.mjs` uses for the network, and the two subprocess tests run the
// script without `--yes`, which is the path that spends nothing.
//
// Every Sinhala string below is one already in the repository — the script's own prompts — because
// inventing Sinhala to test a Sinhala gate would be testing the invention.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CASES, DEFAULT_CANDIDATES, INVOKE_TIMEOUT_MS, parseArgs, score, summaryLines, invoke,
  failureLine, gateIsGreen,
} from '../../scripts/test-sinhala.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'test-sinhala.mjs');

const caseOf = (id) => CASES.find((c) => c.id === id);
const TUTOR = caseOf('tutor-sinhala');
const ATTENDANCE = caseOf('attendance-sinhala');

/** A Sinhala string from this repository: the tutor case's own prompt. */
const SINHALA = TUTOR.prompt;

// --- the false green ----------------------------------------------------------------------------

test('task 1.1: an empty reply is never a pass, on any case', () => {
  // The confirmed defect. `invoke` returns '' for a response shape it cannot read, and the tutor
  // case has no `expect` list — so "no expected substring was missing" was vacuously true and the
  // one case that decides whether the model can WRITE Sinhala scored PASS on nothing at all.
  for (const c of CASES) {
    for (const nothing of ['', '   ', '\n', undefined, null]) {
      const s = score(c, nothing);
      assert.equal(s.ok, false, `[${c.id}] scored a pass on an empty reply`);
      assert.equal(s.label, 'NO REPLY');
      assert.match(s.problems.join(' '), /empty completion is not a pass/);
    }
  }
});

test('task 1.1: an English refusal to the tutor case is not evidence of Sinhala', () => {
  // A refusal, a throttle message pasted into the reply, or a reply in the wrong language all
  // satisfy every other rule this case has: there is nothing to be missing and nothing leaks.
  for (const reply of [
    'I cannot help with that.',
    'Sorry, I am unable to assist with homework.',
    'The first step is to subtract 5 from both sides.',
  ]) {
    const s = score(TUTOR, reply);
    assert.equal(s.ok, false, `scored a pass on a reply with no Sinhala in it: ${reply}`);
    assert.match(s.problems.join(' '), /no Sinhala characters/);
  }
});

test('task 1.1: a Sinhala reply passes, and the same reply leaking the answer does not', () => {
  const good = score(TUTOR, SINHALA);
  assert.equal(good.ok, true, 'a Sinhala reply that keeps the answer back is the pass this case is for');
  assert.equal(good.label, 'PASS');

  const leaky = score(TUTOR, `${SINHALA} x = 6`);
  assert.equal(leaky.ok, false);
  assert.deepEqual(leaky.leaked, ['x = 6', '= 6']);
});

test('task 1.1: a case that asserts nothing automatically can never report a pass', () => {
  // The guard rather than the fix: the defect above arrived by adding a case and leaving its
  // `expect` list empty, so an assertion-free case has to be LOOK by construction.
  const s = score({ id: 'invented', expect: [] }, 'anything at all');
  assert.equal(s.ok, false);
  assert.match(s.problems.join(' '), /asserts nothing automatically/);

  // And every real case does carry one, so none of them relies on this fallback.
  for (const c of CASES) {
    assert.ok(c.expect?.length || c.expectScript, `[${c.id}] has no automatic assertion`);
  }
});

test('task 1.1: the substring rules still work, and are case-insensitive as before', () => {
  const reply = '{"intent":"ATTENDANCE","students":["Kasun","Dilmi"],"when":"yesterday","status":"ABSENT"}';
  assert.equal(score(ATTENDANCE, reply).ok, true);

  const half = '{"intent":"attendance","students":["Kasun"],"status":"absent"}';
  assert.deepEqual(score(ATTENDANCE, half).missing, ['ilmi']);
  assert.equal(score(ATTENDANCE, half).ok, false);
});

// --- a call that never landed is not a failed case ------------------------------------------------

test('task 1.1: a model whose calls all failed prints NO VERDICT, not 0/5', () => {
  const text = summaryLines([{ modelId: 'amazon.nova-micro-v1:0', passed: 0, errored: 5, total: 5 }]).join('\n');

  assert.match(text, /NO VERDICT/);
  assert.match(text, /says nothing about its Sinhala/);
  // "0/5" on its own line reads as "this model cannot do Sinhala" — the same lie in the other
  // direction, and it costs the same decision.
  assert.match(text, /5 calls never answered/);
  assert.match(text, /NO CANDIDATE PASSED EVERY CASE/);
  assert.equal(gateIsGreen([{ modelId: 'm', passed: 0, errored: 5, total: 5 }]), false);
});

test('task 1.1: a partly-answered model says how much of it actually ran', () => {
  const text = summaryLines([{ modelId: 'amazon.nova-lite-v1:0', passed: 4, errored: 1, total: 5 }]).join('\n');
  assert.match(text, /4\/5 passed/);
  assert.match(text, /PARTIAL — 4 of 5 cases actually ran/);
  assert.match(text, /the other 1 have no verdict/);
  // 4 passes out of 4 that ran is not a green gate: the fifth is unknown.
  assert.equal(gateIsGreen([{ modelId: 'm', passed: 4, errored: 1, total: 5 }]), false);
});

test('task 1.1: a clean sweep is the only green, and it names the candidate', () => {
  const summary = [
    { modelId: 'amazon.nova-micro-v1:0', passed: 3, errored: 0, total: 5 },
    { modelId: 'amazon.nova-lite-v1:0', passed: 5, errored: 0, total: 5 },
  ];
  const text = summaryLines(summary).join('\n');
  assert.match(text, /Cleanest candidate: amazon\.nova-lite-v1:0/);
  assert.doesNotMatch(text, /NO CANDIDATE/);
  assert.equal(gateIsGreen(summary), true);
  // The closing instruction stays: a PASS is necessary, not sufficient.
  assert.match(text, /A PASS is necessary, not sufficient/);
  assert.match(text, /docs\/BUILD-LOG\.md/);
});

test('task 1.1: a failed call is named in one line, and a hang is named as a hang', () => {
  assert.match(failureLine(new Error('AccessDeniedException: no model access\n  at …')),
    /^AccessDeniedException: no model access$/);
  assert.match(failureLine(Object.assign(new Error('spawnSync aws ENOENT'), { code: 'ENOENT' })), /ENOENT/);
  assert.match(failureLine(Object.assign(new Error(''), { killed: true })),
    new RegExp(`no answer in ${INVOKE_TIMEOUT_MS} ms`));
});

// --- the call itself ------------------------------------------------------------------------------

test('task 1.1: every call carries a deadline, so a hung CLI cannot stall a paid run', () => {
  let options;
  const run = (_file, argv, opts) => {
    options = opts;
    writeFileSync(argv[argv.length - 1], JSON.stringify({ output: { message: { content: [{ text: 'ok' }] } } }));
  };

  assert.equal(invoke('amazon.nova-micro-v1:0', 'hello', run), 'ok');
  assert.equal(options.timeout, INVOKE_TIMEOUT_MS, 'the timeout has to reach the CLI, or nothing ends the wait');
  assert.ok(INVOKE_TIMEOUT_MS > 0 && INVOKE_TIMEOUT_MS <= 120_000, 'a wait a person at the keyboard will sit through');
});

test('task 1.1: the prompt reaches the CLI as UTF-8 Sinhala, through a file rather than argv', () => {
  let sent;
  const run = (file, argv) => {
    assert.equal(file, 'aws');
    const body = argv[argv.indexOf('--body') + 1];
    assert.match(body, /^fileb:\/\//, 'raw bytes from a file: a Sinhala argv would be at the mercy of the console codepage');
    sent = JSON.parse(readFileSync(body.replace('fileb://', ''), 'utf8'));
    writeFileSync(argv[argv.length - 1], JSON.stringify({ output: { message: { content: [{ text: SINHALA }] } } }));
  };

  const reply = invoke('amazon.nova-micro-v1:0', ATTENDANCE.prompt, run);
  assert.equal(sent.messages[0].content[0].text, ATTENDANCE.prompt, 'the Sinhala prompt was mangled on the way out');
  assert.equal(reply, SINHALA, 'the Sinhala reply was mangled on the way back');
  assert.ok(!reply.includes('�'));
});

test('task 1.1: an answer left by an earlier call is never scored as this one', () => {
  // The two file names are reused for every case of every model. A call that exits 0 without
  // writing — and `aws` has more than one way to do that — would otherwise be scored against the
  // previous model's reply: a PASS for a case that was never answered.
  const out = join(tmpdir(), 'panthiya-sinhala', 'out.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ output: { message: { content: [{ text: SINHALA }] } } }));

  try {
    assert.throws(() => invoke('amazon.nova-micro-v1:0', 'hello', () => {}),
      /ENOENT/, 'a call that wrote nothing must fail, not inherit the last reply');
    assert.ok(!existsSync(out), 'the stale answer should be gone before the call, not after');
  } finally {
    rmSync(dirname(out), { recursive: true, force: true });
  }
});

// --- the flags and the dry run --------------------------------------------------------------------

test('task 1.1: nothing is spent without --yes, and --model needs a model', () => {
  assert.deepEqual(parseArgs([]), { yes: false, only: null });
  assert.deepEqual(parseArgs(['--yes']), { yes: true, only: null });
  assert.deepEqual(parseArgs(['--model', 'amazon.nova-lite-v1:0']), { yes: false, only: 'amazon.nova-lite-v1:0' });

  // `--model` with nothing after it used to become `--model undefined`: five confusing CALL
  // FAILED lines and then a crash in the summary. It is a usage error and is said as one.
  assert.throws(() => parseArgs(['--model']), /--model needs a model id/);
  assert.throws(() => parseArgs(['--model', '--yes']), /--model needs a model id/);
});

test('task 1.1: the dry run prints the real prompts and calls nothing', () => {
  // Faithful on what is sent and what it costs; it does NOT prove the call works, which is why
  // the owner still runs this by hand with --yes.
  const out = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });

  assert.match(out, /Re-run with --yes to proceed/);
  for (const c of CASES) {
    assert.ok(out.includes(c.prompt), `[${c.id}] the prompt a paid run would send is not shown`);
  }
  assert.ok(!out.includes('�'), 'Sinhala must survive the pipe this is read through');
  for (const m of DEFAULT_CANDIDATES) assert.ok(out.includes(m));
});

test('task 1.1: a usage error exits non-zero with words rather than a stack trace', () => {
  try {
    execFileSync(process.execPath, [SCRIPT, '--model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('an unusable argument should not exit 0');
  } catch (err) {
    assert.equal(err.status, 2);
    assert.match(err.stderr, /test-sinhala: --model needs a model id/);
    assert.doesNotMatch(err.stderr, /at \w+ \(/, 'a stack trace where a verdict should be');
  }
});
