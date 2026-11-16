// Parent updates and the approval gate — requirements 6.1-6.6.
//
// Two actions, and the whole point of the file is the wall between them:
//
//   draftParentUpdate     writes a `messages` row with status 'draft'. A draft is invisible to
//                         every parent inbox, because `GET /parent/inbox` queries the `byParent`
//                         index for `begins_with(statusCreatedAt, 'approved#')` and a draft's
//                         composite reads `draft#…`. Invisibility is a property of the key, not of
//                         a filter someone can forget (req 6.2, design §4.0).
//   approveParentUpdate   the teacher-only write that flips that one attribute, and the only way a
//                         message ever reaches a parent (req 6.3). Audited with the exact approved
//                         text (req 6.6).
//
// Requirement 6.1 is enforced by composition, not by instruction: **this handler writes the draft
// text itself**, from stored attendance, fees and marks rows, using fixed respectful sentences.
// Neither the teacher's wording nor the model's wording is ever copied into `body`. So "tell them
// he failed and is lazy" (case D1) cannot produce shaming language — there is no code path that
// puts a caller's adjective into a draft — and requirement 6.5 holds without a word filter.
//
// Requirement 6.4 / case D2: a figure the teacher states that no stored row supports is reported
// back as a mismatch, and the draft uses the stored value. Only the PARSED NUMBER is echoed, never
// the caller's string, for the same reason `DenyError` carries a code and not attacker text.
//
// Same five lines of design §3.2 at the top of each action as in `actions.mjs`, in the same order.
// The three small helpers below mirror private ones in that file; they are duplicated rather than
// exported from it because that file is out of scope for this change, and both copies are 10 lines
// of DynamoDB plumbing with no policy in them.

import { randomUUID } from 'node:crypto';

import {
  sessionAttributes, claimsFromEvent, requireRole, resolveScope, assertInScope,
} from '../../lib/auth.mjs';
import { writeAudit } from '../../lib/audit.mjs';
import { modelParams, resolveStudent } from './actions.mjs';
import { InputError, parseName, text } from './validate.mjs';

/** How many stored rows one draft may cite. A draft is a short message, not a transcript. */
const MAX_SOURCE_FACTS = 40;

// --- plumbing ----------------------------------------------------------------------------------

/** Run a query to exhaustion. A truncated roster would resolve a name to the wrong child. */
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
 * Identity for a teacher write, from whichever server-set channel this invocation arrived on.
 *
 * `sessionAttributes` is the Bedrock path, set by our chat Lambda from verified claims; `jwt.claims`
 * is the HTTP path, verified by the API Gateway authorizer before our code runs (design §3.1). Both
 * are set by the server and neither is readable or writable by the model or the client, which is why
 * one action can serve `POST /teacher/drafts/{id}/approve` and the agent alike. Nothing else in the
 * event is consulted.
 */
function serverIdentity(event) {
  const fromSession = sessionAttributes(event);
  if (fromSession.role && fromSession.sub) return fromSession;

  const { role, sub } = claimsFromEvent(event);
  return { role, sub };
}

/** The first three lines of design §3.2, shared so neither action can accidentally omit one. */
async function teacherSession(event, deps) {
  const { role, sub } = serverIdentity(event);
  requireRole(role, 'teacher');                     // a parent or student session dies here
  const scope = await resolveScope(role, sub, deps);
  return { role, sub, scope };
}

// --- 1. draftParentUpdate (requirements 6.1, 6.2, 6.4, 6.5) ------------------------------------

/** `Rs. 2,500` — our own formatting of a stored number, never the caller's string. */
const money = (n) => `Rs. ${Number(n).toLocaleString('en-US')}`;

/** `2026-11` → `November 2026`, so a parent reads a month rather than a sort key. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function monthName(period) {
  const [year, month] = String(period ?? '').split('-');
  const name = MONTHS[Number(month) - 1];
  return name ? `${name} ${year}` : String(period ?? '');
}

/**
 * Turn the stored rows into sentences and the citations that back them.
 *
 * Every returned line is built from a field of a row that was read in this invocation, so there is
 * no sentence in a draft that `sourceFacts` cannot account for (req 6.1).
 */
function composeSections({ attendance, fees, marks }, focus) {
  const wanted = (section) => focus === 'overall' || focus === section;
  const lines = [];
  const facts = [];

  if (wanted('attendance') && attendance.length) {
    const present = attendance.filter((r) => r.status === 'present').length;
    const late = attendance.filter((r) => r.status === 'late').length;
    const latest = attendance[attendance.length - 1];

    lines.push(
      `Attendance: present on ${present} of ${attendance.length} recorded days`
      + `${late ? `, late on ${late}` : ''}. Most recent record ${latest.date}: ${latest.status}.`,
    );
    for (const r of attendance) {
      facts.push({ table: 'attendance', key: `${r.studentId}#${r.date}`, value: r.status });
    }
  }

  if (wanted('fees') && fees.length) {
    for (const r of fees) {
      const due = Number(r.amountDue ?? 0);
      const paid = Number(r.amountPaid ?? 0);
      const balance = due - paid;
      lines.push(
        `Fees for ${monthName(r.period)}: ${money(due)} due, ${money(paid)} received`
        + `${balance > 0 ? `, ${money(balance)} still outstanding` : ''}.`,
      );
      facts.push({ table: 'fees', key: `${r.studentId}#${r.period}`, value: `${paid}/${due} ${r.currency ?? 'LKR'}` });
    }
  }

  if (wanted('marks') && marks.length) {
    for (const r of marks) {
      lines.push(`${r.assessment} on ${r.date}: ${r.score} out of ${r.maxScore}.`);
      facts.push({ table: 'marks', key: `${r.studentId}#${r.assessmentId}`, value: `${r.score}/${r.maxScore}` });
    }
  }

  return { lines, facts: facts.slice(0, MAX_SOURCE_FACTS) };
}

/**
 * Every figure the stored rows actually support, as numbers.
 *
 * Used only to answer one question: does a number the teacher stated appear anywhere in this
 * child's records? Requirement 6.4 needs nothing more than that.
 */
function storedFigures({ fees, marks }) {
  const figures = new Set();
  for (const r of marks) { figures.add(Number(r.score)); figures.add(Number(r.maxScore)); }
  for (const r of fees) { figures.add(Number(r.amountDue)); figures.add(Number(r.amountPaid)); }
  figures.delete(Number.NaN);
  return figures;
}

/**
 * Requirement 6.4, case D2: the teacher says "say Dilmi got 90" and the stored mark is 72.
 *
 * Returns `{ claimed, stored }` for the first stated figure no stored row supports, or `null`.
 * `claimed` is the number this function parsed, not the caller's text — a mismatch report must not
 * become a way to get an arbitrary string in front of the model a second time.
 */
function findMismatch(claimRaw, rows) {
  const claim = text(claimRaw, 200);
  if (!claim) return null;

  const figures = storedFigures(rows);
  const stated = [...claim.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).slice(0, 10);

  for (const n of stated) {
    if (figures.has(n)) continue;

    const mark = rows.marks[rows.marks.length - 1];
    return {
      claimed: n,
      stored: mark
        ? `${mark.assessment} on ${mark.date}: ${mark.score} out of ${mark.maxScore}`
        : 'no mark is recorded for this student',
    };
  }
  return null;
}

const FOCUS = new Set(['attendance', 'fees', 'marks', 'overall']);

/**
 * Draft one parent update for a student in a class the teacher owns.
 *
 * Nothing becomes visible to a parent here: the row is written with status `draft` and the
 * `statusCreatedAt` composite of design §4.0, so it lands in the teacher's `byTeacher` drafts view
 * and nowhere in any parent's inbox (req 6.2).
 */
export async function draftParentUpdate(event, deps, { now = new Date() } = {}) {
  const { role, sub, scope } = await teacherSession(event, deps);
  const p = modelParams(event);

  const studentName = parseName(p.studentName);
  const focusGiven = text(p.focus, 20).toLowerCase();
  const focus = FOCUS.has(focusGiven) ? focusGiven : 'overall';

  const roster = await rosterInScope(deps, scope);
  const found = resolveStudent(studentName, roster);
  if (found.ask) return { ok: false, action: 'draftParentUpdate', ...found };   // req 3.3, nothing written
  const student = found.student;

  // The row came from a class in scope, so this cannot fail today. It is here because the day
  // someone adds a second way to reach this function, this is the line that still holds.
  const classId = assertInScope(student.classId, scope, 'class');

  // Requirement 6.1: the ONLY inputs to the draft text. Read per student, by table PK — a parent
  // update needs nothing class-wide, so no class-wide read happens.
  const rows = {
    attendance: await rowsForStudent(deps, deps.tables.attendance, student.studentId),
    fees: await rowsForStudent(deps, deps.tables.fees, student.studentId),
    marks: await rowsForStudent(deps, deps.tables.marks, student.studentId),
  };

  const mismatch = findMismatch(p.claimedFact ?? p.claim ?? p.fact, rows);
  const { lines, facts } = composeSections(rows, focus);

  const body = [
    `Dear parent, here is an update about ${student.displayName}.`,
    ...(lines.length ? lines : ['There are no records for this period yet.']),
    'Please contact the class teacher if you would like to discuss this.',
  ].join('\n');

  const createdAt = now.toISOString();
  const item = {
    messageId: `msg-${randomUUID()}`,
    studentId: student.studentId,
    classId,
    teacherId: sub,
    status: 'draft',                              // requirement 6.2
    createdAt,
    statusCreatedAt: `draft#${createdAt}`,        // design §4.0 — omit it and the row is index-invisible
    body,
    sourceFacts: facts,                           // design §4: which stored rows this was built from
    createdBy: sub,
  };
  // Only when the child actually has a linked parent, so a missing link is visible in the result
  // rather than written as an empty GSI key.
  if (typeof student.parentSub === 'string' && student.parentSub) item.parentSub = student.parentSub;
  if (mismatch) item.mismatch = mismatch;         // requirement 6.4, kept with the draft as evidence

  await deps.put({
    TableName: deps.tables.messages,
    Item: item,
    ConditionExpression: 'attribute_not_exists(messageId)',   // a fresh uuid must never clobber
  });

  await writeAudit(deps, {
    classId,
    actorSub: sub,
    actorRole: role,
    action: 'draftParentUpdate',
    targetId: student.studentId,
    before: null,
    after: item,
  });

  return {
    ok: true,
    action: 'draftParentUpdate',
    draftId: item.messageId,
    status: 'draft',
    studentId: student.studentId,
    displayName: student.displayName,
    draftText: body,
    basedOn: facts.map((f) => `${f.table} ${f.key} = ${f.value}`),
    sourceFacts: facts,
    mismatch,
    parentLinked: Boolean(item.parentSub),
    awaitingApproval: true,                       // requirement 6.3: not visible to anyone yet
  };
}

// --- 2. approveParentUpdate (requirements 6.3, 6.6) --------------------------------------------

/**
 * The approval gate. A teacher-only write, and the only transition from `draft` to `approved`.
 *
 * The stored `body` is approved exactly as it stands. There is deliberately no way to supply
 * replacement text here: an approval that could carry its own wording would be a hole straight
 * through requirement 6.1, since the draft's whole guarantee is that every sentence in it came from
 * a stored row. A teacher who wants different wording asks for a new draft.
 *
 * A draft that does not exist and a draft in another teacher's class produce the SAME refusal, so
 * the reply never discloses which it was.
 */
export async function approveParentUpdate(event, deps, { now = new Date() } = {}) {
  const { role, sub, scope } = await teacherSession(event, deps);

  // The id is client- or model-supplied either way, so it is a hint until the row behind it has
  // been read and its class re-authorised below.
  const draftId = text(modelParams(event).draftId ?? event?.pathParameters?.id, 80);
  if (!draftId) throw new InputError('draft_id_required');

  const row = (await deps.get({
    TableName: deps.tables.messages,
    Key: { messageId: draftId },
  }))?.Item;

  // No row, or a row in a class this teacher does not own: one refusal, one code (req 10.3's
  // sibling rule for writes). `assertInScope` produces it, so the two paths are literally one line.
  assertInScope(row ? row.classId : null, scope, 'class');

  // Already approved — by this teacher a moment ago, or by a concurrent request. Nothing to change,
  // so nothing is written and nothing is audited: an audit entry with before === after is noise.
  if (row.status === 'approved') {
    return {
      ok: true, action: 'approveParentUpdate', draftId, status: 'approved', alreadyApproved: true,
      studentId: row.studentId,
    };
  }
  if (row.status !== 'draft') throw new InputError('draft_not_approvable');

  const approvedAt = now.toISOString();
  const after = {
    ...row,
    status: 'approved',                            // requirement 6.3
    // design §4.0 again, and the reason the parent's inbox sorts on approval time: a message thread
    // is ordered by when it arrived, which for a parent is the moment it became visible.
    statusCreatedAt: `approved#${approvedAt}`,
    approvedBy: sub,
    approvedAt,
  };

  try {
    await deps.put({
      TableName: deps.tables.messages,
      Item: after,
      // Only a row that is still a draft may be approved. Two simultaneous approvals therefore
      // produce one write, and the loser lands on the alreadyApproved path on its next read.
      ConditionExpression: '#status = :draft',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':draft': 'draft' },
    });
  } catch (e) {
    if (e?.name === 'ConditionalCheckFailedException') {
      return {
        ok: true, action: 'approveParentUpdate', draftId, status: 'approved', alreadyApproved: true,
        studentId: row.studentId,
      };
    }
    throw e;
  }

  // Requirement 6.6: the approving teacher, the timestamp, and the exact approved text.
  await writeAudit(deps, {
    classId: row.classId,
    actorSub: sub,
    actorRole: role,
    action: 'approveParentUpdate',
    targetId: row.studentId,
    before: row,
    after: { ...after, approvedText: after.body },
  });

  return {
    ok: true,
    action: 'approveParentUpdate',
    draftId,
    status: 'approved',
    studentId: row.studentId,
    approvedText: after.body,
    approvedAt,
    visibleToParent: Boolean(after.parentSub),
  };
}

/**
 * The two rows design §6.2 adds to the action table. `actions-teacher/index.mjs` merges this into
 * its dispatch so nothing else in that file changes.
 */
export const DRAFT_ACTIONS = { draftParentUpdate, approveParentUpdate };

export const __test__ = { findMismatch, composeSections, monthName };
