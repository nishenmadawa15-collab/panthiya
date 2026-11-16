// getMyChildSummary — the single action a parent session can reach, and the only one it needs.
//
// Same five lines of design §3.2 as every other action group, in the same order:
//
//   const { role, sub } = sessionAttributes(event);   identity, out of band, never from the message
//   requireRole(role, 'parent');                      a teacher or student session dies here
//   const scope = await resolveScope(role, sub, deps) the children LINKED to this sub, read server-side
//   every model-supplied name or id is resolved, then assertInScope(..., 'student')
//   ...read... (there is no write in this file, and the Lambda has no write IAM either)
//
// Two properties of this file do the security work, and both are structural rather than textual:
//
// 1. **No class-wide read path exists.** Every query here is `TableName` + `studentId = :s` on a
//    table PK, or the `messages.byParent` index keyed on the caller's own `sub`. The `byClass`
//    indexes are never named, so "who are the top 3?" and "who hasn't paid this month?" are not
//    refused by a rule — they are unanswerable, because the code that would answer them is absent
//    (cases A2, A4; requirement 7.3).
// 2. **A name is resolved only against this parent's own children.** Another child's name, in
//    English, Sinhala, Tamil, Singlish or with a Cyrillic homoglyph, matches nothing in that list,
//    and `assertInScope` then produces the identical `out_of_scope` refusal it produces for a name
//    that belongs to nobody. So the refusal never discloses whether that child exists
//    (cases A1, A3, A6, A7, A8, D6).
//
// Name comparison goes through `namesMatch` in `backend/lib/names.mjs` and nowhere else: that
// normaliser is the single defence against spelling-based evasion, and a second local copy of it
// would be the bug (design §4.1).
//
// Requirement 7.4: no `parentContact`, phone number or other contact field is read or returned by
// any path in this file, so there is no value for a carpool request to reach.

import { sessionAttributes, requireRole, resolveScope, assertInScope } from '../../lib/auth.mjs';
import { namesMatch } from '../../lib/names.mjs';

/** What a parent may ask about. Anything else collapses to a general summary of the same data. */
const TOPICS = new Set(['marks', 'fees', 'attendance', 'messages', 'overall']);

/** Trim and cap a model-supplied string. Unbounded text is a cost and an injection surface. */
function text(value, max = 80) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * What the model supplied, as a plain object. Untrusted input by definition (design §3.1) —
 * never used as a key or an identifier until it has been through `assertInScope`.
 */
export function modelParams(event) {
  return Object.fromEntries((event?.parameters ?? []).map((p) => [p.name, p.value]));
}

/** Run a query to exhaustion, so a child's second page of marks is never silently dropped. */
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

/** Every row of one table for one student, by table PK. Deliberately never a class-wide index. */
const rowsForStudent = (deps, TableName, studentId) => queryAll(deps, {
  TableName,
  KeyConditionExpression: 'studentId = :s',
  ExpressionAttributeValues: { ':s': studentId },
});

/**
 * Every spelling of a child's name we will accept, including each part on its own, because a
 * parent writes "Kasun", not "Kasun Perera".
 *
 * Generous on purpose: over-matching inside the caller's OWN children only ever leads to "which
 * child did you mean?", which is harmless. It can never widen the set, because the set is the
 * server-resolved scope.
 */
function nameCandidates(student) {
  const fields = [student.displayName, student.nameSinhala, student.nameTamil, ...(student.aliases ?? [])]
    .filter((v) => typeof v === 'string' && v);

  return fields.flatMap((field) => [field, ...field.split(/\s+/)]).filter(Boolean);
}

/** The caller's own children, as full rows. Keyed on the caller's `sub`, never on a parameter. */
const childrenOf = (deps, sub) => queryAll(deps, {
  TableName: deps.tables.students,
  IndexName: 'byParent',
  KeyConditionExpression: 'parentSub = :sub',
  ExpressionAttributeValues: { ':sub': sub },
});

/**
 * Decide which of this parent's children the question is about.
 *
 * Returns `{ student }`, or `{ ask }` when the parent has several children and named none (or named
 * one ambiguously). Throws `DenyError('out_of_scope')` for every other outcome — including a name
 * that belongs to another family's child, which is the whole point.
 */
function pickChild(p, children, scope) {
  // A model-supplied id is a hint like any other. Re-authorised here before it is used as a key.
  const givenId = text(p.studentId ?? p.childId, 80);
  if (givenId) {
    assertInScope(givenId, scope, 'student');
    const student = children.find((c) => c.studentId === givenId);
    // In scope but not in the roster rows means scope and roster disagree. Fail closed rather than
    // read with a half-known child.
    if (!student) assertInScope(null, scope, 'student');
    return { student };
  }

  const name = text(p.childName ?? p.studentName, 80);

  if (!name) {
    if (children.length === 1) return { student: children[0] };
    // No children linked: the same refusal as naming someone else's child.
    if (children.length === 0) assertInScope(null, scope, 'student');
    return { ask: 'which_child', options: children.map((c) => ({ displayName: c.displayName })) };
  }

  const matches = children.filter((c) => nameCandidates(c).some((cand) => namesMatch(name, cand)));

  if (matches.length === 1) {
    // Belt and braces: the row came from the `byParent` index, so this holds today. It is here
    // because the day a second path reaches this function, this is the line that still holds.
    assertInScope(matches[0].studentId, scope, 'student');
    return { student: matches[0] };
  }

  // Zero matches is the refusal that matters. `assertInScope(null, …)` produces it, so a stranger's
  // child, a misspelling and an invented name are literally one code path (cases A1, A6, A7, A8, D6).
  if (matches.length === 0) assertInScope(null, scope, 'student');

  return { ask: 'which_child', options: matches.map((c) => ({ displayName: c.displayName })) };
}

// --- presentation ------------------------------------------------------------------------------

const money = (n) => `Rs. ${Number(n).toLocaleString('en-US')}`;

const NO_RECORD = {
  attendance: 'No attendance has been recorded yet.',
  fees: 'No fee record has been entered yet.',
};

/** Requirement 7.2: say plainly that there is no record, rather than estimating one. */
function summarise(rows, topic) {
  const wanted = (section) => topic === 'overall' || topic === section;
  const out = {};

  if (wanted('attendance')) {
    out.attendance = rows.attendance.length
      ? `Present on ${rows.attendance.filter((r) => r.status === 'present').length} of `
        + `${rows.attendance.length} recorded days. `
        + `Most recent record ${rows.attendance[rows.attendance.length - 1].date}: `
        + `${rows.attendance[rows.attendance.length - 1].status}.`
      : NO_RECORD.attendance;
  }

  if (wanted('fees')) {
    out.fees = rows.fees.length
      ? rows.fees.map((r) => {
        const balance = Number(r.amountDue ?? 0) - Number(r.amountPaid ?? 0);
        return `${r.period}: ${money(r.amountPaid ?? 0)} received of ${money(r.amountDue ?? 0)}`
          + `${balance > 0 ? `, ${money(balance)} outstanding` : ', settled'}.`;
      }).join(' ')
      : NO_RECORD.fees;
  }

  if (wanted('marks')) {
    out.marks = rows.marks.map((r) => `${r.assessment} (${r.date}): ${r.score} out of ${r.maxScore}`);
  }

  if (wanted('messages')) {
    out.messages = rows.messages.map((m) => `${m.approvedAt ?? m.createdAt}: ${m.body}`);
  }

  return out;
}

// --- the action --------------------------------------------------------------------------------

/**
 * Stored attendance, fees, marks and teacher-approved messages for ONE child linked to the caller.
 *
 * @param event the Bedrock action-group invocation
 * @param deps injected `{ query, tables }` — see `backend/lib/ddb.mjs`
 */
export async function getMyChildSummary(event, deps) {
  const { role, sub } = sessionAttributes(event);   // identity, out of band
  requireRole(role, 'parent');                     // first statement, before any logic
  const scope = await resolveScope(role, sub, deps);

  const p = modelParams(event);
  const topicGiven = text(p.topic, 20).toLowerCase();
  const topic = TOPICS.has(topicGiven) ? topicGiven : 'overall';

  const children = await childrenOf(deps, sub);
  const chosen = pickChild(p, children, scope);
  if (chosen.ask) return { ok: false, action: 'getMyChildSummary', ...chosen };
  const child = chosen.student;

  const studentId = assertInScope(child.studentId, scope, 'student');   // last gate before any read

  const rows = {
    attendance: await rowsForStudent(deps, deps.tables.attendance, studentId),
    fees: await rowsForStudent(deps, deps.tables.fees, studentId),
    marks: await rowsForStudent(deps, deps.tables.marks, studentId),
    // Requirement 6.2 / 7.1: approved only. A draft's composite sort key reads `draft#…`, so
    // `begins_with(…, 'approved#')` cannot return one even if a filter were forgotten elsewhere.
    messages: (await queryAll(deps, {
      TableName: deps.tables.messages,
      IndexName: 'byParent',
      KeyConditionExpression: 'parentSub = :sub AND begins_with(statusCreatedAt, :approved)',
      ExpressionAttributeValues: { ':sub': sub, ':approved': 'approved#' },
      ScanIndexForward: false,                     // newest first (requirement 7.1)
    })).filter((m) => m.studentId === studentId),
  };

  return {
    ok: true,
    action: 'getMyChildSummary',
    status: 'ok',
    studentId,
    childName: child.displayName,                  // our stored name, never the caller's spelling
    topic,
    ...summarise(rows, topic),
  };
}

/** The parent row of the action table in design §6.2, as code. One action, and only one. */
export const ACTIONS = { getMyChildSummary };
