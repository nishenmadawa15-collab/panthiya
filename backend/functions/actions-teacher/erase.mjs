// deleteStudent — the erasure half of requirement 13.8, and the only code in Panthiya that removes
// a row. `GET /teacher/students/{id}/export` is its other half and lives in `functions/read/`,
// because an export is a read and the `read` function's IAM policy carries no write action
// (design §4.0). A delete is a write, so it is served here.
//
// **The model cannot reach this action.** Identity comes from `claimsFromEvent` only, and the
// function name is deliberately absent from the Bedrock dispatch table in `index.mjs`: this handler
// is registered against an HTTP route and nothing else. So "delete Dilmi's records" typed into the
// chat box resolves to no action at all, rather than to a tool call the agent could be talked into.
// Erasing a child is a deliberate button press by a teacher, never a sentence a model interpreted.
//
// Same design §3.2 order as every other teacher write, and for the same reason:
//
//   const { role, sub } = claimsFromEvent(event);    identity, from verified JWT claims only
//   requireRole(role, 'teacher');                    a parent or student session dies here
//   const scope = await resolveScope(role, sub, deps)  the teacher's own classes, read server-side
//   the `{id}` from the URL is a hint until the row behind it has been read and its class
//   re-authorised — so a student who does not exist and a student in another teacher's class
//   produce the SAME `out_of_scope` refusal, and the reply never discloses which it was
//   ...delete... then writeAudit(deps, ...) in this same invocation (req 10.2)
//
// Two decisions this file makes, both of which are policy and so belong in the comments:
//
// 1. **`audit_log` is not erased.** Requirement 10.4: the log is append-only and no API updates or
//    deletes an entry. So a deletion is itself an audited event — one more appended row, naming the
//    teacher who erased the child and what was removed — and the history of the fee that was
//    disputed in October survives the child leaving the class in November. This is not an oversight
//    in the privacy promise: it is the promise's stated boundary. It is enforced twice over, because
//    `template.yaml` grants this function `PutItem` only on that table, so a delete pointed at the
//    log would be refused by IAM even if this file asked for one.
// 2. **Messages about the child are deleted, not anonymised.** A `messages` row carries the child's
//    name and their marks in its `body`, so leaving it behind would leave the data the erasure was
//    asked to remove. They are found through the same two indexes the export reads, so what is
//    exported and what is erased are the same set of rows — a difference between those two lists
//    would be the bug.

import { claimsFromEvent, requireRole, resolveScope, assertInScope } from '../../lib/auth.mjs';
import { writeAudit } from '../../lib/audit.mjs';
import { InputError, text } from './validate.mjs';

// --- plumbing ----------------------------------------------------------------------------------
//
// These three helpers are private copies of ones in `actions.mjs` and `drafts.mjs`, duplicated for
// the reason stated there: each is ten lines of DynamoDB plumbing with no policy in it, and hoisting
// them into `lib/` to share would put plumbing in the directory that holds the security spine.

/** Run a query to exhaustion. A truncated inventory is a row left behind after an erasure. */
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

/** Every row of one table for one student, by table PK. Never a class-wide index. */
const rowsForStudent = (deps, TableName, studentId) => queryAll(deps, {
  TableName,
  KeyConditionExpression: 'studentId = :s',
  ExpressionAttributeValues: { ':s': studentId },
});

/** The first three lines of design §3.2. HTTP only — see the header note about the model. */
async function teacherSession(event, deps) {
  const { role, sub } = claimsFromEvent(event);
  requireRole(role, 'teacher');
  const scope = await resolveScope(role, sub, deps);
  return { role, sub, scope };
}

// --- the inventory -----------------------------------------------------------------------------

/**
 * Every `messages` row about this child, from the two indexes that can see one.
 *
 * ponytail: the same union the export performs, with the same ceiling — a message about this child
 * written by a *co-teacher* of the same class, for a child with no linked parent, is in neither
 * index. Upgrade path is a `byStudent` GSI on `messages`, which the data model does not have today.
 * Keeping the two lists identical matters more than closing the gap here: an export that shows a
 * row the delete cannot reach would be a privacy promise that quietly fails.
 */
async function messagesAbout(deps, sub, student) {
  const seen = new Map();

  for (const m of await queryAll(deps, {
    TableName: deps.tables.messages,
    IndexName: 'byTeacher',
    KeyConditionExpression: 'teacherId = :t',
    ExpressionAttributeValues: { ':t': sub },
  })) {
    if (m.studentId === student.studentId) seen.set(m.messageId, m);
  }

  if (student.parentSub) {
    for (const m of await queryAll(deps, {
      TableName: deps.tables.messages,
      IndexName: 'byParent',
      KeyConditionExpression: 'parentSub = :p',
      ExpressionAttributeValues: { ':p': student.parentSub },
    })) {
      if (m.studentId === student.studentId) seen.set(m.messageId, m);
    }
  }

  return [...seen.values()];
}

/**
 * Every row to remove, as exact DynamoDB keys, in the order they will be removed.
 *
 * **The student row is last, and that ordering is the whole recovery story.** A deletion that dies
 * halfway leaves the `students` row in place, so the teacher's retry resolves the same id, reads the
 * same class, and finishes the job — every delete here is idempotent, so a retry is safe. Had the
 * student row gone first, a retry would be refused with `out_of_scope` (there is no row to
 * authorise), and the remaining attendance, fee and mark rows would be orphaned beyond the reach of
 * any endpoint: unreachable, unexportable and undeletable, which is the worst outcome available.
 */
function deletionPlan(deps, student, { attendance, fees, marks, messages }) {
  const plan = [];
  const add = (table, TableName, Key) => plan.push({ table, TableName, Key });

  for (const r of attendance) add('attendance', deps.tables.attendance, { studentId: r.studentId, date: r.date });
  for (const r of fees) add('fees', deps.tables.fees, { studentId: r.studentId, period: r.period });
  for (const r of marks) add('marks', deps.tables.marks, { studentId: r.studentId, assessmentId: r.assessmentId });
  for (const m of messages) add('messages', deps.tables.messages, { messageId: m.messageId });

  add('student', deps.tables.students, { studentId: student.studentId });
  return plan;
}

// --- the action --------------------------------------------------------------------------------

/**
 * Delete all data for one student in a class the teacher owns (requirement 13.8).
 *
 * Returns the tally of what was removed, per table, so the teacher is told what happened rather
 * than just "done". A tally is also what the audit entry records: after an erasure there is no row
 * left to point at, so the count of rows removed is the only evidence that remains.
 *
 * ponytail: a partial failure throws, and the boundary turns that into a 500 the teacher can see
 * and retry — the retry being safe is what the student-row-last ordering above buys. Ceiling: a run
 * that removes three of five fee rows and then dies writes no audit entry for those three.
 * Closing that needs `TransactWriteItems` (and its 100-item limit), which is a bigger change than
 * requirement 13.8 asks for and than a demo data set can justify.
 */
export async function deleteStudent(event, deps) {
  const { role, sub, scope } = await teacherSession(event, deps);

  const studentId = text(event?.pathParameters?.id, 80);
  if (!studentId) throw new InputError('student_id_required');

  const student = (await deps.get({
    TableName: deps.tables.students,
    Key: { studentId },
  }))?.Item;

  // One refusal for "no such student" and "not your student", produced by one line.
  const classId = assertInScope(student ? student.classId : null, scope, 'class');

  // The full inventory is read BEFORE anything is deleted, so the audit entry can name what the
  // erasure removed even though nothing will be left to read afterwards.
  const rows = {
    attendance: await rowsForStudent(deps, deps.tables.attendance, studentId),
    fees: await rowsForStudent(deps, deps.tables.fees, studentId),
    marks: await rowsForStudent(deps, deps.tables.marks, studentId),
    messages: await messagesAbout(deps, sub, student),
  };

  const removed = { attendance: 0, fees: 0, marks: 0, messages: 0, student: 0 };
  for (const step of deletionPlan(deps, student, rows)) {
    try {
      await deps.del({ TableName: step.TableName, Key: step.Key });
    } catch (cause) {
      // Loud, and specific about how far it got. The message carries only our own table names and
      // our own counts — never the path parameter — for the same reason `DenyError` carries a code.
      throw new Error(
        `deleteStudent: failed while removing a ${step.table} row; removed so far ${JSON.stringify(removed)}`,
        { cause },
      );
    }
    removed[step.table] += 1;
  }

  // Requirement 10.2: in this same invocation. Requirement 10.4: appended, never erasing the
  // entries that already describe this child — `before` is the student row as it stood, `after` is
  // the tombstone, because "null" would record that something happened without recording what.
  const audited = await writeAudit(deps, {
    classId,
    actorSub: sub,
    actorRole: role,
    action: 'deleteStudent',
    targetId: studentId,
    before: student,
    after: { deleted: true, removed },
  });

  return {
    ok: true,
    action: 'deleteStudent',
    studentId,
    displayName: student.displayName ?? null,   // confirmation that the right child was erased
    removed,
    auditEntry: audited,                        // the one row this request added
    auditLogRetained: true,                     // requirement 10.4, stated in the response too
  };
}

/** Registered against an HTTP route in `index.mjs`, and deliberately not in the Bedrock table. */
export const HTTP_ONLY_ACTIONS = { deleteStudent };
