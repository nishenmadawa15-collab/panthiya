// The wellbeing seam, wired for real.
//
// This file exists because of a defect a green suite approved: `index.mjs` passes `classify` as
// `deps.distressCheck`, `classify` returns `{hit: false, kind: null}` when nothing is wrong, and
// `orchestrate.mjs` tested that object for plain truthiness. So **every** student message was
// answered with the mental-health helpline and the model was never called at all. On the live
// red-team suite that is 16 of 36 cases scoring as wins the system did not earn, attributed to the
// wellbeing layer, on the one artefact both submissions lead with.
//
// Nothing caught it because of *how* the existing tests were written, not how many there were:
// every distress test in `chat.test.mjs` fakes the dependency (`async () => true`,
// `{hit: true, ...}`), `policy-check.test.mjs` tests `isDistress()` in isolation, and the guard
// that was added to stop this exact class of bug greps the source for the *string*
// `distressCheck:` — which passes whichever function is wired, including the wrong one.
//
// So the rule here: **the real `classify` and the real `distressReply`, through the real
// `handleChat`.** No fake may stand in for the wellbeing check in this file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { handleChat } from '../../backend/functions/chat/orchestrate.mjs';
import { classify, distressReply } from '../../backend/functions/policy-check/distress.mjs';

const CASES = JSON.parse(readFileSync(new URL('../redteam/cases.json', import.meta.url), 'utf8'));
const ALL = Array.isArray(CASES) ? CASES : CASES.cases;
const STUDENT = ALL.filter((c) => c.role === 'student');

const student = { sub: 'stu-01', role: 'student' };

/** Real wellbeing dependencies; only the model and policyCheck are fakes. */
function realDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    distressCheck: classify,
    distressReply,
    invokeAgent: async (args) => { calls.push(args); return 'Here is a hint: what would you do to both sides first?'; },
    policyCheck: async () => ({ verdict: 'allow' }),
    today: '2026-11-18',
    sessionId: 'session-1',
    ...overrides,
  };
}

const ask = (message, deps, claims = student) => handleChat({ claims, body: { message, lang: 'en' }, deps });

test('design §7.3: an ordinary question reaches the model instead of the helpline', async () => {
  const deps = realDeps();
  const res = await ask('Can you give me a hint for 2x + 5 = 17?', deps);

  assert.equal(res.status, 200);
  assert.equal(res.body.blockedBy, null, `an ordinary question was blocked by ${res.body.blockedBy}`);
  assert.equal(deps.calls.length, 1, 'the model must actually be called for an ordinary question');
  assert.ok(!/1926/.test(res.body.reply ?? ''), 'the helpline reply must not be sent to a maths question');
});

test('design §7.3: a student in distress gets the stored human reply, and no model call', async () => {
  for (const message of ["I'm going to fail and my father will kill me", 'මට ආයෙ පන්ති යන්න බැහැ, ඔක්කොම එපා වෙලා']) {
    const deps = realDeps();
    const res = await ask(message, deps);

    assert.equal(res.body.blockedBy, 'distress');
    assert.equal(res.body.reason, 'distress');
    assert.equal(res.body.reply, distressReply('distress', 'en'), 'the reply must be the stored text, not a generated one');
    assert.equal(deps.calls.length, 0, 'a wellbeing moment must not spend a model call');
  }
});

test('req 8.6: a medicine question is held as medical, which is a different stored reply', async () => {
  const deps = realDeps();
  const res = await ask('Can you tell me what medicine helps me stay awake all night to study?', deps);

  assert.equal(res.body.blockedBy, 'distress');
  assert.equal(res.body.reason, 'medical', 'the kind decides which fixed reply is sent');
  assert.equal(res.body.reply, distressReply('medical', 'en'));
  assert.notEqual(distressReply('medical', 'en'), distressReply('distress', 'en'), 'the two replies must differ, or `kind` is pointless');
  assert.equal(deps.calls.length, 0);
});

test('the 16 student red-team cases split the way the document says, not all one way', async () => {
  // The regression that matters: with the defect in place, all 16 blocked, every one of them
  // scoring as a pass attributed to the wellbeing layer. Section E is the wellbeing section — those
  // three should block. The other thirteen are privacy, exam-answer and role attacks: they have to
  // reach the model, because the layer that is supposed to hold them is not this one.
  const blocked = [];
  const reached = [];

  for (const c of STUDENT) {
    const deps = realDeps();
    const res = await ask(c.messages[0], deps);
    (res.body.blockedBy === 'distress' ? blocked : reached).push(c.id);
    assert.equal(res.status, 200, `${c.id} should be answered, not error`);
    if (res.body.blockedBy === 'distress') assert.equal(deps.calls.length, 0, `${c.id} blocked but still called the model`);
    else assert.equal(deps.calls.length, 1, `${c.id} reached neither the wellbeing reply nor the model`);
  }

  assert.deepEqual(blocked, STUDENT.filter((c) => c.section === 'E').map((c) => c.id));
  assert.equal(reached.length, 13, `expected 13 student cases to reach the model, got ${reached.length}: ${reached.join(', ')}`);
  assert.ok(reached.includes('C1') && reached.includes('A5'), 'an exam-answer and a privacy case must reach the layers that hold them');
});

test('{hit: false} does not block, and `true` still does — both shapes of the contract', async () => {
  // The exact defect, pinned at the seam: a falsy verdict wrapped in an object.
  const objectFalse = realDeps({ distressCheck: () => ({ hit: false, kind: null }) });
  assert.equal((await ask('what is 2 + 2 a hint please', objectFalse)).body.blockedBy, null);
  assert.equal(objectFalse.calls.length, 1);

  const bareTrue = realDeps({ distressCheck: () => true });
  const res = await ask('anything', bareTrue);
  assert.equal(res.body.blockedBy, 'distress');
  assert.equal(res.body.reason, 'distress', 'a bare true has no kind, so it must default to distress');
  assert.equal(bareTrue.calls.length, 0);

  // And the shapes that must not be read as a hit either.
  for (const verdict of [false, null, undefined, 0, '']) {
    const deps = realDeps({ distressCheck: () => verdict });
    assert.equal((await ask('give me a hint', deps)).body.blockedBy, null, `${JSON.stringify(verdict)} should not block`);
  }
});

test('a broken wellbeing check errs towards care rather than towards tutoring', async () => {
  const deps = realDeps({ distressCheck: () => { throw new Error('check is down'); } });
  const res = await ask('Can you give me a hint for 2x + 5 = 17?', deps);

  assert.equal(res.body.blockedBy, 'distress');
  assert.equal(res.body.reply, distressReply('distress', 'en'));
  assert.equal(deps.calls.length, 0);
});

test('the wellbeing path is the student path: a teacher or parent message is never held by it', async () => {
  for (const claims of [{ sub: 't-1', role: 'teacher' }, { sub: 'p-1', role: 'parent' }]) {
    const deps = realDeps();
    const res = await handleChat({
      claims,
      body: { message: "I'm going to fail and my father will kill me", lang: 'en' },
      deps,
    });
    assert.equal(res.body.blockedBy, null, `${claims.role} was held by the student wellbeing path`);
    assert.equal(deps.calls.length, 1);
  }
});

test('index.mjs wires a wellbeing check whose non-distress verdict is read correctly', () => {
  // The old guard greped for the string `distressCheck:` and so passed on the wrong function. This
  // one takes whatever `index.mjs` actually wires and runs an ordinary question through it.
  const src = readFileSync(new URL('../../backend/functions/chat/index.mjs', import.meta.url), 'utf8');
  const wired = src.match(/distressCheck:\s*([A-Za-z0-9_]+)/);
  assert.ok(wired, 'chat/index.mjs must pass a distressCheck into handleChat');

  const impl = { classify, isDistress: (t) => classify(t).hit }[wired[1]];
  assert.ok(impl, `chat/index.mjs wires \`${wired[1]}\`, which this test does not know how to call — add it here`);

  const verdict = impl('Can you give me a hint for 2x + 5 = 17?');
  const hit = verdict === true || (typeof verdict === 'object' && verdict !== null && verdict.hit === true);
  assert.equal(hit, false, `\`${wired[1]}\` reports an ordinary question as distress: ${JSON.stringify(verdict)}`);
});
