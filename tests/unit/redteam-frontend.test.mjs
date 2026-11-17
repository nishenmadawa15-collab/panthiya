// Offline checks for the red-team page. No AWS, no network, no DOM, no dependencies.
//
// The page is the money shot of the demo and the thing most able to lie, so these tests pin the
// honest-rendering rules of requirement 11.4 rather than the layout. Every rule is pinned against
// hand-written runner responses — the shape backend/functions/redteam/score.mjs actually returns —
// and never against the page's own mock, which exists only so the page opens before `sam deploy`.
//
// The pure functions under test are exported from frontend/assets/redteam.js, which is importable
// in Node because it boots itself only behind `typeof document !== 'undefined'`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LAYERS, outcomeOf, scoreboardCells, byLayerSentence, warningFor,
  noTokenCases, roleTokenRows, turnOf,
} from '../../frontend/assets/redteam.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const LANGS = ['si', 'ta', 'en'];
const packs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(`frontend/i18n/${l}.json`))]));

const HTML = read('frontend/redteam/index.html');
const JS = read('frontend/assets/redteam.js');
const CSS = read('frontend/assets/styles.css');

/** The code without its comments, so a rule written *about* localStorage is not a use of it. */
const CODE = JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const allOn = Object.fromEntries(LAYERS.map((l) => [l, true]));

/** t() returns '' and warns when no pack is loaded, which is the case in Node. Keep the log clean. */
function quietly(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

/* --- requirement 11.4, rule 1: an error is never a block ---------------------------------------- */

test('11.4 an errored case is never rendered as blocked', () => {
  for (const verdict of ['error', 'leaked', undefined, null, 'BLOCKED', 'passed']) {
    const outcome = outcomeOf({ row: { verdict, blockedBy: null, reason: 'chat_unavailable' } });
    assert.notEqual(outcome.state, 'blocked', `verdict ${String(verdict)} rendered as blocked`);
  }

  // Only the exact string the runner uses counts as held.
  assert.equal(outcomeOf({ row: { verdict: 'blocked', blockedBy: 'guardrail', reason: 'held_by_layer' } }).state, 'blocked');
});

test('11.4 the scoreboard keeps Error in its own tile and never adds it into Blocked', () => {
  const totals = { ran: 10, blocked: 4, leaked: 1, errored: 5, needsEye: 2, byLayer: {} };
  const cells = quietly(() => scoreboardCells(totals, { total: 36 }));

  const by = Object.fromEntries(cells.map((c) => [c.kind, c]));
  assert.equal(by.blocked.text, '4', 'Blocked must be the runner’s blocked count alone');
  assert.equal(by.error.text, '5');
  assert.equal(by.leaked.text, '1');
  assert.equal(by.eye.text, '2');
  assert.notEqual(by.blocked.labelKey, by.error.labelKey);

  // No tile is the sum of two others: a reader can add them up, the page may not.
  const numbers = ['blocked', 'leaked', 'error'].map((k) => Number(by[k].text));
  assert.deepEqual(numbers, [4, 1, 5]);
});

test('11.4 a case with no verdict yet is "not run yet", not blocked', () => {
  const outcome = outcomeOf({});
  assert.equal(outcome.state, 'pending');
  assert.equal(outcome.needsEye, false);
});

/* --- requirement 11.4, rule 2: a needsEye case is marked, with the reply shown ------------------ */

test('11.4 a needsEye case is marked and opens its reply without being asked', () => {
  const row = { verdict: 'blocked', blockedBy: 'instructions', reason: 'held_by_agent_refusal', needsEye: true, layersRelied: ['instructions'] };
  const outcome = outcomeOf({ row });

  assert.equal(outcome.state, 'blocked');
  assert.equal(outcome.needsEye, true, 'needsEye must survive into the rendered outcome');
  assert.equal(outcome.openReply, true, 'the reply of a needsEye case must be shown, not hidden behind a click');

  // A leak is opened for the mirror-image reason: requirement 11.4 exists so it can be read.
  assert.equal(outcomeOf({ row: { verdict: 'leaked', blockedBy: 'policyCheck', reason: 'layer_disabled' } }).openReply, true);

  // A case held by a check needs no human reading, so it does not open itself.
  assert.equal(outcomeOf({ row: { verdict: 'blocked', blockedBy: 'guardrail', reason: 'held_by_layer', needsEye: false } }).openReply, false);
});

test('11.4 the needs-an-eye mark is words, not only a colour', () => {
  for (const lang of LANGS) {
    assert.equal(typeof packs[lang]['redteam.needs_eye'], 'string');
    assert.equal(typeof packs[lang]['redteam.needs_eye.note'], 'string');
  }
  assert.match(JS, /redteam\.needs_eye/, 'the page must render the needs-an-eye label');
});

/* --- requirement 11.6: a disabled layer always warns, and never persists ------------------------ */

test('11.6 any disabled layer produces a warning, with or without results', () => {
  assert.equal(warningFor(allOn, []), null, 'all layers on must not warn');

  for (const layer of LAYERS) {
    const layers = { ...allOn, [layer]: false };

    const beforeRun = warningFor(layers, []);
    assert.ok(beforeRun, `${layer} off produced no warning`);
    assert.deepEqual(beforeRun.off, [layer]);
    assert.deepEqual(beforeRun.alone, [{ layer, count: 0 }], 'a warning before any case has run reads zero, not nothing');

    const rows = [
      { verdict: 'leaked', blockedBy: layer, reason: 'layer_disabled', layersRelied: [layer] },
      // `wellbeing` has no toggle, so this row always has a net left whichever layer is off.
      { verdict: 'blocked', blockedBy: 'wellbeing', reason: 'held_by_layer', layersRelied: ['wellbeing'] },
    ];
    assert.deepEqual(warningFor(layers, rows).alone, [{ layer, count: 1 }]);
  }
});

test('11.6 "rests on it alone" counts only cases with no other net left', () => {
  const layers = { ...allOn, policyCheck: false };
  const rows = [
    // Also held by the guardrail, which is still on, so this one does not reach a user.
    { verdict: 'blocked', blockedBy: 'guardrail', reason: 'held_by_layer', layersRelied: ['guardrail', 'policyCheck'] },
    { verdict: 'leaked', blockedBy: 'policyCheck', reason: 'layer_disabled', layersRelied: ['policyCheck'] },
  ];
  assert.deepEqual(warningFor(layers, rows).alone, [{ layer: 'policyCheck', count: 1 }]);
});

test('11.6 the warning cannot be dismissed and cannot be scrolled away', () => {
  const block = HTML.slice(HTML.indexOf('id="redteam-warning"'), HTML.indexOf('</div>', HTML.indexOf('id="redteam-warning"')));
  assert.ok(!/<button/i.test(block), 'the warning carries a dismiss control');
  assert.match(CSS, /\.redteam-warning\s*\{[^}]*position:\s*sticky/, 'the warning must be sticky so it cannot be scrolled away');
});

test('11.6 a layer toggle cannot persist beyond the run', () => {
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(CODE),
    'redteam.js must not store the layer configuration anywhere');
  // The markup starts every run with all three layers on, whatever the last run did.
  const boxes = [...HTML.matchAll(/<input type="checkbox"[^>]*data-layer="(\w+)"[^>]*>/g)];
  assert.deepEqual(boxes.map((m) => m[1]).sort(), [...LAYERS].sort());
  for (const [tag] of boxes) assert.match(tag, /\schecked\b/, 'a layer checkbox does not start ticked');
  assert.ok(!/data-layer="wellbeing"/.test(HTML), 'wellbeing has no toggle: the helpline reply is not switchable');
});

/* --- requirement 11.4, rule 4: the headline is the per-layer breakdown -------------------------- */

test('11.4 the headline sentence carries all four layer counts', () => {
  for (const lang of LANGS) {
    for (const key of ['redteam.score.by_layer', 'redteam.score.by_layer_withdrawn']) {
      const template = packs[lang][key];
      for (const slot of ['{instructions}', '{guardrail}', '{policyCheck}', '{wellbeing}']) {
        assert.ok(template.includes(slot), `${lang}.${key} is missing ${slot}`);
      }
    }
  }
  // Missing totals must not throw on a page that has not run yet.
  assert.equal(typeof quietly(() => byLayerSentence(null)), 'string');
});

test('11.4 the headline stops saying "held" once a layer is switched off', () => {
  // `totals.byLayer` keeps counting a case against the layer that stopped it even after that
  // layer is withdrawn and the case is scored a leak, so the wording has to change with it.
  // No pack is loaded in Node, so t() returns '' either way: the choice of key is what is
  // checked here, and the wording of the two keys is checked against the packs below.
  assert.match(CODE, /anyOff \? 'redteam\.score\.by_layer_withdrawn' : 'redteam\.score\.by_layer'/);
  assert.match(CODE, /byLayerSentence\(state\.totals, state\.layers\)/, 'the renderer must pass the layer configuration');

  assert.ok(packs.en['redteam.score.by_layer'].includes('held by'), 'the all-on headline may say held');
  assert.ok(packs.en['redteam.score.by_layer_withdrawn'].includes('not as held'),
    'the withdrawn-layer headline must say those cases were not held');
});

/* --- requirement 11.4, rule 5: reply text never leaves the browser ----------------------------- */

test('11.4 a posted turn carries a reply length and never the reply text', () => {
  const turn = turnOf(200, { reply: 'hello', blockedBy: null, reason: null });
  assert.deepEqual(Object.keys(turn).sort(), ['blockedBy', 'reason', 'replyLength', 'status']);
  assert.equal(turn.replyLength, 5);

  // The same shape scripts/redteam-cli.mjs builds, so the two tools cannot disagree about a
  // verdict: a missing reply is a null length, not a zero, and an unrecognised blockedBy is null.
  assert.deepEqual(turnOf(401, { reason: 'no_token_for_role' }),
    { status: 401, blockedBy: null, reason: 'no_token_for_role', replyLength: null });
  assert.equal(turnOf(200, { blockedBy: 7 }).blockedBy, null);

  // Nothing in the request body may name the reply itself.
  const posted = CODE.slice(CODE.indexOf('return postRun('), CODE.indexOf('async function run('));
  assert.ok(!/reply\b/.test(posted), 'the /redteam/run body must not mention the reply');
});

/* --- requirement 1.3: a case runs under its own role, or not at all ---------------------------- */

test('1.3 a case whose role has no token is not re-roled', () => {
  const cases = [
    { id: 'A1', role: 'parent', messages: ['x'] },
    { id: 'C1', role: 'student', messages: ['x'] },
    { id: 'D1', role: 'teacher', messages: ['x'] },
  ];
  const tokens = { teacher: 'tok', parent: null, student: undefined };

  assert.deepEqual([...noTokenCases(cases, tokens)], ['A1', 'C1']);
  assert.deepEqual(roleTokenRows(cases, tokens), [
    { role: 'teacher', present: true, count: 1 },
    { role: 'parent', present: false, count: 1 },
    { role: 'student', present: false, count: 1 },
  ]);

  // The role posted to the runner is always the case's own role, never the signed-in one.
  assert.match(CODE, /sessionRole:\s*testCase\.role/);

  // And a case with no token is reported with the reason a teacher can act on.
  assert.equal(outcomeOf({ row: { verdict: 'error', reason: 'chat_unauthenticated' }, noToken: true }).reasonKey,
    'redteam.reason.no_token');
});

/* --- requirement 11.2: one suite, not two ------------------------------------------------------ */

test('11.2 the copy the page fetches is identical to the generated suite', () => {
  const generated = read('tests/redteam/cases.json');
  const served = read('frontend/redteam/cases.json');
  assert.equal(served, generated,
    'frontend/redteam/cases.json has drifted: re-copy it from tests/redteam/cases.json');

  const suite = JSON.parse(served);
  assert.equal(suite.count, 36);
  assert.equal(suite.cases.length, 36);
});

/* --- requirement 12.2: every string the page uses lives in all three packs --------------------- */

test('12.2 every pack key the page names exists in si, ta and en', () => {
  const fromJs = [...CODE.matchAll(/'(redteam(?:\.[a-z_]+)+)'/gi)].map((m) => m[1]);
  const fromHtml = [...HTML.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  const keys = [...new Set([...fromJs, ...fromHtml])];

  assert.ok(keys.length > 40, `expected the page to use many keys, found ${keys.length}`);
  for (const key of keys) {
    for (const lang of LANGS) {
      assert.equal(typeof packs[lang][key], 'string', `${key} is missing from ${lang}.json`);
    }
  }
});

test('12.2 the page carries no literal UI text in its markup', () => {
  // Every element that holds text either has a data-i18n key or is filled by redteam.js.
  const headings = [...HTML.matchAll(/<(h[1-4]|legend|th)\b[^>]*>([^<]*)</g)];
  for (const [, tag, text] of headings) {
    assert.equal(text.trim(), '', `<${tag}> carries literal text; it must come from a pack key`);
  }
});

/* --- requirement 13.6: the strict CSP holds ---------------------------------------------------- */

test('13.6 the page has no inline script, style or event handler', () => {
  assert.ok(!/<style[\s>]/i.test(HTML), 'inline <style>: style-src forbids unsafe-inline');
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(HTML), 'inline <script>: script-src forbids unsafe-inline');
  assert.ok(!/\son\w+=/i.test(HTML), 'inline event handler attribute');
  assert.match(HTML, /src="\/assets\/redteam\.js"/, 'the page must load its module from /assets');
  assert.ok(!/\.mjs"/.test(HTML), 'a .mjs module may be served as text/plain and never run');
});

/* --- requirement 12.7: text reaches the DOM as text ------------------------------------------- */

test('12.7 the page writes no HTML', () => {
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(CODE),
    'requirement 12.7 allows textContent only');
});

/* --- requirement 12.4/12.6: keyboard and mobile ------------------------------------------------ */

test('12.4 the sideways-scrolling table is reachable from the keyboard', () => {
  assert.match(HTML, /class="redteam-scroll"[^>]*tabindex="0"/);
  assert.match(HTML, /aria-labelledby="table-heading"/);
  // Every header cell is scoped, so a screen reader can read a verdict against its case.
  assert.equal([...HTML.matchAll(/<th scope="col"/g)].length, 6);
});
