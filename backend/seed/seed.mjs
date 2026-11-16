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

// --- Build the items ----------------------------------------------------------------------------

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
    actorSub: teacher.teacherSub,
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
  teacherId: teacher.teacherSub,
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
    parentSub: s.parentSub,
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
  console.log('\nDry run. Nothing was written and nothing was spent.');
  console.log(`Re-run with --apply to write to stack "${STACK}" in ${REGION}.`);
  process.exit(0);
}

// --- Write ---------------------------------------------------------------------------------------

const outputs = tableNames();
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
