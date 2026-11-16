// The four read views: a parent's inbox, a teacher's pending drafts, a teacher's audit log, and
// the single-student export of requirement 13.8.
//
// Genuinely read-only. Nothing in this file writes, and `template.yaml` grants the function
// `GetItem`, `BatchGetItem` and `Query` only — including on `audit_log`, which keeps requirement
// 10.4 true by the absence of a capability rather than by the absence of a call.
//
// Same design §3.2 order as every action group, with `claimsFromEvent` in place of
// `sessionAttributes` because these arrive over HTTP, where the API Gateway JWT authorizer has
// already verified signature, issuer, audience and expiry before our code runs (requirement 1.2):
//
//   const { role, sub } = claimsFromEvent(event);   never the body, the query string or a header
//   requireRole(role, 'parent' | 'teacher');        wrong role dies on the first statement
//   const scope = await resolveScope(role, sub, …)  resolved server-side from the caller's own sub
//   every id the CLIENT supplied is assertInScope'd before it is used as a key
//
// The client-supplied ids here are real: `?studentId=`, `?classId=` and the `{id}` of the export
// path all arrive from the browser, so each one goes through `assertInScope` first. A student or
// class that does not exist and one that belongs to someone else produce the SAME `out_of_scope`
// refusal, so a response never discloses which it was (cases A1, A3, A6, A7, A8; requirement 10.3).
//
// Drafts never leak here either: `/parent/inbox` queries `messages.byParent` for
// `begins_with(statusCreatedAt, 'approved#')`, and a draft's composite reads `draft#…`
// (design §4.0), so an unapproved message is invisible to the index the inbox reads (req 6.2).

import { claimsFromEvent, requireRole, resolveScope, assertInScope } from '../../lib/auth.mjs';

/** Every refusal this module can produce for a malformed request. Closed set, like `InputError`. */
const READ_CODES = new Set(['bad_request', 'student_id_required', 'class_id_invalid']);

/** Thrown for a malformed request. Carries a code, never the client's text. */
export class ReadError extends Error {
  constructor(code = 'bad_request') {
    const safe = READ_CODES.has(code) ? code : 'bad_request';
    super(`bad request: ${safe}`);
    this.name = 'ReadError';
    this.code = safe;
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** A client-supplied page size, clamped. An unbounded list view is a cost and a timeout risk. */
function parseLimit(raw) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/** One query-string value, trimmed and capped. */
function param(event, name, max = 80) {
  const value = event?.queryStringParameters?.[name];
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Run a query to exhaustion. Used where completeness matters more than a bounded page. */
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

/** The design §3.2 preamble, shared so no view can accidentally skip a line. */
async function session(event, deps, expectedRole) {
  const { role, sub } = claimsFromEvent(event);
  requireRole(role, expectedRole);
  const scope = await resolveScope(role, sub, deps);
  return { role, sub, scope };
}

// --- 1. GET /parent/inbox (requirements 7.1, 6.2) ----------------------------------------------

/**
 * Approved messages about this parent's own children, newest first.
 *
 * Three independent reasons a draft cannot appear: the `begins_with` on the index, the explicit
 * status check below, and the fact that the only writer of `approved#…` is the teacher-only
 * approval gate in `actions-teacher/drafts.mjs`.
 */
export async function parentInbox(event, deps) {
  const { sub, scope } = await session(event, deps, 'parent');

  // Optional filter. Supplied by the client, so it is re-authorised before it filters anything —
  // and a request naming another family's child is refused here, not answered empty (case A1).
  const requested = param(event, 'studentId');
  if (requested) assertInScope(requested, scope, 'student');

  const rows = await queryAll(deps, {
    TableName: deps.tables.messages,
    IndexName: 'byParent',
    KeyConditionExpression: 'parentSub = :sub AND begins_with(statusCreatedAt, :approved)',
    ExpressionAttributeValues: { ':sub': sub, ':approved': 'approved#' },
    ScanIndexForward: false,                      // newest first (requirement 7.1)
  });

  const messages = rows
    // The index is keyed on the caller's own `sub`, so these rows are already theirs. Re-checking
    // against the resolved scope costs nothing and means a mislinked row cannot widen an inbox.
    .filter((m) => m.status === 'approved' && scope.studentIds.includes(m.studentId))
    .filter((m) => !requested || m.studentId === requested)
    .slice(0, parseLimit(param(event, 'limit', 8)))
    .map((m) => ({
      messageId: m.messageId,
      studentId: m.studentId,
      body: m.body,
      approvedAt: m.approvedAt ?? null,
      createdAt: m.createdAt ?? null,
    }));

  return { status: 200, body: { messages } };
}

// --- 2. GET /teacher/drafts (requirement 6.2) --------------------------------------------------

/** Parent updates awaiting this teacher's approval, newest first. Nobody else can see these. */
export async function teacherDrafts(event, deps) {
  const { sub, scope } = await session(event, deps, 'teacher');

  const rows = await queryAll(deps, {
    TableName: deps.tables.messages,
    IndexName: 'byTeacher',
    KeyConditionExpression: 'teacherId = :t AND begins_with(statusCreatedAt, :draft)',
    ExpressionAttributeValues: { ':t': sub, ':draft': 'draft#' },
    ScanIndexForward: false,
  });

  const drafts = rows
    .filter((m) => m.status === 'draft' && scope.classIds.includes(m.classId))
    .slice(0, parseLimit(param(event, 'limit', 8)))
    .map((m) => ({
      draftId: m.messageId,
      studentId: m.studentId,
      classId: m.classId,
      createdAt: m.createdAt ?? null,
      body: m.body,
      sourceFacts: m.sourceFacts ?? [],           // requirement 6.1: what the draft was built from
      mismatch: m.mismatch ?? null,               // requirement 6.4, if the teacher stated otherwise
    }));

  return { status: 200, body: { drafts } };
}

// --- 3. GET /teacher/audit (requirement 10.3) --------------------------------------------------

/**
 * Audit entries for the classes this teacher owns, newest first — and no others.
 *
 * `audit_log` is partitioned by `classId`, so "only my classes" is expressed as which partitions
 * are queried at all: there is no query here that could return another teacher's entry. An explicit
 * `?classId=` is re-authorised first, so a teacher naming a colleague's class is refused rather
 * than served an empty list.
 */
export async function teacherAudit(event, deps) {
  const { scope } = await session(event, deps, 'teacher');

  const requested = param(event, 'classId');
  const classIds = requested ? [assertInScope(requested, scope, 'class')] : scope.classIds;
  const limit = parseLimit(param(event, 'limit', 8));

  const entries = [];
  for (const classId of classIds) {
    entries.push(...await queryAll(deps, {
      TableName: deps.tables.auditLog,
      KeyConditionExpression: 'classId = :c',
      ExpressionAttributeValues: { ':c': classId },
      ScanIndexForward: false,                    // the SK is `<ISO ts>#<uuid>`, so this is newest-first
    }));
  }

  // Several partitions arrive newest-first each; one merge puts the whole view in order.
  entries.sort((a, b) => String(b.sk ?? '').localeCompare(String(a.sk ?? '')));

  return { status: 200, body: { entries: entries.slice(0, limit) } };
}

// --- 4. GET /teacher/students/{id}/export (requirement 13.8) -----------------------------------

/**
 * Everything Panthiya holds about one student, as JSON, for a teacher who owns that student's class.
 *
 * `{id}` comes from the URL, so it is a client-supplied identifier: the student row is read, and
 * **that row's own `classId`** is what gets re-authorised. A student who does not exist and a
 * student in another teacher's class therefore produce the same `out_of_scope` refusal.
 *
 * ponytail: messages are gathered from both `byTeacher` (this teacher's own drafts and approvals)
 * and `byParent` (anything sent to this child's family), unioned by `messageId`. Ceiling: a message
 * about this child written by a *co-teacher* of the same class, for a child with no linked parent,
 * is in neither index. Upgrade path is a `byStudent` GSI on `messages`, which the data model does
 * not have today.
 */
export async function studentExport(event, deps) {
  const { sub, scope } = await session(event, deps, 'teacher');

  const studentId = String(event?.pathParameters?.id ?? '').trim().slice(0, 80);
  if (!studentId) throw new ReadError('student_id_required');

  const student = (await deps.get({
    TableName: deps.tables.students,
    Key: { studentId },
  }))?.Item;

  // One refusal for "no such student" and "not your student", produced by one line.
  const classId = assertInScope(student ? student.classId : null, scope, 'class');

  const attendance = await rowsForStudent(deps, deps.tables.attendance, studentId);
  const fees = await rowsForStudent(deps, deps.tables.fees, studentId);
  const marks = await rowsForStudent(deps, deps.tables.marks, studentId);

  const audit = await queryAll(deps, {
    TableName: deps.tables.auditLog,
    KeyConditionExpression: 'classId = :c',
    ExpressionAttributeValues: { ':c': classId },
  });

  // Both message indexes, unioned by `messageId`, so an export holds drafts and approvals alike.
  const seen = new Map();
  for (const m of await queryAll(deps, {
    TableName: deps.tables.messages,
    IndexName: 'byTeacher',
    KeyConditionExpression: 'teacherId = :t',
    ExpressionAttributeValues: { ':t': sub },
  })) {
    if (m.studentId === studentId) seen.set(m.messageId, m);
  }
  if (student.parentSub) {
    for (const m of await queryAll(deps, {
      TableName: deps.tables.messages,
      IndexName: 'byParent',
      KeyConditionExpression: 'parentSub = :p',
      ExpressionAttributeValues: { ':p': student.parentSub },
    })) {
      if (m.studentId === studentId) seen.set(m.messageId, m);
    }
  }
  const messages = [...seen.values()];

  return {
    status: 200,
    body: {
      exportedAt: new Date().toISOString(),
      student,
      attendance,
      fees,
      marks,
      messages,
      auditLog: audit.filter((e) => e.targetId === studentId),
    },
  };
}

/** The four routes of design §5 that this function serves, keyed by HTTP API `routeKey`. */
export const ROUTES = {
  'GET /parent/inbox': parentInbox,
  'GET /teacher/drafts': teacherDrafts,
  'GET /teacher/audit': teacherAudit,
  'GET /teacher/students/{id}/export': studentExport,
};
