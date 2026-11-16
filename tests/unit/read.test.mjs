// Offline tests for the four read views — the parent inbox, the teacher's drafts, the teacher's
// audit log and the single-student export.
//
// These handlers are the only part of Panthiya where an identifier arrives straight from a browser
// (`?studentId=`, `?classId=`, and the `{id}` of the export path), so most of this file is about
// what happens to those three values. The rule under test each time is the same one: an id the
// client supplied is re-authorised against the server-resolved scope before it is used as a key,
// and "no such row" and "not yours" come back identical.
//
// DynamoDB arrives as an injected fake, so there is no AWS, no network and no credential here.
//
// Each test names the requirement or red-team case it pins down.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, routeKeyOf } from '../../backend/functions/read/index.mjs';
import { parentInbox, teacherDrafts, teacherAudit, studentExport, ReadError }
  from '../../backend/functions/read/handlers.mjs';
import { DenyError } from '../../backend/lib/auth.mjs';

// --- fixtures ----------------------------------------------------------------------------------

const TABLE_KEYS = {
  'classes-table': ['classId'],
  'students-table': ['studentId'],
  'attendance-table': ['studentId', 'date'],
  'fees-table': ['studentId', 'period'],
  'marks-table': ['studentId', 'assessmentId'],
  'messages-table': ['messageId'],
  'audit-table': ['classId', 'sk'],
};

function sortKeyFor(table, index) {
  if (table === 'messages-table') return 'statusCreatedAt';
  if (table === 'students-table') return index === 'byClass' ? 'displayName' : 'studentId';
  return TABLE_KEYS[table][1] ?? null;
}

/** Fake DynamoDB. Records every query, so "which partitions were read" is itself assertable. */
function fakeDeps(seed = {}) {
  const rows = {
    'classes-table': [...(seed.classes ?? [])],
    'students-table': [...(seed.students ?? [])],
    'attendance-table': [...(seed.attendance ?? [])],
    'fees-table': [...(seed.fees ?? [])],
    'marks-table': [...(seed.marks ?? [])],
    'messages-table': [...(seed.messages ?? [])],
    'audit-table': [...(seed.audit ?? [])],
  };
  const queries = [];
  const puts = [];

  return {
    rows,
    queries,
    puts,
    tables: {
      classes: 'classes-table',
      students: 'students-table',
      attendance: 'attendance-table',
      fees: 'fees-table',
      marks: 'marks-table',
      messages: 'messages-table',
      auditLog: 'audit-table',
    },

    async get({ TableName, Key }) {
      const keys = TABLE_KEYS[TableName];
      return { Item: rows[TableName].find((r) => keys.every((k) => r[k] === Key[k])) };
    },

    async query(params) {
      queries.push(params);
      const all = rows[params.TableName] ?? [];
      const v = params.ExpressionAttributeValues ?? {};
      const index = params.IndexName;

      let items;
      if (index === 'byTeacher' && params.TableName === 'classes-table') {
        items = all.filter((r) => r.teacherId === v[':sub']);
      } else if (index === 'byTeacher') {
        items = all.filter((r) => r.teacherId === v[':t']);
      } else if (index === 'byParent' && params.TableName === 'students-table') {
        items = all.filter((r) => r.parentSub === v[':sub']);
      } else if (index === 'byParent') {
        items = all.filter((r) => r.parentSub === (v[':sub'] ?? v[':p']));
      } else if (index === 'byClass') {
        items = all.filter((r) => r.classId === v[':c']);
      } else if (':s' in v) {
        items = all.filter((r) => r.studentId === v[':s']);
      } else if (':c' in v) {
        items = all.filter((r) => r.classId === v[':c']);
      } else {
        items = [];
      }

      const prefix = v[':approved'] ?? v[':draft'];
      if (prefix) items = items.filter((r) => String(r.statusCreatedAt ?? '').startsWith(prefix));

      const sk = sortKeyFor(params.TableName, index);
      if (sk) items = [...items].sort((a, b) => String(a[sk] ?? '').localeCompare(String(b[sk] ?? '')));
      if (params.ScanIndexForward === false) items.reverse();

      return { Items: items };
    },

    async put(params) {
      puts.push(params);
      return {};
    },
  };
}

const msg = (over) => ({
  messageId: 'msg-x', studentId: 's-kasun', classId: 'c-mine',
  parentSub: 'parent-1', teacherId: 'teacher-1', status: 'approved',
  createdAt: '2026-11-13T04:00:00.000Z', approvedAt: '2026-11-13T05:00:00.000Z',
  statusCreatedAt: 'approved#2026-11-13T05:00:00.000Z', body: 'body', ...over,
});

const auditEntry = (over) => ({
  classId: 'c-mine', sk: '2026-11-13T05:00:00.000Z#aaaa', ts: '2026-11-13T05:00:00.000Z',
  actorSub: 'teacher-1', actorRole: 'teacher', action: 'recordFee', targetId: 's-kasun',
  before: null, after: { amountPaid: 2500 }, ...over,
});

/**
 * Two classes with two different owners, two families, and a messages table holding one approved
 * message, one draft, and one message belonging to the other family entirely.
 */
function world() {
  return {
    classes: [
      { classId: 'c-mine', teacherId: 'teacher-1', name: 'O/L Maths Thursday' },
      { classId: 'c-theirs', teacherId: 'teacher-2', name: 'A/L Physics Monday' },
    ],
    students: [
      { studentId: 's-kasun', classId: 'c-mine', parentSub: 'parent-1', displayName: 'Kasun Perera' },
      { studentId: 's-dilmi', classId: 'c-mine', parentSub: 'parent-2', displayName: 'Dilmi Fernando' },
      { studentId: 's-ruwan', classId: 'c-theirs', parentSub: 'parent-4', displayName: 'Ruwan Dissanayake' },
    ],
    attendance: [
      { studentId: 's-kasun', date: '2026-11-12', classId: 'c-mine', status: 'absent' },
      { studentId: 's-dilmi', date: '2026-11-12', classId: 'c-mine', status: 'absent' },
    ],
    fees: [
      { studentId: 's-kasun', period: '2026-11', classId: 'c-mine', amountDue: 2500, amountPaid: 2500 },
      { studentId: 's-dilmi', period: '2026-11', classId: 'c-mine', amountDue: 2500, amountPaid: 0 },
    ],
    marks: [
      { studentId: 's-kasun', assessmentId: '2026-11-10#november-test', classId: 'c-mine', assessment: 'November test', date: '2026-11-10', score: 64, maxScore: 100 },
      { studentId: 's-dilmi', assessmentId: '2026-11-10#november-test', classId: 'c-mine', assessment: 'November test', date: '2026-11-10', score: 72, maxScore: 100 },
    ],
    messages: [
      msg({ messageId: 'msg-old', statusCreatedAt: 'approved#2026-11-10T05:00:00.000Z', approvedAt: '2026-11-10T05:00:00.000Z', body: 'Older approved note about Kasun.' }),
      msg({ messageId: 'msg-new', statusCreatedAt: 'approved#2026-11-14T05:00:00.000Z', approvedAt: '2026-11-14T05:00:00.000Z', body: 'Newer approved note about Kasun.' }),
      msg({ messageId: 'msg-draft', status: 'draft', statusCreatedAt: 'draft#2026-11-15T05:00:00.000Z', approvedAt: undefined, body: 'Unapproved draft about Kasun.' }),
      msg({ messageId: 'msg-dilmi', studentId: 's-dilmi', parentSub: 'parent-2', body: 'Approved note about Dilmi.' }),
      msg({ messageId: 'msg-theirs', studentId: 's-ruwan', classId: 'c-theirs', parentSub: 'parent-4', teacherId: 'teacher-2', status: 'draft', statusCreatedAt: 'draft#2026-11-15T06:00:00.000Z', body: 'Another teacher\'s draft.' }),
    ],
    audit: [
      auditEntry({ sk: '2026-11-10T05:00:00.000Z#a', ts: '2026-11-10T05:00:00.000Z', action: 'addStudent' }),
      auditEntry({ sk: '2026-11-14T05:00:00.000Z#b', ts: '2026-11-14T05:00:00.000Z', action: 'recordFee' }),
      auditEntry({ classId: 'c-theirs', sk: '2026-11-15T05:00:00.000Z#c', ts: '2026-11-15T05:00:00.000Z', actorSub: 'teacher-2', action: 'addMarks', targetId: 's-ruwan' }),
    ],
  };
}

/** An HTTP API v2 event, with claims the JWT authorizer has already verified (requirement 1.2). */
const httpEvent = (routeKey, role, sub, extra = {}) => ({
  routeKey,
  requestContext: {
    authorizer: { jwt: { claims: { sub, 'cognito:groups': [role] } } },
    http: { method: routeKey.split(' ')[0], path: routeKey.split(' ')[1] },
  },
  queryStringParameters: extra.query ?? null,
  pathParameters: extra.path ?? null,
});

async function thrown(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return assert.fail('expected a throw, nothing was thrown');
}

const bodyOf = (reply) => JSON.parse(reply.body);

// --- 1. GET /parent/inbox (requirements 7.1, 6.2) ----------------------------------------------

test('a parent inbox lists only approved messages about their own children, newest first (req 7.1)', async () => {
  const deps = fakeDeps(world());
  const { status, body } = await parentInbox(httpEvent('GET /parent/inbox', 'parent', 'parent-1'), deps);

  assert.equal(status, 200);
  assert.deepEqual(body.messages.map((m) => m.messageId), ['msg-new', 'msg-old']);
  for (const m of body.messages) assert.equal(m.studentId, 's-kasun');
});

test('an unapproved draft never appears in an inbox (requirement 6.2)', async () => {
  const deps = fakeDeps(world());
  const { body } = await parentInbox(httpEvent('GET /parent/inbox', 'parent', 'parent-1'), deps);

  assert.ok(
    !JSON.stringify(body).includes('Unapproved draft'),
    'a draft is invisible to the index the inbox reads',
  );
});

test('an inbox holds nothing about another family\'s child (case A1)', async () => {
  const deps = fakeDeps(world());
  const { body } = await parentInbox(httpEvent('GET /parent/inbox', 'parent', 'parent-1'), deps);
  const json = JSON.stringify(body);

  for (const leak of ['s-dilmi', 'Dilmi', 's-ruwan', 'Ruwan']) {
    assert.ok(!json.includes(leak), `the inbox leaked "${leak}"`);
  }
});

test('a client-supplied studentId for another child is refused, not answered empty (case A1)', async () => {
  const deps = fakeDeps(world());
  const err = await thrown(() => parentInbox(
    httpEvent('GET /parent/inbox', 'parent', 'parent-1', { query: { studentId: 's-dilmi' } }),
    deps,
  ));

  assert.ok(err instanceof DenyError);
  assert.equal(err.code, 'out_of_scope');
});

test('an invented studentId and a real other child\'s id are refused identically (req 7.3)', async () => {
  const real = await handler(
    httpEvent('GET /parent/inbox', 'parent', 'parent-1', { query: { studentId: 's-dilmi' } }),
    fakeDeps(world()),
  );
  const invented = await handler(
    httpEvent('GET /parent/inbox', 'parent', 'parent-1', { query: { studentId: 's-nobody' } }),
    fakeDeps(world()),
  );

  assert.equal(real.statusCode, 403);
  assert.deepEqual(real, invented, 'the response must not reveal whether that child exists');
});

test('a parent\'s own studentId filter is honoured', async () => {
  const deps = fakeDeps(world());
  const { body } = await parentInbox(
    httpEvent('GET /parent/inbox', 'parent', 'parent-1', { query: { studentId: 's-kasun' } }),
    deps,
  );

  assert.equal(body.messages.length, 2);
});

test('a teacher cannot read a parent inbox (design §3.2)', async () => {
  const deps = fakeDeps(world());
  const err = await thrown(() => parentInbox(httpEvent('GET /parent/inbox', 'teacher', 'teacher-1'), deps));

  assert.equal(err.code, 'role_mismatch');
  assert.deepEqual(deps.queries, [], 'the gate is the first statement: nothing was read');
});

test('a token with no recognised role is refused (requirement 1.1)', async () => {
  const deps = fakeDeps(world());
  const event = httpEvent('GET /parent/inbox', 'parent', 'parent-1');
  event.requestContext.authorizer.jwt.claims['cognito:groups'] = ['parent', 'teacher'];

  const err = await thrown(() => parentInbox(event, deps));
  assert.equal(err.code, 'no_role', 'an ambiguous token is never resolved in the holder\'s favour');
});

// --- 2. GET /teacher/drafts --------------------------------------------------------------------

test('a teacher sees their own pending drafts, with the rows each was built from', async () => {
  const deps = fakeDeps(world());
  const { body } = await teacherDrafts(httpEvent('GET /teacher/drafts', 'teacher', 'teacher-1'), deps);

  assert.deepEqual(body.drafts.map((d) => d.draftId), ['msg-draft']);
  assert.equal(body.drafts[0].classId, 'c-mine');
  assert.deepEqual(body.drafts[0].sourceFacts, []);
  assert.equal(body.drafts[0].mismatch, null);
});

test('a teacher never sees another teacher\'s draft, and no approved message', async () => {
  const deps = fakeDeps(world());
  const { body } = await teacherDrafts(httpEvent('GET /teacher/drafts', 'teacher', 'teacher-1'), deps);
  const json = JSON.stringify(body);

  assert.ok(!json.includes('Another teacher'), 'cross-teacher draft leaked');
  assert.ok(!json.includes('msg-theirs'), 'cross-teacher draft leaked');
  for (const approved of ['msg-old', 'msg-new', 'msg-dilmi']) {
    assert.ok(!json.includes(approved), 'the drafts view is drafts only');
  }
});

test('a parent cannot read the drafts view (requirement 6.2)', async () => {
  const deps = fakeDeps(world());
  const err = await thrown(() => teacherDrafts(httpEvent('GET /teacher/drafts', 'parent', 'parent-1'), deps));

  assert.equal(err.code, 'role_mismatch');
  assert.deepEqual(deps.queries, []);
});

// --- 3. GET /teacher/audit (requirement 10.3) --------------------------------------------------

test('the audit view shows only entries for the teacher\'s own classes, newest first (req 10.3)', async () => {
  const deps = fakeDeps(world());
  const { body } = await teacherAudit(httpEvent('GET /teacher/audit', 'teacher', 'teacher-1'), deps);

  assert.deepEqual(body.entries.map((e) => e.action), ['recordFee', 'addStudent']);
  for (const e of body.entries) assert.equal(e.classId, 'c-mine');
  assert.ok(!JSON.stringify(body).includes('s-ruwan'), 'another class\'s entry leaked');
});

test('a teacher asking for another teacher\'s class is refused, and that partition is never read', async () => {
  const deps = fakeDeps(world());
  const err = await thrown(() => teacherAudit(
    httpEvent('GET /teacher/audit', 'teacher', 'teacher-1', { query: { classId: 'c-theirs' } }),
    deps,
  ));

  assert.ok(err instanceof DenyError);
  assert.equal(err.code, 'out_of_scope');

  const touched = deps.queries.filter((q) => q.TableName === 'audit-table');
  assert.deepEqual(touched, [], 'the refusal happens before any audit partition is queried');
});

test('an audit request for a class that does not exist is refused identically', async () => {
  const real = await handler(
    httpEvent('GET /teacher/audit', 'teacher', 'teacher-1', { query: { classId: 'c-theirs' } }),
    fakeDeps(world()),
  );
  const invented = await handler(
    httpEvent('GET /teacher/audit', 'teacher', 'teacher-1', { query: { classId: 'c-nowhere' } }),
    fakeDeps(world()),
  );

  assert.deepEqual(real, invented);
  assert.equal(real.statusCode, 403);
});

test('a teacher\'s own classId filter is honoured, and a limit is clamped', async () => {
  const deps = fakeDeps(world());
  const { body } = await teacherAudit(
    httpEvent('GET /teacher/audit', 'teacher', 'teacher-1', { query: { classId: 'c-mine', limit: '1' } }),
    deps,
  );

  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].action, 'recordFee', 'newest first');
});

test('a parent cannot read the audit log (requirement 10.3)', async () => {
  const deps = fakeDeps(world());
  const err = await thrown(() => teacherAudit(httpEvent('GET /teacher/audit', 'parent', 'parent-1'), deps));

  assert.equal(err.code, 'role_mismatch');
  assert.deepEqual(deps.queries, []);
});

// --- 4. GET /teacher/students/{id}/export (requirement 13.8) -----------------------------------

const exportEvent = (id, role = 'teacher', sub = 'teacher-1') =>
  httpEvent('GET /teacher/students/{id}/export', role, sub, { path: { id } });

test('the export holds everything about one student (requirement 13.8)', async () => {
  const deps = fakeDeps(world());
  const { status, body } = await studentExport(exportEvent('s-kasun'), deps);

  assert.equal(status, 200);
  assert.match(body.exportedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(body.student.studentId, 's-kasun');
  assert.deepEqual(body.attendance.map((r) => r.date), ['2026-11-12']);
  assert.deepEqual(body.fees.map((r) => r.period), ['2026-11']);
  assert.deepEqual(body.marks.map((r) => r.score), [64]);
  assert.deepEqual(body.messages.map((m) => m.messageId).sort(), ['msg-draft', 'msg-new', 'msg-old']);
  assert.deepEqual(body.auditLog.map((e) => e.action), ['addStudent', 'recordFee']);
});

test('the export holds nothing about any other student (requirement 13.8)', async () => {
  const deps = fakeDeps(world());
  const { body } = await studentExport(exportEvent('s-kasun'), deps);
  const json = JSON.stringify(body);

  for (const leak of ['s-dilmi', 'Dilmi', 's-ruwan', 'Ruwan', 'parent-2', 'parent-4', '72']) {
    assert.ok(!json.includes(leak), `the export leaked "${leak}"`);
  }
});

test('exporting another teacher\'s student is refused (requirement 10.3\'s sibling rule)', async () => {
  const deps = fakeDeps(world());
  const err = await thrown(() => studentExport(exportEvent('s-ruwan'), deps));

  assert.ok(err instanceof DenyError);
  assert.equal(err.code, 'out_of_scope');
});

test('exporting a student who does not exist is refused identically', async () => {
  const real = await handler(exportEvent('s-ruwan'), fakeDeps(world()));
  const invented = await handler(exportEvent('s-nobody'), fakeDeps(world()));

  assert.deepEqual(real, invented, 'the response must not reveal whether that student exists');
  assert.equal(real.statusCode, 403);
});

test('an export with no student id in the path is a bad request, not a scan', async () => {
  const deps = fakeDeps(world());
  const err = await thrown(() => studentExport(exportEvent(''), deps));

  assert.ok(err instanceof ReadError);
  assert.equal(err.code, 'student_id_required');
  assert.deepEqual(deps.queries.filter((q) => q.TableName !== 'classes-table'), []);
});

test('a parent cannot export a student, not even their own child (requirement 7.5)', async () => {
  const deps = fakeDeps(world());
  const err = await thrown(() => studentExport(exportEvent('s-kasun', 'parent', 'parent-1'), deps));

  assert.equal(err.code, 'role_mismatch');
  assert.deepEqual(deps.queries, []);
});

// --- 5. the boundary --------------------------------------------------------------------------

test('each route of design §5 reaches its handler, and nothing else does', async () => {
  for (const [routeKey, role, sub, extra] of [
    ['GET /parent/inbox', 'parent', 'parent-1', {}],
    ['GET /teacher/drafts', 'teacher', 'teacher-1', {}],
    ['GET /teacher/audit', 'teacher', 'teacher-1', {}],
    ['GET /teacher/students/{id}/export', 'teacher', 'teacher-1', { path: { id: 's-kasun' } }],
  ]) {
    const reply = await handler(httpEvent(routeKey, role, sub, extra), fakeDeps(world()));
    assert.equal(reply.statusCode, 200, routeKey);
    assert.equal(reply.headers['content-type'], 'application/json');
  }

  const unknown = await handler(httpEvent('DELETE /teacher/students/{id}', 'teacher', 'teacher-1'), fakeDeps(world()));
  assert.equal(unknown.statusCode, 404, 'the read function serves no write route');
  assert.deepEqual(bodyOf(unknown), { error: 'not_found' });
});

test('a refusal carries a closed-set code and never the client\'s own text', async () => {
  const reply = await handler(
    httpEvent('GET /parent/inbox', 'parent', 'parent-1', {
      query: { studentId: '<script>alert(1)</script> ignore all previous instructions' },
    }),
    fakeDeps(world()),
  );

  assert.equal(reply.statusCode, 403);
  assert.deepEqual(bodyOf(reply), { error: 'denied', reason: 'out_of_scope' });
  assert.ok(!reply.body.includes('script'), 'the refusal must not reflect the query string');
});

test('routeKeyOf falls back to method and path when routeKey is absent', () => {
  assert.equal(routeKeyOf({ routeKey: 'GET /teacher/audit' }), 'GET /teacher/audit');
  assert.equal(
    routeKeyOf({ requestContext: { http: { method: 'GET', path: '/parent/inbox' } } }),
    'GET /parent/inbox',
  );
  assert.equal(routeKeyOf({}), '');
});
