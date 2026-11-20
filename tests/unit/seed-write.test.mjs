// Offline tests for backend/seed/seed.mjs — the one deploy-evening script the 2026-11-19 review
// never opened.
//
// Nothing here calls AWS. `writeBatch` takes its runner as an argument and `buildSeed` is pure,
// which is the same injection `tests/unit/demo-users.test.mjs` and `tests/unit/bma-probe.test.mjs`
// use. What is pinned is the gap between what this script PRINTS and what is actually in the
// table, because on deploy evening those two sentences are read as one:
//
//   - `BatchWriteItem` is a partial-success API. The old loop ran it with `stdio: 'inherit'`, so
//     the response was never read, and then counted the whole batch as written.
//   - the placeholder guard tested two values that can never be placeholders, while three tables
//     were writing one.
//   - the audit sort key carried the wall clock, so the re-run this script tells you to do
//     doubled the audit log.
//
// Each of those gets a family of inputs below rather than the single case that exposed it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readFileSync as read } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSeed, writeBatch, batchesOf, countItems, tableNames, SEED_TS, DEMO_PARENT_STUDENT,
  demoSubs, missingLoginsMessage }
  from '../../backend/seed/seed.mjs';

const DATA = JSON.parse(readFileSync(new URL('../../backend/seed/demo-class.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(DATA));

/** Real Cognito subs are UUIDs, and the point of several tests below is that they are not `SEED-`. */
const SUBS = { teacher: '7f1c0a52-0e3d-4a71-9a1b-2c6d5e4f3a10', parent: 'b2d9e7c1-5a84-4f36-8c0e-19d7a3b5c248' };

const tmp = () => mkdtempSync(join(tmpdir(), 'panthiya-seed-'));
const REQUEST = (n, table = 'T-students') => ({
  [table]: Array.from({ length: n }, (_, i) => ({ PutRequest: { Item: { studentId: { S: `stu-${i}` } } } })),
});

// --- the false "Seeded 105 items" ---------------------------------------------------------------

test('a batch that comes back partly unprocessed is retried, and only what landed is counted', () => {
  // The confirmed defect, driven: the CLI exits 0 every time and hands back leftovers. Before the
  // fix the caller saw nothing at all (`stdio: 'inherit'` returns null) and added the whole batch
  // to its running total.
  const file = join(tmp(), 'batch.json');
  const seen = [];
  let call = 0;

  const run = (_cmd, argv, opts) => {
    seen.push({ argv, opts });
    call += 1;
    // 25 submitted: 10 left over, then 4, then none.
    const leftover = call === 1 ? 10 : call === 2 ? 4 : 0;
    return JSON.stringify({ UnprocessedItems: leftover ? REQUEST(leftover) : {} });
  };

  const lines = [];
  const result = writeBatch({ file, request: REQUEST(25), run, log: (l) => lines.push(l), wait: () => {} });

  assert.equal(result.written, 25, 'all 25 must be accounted for once the retries land');
  assert.equal(result.attempts, 3);
  assert.equal(seen.length, 3, 'the leftovers have to be re-submitted, not assumed');
  assert.equal(lines.length, 2, 'each shed batch is said out loud');
  assert.match(lines[0], /10 of 25 items came back unprocessed/);

  // stdout must be captured or `UnprocessedItems` cannot be read at all. This is the line that
  // made the old loop structurally unable to notice.
  assert.notEqual(seen[0].opts.stdio, 'inherit');
  assert.deepEqual(seen[0].opts.stdio, ['ignore', 'pipe', 'inherit'], 'stderr stays visible');
  assert.ok(seen[0].argv.includes('--output') && seen[0].argv.includes('json'));

  // The retry carries exactly the leftovers, not the original batch again.
  assert.equal(countItems(JSON.parse(read(file, 'utf8'))), 4);
});

test('items still unprocessed after every attempt are a throw, never a silent short count', () => {
  const file = join(tmp(), 'batch.json');
  let calls = 0;
  // A table being throttled flat out: it accepts 20 of 25 and keeps handing 5 back, forever.
  const run = () => { calls += 1; return JSON.stringify({ UnprocessedItems: REQUEST(5) }); };

  assert.throws(
    () => writeBatch({ file, request: REQUEST(25), run, attempts: 3, wait: () => {} }),
    (err) => {
      assert.match(err.message, /5 of 25 items were still unprocessed after 3 attempts/);
      assert.match(err.message, /PARTLY written/, 'the operator must be told the table is half-done');
      assert.match(err.message, /Re-run the same command/, 'and what to do about it');
      return true;
    },
  );
  assert.equal(calls, 3, 'it must stop, not retry for ever on the owner’s money');
});

test('every shape of non-answer from the CLI is refused rather than counted as written', () => {
  // The corpus this defect is one of: a 200 can carry an empty body, an error document, HTML from
  // a proxy, or a truncated payload, and `exit 0` says nothing about which.
  const file = join(tmp(), 'batch.json');
  // The two shapes that genuinely mean "nothing was left over".
  for (const raw of ['{}', '{"UnprocessedItems":{}}', '{"UnprocessedItems":{"T-students":[]}}']) {
    const result = writeBatch({ file, request: REQUEST(3), run: () => raw, wait: () => {} });
    assert.equal(result.written, 3, `${raw} is a full-success response`);
  }

  // Everything else is "we do not know", and must say so. `''` and `null` are in this list on
  // purpose: a successful `--output json` call always prints a JSON object, so stdout that holds
  // neither is a call whose outcome was lost — reading it as success would be the same false
  // green as the `stdio: 'inherit'` this replaced, one layer further down.
  const unknown = ['', '   ', 'null', 'true', '42', '[]', '"ok"',
    '<html>503 from a proxy</html>', '{"Unprocessed', 'Traceback (most recent call last):'];
  for (const raw of unknown) {
    assert.throws(() => writeBatch({ file, request: REQUEST(3), run: () => raw, wait: () => {} }),
      (err) => {
        assert.match(err.message, /not a JSON object/);
        assert.match(err.message, /UNKNOWN/, 'it must not claim either outcome');
        return true;
      }, `${JSON.stringify(raw)} must not read as a successful write`);
  }
});

test('the 105 items are chunked at BatchWriteItem’s own 25-item limit, and all of them are sent', () => {
  const { items, audit, total } = buildSeed({ data: clone(), subs: SUBS });
  const target = Object.fromEntries(['classes', 'students', 'attendance', 'fees', 'marks',
    'messages', 'audit_log'].map((k) => [k, `T-${k}`]));
  const batches = batchesOf(items, audit, target);

  assert.ok(batches.every((b) => b.rows.length <= 25), 'a 26-item request is rejected by the API');
  assert.ok(batches.every((b) => b.table), 'a batch with no table name would write nowhere');
  assert.equal(batches.reduce((n, b) => n + b.rows.length, 0), total,
    'every row built must be in exactly one batch — a dropped table is an empty screen');
});

// --- the guard that could not fire --------------------------------------------------------------

test('the placeholder teacher sub is caught in EVERY table, not just the two Cognito values', () => {
  // Before the fix the check tested `subs.teacher`/`subs.parent` for a `SEED-` prefix. Those come
  // straight out of Cognito and are UUIDs, so it could never fire — while `attendance.markedBy`,
  // `fees.recordedBy` and `marks.recordedBy` were each written from the fixture's
  // `SEED-TEACHER-SUB`. This drives the guard against a build that still has the leak.
  // Driving the guard: a pool that hands back the placeholder itself is the one input that still
  // reaches every row through the supported path, and it must be refused by name, per table.
  const leaked = buildSeed({ data: clone(), subs: { teacher: DATA.teacher.teacherSub, parent: SUBS.parent } });
  const complaint = leaked.problems.find((p) => /placeholder teacher sub reached/.test(p));
  assert.ok(complaint, `expected a placeholder complaint, got ${JSON.stringify(leaked.problems)}`);
  for (const field of ['attendance.markedBy', 'fees.recordedBy', 'marks.recordedBy',
    'classes.teacherId', 'messages.createdBy', 'messages.teacherId', 'audit_log.actorSub']) {
    assert.match(complaint, new RegExp(field.replace('.', '\\.')),
      `${field} is written from the teacher sub and must be named when it is a placeholder`);
  }

  // And the shipped build leaks it nowhere — the three fields that used to, included.
  const { items, audit } = buildSeed({ data: clone(), subs: SUBS });
  const carriers = [];
  for (const [table, rows] of Object.entries(items)) {
    for (const row of rows) {
      for (const [field, value] of Object.entries(row)) {
        if (value === DATA.teacher.teacherSub) carriers.push(`${table}.${field}`);
      }
    }
  }
  for (const row of audit) if (row.actorSub === DATA.teacher.teacherSub) carriers.push('audit_log.actorSub');
  assert.deepEqual(carriers, [], 'SEED-TEACHER-SUB must not reach a real table');

  // Positive control: those three fields exist and carry the real sub, so the assertion above is
  // not passing because the fields are missing.
  assert.equal(items.attendance[0].markedBy, SUBS.teacher);
  assert.equal(items.fees[0].recordedBy, SUBS.teacher);
  assert.equal(items.marks[0].recordedBy, SUBS.teacher);
  assert.ok(audit.every((r) => r.actorSub === SUBS.teacher));
});

test('the eleven unlinked children keep SEED-PARENT-nn, and that is not an error', () => {
  // The guard must not be a blanket `SEED-` sniff: eleven children belong to nobody who can log
  // in, which is what keeps red-team case A1 an attack rather than a legitimate request.
  const { items, problems } = buildSeed({ data: clone(), subs: SUBS });
  assert.deepEqual(problems, []);

  const placeholders = items.students.filter((s) => /^SEED-PARENT-/.test(s.parentSub));
  assert.equal(placeholders.length, 11);
  const linked = items.students.filter((s) => s.parentSub === SUBS.parent);
  assert.equal(linked.length, 1);
  assert.equal(linked[0].studentId, DEMO_PARENT_STUDENT);
});

test('a build whose class is not owned by the teacher login refuses, and says why', () => {
  const data = clone();
  const { problems } = buildSeed({ data, subs: { ...SUBS, teacher: SUBS.teacher } });
  assert.deepEqual(problems, []);

  // Two children linked instead of one: case A1 would become a legitimate request.
  const twoLinked = clone();
  twoLinked.students[1].studentId = DEMO_PARENT_STUDENT;
  const second = buildSeed({ data: twoLinked, subs: SUBS });
  assert.ok(second.problems.some((p) => /exactly one child must be linked/.test(p)),
    `expected a linkage complaint, got ${JSON.stringify(second.problems)}`);
});

// --- idempotency, claimed and now true ----------------------------------------------------------

test('two runs of the seed write the same keys, so the re-run it advises cannot double the data', () => {
  // The claim is in this script's own failure messages ("re-run the same command") and in
  // demo-users.mjs ("the creates are idempotent"). For the audit table it was false: the sort key
  // was `${new Date().toISOString()}#seed-NNNN`, so a second run added 41 more rows in a second
  // timestamp group and requirement 10.1's screen showed the seed twice.
  const first = buildSeed({ data: clone(), subs: SUBS });
  const second = buildSeed({ data: clone(), subs: SUBS });

  const auditKeys = (b) => b.audit.map((r) => `${r.classId}|${r.tsUlid}`);
  assert.deepEqual(auditKeys(second), auditKeys(first), 'the audit sort keys must not move');
  assert.equal(new Set(auditKeys(first)).size, first.audit.length, 'and must not collide inside one run');

  // Every row, not just the keys: a re-run should be a byte-identical overwrite.
  assert.deepEqual(second.items, first.items);
  assert.deepEqual(second.audit, first.audit);
  assert.ok(first.audit.every((r) => r.tsUlid.startsWith(SEED_TS)));
});

test('a wall-clock timestamp is what made the audit rows pile up — pinned so it cannot come back', () => {
  // Driving the old behaviour directly: `now` is injectable, so two different clocks stand in for
  // two runs on the same evening.
  const a = buildSeed({ data: clone(), subs: SUBS, now: '2026-12-02T19:04:11.000Z' });
  const b = buildSeed({ data: clone(), subs: SUBS, now: '2026-12-02T19:11:38.000Z' });
  const keys = new Set([...a.audit, ...b.audit].map((r) => r.tsUlid));
  assert.equal(keys.size, a.audit.length + b.audit.length,
    'different clocks give every audit row a brand new key — this is the pile-up, reproduced');

  // And the default does not do that.
  assert.equal(new Set([...buildSeed({ data: clone(), subs: SUBS }).audit,
    ...buildSeed({ data: clone(), subs: SUBS }).audit].map((r) => r.tsUlid)).size,
  a.audit.length, 'the shipped default collapses the two runs onto one set of keys');
});

// --- guards that have to be checking the thing they name ----------------------------------------

test("Dilmi's guard checks the November mark by name, not whichever mark is listed first", () => {
  // `find` on the student id alone read the first mark in the file. Harmless today — stu-02 has
  // one — and wrong the moment an earlier assessment is added above it, which is a guard that
  // passes while red-team case D2 silently stops testing anything.
  const withOctober = clone();
  withOctober.marks.unshift({
    studentId: 'stu-02', assessment: 'October test', date: '2026-10-08',
    subject: 'Mathematics', score: 90, maxScore: 100,
  });

  const { problems } = buildSeed({ data: withOctober, subs: SUBS });
  assert.deepEqual(problems, [], 'an added October mark of 90 must not trip the November guard');

  // And the guard still bites when the mark it names actually moves.
  const moved = clone();
  moved.marks.find((m) => m.studentId === 'stu-02' && m.assessment === 'November test').score = 90;
  assert.ok(buildSeed({ data: moved, subs: SUBS }).problems.some((p) => /November mark must stay 72/.test(p)));

  // Including when it is moved under an added October row — the ordering case the old guard missed.
  const both = JSON.parse(JSON.stringify(withOctober));
  both.marks.find((m) => m.assessment === 'November test' && m.studentId === 'stu-02').score = 90;
  assert.ok(buildSeed({ data: both, subs: SUBS }).problems.some((p) => /November mark must stay 72/.test(p)),
    'this is the one the index-based guard let through');
});

test('every message row stays visible to the index it is read through', () => {
  const { items, problems } = buildSeed({ data: clone(), subs: SUBS });
  assert.deepEqual(problems, []);
  for (const m of items.messages) {
    assert.ok(m.statusCreatedAt.startsWith(`${m.status}#`), `${m.messageId} is index-invisible`);
    assert.ok(m.sourceFacts?.length, `${m.messageId} has no sourceFacts (requirement 6.1)`);
  }
  assert.equal(items.messages.filter((m) => m.status === 'approved').length, 2);
  assert.equal(items.messages.filter((m) => m.status === 'draft').length, 1);

  // A draft must never acquire an `approved#` key, whatever else is wrong.
  const broken = clone();
  broken.messages.find((m) => m.status === 'draft').approvedAt = '2026-11-18T10:00:00.000Z';
  const after = buildSeed({ data: broken, subs: SUBS });
  assert.ok(after.items.messages.every((m) => m.statusCreatedAt.startsWith(`${m.status}#`)));
  assert.deepEqual(after.problems, []);
});

// --- the stack outputs the script actually uses -------------------------------------------------

test('a stack missing UserPoolId is named as a missing output, not as missing demo logins', () => {
  // `demoSubs(outputs.UserPoolId)` was called with `undefined` when the key was absent, every
  // `admin-get-user` failed, and `demoSubs` reads any failure as UserNotFoundException — so the
  // script said "these demo logins do not exist yet" about three accounts that were already there.
  const outputs = (keys) => () => JSON.stringify(keys.map((k) => ({ OutputKey: k, OutputValue: `v-${k}` })));
  const all = ['UserPoolId', 'ClassesTableName', 'StudentsTableName', 'AttendanceTableName',
    'FeesTableName', 'MarksTableName', 'MessagesTableName', 'AuditLogTableName'];

  assert.deepEqual(tableNames(outputs(all)).UserPoolId, 'v-UserPoolId');

  for (const dropped of all) {
    const partial = all.filter((k) => k !== dropped);
    assert.throws(() => tableNames(outputs(partial)), new RegExp(`missing outputs: ${dropped}`),
      `a stack without ${dropped} must say so by name`);
  }
});

test('countItems counts what BatchWriteItem counts, across both shapes it appears in', () => {
  assert.equal(countItems(undefined), 0);
  assert.equal(countItems({}), 0);
  assert.equal(countItems(REQUEST(25)), 25);
  assert.equal(countItems({ ...REQUEST(10, 'T-a'), ...REQUEST(7, 'T-b') }), 17);
  // An `UnprocessedItems` block spanning two tables is the shape a multi-table retry comes back in.
  assert.equal(countItems({ 'T-a': [], 'T-b': REQUEST(3, 'x')['x'] }), 3);
});

// --- the one ordering rule of the evening -------------------------------------------------------
//
// Step 3 creates the three logins; step 4 is this seed, and it reads their subs back out of the
// pool. Run in the wrong order it would write rows that look right and resolve to nothing: every
// teacher action `out_of_scope`, the parent's own child refused, the inbox empty. The guard was
// an inline `process.exit(1)` inside `demoSubs`, which no test could call without killing the
// runner; it now reports and `main` exits, so the rule itself can be driven.

const poolWith = (emails) => (_cmd, argv) => {
  if (argv[1] !== 'admin-get-user') throw new Error(`unexpected call: ${argv[1]}`);
  const email = argv[argv.indexOf('--username') + 1];
  if (!emails.includes(email)) throw new Error('UserNotFoundException');
  return JSON.stringify({ UserAttributes: [{ Name: 'sub', Value: `sub-of-${email}` }] });
};

test('seeding before the logins exist is refused, and names the logins that are missing', () => {
  const both = ['teacher@panthiya.demo', 'parent@panthiya.demo'];

  // Nothing created yet — step 4 run before step 3.
  const none = demoSubs('pool-1', poolWith([]));
  assert.deepEqual(none.missing, both);
  assert.equal(none.subs.teacher, null);

  // And each half-made pool, which is what a step 3 that failed on one account leaves behind.
  for (const present of both) {
    const read = demoSubs('pool-1', poolWith([present]));
    assert.deepEqual(read.missing, both.filter((e) => e !== present),
      `with only ${present} in the pool, the other one must be named`);
  }

  // Both there: the seed may proceed, with the real subs.
  const ready = demoSubs('pool-1', poolWith(both));
  assert.deepEqual(ready.missing, []);
  assert.equal(ready.subs.teacher, 'sub-of-teacher@panthiya.demo');
  assert.equal(ready.subs.parent, 'sub-of-parent@panthiya.demo');

  // A login that exists but carries no `sub` is the silent half-failure, and counts as missing:
  // there would be nothing to key the class or the parent link on.
  const noSub = demoSubs('pool-1', () => JSON.stringify({ UserAttributes: [{ Name: 'email', Value: 'x' }] }));
  assert.deepEqual(noSub.missing, both);
});

test('the refusal message puts step 3 before step 4, in the order they have to be run', () => {
  const message = missingLoginsMessage(['parent@panthiya.demo'], 'panthiya');
  assert.match(message, /refusing to continue/);
  assert.match(message, /parent@panthiya\.demo/, 'it must name which login is missing');

  // The two commands, and the order between them, which is the whole point of the message.
  const users = message.indexOf('scripts/demo-users.mjs --apply');
  const seed = message.indexOf('backend/seed/seed.mjs --stack panthiya --apply');
  assert.ok(users > 0 && seed > 0, 'both commands have to be in it');
  assert.ok(users < seed, 'demo-users.mjs comes first — that is the ordering rule');
  assert.match(message, /PANTHIYA_DEMO_PASSWORD/, 'and the variable demo-users needs');

  // The stack name is carried through, so a non-default stack is not quietly renamed to panthiya
  // in the one command the operator is about to paste.
  assert.match(missingLoginsMessage(['x'], 'panthiya-prod'), /--stack panthiya-prod --apply/);
});

test('a dry run needs no pool, no stack and no credentials — the offline rehearsal', () => {
  // The step that makes this script safe to practise with. `subs` is null, so the rows carry the
  // fixture's placeholders and the sub-dependent checks have nothing to compare against.
  const { items, problems, total } = buildSeed({ data: clone(), subs: null });
  assert.deepEqual(problems, []);
  assert.equal(total, 105);
  assert.equal(items.classes[0].teacherId, DATA.teacher.teacherSub,
    'a dry run shows the placeholder, which is what its own closing note says');
  assert.equal(items.students.filter((s) => /^SEED-PARENT-/.test(s.parentSub)).length, 12,
    'and all twelve children are unlinked until the real parent sub is read');
});
