// Every function that resolves a TEACHER's scope queries `classes.byTeacher` first
// (`backend/lib/auth.mjs#resolveScope`). On the first live call, 2026-11-20, ReadFunction's role
// could query every table except `classes`, so every teacher read returned 500 with
// AccessDeniedException -- while parent reads, which start from `students.byParent`, worked.
// Offline tests fake DynamoDB, so only the template can say this.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TEMPLATE = readFileSync(new URL('../../backend/template.yaml', import.meta.url), 'utf8');

/** The text of one top-level resource block. */
const block = (name) => {
  const start = TEMPLATE.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `${name} is not in the template`);
  const rest = TEMPLATE.slice(start + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z0-9]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

test('every function that serves a teacher can query classes.byTeacher', () => {
  for (const fn of ['ReadFunction', 'ActionsTeacherFunction']) {
    const b = block(fn);
    assert.ok(b.includes('!GetAtt ClassesTable.Arn'), `${fn} cannot read the classes table`);
    assert.ok(b.includes('${ClassesTable.Arn}/index/byTeacher'),
      `${fn} cannot query classes.byTeacher, so every teacher call it serves is a 500`);
  }
});
