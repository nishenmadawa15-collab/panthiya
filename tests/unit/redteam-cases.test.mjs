// docs/RED-TEAM-CASES.md is what a judge reads. tests/redteam/cases.json is what actually runs.
// If those two ever disagree, the scoreboard on stage is measuring something other than what the
// document claims — which would be worse than having no scoreboard at all.
//
// These tests keep them honest, and check that the suite still carries the evasion techniques the
// whole design is built to defeat.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
const suite = JSON.parse(readFileSync(new URL('tests/redteam/cases.json', ROOT), 'utf8'));

const EXPECTED = {
  A: 8, B: 8, C: 10, D: 6, E: 3, F: 1,
};

test('cases.json is in sync with RED-TEAM-CASES.md', () => {
  // The generator re-parses the document and compares byte for byte, so a reworded attack or a
  // new case fails here until someone regenerates.
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('scripts/gen-redteam-cases.mjs', ROOT)), '--check'],
      { cwd: fileURLToPath(ROOT), encoding: 'utf8' });
  } catch (err) {
    assert.fail(`${err.stderr?.trim() || err.message}`);
  }
});

test('all 36 documented cases are present, with the right split per section', () => {
  assert.equal(suite.count, 36);
  assert.equal(suite.cases.length, 36);

  const bySection = {};
  for (const c of suite.cases) bySection[c.section] = (bySection[c.section] ?? 0) + 1;
  assert.deepEqual(bySection, EXPECTED);

  const ids = suite.cases.map((c) => c.id);
  assert.equal(new Set(ids).size, 36, 'case IDs must be unique');
});

test('every case is runnable and judgeable', () => {
  for (const c of suite.cases) {
    assert.ok(['teacher', 'parent', 'student'].includes(c.role), `${c.id} has role "${c.role}"`);
    assert.ok(Array.isArray(c.messages) && c.messages.length > 0, `${c.id} has nothing to send`);
    for (const m of c.messages) {
      assert.equal(typeof m, 'string', `${c.id} has a non-string message`);
      assert.ok(m.trim().length > 0, `${c.id} has an empty message`);
    }
    assert.ok(c.passLooksLike?.trim(), `${c.id} has no pass condition to judge against`);
    assert.ok(c.rules.length > 0, `${c.id} is not tied to a product rule`);
  }
});

test('the suite still carries every evasion technique the design claims to defeat', () => {
  const all = suite.cases.flatMap((c) => c.messages).join('\n');

  assert.ok(/[඀-෿]/.test(all), 'no Sinhala attack left in the suite');
  assert.ok(/[஀-௿]/.test(all), 'no Tamil attack left in the suite');
  assert.ok(/[Ѐ-ӿ]/.test(all), 'no Cyrillic homoglyph attack left in the suite');

  // Singlish: Latin script, but a Sinhala word. "Dilmi-ge", "eka kiyanna".
  assert.ok(suite.cases.some((c) => c.messages.some((m) => /kiyanna|-ge\b|eka\b/i.test(m))),
    'no Singlish attack left in the suite');

  // At least one base64-encoded payload that decodes to readable text.
  const encoded = suite.cases.find((c) => c.note?.includes('base64'));
  assert.ok(encoded, 'no base64 attack left in the suite');
  const decoded = Buffer.from(encoded.messages[0], 'base64').toString('utf8');
  assert.match(decoded, /paid/i, 'the base64 case no longer decodes to a fee-write attempt');

  // At least one multi-message attack, which is the whole point of cases B7 and C6.
  assert.ok(suite.cases.some((c) => c.messages.length > 1), 'no multi-message attack left in the suite');
});

test('each role carries enough cases to be worth testing', () => {
  const byRole = {};
  for (const c of suite.cases) byRole[c.role] = (byRole[c.role] ?? 0) + 1;

  assert.ok(byRole.parent >= 10, `only ${byRole.parent} parent cases`);
  assert.ok(byRole.student >= 10, `only ${byRole.student} student cases`);
  assert.ok(byRole.teacher >= 2, `only ${byRole.teacher} teacher cases`);
  assert.equal(byRole.parent + byRole.student + byRole.teacher, 36);
});

test('the generated file is marked generated, so nobody hand-edits it', () => {
  assert.match(suite.$comment, /GENERATED/);
  assert.match(suite.$comment, /gen-redteam-cases\.mjs/);
  assert.equal(suite.source, 'docs/RED-TEAM-CASES.md');
});
