#!/usr/bin/env node
// Load the fictional demo class into DynamoDB.
//
// Runs with ZERO npm dependencies: the AWS SDK is only present inside the Lambda runtime, not on a
// laptop, so this marshals DynamoDB JSON itself and hands the batches to the AWS CLI.
//
// Dry run by default. Nothing is written, and nothing costs money, until you pass --apply.
//
//   node backend/seed/seed.mjs --stack panthiya            # show what would be written
//   node backend/seed/seed.mjs --stack panthiya --apply    # actually write it
//
// ponytail: BatchWriteItem in 25-item chunks via the CLI, rather than the SDK. ~105 items total.
// Upgrade to the SDK if seeding ever grows past a few hundred rows.
//
// WHAT A SUCCESSFUL SEED IS ALLOWED TO MEAN. `BatchWriteItem` is a partial-success API: it answers
// 200 having written some of the items and hands the rest back in `UnprocessedItems`, which is how
// DynamoDB sheds load. So "the CLI exited 0" and "the rows are in the table" are different claims,
// and this file must only ever make the second one — see `writeBatch`. Re-running is the fix for
// every failure below, and is safe: every row is keyed by its own id and the seed's timestamp is
// fixed, so a second run writes byte-identical rows over the first rather than adding to them.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
/**
 * The value after a flag, or the fallback. Four lines rather than `args[indexOf(...) + 1]`, which
 * is what was here: with no `--stack` at all `indexOf` returns -1, so it read `args[0]`, and
 * `node backend/seed/seed.mjs --apply` therefore set the stack name to **"--apply"** and the AWS
 * CLI failed with a parse error that named nothing useful. Duplicated in `scripts/demo-users.mjs`
 * rather than shared: four lines of argument plumbing in two standalone scripts is cheaper than a
 * `scripts/lib` for them to import.
 */
function flagValue(name, fallback) {
  const i = args.indexOf(name);
  const next = i >= 0 ? args[i + 1] : undefined;
  return next && !next.startsWith('--') ? next : fallback;
}

const STACK = flagValue('--stack', process.env.PANTHIYA_STACK ?? 'panthiya');
const REGION = process.env.AWS_REGION ?? 'ap-south-1';

/**
 * The seed's own timestamp, fixed rather than `new Date()`.
 *
 * Every row here is keyed by its own id, so a second run overwrites the first — except the audit
 * rows, whose sort key was `${new Date().toISOString()}#seed-NNNN`. A wall-clock timestamp made
 * that key different on every run, so the one thing this script's own failure message tells you to
 * do — "fix the cause and run exactly this command again" — **doubled the audit log**: 41 rows
 * became 82 in two timestamp groups, and requirement 10.1's screen shows the seed twice. Confirmed
 * 2026-11-20 by seeding the same data twice into a fake table and counting the keys.
 *
 * Fixed to the month the fixture itself is set in (its attendance and marks are all 2026-11), so
 * a re-run now writes byte-identical rows.
 *
 * ponytail: a constant, not an `--as-of` flag. Lift it if the demo ever needs two seeded cohorts.
 */
export const SEED_TS = '2026-11-01T00:00:00.000Z';

// --- DynamoDB JSON marshalling (only the types this seed data actually uses) --------------------

function toAttr(value) {
  if (value === null || value === undefined) return { NULL: true };
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'number') return { N: String(value) };
  if (typeof value === 'boolean') return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(toAttr) };
  if (typeof value === 'object') return { M: marshal(value) };
  throw new Error(`seed: cannot marshal ${typeof value}`);
}

const marshal = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toAttr(v)]));

// --- Stack outputs ------------------------------------------------------------------------------

/**
 * Read the deployed table names from the CloudFormation stack, so nothing is hard-coded.
 *
 * `UserPoolId` is in the list for a reason that cost nothing to fix and would have cost an hour to
 * diagnose: `demoSubs` is called with `outputs.UserPoolId`, and with the key absent it was called
 * with `undefined`. `admin-get-user --user-pool-id undefined` fails, `demoSubs` reads any failure
 * as UserNotFoundException, and the script then printed **"these demo logins do not exist yet"** —
 * sending the operator back to re-run `demo-users.mjs --apply` on three accounts that were already
 * there, over and over, because the real fault was a stack output. A missing output is now named
 * as a missing output.
 */
export function tableNames(run = execFileSync) {
  const raw = run('aws', [
    'cloudformation', 'describe-stacks',
    '--stack-name', STACK, '--region', REGION,
    '--query', 'Stacks[0].Outputs', '--output', 'json',
  ], { encoding: 'utf8' });

  const outputs = Object.fromEntries(JSON.parse(raw).map((o) => [o.OutputKey, o.OutputValue]));
  const need = ['UserPoolId', 'ClassesTableName', 'StudentsTableName', 'AttendanceTableName',
    'FeesTableName', 'MarksTableName', 'MessagesTableName', 'AuditLogTableName'];

  const missing = need.filter((k) => !outputs[k]);
  if (missing.length) throw new Error(`stack "${STACK}" is missing outputs: ${missing.join(', ')}`);
  return outputs;
}

// --- The real Cognito subs ----------------------------------------------------------------------

/**
 * `demo-class.json` carries `SEED-TEACHER-SUB` and `SEED-PARENT-01…12` as placeholders, and every
 * scope in this product is resolved server-side from the caller's own `sub`. Seeding a placeholder
 * is therefore not a cosmetic TODO — it is a demo that cannot work:
 *
 *   - the teacher's real sub would match no `classes.byTeacher` row, so their scope is **no
 *     classes** and every teacher action answers `out_of_scope`;
 *   - the parent's real sub would match no `students.byParent` row, so their *own* child is
 *     refused and the inbox is empty;
 *   - a student resolves to an empty scope by design (requirement 1.7), which is why the tutor is
 *     the one role that works regardless.
 *
 * So the subs are read back out of the user pool here, by email, rather than taken as arguments:
 * there is then nothing to copy and paste wrongly, and the seed refuses to run before the logins
 * exist instead of writing rows that look right and resolve to nothing.
 *
 * Exactly **one** child is linked to the parent login. If all twelve were, "show me Dilmi's marks"
 * (case A1) would be a legitimate request from a parent who really is Dilmi's parent, and the
 * privacy half of the red-team suite would be measuring nothing.
 */
export const DEMO_PARENT_STUDENT = 'stu-01';
export const DEMO_EMAILS = { teacher: 'teacher@panthiya.demo', parent: 'parent@panthiya.demo' };

/**
 * The two subs, and which logins are not there yet.
 *
 * Returns `{ subs, missing }` rather than exiting, so the step-3-before-step-4 guard — the one
 * ordering rule on deploy evening — can be driven by a test. `main` does the exiting.
 */
export function demoSubs(userPoolId, run = execFileSync) {
  const read = (email) => {
    let raw;
    try {
      raw = run('aws', ['cognito-idp', 'admin-get-user', '--user-pool-id', userPoolId,
        '--username', email, '--region', REGION, '--output', 'json'], { encoding: 'utf8' });
    } catch {
      return null;                     // UserNotFoundException — the logins have not been made yet
    }
    return (JSON.parse(raw).UserAttributes ?? []).find((a) => a.Name === 'sub')?.Value ?? null;
  };

  const subs = { teacher: read(DEMO_EMAILS.teacher), parent: read(DEMO_EMAILS.parent) };
  return { subs, missing: Object.entries(subs).filter(([, v]) => !v).map(([k]) => DEMO_EMAILS[k]) };
}

/** What to print when the logins are not there yet: the order, and the two commands, in order. */
export const missingLoginsMessage = (missing, stack = STACK) =>
  'seed: refusing to continue — these demo logins do not exist yet:\n  - '
  + missing.join('\n  - ')
  + '\n\nThe subs are what make the scopes resolve, so the logins come first:'
  + '\n  export PANTHIYA_DEMO_PASSWORD=\'…\''
  + '\n  node scripts/demo-users.mjs --apply'
  + `\n  node backend/seed/seed.mjs --stack ${stack} --apply`;

// --- Build the items ----------------------------------------------------------------------------

/**
 * Every row the seed would write, and everything wrong with them.
 *
 * Pure: no AWS, no clock, no `process.exit`. `subs` is null for a dry run and `{teacher, parent}`
 * once the logins have been read out of the pool. Exported so the checks at the bottom — the ones
 * that only ever run a line away from a real table — can be driven without one.
 */
export function buildSeed({ data, subs = null, now = SEED_TS }) {
  const { class: cls, teacher, students, fees, attendance, marks, messages } = data;

  // One name for "whose sub goes in this row", used by every table.
  //
  // It was `subs?.teacher ?? teacher.teacherSub` in `classes` and `messages` and the bare
  // placeholder `teacher.teacherSub` in `attendance.markedBy`, `fees.recordedBy` and
  // `marks.recordedBy` — so a real `--apply` wrote the literal string `SEED-TEACHER-SUB` into 48
  // of the 64 data rows. Confirmed 2026-11-20. One binding rather than six expressions is also why
  // a table added later cannot get this wrong by being copied from the wrong neighbour.
  const teacherSub = subs?.teacher ?? teacher.teacherSub;

  /** One audit row per seeded write, so the demo audit log is not empty and requirement 10.1 holds. */
  const audit = [];
  let auditSeq = 0;
  const auditFor = (action, targetId, after) => {
    audit.push({
      classId: cls.classId,
      // Monotonic suffix instead of a UUID: a seed run should replay in a readable order. The
      // prefix is `SEED_TS`, not the wall clock, so re-running replaces these rows — see SEED_TS.
      sk: `${now}#seed-${String(++auditSeq).padStart(4, '0')}`,
      actorSub: teacherSub,
      actorRole: 'system',
      action,
      targetId,
      before: null,
      after,
    });
  };

  const items = { classes: [], students: [], attendance: [], fees: [], marks: [], messages: [] };

  items.classes.push({
    classId: cls.classId,
    teacherId: teacherSub,
    name: cls.name,
    subject: cls.subject,
    grade: cls.grade,
    feeAmount: cls.feeAmount,
    currency: cls.currency,
    createdAt: now,
  });
  auditFor('seed.createClass', cls.classId, cls.name);

  for (const s of students) {
    items.students.push({
      studentId: s.studentId,
      classId: cls.classId,
      displayName: s.displayName,
      nameSinhala: s.nameSinhala,
      nameTamil: s.nameTamil,
      // One child, and only one: see the comment on DEMO_PARENT_STUDENT above. The other eleven
      // keep their `SEED-PARENT-nn`, which is deliberate — they belong to nobody who can log in.
      parentSub: s.studentId === DEMO_PARENT_STUDENT && subs ? subs.parent : s.parentSub,
      parentName: s.parentName,
      grade: cls.grade,
      createdAt: now,
    });
    auditFor('seed.addStudent', s.studentId, s.displayName);
  }

  for (const f of fees) {
    items.fees.push({
      studentId: f.studentId,
      period: f.period,
      classId: cls.classId,
      amountDue: f.amountDue,
      amountPaid: f.amountPaid,
      currency: cls.currency,
      method: f.method,
      paidOn: f.paidOn,
      recordedBy: teacherSub,
      recordedAt: now,
    });
    auditFor('seed.recordFee', `${f.studentId}#${f.period}`, f.amountPaid);
  }

  for (const session of attendance) {
    for (const [status, ids] of [['present', session.present], ['absent', session.absent]]) {
      for (const studentId of ids) {
        items.attendance.push({
          studentId,
          date: session.date,
          classId: cls.classId,
          // Composite GSI sort key — design §4.0. Without it the row is invisible to byClass.
          dateStudentId: `${session.date}#${studentId}`,
          status,
          markedBy: teacherSub,
          markedAt: now,
        });
      }
    }
  }
  auditFor('seed.markAttendance', cls.classId, `${items.attendance.length} rows`);

  for (const m of marks) {
    const assessmentId = `${m.date}#${m.assessment.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    items.marks.push({
      studentId: m.studentId,
      assessmentId,
      classId: cls.classId,
      assessment: m.assessment,
      subject: m.subject,
      score: m.score,
      maxScore: m.maxScore,
      date: m.date,
      recordedBy: teacherSub,
      recordedAt: now,
    });
    auditFor('seed.addMarks', `${m.studentId}#${assessmentId}`, m.score);
  }

  /**
   * The parent updates, in the exact shape `actions-teacher/drafts.mjs` writes.
   *
   * Without these the parent inbox is empty after a real seed, and the demo beat "a fee is recorded
   * and the parent gets an approved update" has no data behind it — found while writing the demo
   * script, because the only thread content in the project was a mock in `parent.js`.
   *
   * Two are approved and one is still a draft, so requirement 6.2's approval gate is *doing*
   * something in the demo rather than being asserted: the parent sees two, the teacher sees three.
   * Every sentence is built only from rows this same file seeds, and `sourceFacts` names them, so a
   * seeded row and one the agent drafted are indistinguishable to the inbox.
   *
   * `statusCreatedAt` is the composite of design §4.0 and is what both GSIs sort on — omit it and
   * the row is invisible to the index, which is the failure that looks like "the inbox is just
   * empty". The parent group reads `begins_with(statusCreatedAt, 'approved#')`, so the draft below
   * cannot reach a parent even if every filter above it were wrong.
   */
  for (const m of messages) {
    const student = students.find((s) => s.studentId === m.studentId);
    if (!student) throw new Error(`seed: message ${m.messageId} names an unknown student`);

    // Only when the child has a linked parent, exactly as drafts.mjs does: an empty GSI key is
    // worse than an absent one. Of the twelve children only stu-01 is linked to the demo login.
    const parentSub = items.students.find((s) => s.studentId === m.studentId)?.parentSub;

    items.messages.push({
      messageId: m.messageId,
      studentId: m.studentId,
      classId: cls.classId,
      teacherId: teacherSub,
      status: m.status,
      createdAt: m.createdAt,
      statusCreatedAt: `${m.status}#${m.approvedAt ?? m.createdAt}`,
      ...(m.approvedAt ? { approvedAt: m.approvedAt } : {}),
      body: m.body,
      sourceFacts: m.sourceFacts,
      createdBy: teacherSub,
      ...(parentSub ? { parentSub } : {}),
    });
    auditFor(`seed.${m.status === 'approved' ? 'approveParentUpdate' : 'draftParentUpdate'}`,
      m.messageId, m.status);
  }

  // --- Sanity checks before anything is written -------------------------------------------------

  const problems = [];
  if (students.length !== 12) problems.push(`expected 12 students, found ${students.length}`);
  for (const m of items.marks) {
    if (m.score < 0 || m.score > m.maxScore) problems.push(`mark out of range for ${m.studentId}`);
  }
  // The approval gate is the demo's whole point on that screen, so it is checked rather than assumed.
  const approved = items.messages.filter((m) => m.status === 'approved');
  const drafts = items.messages.filter((m) => m.status === 'draft');
  if (!approved.length) problems.push('no approved parent update — the inbox would be empty');
  if (!drafts.length) problems.push('no draft parent update — the approval gate would demo nothing');
  for (const m of items.messages) {
    if (!m.statusCreatedAt.startsWith(`${m.status}#`)) {
      problems.push(`${m.messageId}: statusCreatedAt does not match its status, so it is index-invisible`);
    }
    if (!m.sourceFacts?.length) problems.push(`${m.messageId}: no sourceFacts (requirement 6.1)`);
  }

  // `find` on the student id alone read whichever mark the JSON happened to list first, so the
  // guard's own sentence — "Dilmi's **November** mark" — was not what it checked. Harmless today
  // (stu-02 has one mark) and wrong the moment a second assessment is added above it, which is the
  // kind of guard that passes while the thing it guards is broken. Named the same way
  // `tests/unit/demo-data.test.mjs` names it.
  const dilmi = items.marks.find((m) => m.studentId === 'stu-02' && m.assessment === 'November test');
  if (!dilmi || dilmi.score !== 72) {
    problems.push('Dilmi’s November mark must stay 72 — red-team case D2 depends on it');
  }

  if (subs) {
    // The linkage is what a placeholder sub gets wrong *silently*: the rows look right and resolve
    // to nothing. Checked here rather than trusted, because by this point it is one line away from
    // being written to a real table.
    const linked = items.students.filter((s) => s.parentSub === subs.parent);
    if (linked.length !== 1) {
      problems.push(`exactly one child must be linked to the parent login, found ${linked.length}`);
    } else if (linked[0].studentId !== DEMO_PARENT_STUDENT) {
      problems.push(`the parent login is linked to ${linked[0].studentId}, not ${DEMO_PARENT_STUDENT}`);
    }
    if (items.classes[0].teacherId !== subs.teacher) {
      problems.push('the class is not owned by the teacher login, so its scope will not resolve');
    }

    /*
     * The placeholder check, over every field of every row.
     *
     * What was here tested `subs.teacher` and `subs.parent` — the two values Cognito had just
     * handed back — for a `SEED-` prefix. A Cognito sub is a UUID, so neither can ever start with
     * `SEED-`: the guard was structurally incapable of firing, and it was the only thing claiming
     * to catch "a placeholder sub reached the write path" while three tables were writing one.
     *
     * It compares against `teacher.teacherSub` — the fixture's own placeholder — rather than
     * sniffing for a `SEED-` prefix, because `SEED-PARENT-nn` on the eleven unlinked children is
     * deliberate and must keep passing. And it walks the rows, so a table added later is covered
     * without this being edited.
     */
    const leaked = new Set();
    for (const [table, rows] of Object.entries(items)) {
      for (const row of rows) {
        for (const [field, value] of Object.entries(row)) {
          if (value === teacher.teacherSub) leaked.add(`${table}.${field}`);
        }
      }
    }
    for (const row of audit) {
      if (row.actorSub === teacher.teacherSub) leaked.add('audit_log.actorSub');
    }
    if (leaked.size) {
      problems.push(`the placeholder teacher sub reached the write path in: ${[...leaked].sort().join(', ')}`);
    }
  }

  const counts = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.length]));
  counts.audit_log = audit.length;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return { cls, items, audit, problems, counts, total };
}

// --- Writing ------------------------------------------------------------------------------------

/** How many item requests a `--request-items` payload (or an `UnprocessedItems` block) holds. */
export const countItems = (request) =>
  Object.values(request ?? {}).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0);

/** A synchronous pause, between retries, in a script that is synchronous throughout. */
const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * Hand one request to BatchWriteItem and do not return until nothing is left over.
 *
 * THE DEFECT THIS REPLACES. `BatchWriteItem` is a partial-success API: it answers 200 having
 * written some of the items and returns the rest in `UnprocessedItems`. The loop here called it
 * with `stdio: 'inherit'`, which hands the caller **nothing** — the response was printed to the
 * terminal and never read — and then added the whole batch to a running total regardless.
 * Confirmed 2026-11-20 by driving the loop with a CLI that left items over in every call: it
 * printed "wrote students (13/105)" … "Seeded 105 items into stack" and exited 0, having written
 * none of them. A half-written table is what that looks like in the morning: the class row lands,
 * the students do not, every screen in the demo is empty, and the seed said it was done.
 *
 * So stdout is captured and parsed, leftovers are retried, and `written` counts what the API
 * actually accepted — submitted minus returned. Anything still pending after `attempts` is a
 * throw, because the alternative is a number nobody can trust.
 *
 * ponytail: retry with a short linear backoff, not `TransactWriteItems`. The ceiling is a real
 * one: a transaction takes at most 100 items and this seed writes 105, so all-or-nothing is not
 * available without splitting the data across transactions and inventing a rollback for the split.
 * Re-running is the recovery instead, which SEED_TS makes safe. Lift this if the seed ever has to
 * be atomic — it does not; it is a demo fixture loaded before anyone logs in.
 */
export function writeBatch({ file, request, region = REGION, run = execFileSync, attempts = 4,
  log = () => {}, wait = sleepSync }) {
  const submitted = countItems(request);
  let pending = request;
  let written = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    writeFileSync(file, JSON.stringify(pending, null, 2));

    // stdout captured so `UnprocessedItems` can be read at all; stderr still inherited, so an
    // AccessDenied or a misspelled table is exactly as visible as it was before.
    const raw = run('aws', ['dynamodb', 'batch-write-item',
      '--request-items', `file://${file}`, '--region', region, '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

    let unprocessed;
    try {
      // Only an actual JSON object counts as an answer. `--output json` on a successful
      // `batch-write-item` always prints one (`{"UnprocessedItems": {}}` at the least), so empty
      // stdout, a bare `null`, or a page of proxy HTML all mean the same thing: the CLI exited 0
      // and we still do not know what is in the table. Reading any of them as "nothing was left
      // over" is the same false green as the `stdio: 'inherit'` this replaced, one layer down.
      const answer = JSON.parse(raw);
      if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
        throw new Error('not an object');
      }
      unprocessed = answer.UnprocessedItems ?? {};
    } catch {
      // Neither a successful write nor a failed one: these rows may or may not be in the table,
      // and saying "may or may not" is the whole point.
      throw new Error('batch-write-item answered something that is not a JSON object: '
        + `${raw ? String(raw).slice(0, 160) : '(nothing on stdout)'}`
        + `\n  Whether these ${submitted} rows landed is UNKNOWN. `
        + 'Check the table, then re-run — a second run replaces rather than duplicates.');
    }

    const stillPending = countItems(unprocessed);
    written = submitted - stillPending;
    if (!stillPending) return { written, attempts: attempt };

    log(`    ${stillPending} of ${submitted} items came back unprocessed (attempt ${attempt}/${attempts})`
      + ' — DynamoDB shed load; retrying exactly those');
    pending = unprocessed;
    if (attempt < attempts) wait(250 * attempt);
  }

  throw new Error(`${submitted - written} of ${submitted} items were still unprocessed after `
    + `${attempts} attempts, so this table is now PARTLY written.\n  Re-run the same command: `
    + 'every row is keyed by its own id and the seed timestamp is fixed, so a second run replaces '
    + 'these rows rather than adding to them.');
}

/** The 25-item chunks, in the order they are written. 25 is BatchWriteItem's own per-call limit. */
export function batchesOf(items, audit, target) {
  const batches = [];
  for (const [key, rows] of [...Object.entries(items), ['audit_log', audit]]) {
    for (let i = 0; i < rows.length; i += 25) {
      batches.push({ key, table: target[key], rows: rows.slice(i, i + 25) });
    }
  }
  return batches;
}

// --- main ---------------------------------------------------------------------------------------

function main() {
  // Only when writing, so a dry run stays offline and usable before the stack exists at all.
  const outputs = APPLY ? tableNames() : null;
  let subs = null;
  if (APPLY) {
    const read = demoSubs(outputs.UserPoolId);
    if (read.missing.length) {
      console.error(missingLoginsMessage(read.missing));
      return 1;
    }
    subs = read.subs;
  }

  const data = JSON.parse(readFileSync(join(HERE, 'demo-class.json'), 'utf8'));
  const { cls, items, audit, problems, counts, total } = buildSeed({ data, subs });

  if (problems.length) {
    console.error('seed: refusing to continue\n  - ' + problems.join('\n  - '));
    return 1;
  }

  console.log(`Panthiya demo class — ${cls.name}`);
  console.log('All 12 students and their parents are fictional.\n');
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(12)} ${n} items`);
  console.log(`  ${'TOTAL'.padEnd(12)} ${total} items`);

  if (!APPLY) {
    console.log('\nDry run. Nothing was written and nothing was spent — and the Cognito subs in it');
    console.log('are still placeholders. --apply reads the real ones out of the user pool, which is');
    console.log('why the three demo logins have to exist first:');
    console.log('  export PANTHIYA_DEMO_PASSWORD=\'…\'');
    console.log('  node scripts/demo-users.mjs --apply');
    console.log(`  node backend/seed/seed.mjs --stack ${STACK} --apply`);
    return 0;
  }

  const target = {
    classes: outputs.ClassesTableName,
    students: outputs.StudentsTableName,
    messages: outputs.MessagesTableName,
    attendance: outputs.AttendanceTableName,
    fees: outputs.FeesTableName,
    marks: outputs.MarksTableName,
    audit_log: outputs.AuditLogTableName,
  };

  mkdirSync(OUT, { recursive: true });
  const batches = batchesOf(items, audit, target);

  let written = 0;
  for (const [i, batch] of batches.entries()) {
    const file = join(OUT, `batch-${String(i).padStart(3, '0')}-${batch.key}.json`);
    const request = { [batch.table]: batch.rows.map((row) => ({ PutRequest: { Item: marshal(row) } })) };
    const result = writeBatch({ file, request, log: (l) => console.log(l) });
    written += result.written;
    console.log(`  wrote ${batch.key} (${written}/${total})`);
  }

  // The printed verdict and the arithmetic, checked against each other before the verdict is
  // printed. `writeBatch` throws rather than returning short, so this cannot fire today — it is
  // here so that a future change which makes it fire cannot also print "Seeded 105 items".
  if (written !== total) {
    console.error(`\nseed: wrote ${written} of ${total} items. The stack is PARTLY seeded.`);
    return 1;
  }

  console.log(`\nSeeded ${written} items into stack "${STACK}".`);
  console.log(`Request files kept in ${OUT} for inspection; they contain no secrets.`);
  return 0;
}

// Importable for the tests; only runs when invoked directly. `pathToFileURL` rather than a
// string-built `file://` URL, for the Windows reason given in scripts/redteam-cli.mjs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (err) {
    // Words rather than a stack trace: what lands here is the stack not being deployed, the CLI
    // having no credentials, or a batch that would not go in — each already carries a sentence.
    console.error(`seed: ${String(err?.message ?? err).split('\n').slice(0, 4).join('\n')}`);
    process.exitCode = 1;
  }
}
