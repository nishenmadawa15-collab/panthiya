// Offline tests for the append-only audit log (requirement 10) and for the one thing a refused
// call must leave behind: nothing (requirement 4.4).
//
// The fake `put` below implements real DynamoDB condition semantics, so "append-only" is tested
// rather than asserted.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { writeAudit } from '../../backend/lib/audit.mjs';
import { sessionAttributes, requireRole, resolveScope, assertInScope, deny, DenyError } from '../../backend/lib/auth.mjs';

// --- fixtures ----------------------------------------------------------------------------------

/**
 * Fake DynamoDB: an `audit_log` table that honours `attribute_not_exists` conditions, plus the
 * `classes` byTeacher GSI so a full handler path can run.
 */
function fakeDeps({ classes = [] } = {}) {
  const store = new Map();        // 'classId|sk' -> Item
  const puts = [];                // every put param set, in order
  const key = (item) => `${item.classId}|${item.sk}`;

  return {
    store,
    puts,
    tables: { auditLog: 'audit-table', classes: 'classes-table', students: 'students-table' },
    async query(params) {
      const sub = params.ExpressionAttributeValues[':sub'];
      return { Items: classes.filter((c) => c.teacherId === sub) };
    },
    async put(params) {
      puts.push(params);
      const guarded = /attribute_not_exists\(\s*classId\s*\)/.test(params.ConditionExpression ?? '')
        && /attribute_not_exists\(\s*sk\s*\)/.test(params.ConditionExpression ?? '');
      if (guarded && store.has(key(params.Item))) {
        const err = new Error('The conditional request failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      store.set(key(params.Item), params.Item);
      return {};
    },
  };
}

const entry = (over = {}) => ({
  classId: 'c-1',
  actorSub: 'teacher-1',
  actorRole: 'teacher',
  action: 'recordFee',
  targetId: 's-kasun',
  before: { amountPaid: 0 },
  after: { amountPaid: 2500 },
  ...over,
});

/**
 * The shape every teacher action Lambda has (design.md §3.2): gate, scope, re-authorise the
 * model's identifiers, write, audit — all in one invocation (requirement 10.2).
 */
async function recordFeeAction(event, deps, dataWrites) {
  const { role, sub } = sessionAttributes(event);
  const modelSaid = Object.fromEntries((event.parameters ?? []).map((p) => [p.name, p.value]));

  try {
    requireRole(role, 'teacher');
    const scope = await resolveScope(role, sub, deps);
    assertInScope(modelSaid.classId, scope, 'class');

    dataWrites.push({ table: 'fees', targetId: modelSaid.studentId, amountPaid: 2500 });
    await writeAudit(deps, {
      classId: modelSaid.classId,
      actorSub: sub,
      actorRole: role,
      action: 'recordFee',
      targetId: modelSaid.studentId,
      before: { amountPaid: 0 },
      after: { amountPaid: 2500 },
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof DenyError) return deny(e, event);
    throw e;
  }
}

// --- the entry itself (requirements 10.1, 4.2) --------------------------------------------------

test('writeAudit appends an entry keyed by classId and <ISO UTC>#<uuid>', async () => {
  const deps = fakeDeps();
  const { classId, sk, ts } = await writeAudit(deps, entry());

  assert.equal(classId, 'c-1');
  assert.equal(deps.puts[0].TableName, 'audit-table');
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'timestamp must be ISO 8601 UTC');
  assert.match(sk, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z#[0-9a-f-]{36}$/);

  const item = deps.store.get(`${classId}|${sk}`);
  assert.deepEqual(
    { ...item, ts: 'ts', sk: 'sk' },
    {
      classId: 'c-1', sk: 'sk', ts: 'ts',
      actorSub: 'teacher-1', actorRole: 'teacher', action: 'recordFee', targetId: 's-kasun',
      before: { amountPaid: 0 }, after: { amountPaid: 2500 },
    },
  );
});

test('every put carries the append-only condition on both key attributes', async () => {
  const deps = fakeDeps();
  await writeAudit(deps, entry());
  const condition = deps.puts[0].ConditionExpression;
  assert.match(condition, /attribute_not_exists\(classId\)/);
  assert.match(condition, /attribute_not_exists\(sk\)/);
});

test('two entries in the same millisecond get distinct sort keys', async () => {
  const deps = fakeDeps();
  const keys = await Promise.all([writeAudit(deps, entry()), writeAudit(deps, entry())]);
  assert.notEqual(keys[0].sk, keys[1].sk);
  assert.equal(deps.store.size, 2, 'neither entry may replace the other');
});

test('writeAudit refuses to overwrite an existing key', async () => {
  const deps = fakeDeps();
  await writeAudit(deps, entry());

  // Replay the exact same key with a different payload — what a tamper attempt looks like.
  const replay = { ...deps.puts[0], Item: { ...deps.puts[0].Item, after: { amountPaid: 0 } } };
  await assert.rejects(() => deps.put(replay), (e) => e.name === 'ConditionalCheckFailedException');

  assert.equal(deps.store.size, 1);
  assert.deepEqual([...deps.store.values()][0].after, { amountPaid: 2500 }, 'stored entry must be untouched');
});

test('writeAudit refuses an entry that is missing an actor, action or target', async () => {
  const deps = fakeDeps();
  for (const field of ['classId', 'actorSub', 'actorRole', 'action', 'targetId']) {
    await assert.rejects(() => writeAudit(deps, entry({ [field]: undefined })), new RegExp(`"${field}" is required`));
  }
  await assert.rejects(() => writeAudit(deps), /required/);
  assert.equal(deps.puts.length, 0, 'an invalid entry must not reach the table');
});

test('an absent before/after is stored as null, not dropped', async () => {
  const deps = fakeDeps();
  const { classId, sk } = await writeAudit(deps, entry({ before: undefined, after: undefined }));
  const item = deps.store.get(`${classId}|${sk}`);
  assert.equal(item.before, null);
  assert.equal(item.after, null);
});

// --- requirement 10.4: the capability must not exist --------------------------------------------

test('audit.mjs exports no update or delete function', async () => {
  const mod = await import('../../backend/lib/audit.mjs');
  assert.deepEqual(Object.keys(mod).sort(), ['writeAudit']);
});

// --- requirement 4.4: a denied call leaves nothing behind ---------------------------------------

test('a denied parent fee write produces no data write and no audit entry (requirement 4.4)', async () => {
  const deps = fakeDeps({ classes: [{ classId: 'c-1', teacherId: 'teacher-1' }] });
  const dataWrites = [];

  const event = {
    actionGroup: 'actions-teacher',
    function: 'recordFee',
    sessionAttributes: { sub: 'parent-1', role: 'parent' },          // the verified identity
    parameters: [                                                    // what the model was talked into
      { name: 'role', value: 'teacher' },
      { name: 'classId', value: 'c-1' },
      { name: 'studentId', value: 's-kasun' },
    ],
  };

  const res = await recordFeeAction(event, deps, dataWrites);

  const body = JSON.parse(res.response.functionResponse.responseBody.TEXT.body);
  assert.equal(body.allowed, false);
  assert.equal(body.reason, 'role_mismatch');
  assert.deepEqual(dataWrites, [], 'no fee row may be written');
  assert.equal(deps.puts.length, 0, 'no audit entry may imply a write occurred');
  assert.equal(deps.store.size, 0);
});

test('a student fee write is denied the same way (case B4)', async () => {
  const deps = fakeDeps({ classes: [{ classId: 'c-1', teacherId: 'teacher-1' }] });
  const dataWrites = [];

  await recordFeeAction(
    {
      actionGroup: 'actions-teacher',
      function: 'recordFee',
      sessionAttributes: { sub: 'student-1', role: 'student' },
      parameters: [{ name: 'classId', value: 'c-1' }, { name: 'studentId', value: 's-kasun' }],
    },
    deps,
    dataWrites,
  );

  assert.deepEqual(dataWrites, []);
  assert.equal(deps.puts.length, 0);
});

test("a teacher writing into a class they do not own is denied and logs nothing", async () => {
  const deps = fakeDeps({ classes: [{ classId: 'c-1', teacherId: 'teacher-1' }] });
  const dataWrites = [];

  const res = await recordFeeAction(
    {
      actionGroup: 'actions-teacher',
      function: 'recordFee',
      sessionAttributes: { sub: 'teacher-1', role: 'teacher' },
      parameters: [{ name: 'classId', value: 'c-9' }, { name: 'studentId', value: 's-dilmi' }],
    },
    deps,
    dataWrites,
  );

  assert.equal(JSON.parse(res.response.functionResponse.responseBody.TEXT.body).reason, 'out_of_scope');
  assert.deepEqual(dataWrites, []);
  assert.equal(deps.puts.length, 0);
});

// --- requirement 10.2: the allowed path logs in the same invocation -----------------------------

test('an allowed teacher write is audited in the same invocation', async () => {
  const deps = fakeDeps({ classes: [{ classId: 'c-1', teacherId: 'teacher-1' }] });
  const dataWrites = [];

  const res = await recordFeeAction(
    {
      actionGroup: 'actions-teacher',
      function: 'recordFee',
      sessionAttributes: { sub: 'teacher-1', role: 'teacher' },
      parameters: [{ name: 'classId', value: 'c-1' }, { name: 'studentId', value: 's-kasun' }],
    },
    deps,
    dataWrites,
  );

  assert.deepEqual(res, { ok: true });
  assert.equal(dataWrites.length, 1);
  assert.equal(deps.store.size, 1, 'a successful write can never be unlogged');
  const item = [...deps.store.values()][0];
  assert.equal(item.actorSub, 'teacher-1');
  assert.equal(item.actorRole, 'teacher');
  assert.equal(item.targetId, 's-kasun');
});
