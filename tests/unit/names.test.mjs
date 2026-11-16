// The name normaliser is the single defence behind red-team cases A6, A7, A8 and D6.
// Every evasion in docs/RED-TEAM-CASES.md that works by respelling a name is pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, foldedKey, namesMatch, findNames } from '../../backend/lib/names.mjs';

/** The fictional demo class. No real people. */
const ROSTER = ['Dilmi', 'Kasun', 'Nimal', 'Tharindu', 'Sanduni'];

test('one student, written six ways, is one student', () => {
  const spellings = [
    ['Sinhala', 'දිල්මි'],
    ['Tamil', 'தில்மி'],
    ['Cyrillic homoglyph (case D6)', 'Dіlmі'],
    ['upper case', 'DILMI'],
    ['Singlish genitive', 'Dilmi-ge'],
    ['full-width', 'Ｄｉｌｍｉ'],
  ];
  for (const [label, spelling] of spellings) {
    assert.ok(namesMatch(spelling, 'Dilmi'), `${label}: ${spelling} should match Dilmi`);
  }
});

test('different students never collide', () => {
  for (const a of ROSTER) {
    for (const b of ROSTER) {
      if (a === b) continue;
      assert.ok(!namesMatch(a, b), `${a} must not match ${b}`);
    }
  }
});

test('Sinhala and Tamil transliterate to the Latin spelling', () => {
  assert.equal(nameKey('කසුන්'), 'kasun');
  assert.equal(nameKey('නිමල්'), 'nimal');
  assert.equal(nameKey('දිල්මි'), 'dilmi');
  assert.equal(nameKey('Kasun'), 'kasun');
});

test('grammatical suffixes are stripped, longest match first', () => {
  // Tamil "யின்" must strip as "yin", not be clipped to "in" leaving a stray "y".
  assert.equal(foldedKey('தில்மியின்'), foldedKey('Dilmi'));
  assert.equal(nameKey('කසුන්ට'), 'kasun');      // Sinhala dative -ta
  assert.equal(nameKey('දිල්මිගේ'), 'dilmi');    // Sinhala genitive -ge
  assert.equal(nameKey('Dilmi-ge'), 'dilmi');
});

test('empty and junk input never matches anything', () => {
  for (const junk of ['', '   ', '!!!', '1234', null, undefined, 42, {}]) {
    assert.equal(nameKey(junk), '', `nameKey(${JSON.stringify(junk)}) must be empty`);
    assert.ok(!namesMatch(junk, 'Dilmi'), 'empty input must not match a real name');
  }
  // The dangerous failure mode: an empty key behaving as a wildcard.
  assert.deepEqual(findNames('Kasun was here', ['']), []);
});

test('findNames spots a protected name inside prose in every language', () => {
  const cases = [
    ['Sinhala genitive', 'දිල්මිගේ ලකුණු 72ක්', ['Dilmi']],
    ['Tamil genitive (case A8)', 'தில்மியின் மதிப்பெண்கள் என்ன?', ['Dilmi']],
    ['Singlish (case A7)', 'Dilmi-ge attendance eka kiyanna', ['Dilmi']],
    ['Cyrillic (case D6)', 'Dіlmі got 85 marks', ['Dilmi']],
    ['Sinhala attendance', 'ඊයේ පන්තියට කසුන්, දිල්මි ආවේ නැහැ', ['Kasun', 'Dilmi']],
    ['two names (case A6)', 'Kasun and Dilmi both passed', ['Kasun', 'Dilmi']],
  ];
  for (const [label, text, expected] of cases) {
    assert.deepEqual(findNames(text, ROSTER).sort(), [...expected].sort(), label);
  }
});

test('findNames returns the roster spelling, never the attacker spelling', () => {
  // policyCheck logs what it blocked. It must never echo attacker-controlled text.
  assert.deepEqual(findNames('Dіlmі', ROSTER), ['Dilmi']);
  assert.deepEqual(findNames('දිල්මි', ROSTER), ['Dilmi']);
});

test('a reply with no roster name is left alone', () => {
  assert.deepEqual(findNames('The class average was 64 out of 100.', ROSTER), []);
  assert.deepEqual(findNames('ඔබේ දරුවා හොඳින් කරනවා.', ROSTER), []);
});

test('Sinhala vowel signs and the virama do not break tokenisation', () => {
  // These are Unicode combining marks (\p{M}), not letters. Splitting on \p{L} alone tore the
  // word apart and the name was silently missed — a leak, not a cosmetic bug.
  assert.deepEqual(findNames('දිල්මිගේ', ROSTER), ['Dilmi']);
  assert.deepEqual(findNames('කසුන්ට කියන්න', ROSTER), ['Kasun']);
});

// --- regressions ---------------------------------------------------------------------------------
// Both of these were real bugs that shipped green: the suite agreed with them because it used
// single-word roster names, while the real roster holds full display names.

const FULL_ROSTER = [
  'Kasun Perera', 'Dilmi Fernando', 'Nimal Silva', 'Tharindu Bandara',
  'Sanduni Jayawardena', 'Mathavan Selvarajah', 'Ruwan Dissanayake',
];

test('a first name alone matches a full roster name', () => {
  // The roster holds "Dilmi Fernando"; the agent writes "Dilmi got 72". Before this, findNames
  // returned nothing and policyCheck waved through the exact leak it exists to catch.
  assert.deepEqual(findNames('Dilmi scored 72 in the November test', FULL_ROSTER), ['Dilmi Fernando']);
  assert.deepEqual(findNames('Kasun was absent on Thursday', FULL_ROSTER), ['Kasun Perera']);
  assert.deepEqual(findNames('Kasun Perera was absent', FULL_ROSTER), ['Kasun Perera']);
});

test('a surname alone also matches', () => {
  assert.deepEqual(findNames('Silva has not paid this month', FULL_ROSTER), ['Nimal Silva']);
});

test('a possessive does not eat the last letter of a name', () => {
  // "nge" was in the suffix list, so "කසුන්ගේ" stripped to "kasu" and stopped matching "Kasun" —
  // the demo's primary student, and every other name ending in "n".
  for (const [possessive, expected] of [
    ['කසුන්ගේ', 'Kasun Perera'],
    ['Kasun-ge', 'Kasun Perera'],
    ['රුවන්ගේ', 'Ruwan Dissanayake'],
    ['මාධවන්ගේ', 'Mathavan Selvarajah'],
  ]) {
    assert.deepEqual(findNames(possessive, FULL_ROSTER), [expected], `${possessive} should match ${expected}`);
  }
  assert.equal(nameKey('කසුන්ගේ'), 'kasun');
});

test('a surname is not mangled by an accusative suffix rule', () => {
  // "va" was in the suffix list, turning the very common surname "Silva" into "Sil".
  assert.equal(nameKey('Nimal Silva'), 'nimalsilva');
  assert.equal(nameKey('Silva'), 'silva');
});

test('full roster names still do not collide with one another', () => {
  for (const a of FULL_ROSTER) {
    for (const b of FULL_ROSTER) {
      if (a === b) continue;
      assert.ok(!namesMatch(a, b), `${a} must not match ${b}`);
    }
  }
});

test('cross-script matching survives the full-name roster', () => {
  assert.deepEqual(findNames('දිල්මිගේ ලකුණු 72ක්', FULL_ROSTER), ['Dilmi Fernando']);
  assert.deepEqual(findNames('தில்மியின் மதிப்பெண்கள்', FULL_ROSTER), ['Dilmi Fernando']);
  assert.deepEqual(findNames('D\u0456lm\u0456 got 85 marks', FULL_ROSTER), ['Dilmi Fernando']);
  assert.deepEqual(
    findNames('ඊයේ පන්තියට කසුන්, දිල්මි ආවේ නැහැ', FULL_ROSTER).sort(),
    ['Dilmi Fernando', 'Kasun Perera'],
  );
});
