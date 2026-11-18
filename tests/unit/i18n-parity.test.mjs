// The runnable check behind task 6.5: the three language packs stay one pack in three languages.
// No AWS, no network, no dependencies — so the run-unit-tests Kiro hook can run this on every save
// for free.
//
// tests/unit/frontend.test.mjs guards the markup side of requirement 12.2: every data-i18n key in
// an .html file exists in si, ta and en. This file guards the two gaps that leaves:
//
//   a key the scripts read is not in the markup at all — a status line, a mock reply, a verdict
//   label — and `t()` turns a missing one into an empty string, so a gap reaches the screen as a
//   blank status or a blank verdict cell rather than as an error anyone would notice;
//
//   the three voice failure strings must stay word for word what `voice/voice.mjs` sends, because
//   the teacher reads the server's sentence when there is one and the pack's sentence when there
//   is not, and two different sentences for the same failure is the drift this test exists to stop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const LANGS = ['si', 'ta', 'en'];
const packs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(`frontend/i18n/${l}.json`))]));

/** Every script the pages load. `i18n.js` is in here too: it reads keys of its own. */
const scripts = readdirSync(new URL('frontend/assets/', ROOT))
  .filter((name) => name.endsWith('.js'))
  .map((name) => [name, read(`frontend/assets/${name}`)]);

/**
 * Comments out, code in.
 *
 * The scripts in this repo explain themselves at length, and one of those explanations writes
 * `t('redteam.verdict.' + verdict)` as the thing *not* to do. Scanning the prose would fail this
 * test on a sentence that exists to keep the code right.
 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

/** The first segment of every key in the pack: `mic`, `redteam`, `voice`, … */
const namespaces = new Set(Object.keys(packs.en).map((key) => key.split('.')[0]));

/**
 * Every pack key a script reads.
 *
 * Matched by shape rather than by `t(...)`, because a key reaches `t()` three ways here: written
 * out at the call, held in a map (`LAYER_KEY`, `MIC`), or carried on a field (`statusKey`,
 * `replyKey`). A dotted literal whose first segment is a pack namespace is a pack key in all
 * three, and nothing else in these files looks like one — an S3 key has slashes in it.
 */
function referencedKeys() {
  const found = new Map();
  for (const [name, src] of scripts) {
    for (const [, key] of code(src).matchAll(/'([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)'/g)) {
      if (namespaces.has(key.split('.')[0])) found.set(key, name);
    }
  }
  return found;
}

/** `t(`month.${n}`)` — the key is built at runtime, so only its fixed part can be checked. */
function referencedPrefixes() {
  const found = new Map();
  for (const [name, src] of scripts) {
    for (const [, prefix] of code(src).matchAll(/\bt\(\s*`([^`]*)\$\{/g)) found.set(prefix, name);
  }
  return found;
}

/* --- requirement 12.2: one pack in three languages -------------------------------------------- */

test('req 12.2 — si, ta and en have an identical key set', () => {
  const reference = Object.keys(packs.en).sort();
  assert.ok(reference.length > 200, 'en.json looks truncated');
  for (const lang of LANGS) {
    const keys = Object.keys(packs[lang]).sort();
    // Named both ways round, because "extra in si" and "missing from si" are different bugs and
    // a set difference that only reports one of them sends the reader looking in the wrong file.
    assert.deepEqual(
      keys.filter((k) => !(k in packs.en)),
      [],
      `${lang}.json has keys en.json does not`,
    );
    assert.deepEqual(
      reference.filter((k) => !(k in packs[lang])),
      [],
      `${lang}.json is missing keys en.json has`,
    );
    assert.deepEqual(keys, reference, `${lang}.json key set differs from en.json`);
  }
});

test('req 12.2 — no pack value is empty or non-text', () => {
  // An empty string is worse than a missing key: `t()` warns about the missing one and returns
  // the same blank for both, so an empty value is a gap with the warning switched off.
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(packs[lang])) {
      assert.equal(typeof value, 'string', `${lang}.json ${key} is ${typeof value}, not a string`);
      assert.ok(value.trim().length > 0, `${lang}.json ${key} is empty`);
    }
  }
});

test('req 12.2 — every key the scripts read exists in en.json', () => {
  const referenced = referencedKeys();
  assert.ok(referenced.size > 100, 'the scripts should read more than a hundred keys');
  for (const [key, file] of referenced) {
    assert.ok(key in packs.en, `assets/${file} reads "${key}", missing from en.json`);
  }
});

test('req 12.2 — a key built at runtime has a namespace that exists', () => {
  // `t(`auth.role.${role}`)` cannot be checked key by key from here, but a whole namespace
  // disappearing from the packs can be, and that is the failure that blanks a whole column.
  const prefixes = referencedPrefixes();
  assert.ok(prefixes.size > 0, 'the scripts build at least one key at runtime');
  for (const [prefix, file] of prefixes) {
    const matches = Object.keys(packs.en).filter((key) => key.startsWith(prefix));
    assert.ok(matches.length > 0, `assets/${file} builds keys from "${prefix}", which has no key in en.json`);
  }
});

/* --- requirement 3.6: the voice failure strings say the same thing on both sides -------------- */

test('req 3.6 — the voice.* keys are word for word the server FALLBACK messages', () => {
  // `voice/voice.mjs` answers a failed transcription with one of these three sentences in the
  // teacher's own language; the front end shows that sentence when it arrives and the pack's copy
  // when it does not. They are the same message, so they have to be the same words.
  const block = read('backend/functions/voice/voice.mjs').match(/const FALLBACK = \{[\s\S]*?\n\};/);
  assert.ok(block, 'the FALLBACK table was not found in voice/voice.mjs');

  const server = [...block[0].matchAll(/(\w+): \{\s*en: '([^']*)',\s*si: '([^']*)',\s*ta: '([^']*)',/g)];
  assert.equal(server.length, 3, 'expected three failure reasons in the FALLBACK table');

  for (const [, reason, en, si, ta] of server) {
    const key = `voice.${reason}`;
    assert.equal(packs.en[key], en, `${key} does not match the server's English`);
    assert.equal(packs.si[key], si, `${key} does not match the server's Sinhala`);
    assert.equal(packs.ta[key], ta, `${key} does not match the server's Tamil`);
  }
});

test('req 3.6 — every voice.* and mic.* failure string says nothing was saved', () => {
  // The one promise these strings carry, in all three languages: a teacher who is told a voice
  // note failed must not be left wondering whether half of it was recorded anyway. Each language
  // has one settled way of saying it, so the check is that wording, not a translation guess.
  const saidNothingSaved = {
    en: /Nothing was (saved|recorded)/,
    si: /කිසිවක් (සුරැකුණේ|පටිගත වූයේ) නැත/,
    ta: /எதுவும் (சேமிக்கப்படவில்லை|பதிவாகவில்லை)/,
  };
  const failureKeys = Object.keys(packs.en).filter(
    (key) => key.startsWith('voice.')
      || ['mic.unsupported', 'mic.denied', 'mic.empty', 'mic.timeout', 'mic.error'].includes(key),
  );
  assert.equal(failureKeys.length, 8, 'the voice failure strings changed; check this list');

  for (const lang of LANGS) {
    for (const key of failureKeys) {
      assert.match(packs[lang][key], saidNothingSaved[lang], `${lang}.json ${key} does not say nothing was saved`);
    }
  }
});
