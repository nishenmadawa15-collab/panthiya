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
// ponytail: BatchWriteItem in 25-item chunks via the CLI, rather than the SDK. ~60 items total.
// Upgrade to the SDK if seeding ever grows past a few hundred rows.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STACK = args[args.indexOf('--stack') + 1] ?? process.env.PANTHIYA_STACK ?? 'panthiya';
const REGION = process.env.AWS_REGION ?? 'ap-south-1';

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

/** Read the deployed table names from the CloudFormation stack, so nothing is hard-coded. */
function tableNames() {
  const raw = execFileSync('aws', [
    'cloudformation', 'describe-stacks',
    '--stack-name', STACK, '--region', REGION,
    '--query', 'Stacks[0].Outputs', '--output', 'json',
  ], { encoding: 'utf8' });

  const outputs = Object.fromEntries(JSON.parse(raw).map((o) => [o.OutputKey, o.OutputValue]));
  const need = ['ClassesTableName', 'StudentsTableName', 'AttendanceTableName',
    'FeesTableName', 'MarksTableName', 'AuditLogTableName'];

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
const DEMO_PARENT_STUDENT = 'stu-01';
const DEMO_EMAILS = { teacher: 'teacher@panthiya.demo', parent: 'parent@panthiya.demo' };

function demoSubs(userPoolId) {
  const read = (email) => {
    let raw;
    try {
      raw = execFileSync('aws', ['cognito-idp', 'admin-get-user', '--user-pool-id', userPoolId,
        '--username', email, '--region', REGION, '--output', 'json'], { encoding: 'utf8' });
    } catch {
      return null;                     // UserNotFoundException — the logins have not been made yet
    }
    return (JSON.parse(raw).UserAttributes ?? []).find((a) => a.Name === 'sub')?.Value ?? null;
  };

  const subs = { teacher: read(DEMO_EMAILS.teacher), parent: read(DEMO_EMAILS.parent) };
  const missing = Object.entries(subs).filter(([, v]) => !v).map(([k]) => DEMO_EMAILS[k]);
  if (missing.length) {
    console.error('seed: refusing to continue — these demo logins do not exist yet:\n  - '
      + missing.join('\n  - ')
      + '\n\nThe subs are what make the scopes resolve, so the logins come first:'
      + '\n  export PANTHIYA_DEMO_PASSWORD=\'…\''
      + '\n  node scripts/demo-users.mjs --apply'
      + `\n  node backend/seed/seed.mjs --stack ${STACK} --apply`);
    process.exit(1);
  }
  return subs;
}

// --- Build the items ----------------------------------------------------------------------------

// Only when writing, so a dry run stays offline and usable before the stack exists at all.
const outputs = APPLY ? tableNames() : null;
const subs = APPLY ? demoSubs(outputs.UserPoolId) : null;

const data = JSON.parse(readFileSync(join(HERE, 'demo-class.json'), 'utf8'));
const { class: cls, teacher, students, fees, attendance, marks } = data;
const now = new Date().toISOString();

/** One audit row per seeded write, so the demo audit log is not empty and requirement 10.1 holds. */
const audit = [];
let auditSeq = 0;
const auditFor = (action, targetId, after) => {
  audit.push({
    classId: cls.classId,
    // Monotonic suffix instead of a UUID: a seed run should replay in a readable order.
    tsUlid: `${now}#seed-${String(++auditSeq).padStart(4, '0')}`,
    actorSub: subs?.teacher ?? teacher.teacherSub,
    actorRole: 'system',
    action,
    targetId,
    before: null,
    after,
  });
};

const items = { classes: [], students: [], attendance: [], fees: [], marks: [] };

items.classes.push({
  classId: cls.classId,
  teacherId: subs?.teacher ?? teacher.teacherSub,
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
    // One child, and only one: see the comment on DEMO_PARENT_STUDENT above.
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
    recordedBy: teacher.teacherSub,
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
        markedBy: teacher.teacherSub,
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
    recordedBy: teacher.teacherSub,
    recordedAt: now,
  });
  auditFor('seed.addMarks', `${m.studentId}#${assessmentId}`, m.score);
}

// --- Sanity checks before anything is written ---------------------------------------------------

const problems = [];
if (students.length !== 12) problems.push(`expected 12 students, found ${students.length}`);
for (const m of items.marks) {
  if (m.score < 0 || m.score > m.maxScore) problems.push(`mark out of range for ${m.studentId}`);
}
const dilmi = items.marks.find((m) => m.studentId === 'stu-02');
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
  if (/^SEED-/.test(subs.teacher) || /^SEED-/.test(subs.parent)) {
    problems.push('a placeholder sub reached the write path');
  }
}

if (problems.length) {
  console.error('seed: refusing to continue\n  - ' + problems.join('\n  - '));
  process.exit(1);
}

const counts = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.length]));
counts.audit_log = audit.length;
const total = Object.values(counts).reduce((a, b) => a + b, 0);

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
  process.exit(0);
}

// --- Write ---------------------------------------------------------------------------------------

const target = {
  classes: outputs.ClassesTableName,
  students: outputs.StudentsTableName,
  attendance: outputs.AttendanceTableName,
  fees: outputs.FeesTableName,
  marks: outputs.MarksTableName,
  audit_log: outputs.AuditLogTableName,
};

mkdirSync(OUT, { recursive: true });
const batches = [];
for (const [key, rows] of [...Object.entries(items), ['audit_log', audit]]) {
  for (let i = 0; i < rows.length; i += 25) {
    batches.push({ key, table: target[key], rows: rows.slice(i, i + 25) });
  }
}

let written = 0;
for (const [i, batch] of batches.entries()) {
  const file = join(OUT, `batch-${String(i).padStart(3, '0')}-${batch.key}.json`);
  writeFileSync(file, JSON.stringify({
    [batch.table]: batch.rows.map((row) => ({ PutRequest: { Item: marshal(row) } })),
  }, null, 2));

  execFileSync('aws', ['dynamodb', 'batch-write-item',
    '--request-items', `file://${file}`, '--region', REGION], { stdio: 'inherit' });
  written += batch.rows.length;
  console.log(`  wrote ${batch.key} (${written}/${total})`);
}

console.log(`\nSeeded ${written} items into stack "${STACK}".`);
console.log(`Request files kept in ${OUT} for inspection; they contain no secrets.`);
