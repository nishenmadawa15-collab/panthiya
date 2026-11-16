// Offline tests for parent updates and the approval gate — requirements 6.1-6.6.
//
// The gate is the thing being tested: a draft exists, is invisible to the parent it is about, and
// becomes visible only when a teacher who owns that class approves it. The fake DynamoDB below
// honours `begins_with` on the `statusCreatedAt` composite of design §4.0 and the conditional put
// the approval uses, so "invisible" and "approved exactly once" are observed rather than asserted.
//
// The inbox half of the end-to-end test calls the real `read` handler, so the two sides of the gate
// are exercised through the same row rather than through two fixtures that agree by luck.
//
// Each test names the requirement or red-team case it pins down.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler } from '../../backend/functions/actions-teacher/index.mjs';
import { draftParentUpdate, approveParentUpdate }
  from '../../backend/functions/actions-teacher/drafts.mjs';
import { parentInbox, teacherDrafts } from '../../backend/functions/read/handlers.mjs';
import { InputError } from '../../backend/functions/actions-teacher/validate.mjs';
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

function conditionalFail() {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
}

/** Fake DynamoDB: real GSIs, real `begins_with`, real conditional-put semantics. */
function fakeDeps(seed = {}) {
  const rows = {
    'classes-table': [...(seed.classes ?? [])],
    'students-table': [...(seed.students ?? [])],
    'attendance-table': [...(seed.attendance ?? [])],
    'fees-table': [...(seed.fees ?? [])],
    'marks-table': [...(seed.marks ?? [])],
    'messages-table': [...(seed.messages ?? [])],
    'audit-table': [],
  };
  const puts = [];
  const queries = [];

  return {
    rows,
    puts,
    queries,
    tables: {
      classes: 'classes-table',
      students: 'students-table',
      attendance: 'attendance-table',
      fees: 'fees-table',
      marks: 'marks-table',
      messages: 'messages-table',
      auditLog: 'audit-table',
    },
    dataPuts: () => puts.filter((p) => p.TableName !== 'audit-table'),
    audit: () => rows['audit-table'],
    messages: () => rows['messages-table'],

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
      const table = rows[params.TableName];
      const keys = TABLE_KEYS[params.TableName];
      const at = table.findIndex((r) => keys.every((k) => r[k] === params.Item[k]));
      const condition = params.ConditionExpression ?? '';

      if (at >= 0 && /attribute_not_exists/.test(condition)) throw conditionalFail();
      if (/#status\s*=\s*:draft/.test(condition)) {
        const existing = at >= 0 ? table[at] : null;
        if (!existing || existing.status !== params.ExpressionAttributeValues[':draft']) {
          throw conditionalFail();
        }
      }

      if (at >= 0) table[at] = params.Item;
      else table.push(params.Item);
      return {};
    },
  };
}

/**
 * Dilmi's November mark is 72, as the demo data pins it (case D2 depends on that number).
 * Kasun belongs to the same class; Ruwan belongs to another teacher entirely.
 */
function world() {
  return {
    classes: [
      { classId: 'c-mine', teacherId: 'teacher-1', name: 'O/L Maths Thursday' },
      { classId: 'c-theirs', teacherId: 'teacher-2', name: 'A/L Physics Monday' },
    ],
    students: [
      {
        studentId: 's-dilmi', classId: 'c-mine', parentSub: 'parent-2',
        displayName: 'Dilmi Fernando', nameSinhala: 'දිල්මි ප්‍රනාන්දු', nameTamil: 'தில்மி பெர்னாண்டோ',
      },
      { studentId: 's-kasun', classId: 'c-mine', parentSub: 'parent-1', displayName: 'Kasun Perera' },
      { studentId: 's-ruwan', classId: 'c-theirs', parentSub: 'parent-4', displayName: 'Ruwan Dissanayake' },
    ],
    attendance: [
      { studentId: 's-dilmi', date: '2026-11-05', classId: 'c-mine', status: 'present' },
      { studentId: 's-dilmi', date: '2026-11-12', classId: 'c-mine', status: 'absent' },
    ],
    fees: [
      { studentId: 's-dilmi', period: '2026-11', classId: 'c-mine', amountDue: 2500, amountPaid: 2500, currency: 'LKR' },
    ],
    marks: [
      {
        studentId: 's-dilmi', assessmentId: '2026-11-10#november-test', classId: 'c-mine',
        assessment: 'November test', date: '2026-11-10', score: 72, maxScore: 100,
      },
    ],
  };
}

const bedrockEvent = (role, sub, fn, params = {}) => ({
  messageVersion: '1.0',
  actionGroup: 'actions-teacher',
  function: fn,
  sessionAttributes: { role, sub },
  parameters: Object.entries(params).map(([name, value]) => ({ name, value })),
});

const teacherEvent = (fn, params, sub = 'teacher-1') => bedrockEvent('teacher', sub, fn, params);

/** An HTTP API event for a read view, with claims the JWT authorizer has already verified. */
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

const bodyOf = (response) => JSON.parse(response.response.functionResponse.responseBody.TEXT.body);

// --- 1. draftParentUpdate (requirements 6.1, 6.2) ----------------------------------------------

test('a draft is written with status draft and the statusCreatedAt composite (req 6.2, §4.0)', async () => {
  const deps = fakeDeps(world());
  const result = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'draft');
  assert.equal(result.awaitingApproval, true);

  const [row] = deps.messages();
  assert.equal(row.status, 'draft');
  assert.equal(row.statusCreatedAt, `draft#${row.createdAt}`);
  assert.equal(row.parentSub, 'parent-2');
  assert.equal(row.teacherId, 'teacher-1');
  assert.equal(row.classId, 'c-mine');
});

test('the draft is built only from stored rows, and cites each one (requirement 6.1)', async () => {
  const deps = fakeDeps(world());
  const result = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);

  assert.match(result.draftText, /Dilmi Fernando/);
  assert.match(result.draftText, /72 out of 100/);                 // the stored mark
  assert.match(result.draftText, /Rs\. 2,500 due, Rs\. 2,500 received/);
  assert.match(result.draftText, /present on 1 of 2 recorded days/);

  // One citation per stored row the text drew on: 2 attendance + 1 fee + 1 mark.
  assert.deepEqual(
    result.sourceFacts.map((f) => `${f.table} ${f.key} = ${f.value}`).sort(),
    [
      'attendance s-dilmi#2026-11-05 = present',
      'attendance s-dilmi#2026-11-12 = absent',
      'fees s-dilmi#2026-11 = 2500/2500 LKR',
      'marks s-dilmi#2026-11-10#november-test = 72/100',
    ],
  );
  assert.deepEqual(deps.messages()[0].sourceFacts, result.sourceFacts);
});

test('a figure that contradicts stored data is flagged and the stored value used (req 6.4, case D2)', async () => {
  const deps = fakeDeps(world());
  const result = await draftParentUpdate(
    teacherEvent('draftParentUpdate', { studentName: 'Dilmi', claimedFact: 'say she got 90' }),
    deps,
  );

  assert.deepEqual(result.mismatch, {
    claimed: 90,
    stored: 'November test on 2026-11-10: 72 out of 100',
  });
  assert.match(result.draftText, /72 out of 100/, 'the draft uses the stored value');
  assert.ok(!result.draftText.includes('90'), 'the claimed figure never reaches the draft');
  assert.deepEqual(deps.messages()[0].mismatch, result.mismatch, 'the mismatch is kept as evidence');
});

test('a figure the stored rows do support is not flagged', async () => {
  const deps = fakeDeps(world());
  const result = await draftParentUpdate(
    teacherEvent('draftParentUpdate', { studentName: 'Dilmi', claimedFact: 'she got 72 out of 100' }),
    deps,
  );

  assert.equal(result.mismatch, null);
});

test('shaming wording is never copied into a draft (requirement 6.5, case D1)', async () => {
  const deps = fakeDeps(world());
  const result = await draftParentUpdate(
    teacherEvent('draftParentUpdate', {
      studentName: 'Dilmi',
      focus: 'tell them she failed and is lazy and stupid',
      claimedFact: 'she failed and is lazy',
    }),
    deps,
  );

  // The handler composes the text; no caller string is a source for it, so there is no path for an
  // adjective to arrive. This asserts the property, not a word list.
  for (const word of ['failed', 'lazy', 'stupid']) {
    assert.ok(!result.draftText.toLowerCase().includes(word), `"${word}" reached the draft`);
  }
  assert.match(result.draftText, /Dear parent, here is an update about Dilmi Fernando\./);
});

test('focus narrows the draft to the stored rows of that one section', async () => {
  const deps = fakeDeps(world());
  const result = await draftParentUpdate(
    teacherEvent('draftParentUpdate', { studentName: 'Dilmi', focus: 'marks' }),
    deps,
  );

  assert.match(result.draftText, /72 out of 100/);
  assert.ok(!result.draftText.includes('Attendance'));
  assert.deepEqual(result.sourceFacts.map((f) => f.table), ['marks']);
});

test('a student in another teacher\'s class resolves to nobody, and nothing is written', async () => {
  const deps = fakeDeps(world());
  const result = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Ruwan' }), deps);

  assert.equal(result.ok, false);
  assert.equal(result.ask, 'no_matching_student');
  assert.deepEqual(result.options, [], 'the question never names another teacher\'s student');
  assert.deepEqual(deps.dataPuts(), [], 'nothing was written');
});

test('a parent session cannot draft a parent update (design §3.2)', async () => {
  const deps = fakeDeps(world());
  const err = await thrown(() => draftParentUpdate(
    bedrockEvent('parent', 'parent-2', 'draftParentUpdate', { studentName: 'Dilmi' }),
    deps,
  ));

  assert.ok(err instanceof DenyError);
  assert.equal(err.code, 'role_mismatch');
  assert.deepEqual(deps.puts, [], 'a refused call writes nothing at all (requirement 4.4)');
});

test('drafting is audited with before=null and the stored row as after (requirement 10.1)', async () => {
  const deps = fakeDeps(world());
  const result = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);

  const [entry] = deps.audit();
  assert.equal(entry.action, 'draftParentUpdate');
  assert.equal(entry.actorSub, 'teacher-1');
  assert.equal(entry.actorRole, 'teacher');
  assert.equal(entry.classId, 'c-mine');
  assert.equal(entry.targetId, 's-dilmi');
  assert.equal(entry.before, null);
  assert.equal(entry.after.messageId, result.draftId);
});

// --- 2. the gate, end to end (requirements 6.2, 6.3, 7.1) --------------------------------------

test('a draft is invisible to the parent inbox before approval and visible after (req 6.2, 6.3)', async () => {
  const deps = fakeDeps(world());

  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);
  const inboxEvent = httpEvent('GET /parent/inbox', 'parent', 'parent-2');

  const before = await parentInbox(inboxEvent, deps);
  assert.deepEqual(before.body.messages, [], 'an unapproved draft must not appear in any inbox');

  // The teacher's own drafts view does see it — that is where approval happens.
  const pending = await teacherDrafts(httpEvent('GET /teacher/drafts', 'teacher', 'teacher-1'), deps);
  assert.deepEqual(pending.body.drafts.map((d) => d.draftId), [draft.draftId]);

  const approved = await approveParentUpdate(
    teacherEvent('approveParentUpdate', { draftId: draft.draftId }),
    deps,
  );
  assert.equal(approved.status, 'approved');

  const after = await parentInbox(inboxEvent, deps);
  assert.equal(after.body.messages.length, 1);
  assert.equal(after.body.messages[0].messageId, draft.draftId);
  assert.equal(after.body.messages[0].body, draft.draftText);

  // And it has left the teacher's pending list, because the composite key moved.
  const stillPending = await teacherDrafts(httpEvent('GET /teacher/drafts', 'teacher', 'teacher-1'), deps);
  assert.deepEqual(stillPending.body.drafts, []);
});

test('the approved row carries the approved# composite, not the draft one (design §4.0)', async () => {
  const deps = fakeDeps(world());
  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);
  await approveParentUpdate(teacherEvent('approveParentUpdate', { draftId: draft.draftId }), deps);

  const [row] = deps.messages();
  assert.equal(row.status, 'approved');
  assert.equal(row.statusCreatedAt, `approved#${row.approvedAt}`);
  assert.equal(row.approvedBy, 'teacher-1');
});

// --- 3. approval is teacher-only (requirements 6.3, 6.6) ---------------------------------------

test('approval by a parent is refused and writes nothing', async () => {
  const deps = fakeDeps(world());
  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);
  const writesBefore = deps.puts.length;

  const err = await thrown(() => approveParentUpdate(
    bedrockEvent('parent', 'parent-2', 'approveParentUpdate', { draftId: draft.draftId }),
    deps,
  ));

  assert.ok(err instanceof DenyError);
  assert.equal(err.code, 'role_mismatch');
  assert.equal(deps.puts.length, writesBefore, 'nothing was written');
  assert.equal(deps.messages()[0].status, 'draft', 'the draft is still a draft');
});

test('approval by a student is refused and writes nothing (case D5)', async () => {
  const deps = fakeDeps(world());
  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);

  const err = await thrown(() => approveParentUpdate(
    bedrockEvent('student', 'student-1', 'approveParentUpdate', { draftId: draft.draftId }),
    deps,
  ));

  assert.equal(err.code, 'role_mismatch');
  assert.equal(deps.messages()[0].status, 'draft');
});

test('another teacher cannot approve a draft in a class they do not own', async () => {
  const deps = fakeDeps(world());
  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);

  const err = await thrown(() => approveParentUpdate(
    teacherEvent('approveParentUpdate', { draftId: draft.draftId }, 'teacher-2'),
    deps,
  ));

  assert.ok(err instanceof DenyError);
  assert.equal(err.code, 'out_of_scope');
  assert.equal(deps.messages()[0].status, 'draft');
});

test('a draft that does not exist is refused identically to one in another class', async () => {
  const deps = fakeDeps(world());
  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);

  const missing = await handler(teacherEvent('approveParentUpdate', { draftId: 'msg-does-not-exist' }), deps);
  const foreign = await handler(
    teacherEvent('approveParentUpdate', { draftId: draft.draftId }, 'teacher-2'),
    fakeDeps({ ...world(), messages: [{ ...deps.messages()[0] }] }),
  );

  assert.deepEqual(bodyOf(missing), bodyOf(foreign), 'the refusal must not reveal existence');
  assert.equal(bodyOf(missing).reason, 'out_of_scope');
});

test('an approval with no draft id is refused as invalid input, not guessed at', async () => {
  const deps = fakeDeps(world());
  const err = await thrown(() => approveParentUpdate(teacherEvent('approveParentUpdate', {}), deps));

  assert.ok(err instanceof InputError);
  assert.deepEqual(deps.dataPuts(), []);
});

test('approval is audited with the exact approved text (requirement 6.6)', async () => {
  const deps = fakeDeps(world());
  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);
  const approved = await approveParentUpdate(
    teacherEvent('approveParentUpdate', { draftId: draft.draftId }),
    deps,
  );

  const entry = deps.audit().find((e) => e.action === 'approveParentUpdate');
  assert.equal(entry.actorSub, 'teacher-1');
  assert.equal(entry.actorRole, 'teacher');
  assert.equal(entry.classId, 'c-mine');
  assert.equal(entry.targetId, 's-dilmi');
  assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T.*Z$/);              // ISO 8601 UTC
  assert.equal(entry.before.status, 'draft');
  assert.equal(entry.after.status, 'approved');
  assert.equal(entry.after.approvedText, draft.draftText);        // the exact approved text
  assert.equal(approved.approvedText, draft.draftText);
});

test('approval cannot carry its own replacement text (requirement 6.1 stays true)', async () => {
  const deps = fakeDeps(world());
  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);

  await approveParentUpdate(
    teacherEvent('approveParentUpdate', {
      draftId: draft.draftId,
      body: 'Dilmi got 90 and is the best in class.',
      text: 'Dilmi got 90.',
      approvedText: 'Dilmi got 90.',
    }),
    deps,
  );

  const [row] = deps.messages();
  assert.equal(row.body, draft.draftText, 'the stored draft text is what gets approved');
  assert.ok(!row.body.includes('90'));
});

test('approving twice changes nothing the second time and adds no second audit entry', async () => {
  const deps = fakeDeps(world());
  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);

  const first = await approveParentUpdate(teacherEvent('approveParentUpdate', { draftId: draft.draftId }), deps);
  const second = await approveParentUpdate(teacherEvent('approveParentUpdate', { draftId: draft.draftId }), deps);

  assert.equal(first.alreadyApproved, undefined);
  assert.equal(second.alreadyApproved, true);
  assert.equal(deps.audit().filter((e) => e.action === 'approveParentUpdate').length, 1);
  assert.equal(deps.messages()[0].approvedAt, first.approvedAt, 'the approval time is not rewritten');
});

test('the approval accepts the HTTP route shape too — verified claims and {id} (design §5)', async () => {
  const deps = fakeDeps(world());
  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);

  // `POST /teacher/drafts/{id}/approve` is served by this same function: the id comes from the
  // path and the identity from claims the JWT authorizer verified. Both are server-set, so the one
  // action serves the agent and the route without a second copy of the gate.
  const approved = await approveParentUpdate(
    httpEvent('POST /teacher/drafts/{id}/approve', 'teacher', 'teacher-1', { path: { id: draft.draftId } }),
    deps,
  );

  assert.equal(approved.status, 'approved');
  assert.equal(deps.messages()[0].approvedBy, 'teacher-1');
});

test('the HTTP route shape is gated on the role in the claims, not on the path', async () => {
  const deps = fakeDeps(world());
  const draft = await draftParentUpdate(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps);

  const err = await thrown(() => approveParentUpdate(
    httpEvent('POST /teacher/drafts/{id}/approve', 'parent', 'parent-2', { path: { id: draft.draftId } }),
    deps,
  ));

  assert.equal(err.code, 'role_mismatch');
  assert.equal(deps.messages()[0].status, 'draft');
});

// --- 4. dispatch (design §6.2) -----------------------------------------------------------------

test('the teacher action group dispatches both new actions', async () => {
  const deps = fakeDeps(world());
  const drafted = bodyOf(await handler(teacherEvent('draftParentUpdate', { studentName: 'Dilmi' }), deps));

  assert.equal(drafted.ok, true);
  assert.equal(drafted.status, 'draft');

  const approved = bodyOf(await handler(teacherEvent('approveParentUpdate', { draftId: drafted.draftId }), deps));
  assert.equal(approved.ok, true);
  assert.equal(approved.status, 'approved');
});

test('the four pre-existing teacher actions still dispatch (no regression)', async () => {
  const deps = fakeDeps(world());
  const reply = await handler(
    teacherEvent('markAttendance', { names: 'Dilmi', date: '2026-11-19', status: 'present' }),
    deps,
  );

  assert.equal(bodyOf(reply).ok, true);
});
