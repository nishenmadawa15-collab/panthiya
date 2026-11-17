// Offline checks for the student tutor page (task 4.6). No AWS, no network, no dependencies — so
// the run-unit-tests Kiro hook can run this on every save for free.
//
// tests/unit/frontend.test.mjs already guards the rules every page shares (one key set across the
// three packs, no inline script or style, no innerHTML, contrast, no .mjs under assets/). This
// file guards what is specific to this screen, and it is one thing above all: the two kinds of
// text in a tutor reply must not be drawn the same way. A worked example that looks like a hint is
// the answer handed over in a box labelled "hint" — the failure requirement 8.3 exists to stop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { splitReply } from '../../frontend/assets/student.js';
import { splitExamples, runChecks } from '../../backend/functions/policy-check/checks.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const HTML = read('frontend/student/index.html');
const JS = read('frontend/assets/student.js');
const CSS = read('frontend/assets/styles.css');

const LANGS = ['si', 'ta', 'en'];
const packs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(`frontend/i18n/${l}.json`))]));

const kinds = (reply) => splitReply(reply).map((s) => s.kind);

/* --- the [[EXAMPLE]] contract (requirement 8.2, design §7.2) ---------------------------------- */

test('req 8.2 — an [[EXAMPLE]] span becomes an example card and the text around it becomes hints', () => {
  const segments = splitReply(
    'Get the unknown by itself one step at a time.\n\n'
    + 'Which step leaves only the unknown on the left?\n\n'
    + '[[EXAMPLE]] Solve 3y + 4 = 19. Taking 4 from both sides leaves 3y = 15, so y = 5. [[/EXAMPLE]]\n\n'
    + 'Use the same two steps on your own equation.',
  );

  assert.deepEqual(segments.map((s) => s.kind), ['hint', 'hint', 'example', 'hint']);

  // Two card kinds, and the answer-shaped text is in the example one — not in a hint.
  const example = segments.find((s) => s.kind === 'example');
  assert.ok(example.lines.join(' ').includes('y = 5'));
  for (const hint of segments.filter((s) => s.kind === 'hint')) {
    assert.ok(!hint.lines.join(' ').includes('y = 5'), 'answer-shaped text leaked into a hint card');
  }
});

test('req 8.2 — a reply with no example at all is all hint cards, and that is legal', () => {
  // policyCheck discards answer-shaped text that arrives without both delimiters, so a perfectly
  // good reply can carry no example. The page must not go blank waiting for one.
  assert.deepEqual(kinds('Start by taking the same constant from both sides.'), ['hint']);
  assert.deepEqual(kinds(''), []);
});

test('req 8.2 — an unclosed [[EXAMPLE]] stays a hint, exactly as policyCheck treats it', () => {
  // A half-written wrapper must not become a way into the card that says "this is not your
  // problem". splitExamples() in policy-check/checks.mjs leaves it outside for the same reason.
  const half = 'Think about the next step. [[EXAMPLE]] the answer is 6';
  assert.deepEqual(kinds(half), ['hint']);
  assert.equal(splitExamples(half).examples.length, 0);
});

test('the page splitter and the policyCheck splitter agree on every reply shape', () => {
  // They are two sides of one contract: that file decides what is allowed to arrive, this one
  // decides how it is drawn. If they ever disagree, the page either leaks an answer or renders a
  // safe reply as if it were blocked.
  const replies = [
    'hint only',
    '[[EXAMPLE]] a different problem [[/EXAMPLE]]',
    'hint\n\n[[EXAMPLE]] one [[/EXAMPLE]]\n\nhint\n\n[[EXAMPLE]] two [[/EXAMPLE]]',
    '[[example]] lower case delimiters still count [[/example]]',
    '[[EXAMPLE]] unclosed',
    '[[/EXAMPLE]] closing only',
    '[[EXAMPLE]][[/EXAMPLE]]',
  ];
  for (const reply of replies) {
    assert.equal(
      kinds(reply).filter((k) => k === 'example').length,
      splitExamples(reply).examples.filter((e) => e.trim() !== '').length,
      `example count differs for: ${reply}`,
    );
  }
});

test('req 12.7 — a segment is plain lines of text, never markup', () => {
  // The splitter is the one place model text is reshaped, so it is the one place that could turn
  // it into something a renderer might treat as HTML. It returns strings and nothing else.
  for (const segment of splitReply('a <b>tag</b> and a line\nbreak\n\n[[EXAMPLE]] x [[/EXAMPLE]]')) {
    assert.ok(Array.isArray(segment.lines));
    for (const line of segment.lines) assert.equal(typeof line, 'string');
  }
  assert.deepEqual(splitReply('a <b>tag</b>')[0].lines, ['a <b>tag</b>']);
});

test('the demo reply is one policyCheck would really allow, in all three languages', () => {
  // The demo is the only thing anybody will see on stage, and a demo reply that layer 3 would
  // block renders as a refusal — the page then looks broken rather than safe. Assembled the same
  // way mockReply() assembles it in student.js, which is also where the delimiters live.
  for (const lang of LANGS) {
    const pack = packs[lang];
    const reply = [
      pack['student.mock_hint'],
      `[[EXAMPLE]] ${pack['student.mock_example']} [[/EXAMPLE]]`,
      pack['student.mock_transfer'],
    ].join('\n\n');

    const verdict = runChecks({
      role: 'student',
      userMessage: pack['student.prompt.maths'],
      agentReply: reply,
    });
    assert.equal(verdict.verdict, 'allow', `${lang} demo reply is blocked by ${verdict.reason}`);

    // And it is only allowed because the answer-shaped part sits inside the wrapper.
    assert.equal(splitReply(reply).filter((s) => s.kind === 'example').length, 1);
  }
});

/* --- the two cards are drawn differently (requirement 12.5, product.md rule on the tutor) ----- */

/** The declarations inside one top-level rule, e.g. body of `.student-hint { … }`. */
function rule(selector) {
  const match = CSS.match(new RegExp(`\\n${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} is not defined in styles.css`);
  return match[1];
}

test('a hint card and an example card are visibly different, in more than one way', () => {
  const hint = rule('.student-hint');
  const example = rule('.student-example');

  // Container: the example is framed on all four sides; the hint has a left rule only.
  assert.match(hint, /border-left:/);
  assert.ok(!/\bborder:/.test(hint), '.student-hint should not be fully framed');
  assert.match(example, /\bborder:\s*2px dashed/);

  // Background: white against --paper-edge.
  assert.match(hint, /background:\s*#fff/i);
  assert.match(example, /background:\s*var\(--paper-edge\)/);
});

test('the example card says in words that it is a different problem', () => {
  // The visual difference is the one a student reading aloud, in greyscale or through a screen
  // reader does not get. These two strings are the ones that always survive.
  assert.match(JS, /student\.example\.label/);
  assert.match(JS, /student\.example\.note/);
  for (const lang of LANGS) {
    for (const key of ['student.example.label', 'student.example.note']) {
      assert.ok(packs[lang][key].trim().length > 0, `${key} is empty in ${lang}.json`);
    }
  }
});

/* --- i18n (requirement 12.2) ------------------------------------------------------------------ */

/** Every pack key the page references: data-i18n attributes plus student.* literals in the script. */
function referencedKeys() {
  const keys = new Set();
  for (const m of HTML.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) keys.add(m[1]);
  // Status keys and the title key are plain string literals, not t() arguments, so match the
  // namespace rather than the call.
  for (const m of JS.matchAll(/'(student\.[A-Za-z0-9_.]+)'/g)) keys.add(m[1]);
  return [...keys];
}

test('req 12.2 — every key the student page references exists in si, ta and en', () => {
  const keys = referencedKeys();
  assert.ok(keys.length > 15, 'the page should reference more than a handful of keys');
  for (const key of keys) {
    for (const lang of LANGS) {
      assert.equal(typeof packs[lang][key], 'string', `student page uses "${key}", missing from ${lang}.json`);
    }
  }
});

test('req 12.2 — no student.* key is left in the packs unused', () => {
  // The other direction: a key nobody reads is a string three people were asked to translate for
  // nothing, and it hides the one that is actually missing.
  const referenced = new Set(referencedKeys());
  for (const key of Object.keys(packs.en)) {
    if (!key.startsWith('student.')) continue;
    assert.ok(referenced.has(key), `${key} is in the packs but the student page never uses it`);
  }
});

/* --- the shell rules, for this page specifically ---------------------------------------------- */

test('req 13.6 — the student page carries no inline script, style or handler', () => {
  assert.ok(!/<style[\s>]/i.test(HTML), 'inline <style>; the CSP has no style-src unsafe-inline');
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(HTML), 'inline <script>; the CSP has no script-src unsafe-inline');
  assert.ok(!/\son\w+=/i.test(HTML), 'inline event handler attribute');
  assert.match(HTML, /<script type="module" src="\/assets\/student\.js">/);
});

test('req 12.4 — the question box is labelled and the hint log is reachable by keyboard', () => {
  assert.match(HTML, /<label class="vh" for="student-input"/);
  assert.match(HTML, /id="student-input"/);
  // role="log" is not focusable by default, so scrolling the history needs an explicit stop.
  assert.match(HTML, /id="student-log"[\s\S]{0,200}tabindex="0"/);
  // The promise is the input's description, so it is read before the student types.
  assert.match(HTML, /aria-describedby="student-promise"/);
});

test('every new style rule is namespaced, so no other page can be changed by this one', () => {
  // Bounded at the *next* banner, not at the end of the file. Slicing to EOF passed on the day it
  // was written and then failed the moment the next page appended its own section — the same shape
  // as every other bug in this log: a test that was really asserting "I am last".
  const start = CSS.indexOf('STUDENT TUTOR (/student/)');
  assert.ok(start > 0, 'the student section is missing from styles.css');
  const next = CSS.indexOf('/* ====', start);
  const section = CSS.slice(start, next === -1 ? undefined : next);
  // Single-selector rules only, at any indent, so the rules inside the media queries are checked
  // too. A comma-separated list is skipped on purpose: the print block hides existing elements
  // (.crumbs, .composer) rather than defining anything new.
  const selectors = [...section.matchAll(/\n\s*(\.[A-Za-z][^{,\n]*)\{/g)].map((m) => m[1].trim());
  assert.ok(selectors.length >= 15, `only ${selectors.length} selectors found; the regex has drifted`);
  for (const selector of selectors) {
    assert.match(selector, /^\.student-/, `${selector} is not under the .student- prefix`);
  }
});
