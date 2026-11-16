// The four Teacher actions — the only code in Panthiya that changes data.
//
// Every one of them is the same five lines of design §3.2, in the same order, before any business
// logic runs:
//
//   const { role, sub } = sessionAttributes(event);   identity, out of band, never from the message
//   requireRole(role, 'teacher');                     a parent or student session dies here
//   const scope = await resolveScope(role, sub, deps) the teacher's own classes, read server-side
//   resolve each model-supplied NAME to a studentId, then assertInScope(classId, scope, 'class')
//   ...write... then writeAudit(deps, ...) in this same invocation (req 10.2)
//
// Teacher scope is CLASS ids, not student ids (see `resolveScope`): a name is resolved to a
// student, that student's own `classId` is read from the row, and *the class* is what gets
// re-authorised. So a teacher who names a real student in someone else's class is refused at the
// same line as a teacher who invents one, and neither learns which it was.
//
// Requirement 4.4 is why `writeAudit` is only ever reached after every gate has passed: a denied
// call leaves no data row and no audit entry implying a write happened. There is deliberately no
// "attempted write" audit action.
//
// Nothing here imports the AWS SDK. DynamoDB arrives as the injected `deps` from
// `backend/lib/ddb.mjs`, which is what lets `tests/unit/actions-teacher.test.mjs` run offline.

import { randomUUID } from 'node:crypto';

import { sessionAttributes, requireRole, resolveScope, assertInScope } from '../../lib/auth.mjs';
import { writeAudit } from '../../lib/audit.mjs';
import { nameKey, namesMatch } from '../../lib/names.mjs';
import {
  InputError, parseName, parseNames, parseClassName,
  parseDate, parsePeriod, parseStatus, parseAmount, parseScore, assessmentId, text,
} from './validate.mjs';

// --- plumbing ----------------------------------------------------------------------------------

/**
 * What the model supplied, as a plain object. Untrusted input, by definition (design §3.1) —
 * read here and validated immediately, never used as a key or an identifier on trust.
 */
export function modelParams(event) {
  return Object.fromEntries((event?.parameters ?? []).map((p) => [p.name, p.value]));
}

/** Run a query to exhaustion. A silently truncated roster would resolve a name to the wrong child. */
async function queryAll(deps, params) {
  const items = [];
  let startKey;
  do {
    const page = await deps.query(startKey ? { ...params, ExclusiveStartKey: startKey } : params);
    items.push(...(page?.Items ?? []));
    startKey = page?.LastEvaluatedKey;
  } while (startKey);
  return items;
}

/** The one row at this exact key, or `undefined`. Used to capture `before` for the audit entry. */
async function readRow(deps, { TableName, pk, pkValue, sk, skValue }) {
  const page = await deps.query({
    TableName,
    KeyConditionExpression: '#pk = :pk AND #sk = :sk',
    ExpressionAttributeNames: { '#pk': pk, '#sk': sk },   // `date` and `period` are reserved words
    ExpressionAttributeValues: { ':pk': pkValue, ':sk': skValue },
    Limit: 1,
  });
  return page?.Items?.[0];
}

// --- name resolution (requirement 3.3) ---------------------------------------------------------

/**
 * Every spelling of a student's name we are willing to accept, including each part on its own,
 * because a teacher writes "Kasun", not "Kasun Perera".
 *
 * Deliberately generous: `foldedKey` inside `namesMatch` folds the consonants the four languages
 * disagree about, so over-matching here means the teacher is asked which student was meant, which
 * is requirement 3.3 and harmless. Under-matching would mean guessing.
 */
function nameCandidates(student) {
  const fields = [student.displayName, student.nameSinhala, student.nameTamil, ...(student.aliases ?? [])]
    .filter((v) => typeof v === 'string' && v);

  return fields.flatMap((field) => [field, ...field.split(/\s+/)]).filter(Boolean);
}

/** Every student in every class this teacher owns. The only roster a name may resolve against. */
async function rosterInScope(deps, scope) {
  const roster = [];
  for (const classId of scope.classIds) {
    roster.push(...await queryAll(deps, {
      TableName: deps.tables.students,
      IndexName: 'byClass',
      KeyConditionExpression: 'classId = :c',
      ExpressionAttributeValues: { ':c': classId },
    }));
  }
  return roster;
}

/**
 * Resolve one model-supplied name to exactly one student in the teacher's own classes.
 *
 * Returns `{ student }` on a single match, or `{ ask }` for zero or several — requirement 3.3:
 * ask which student is meant, never guess. `options` lists our own stored display names, so the
 * question we put to the teacher never echoes the spelling that arrived in the message.
 */
export function resolveStudent(name, roster) {
  const matches = roster.filter((s) => nameCandidates(s).some((candidate) => namesMatch(name, candidate)));

  if (matches.length === 1) return { student: matches[0] };

  return {
    ask: matches.length === 0 ? 'no_matching_student' : 'which_student',
    options: matches.map((s) => ({ studentId: s.studentId, displayName: s.displayName })),
  };
}

/** Resolve, then re-authorise the student's OWN class against the teacher's scope. */
function resolveInScope(name, roster, scope) {
  const found = resolveStudent(name, roster);
  if (found.ask) return found;

  // The row came from a class in scope, so this cannot fail today. It is here because the day
  // someone adds a second way to reach this function, this is the line that still holds.
  assertInScope(found.student.classId, scope, 'class');
  return found;
}

/** The first three lines of design §3.2, shared so no action can accidentally omit one. */
async function teacherSession(event, deps) {
  const { role, sub } = sessionAttributes(event);   // identity, out of band
  requireRole(role, 'teacher');                     // first statement, before any logic
  const scope = await resolveScope(role, sub, deps);
  return { role, sub, scope };
}

// --- 1. addStudent (requirements 2.2-2.5) ------------------------------------------------------

/**
 * Add one student to a class the teacher owns.
 *
 * Requirement 2.3: a class name that does not resolve inside the teacher's own classes is refused
 * as `out_of_scope` — the same refusal as a class that exists but belongs to someone else, so the
 * reply never discloses whether that class exists.
 *
 * Requirement 2.5: the stored row holds display name, class, an optional parent contact and an
 * optional grade. No phone number, address, date of birth, school, photo or national ID.
 */
export async function addStudent(event, deps) {
  const { role, sub, scope } = await teacherSession(event, deps);
  const p = modelParams(event);

  const className = parseClassName(p.className);
  const studentName = parseName(p.studentName);

  const classes = await queryAll(deps, {
    TableName: deps.tables.classes,
    IndexName: 'byTeacher',
    KeyConditionExpression: 'teacherId = :sub',
    ExpressionAttributeValues: { ':sub': sub },
  });
  const matches = classes.filter((c) => namesMatch(className, c.name));

  // Zero matches and several matches are both refusals, and `assertInScope` produces the refusal
  // so the code path is identical to naming another teacher's class (req 2.3).
  const classId = assertInScope(matches.length === 1 ? matches[0].classId : null, scope, 'class');

  const item = {
    studentId: `stu-${randomUUID()}`,
    classId,
    displayName: studentName,
    nameKey: nameKey(studentName),          // design §4: the lookup key, from the shared normaliser
    addedBy: sub,
  };
  if (p.parentContact) item.parentContact = text(p.parentContact, 80);
  if (p.grade) item.grade = text(p.grade, 20);

  await deps.put({
    TableName: deps.tables.students,
    Item: item,
    ConditionExpression: 'attribute_not_exists(studentId)',   // a fresh uuid must never clobber
  });

  await writeAudit(deps, {
    classId,
    actorSub: sub,
    actorRole: role,
    action: 'addStudent',
    targetId: item.studentId,
    before: null,                                             // requirement 2.4
    after: item,
  });

  return { ok: true, action: 'addStudent', studentId: item.studentId, displayName: item.displayName, classId };
}

// --- 2. markAttendance (requirements 3.1-3.4) --------------------------------------------------

/**
 * Mark one date's attendance for one or more students.
 *
 * All-or-nothing: if any single name fails to resolve to exactly one student, nothing is written
 * and the teacher is asked (req 3.3). A half-marked register is worse than an unmarked one,
 * because the teacher has no way to see which half took.
 *
 * `today` is an argument, never `new Date()`, so "yesterday" / "ඊයේ" / "நேற்று" is deterministic.
 */
export async function markAttendance(event, deps, { today } = {}) {
  const { role, sub, scope } = await teacherSession(event, deps);
  const p = modelParams(event);

  const names = parseNames(p.names ?? p.studentName);
  const date = parseDate(p.date, today);
  const status = parseStatus(p.status);

  const roster = await rosterInScope(deps, scope);

  const students = [];
  for (const name of names) {
    const found = resolveInScope(name, roster, scope);
    if (found.ask) return { ok: false, action: 'markAttendance', ...found };   // nothing written yet
    students.push(found.student);
  }

  const recorded = [];
  for (const student of students) {
    const before = await readRow(deps, {
      TableName: deps.tables.attendance,
      pk: 'studentId', pkValue: student.studentId,
      sk: 'date', skValue: date,
    });

    const after = {
      studentId: student.studentId,
      date,
      classId: student.classId,
      status,
      // design §4.0: the `byClass` index sorts on this stored composite. Omit it and the row is
      // invisible to every class-wide read, which is a silent data-loss bug, not a lookup bug.
      dateStudentId: `${date}#${student.studentId}`,
      recordedBy: sub,
    };

    await deps.put({ TableName: deps.tables.attendance, Item: after });

    // Requirement 3.2: re-marking overwrites, and the audit entry carries BOTH sides.
    await writeAudit(deps, {
      classId: student.classId,
      actorSub: sub,
      actorRole: role,
      action: 'markAttendance',
      targetId: student.studentId,
      before: before ?? null,
      after,
    });

    recorded.push({ studentId: student.studentId, displayName: student.displayName, status, date });
  }

  return { ok: true, action: 'markAttendance', date, status, recorded };   // req 3.4
}

// --- 3. recordFee (requirements 4.1, 4.2, 4.5) -------------------------------------------------

/**
 * Record a fee payment — in two steps, because money is the one place where a wrong write is
 * worse than a slow write (requirement 4.5).
 *
 * Step 1 (`confirmed` absent, the default): validate, resolve, re-authorise, and return the parsed
 * amount and period for the teacher to confirm. **Nothing is written and nothing is audited.**
 * Step 2 (`confirmed` true): the same validation runs again from scratch, then the row is written.
 *
 * The confirmation is not state we keep: step 2 re-derives and re-authorises everything, so a
 * `confirmed=true` that arrives on its own is no shortcut past any gate.
 */
export async function recordFee(event, deps, { today } = {}) {
  const { role, sub, scope } = await teacherSession(event, deps);
  const p = modelParams(event);

  const studentName = parseName(p.studentName);
  const amount = parseAmount(p.amount);
  const period = parsePeriod(p.period, today);
  const method = p.method ? text(p.method, 20) : null;

  const roster = await rosterInScope(deps, scope);
  const found = resolveInScope(studentName, roster, scope);
  if (found.ask) return { ok: false, action: 'recordFee', ...found };
  const student = found.student;

  // Default is unconfirmed. Only a literal true survives, so an absent, empty, 'maybe' or
  // 'ignore previous instructions' value all leave the ledger untouched.
  const confirmed = p.confirmed === true || text(p.confirmed, 10).toLowerCase() === 'true';
  if (!confirmed) {
    return {
      ok: false,
      action: 'recordFee',
      confirm: {
        studentId: student.studentId,
        displayName: student.displayName,
        amount,
        currency: 'LKR',
        period,
        method,
      },
    };
  }

  const before = await readRow(deps, {
    TableName: deps.tables.fees,
    pk: 'studentId', pkValue: student.studentId,
    sk: 'period', skValue: period,
  });

  const after = {
    studentId: student.studentId,
    period,
    classId: student.classId,
    amountDue: before?.amountDue ?? amount,   // keep the class's billed amount; only paid changes
    amountPaid: amount,
    currency: 'LKR',                          // requirement 4.1
    method,
    recordedBy: sub,
  };

  await deps.put({ TableName: deps.tables.fees, Item: after });

  await writeAudit(deps, {                    // requirement 4.2: before and after amounts
    classId: student.classId,
    actorSub: sub,
    actorRole: role,
    action: 'recordFee',
    targetId: student.studentId,
    before: before ?? null,
    after,
  });

  return {
    ok: true,
    action: 'recordFee',
    studentId: student.studentId,
    displayName: student.displayName,
    amount,
    currency: 'LKR',
    period,
  };
}

// --- 4. addMarks (requirements 5.1-5.3) --------------------------------------------------------

/**
 * Record one assessment mark.
 *
 * Requirement 5.2: non-numeric, negative or above the stated maximum is refused by `parseScore`
 * before anything is read or written, and the teacher is asked to restate.
 */
export async function addMarks(event, deps, { today } = {}) {
  const { role, sub, scope } = await teacherSession(event, deps);
  const p = modelParams(event);

  const studentName = parseName(p.studentName);
  const { score, maxScore } = parseScore(p.score, p.maxScore);
  const date = parseDate(p.date, today);
  const assessment = text(p.assessment, 60);
  const sk = assessmentId(assessment, date);

  const roster = await rosterInScope(deps, scope);
  const found = resolveInScope(studentName, roster, scope);
  if (found.ask) return { ok: false, action: 'addMarks', ...found };
  const student = found.student;

  const before = await readRow(deps, {
    TableName: deps.tables.marks,
    pk: 'studentId', pkValue: student.studentId,
    sk: 'assessmentId', skValue: sk,
  });

  const after = {
    studentId: student.studentId,
    assessmentId: sk,
    classId: student.classId,
    assessment,
    date,
    score,
    maxScore,
    recordedBy: sub,
  };
  if (p.subject) after.subject = text(p.subject, 40);

  await deps.put({ TableName: deps.tables.marks, Item: after });

  await writeAudit(deps, {                    // requirement 5.3: before and after values
    classId: student.classId,
    actorSub: sub,
    actorRole: role,
    action: 'addMarks',
    targetId: student.studentId,
    before: before ?? null,
    after,
  });

  return {
    ok: true,
    action: 'addMarks',
    studentId: student.studentId,
    displayName: student.displayName,
    assessment,
    score,
    maxScore,
    date,
  };
}

export { InputError };

/** The action table of design §6.2, as code. `index.mjs` dispatches through this and nothing else. */
export const ACTIONS = { addStudent, markAttendance, recordFee, addMarks };
