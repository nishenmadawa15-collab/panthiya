// The one contract unit tests cannot otherwise reach.
//
// Every handler is tested with an injected fake `deps`, which is the right way to test them — but
// it means the real wiring between code and infrastructure is never exercised offline. That gap
// already produced a bug: backend/lib/ddb.mjs read TABLE_CLASSES while backend/template.yaml set
// CLASSES_TABLE, so every table name would have been `undefined` in a deployed Lambda, and the
// whole suite would still have been green.
//
// This test reads both sides and insists they agree. It is the cheapest possible stand-in for a
// deploy, and it costs nothing to run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const template = read('backend/template.yaml');

/**
 * The `Environment: Variables:` names of one template block, found by indentation.
 *
 * Per block, not per file: "set somewhere in the template" was the weakness this replaced. Moving
 * GUARDRAIL_ID from ChatFunction to any other function would have left defence layer 2 reading an
 * undefined id with the whole suite still green.
 */
function envVarsIn(block) {
  const names = new Set();
  const head = /^([ ]*)Environment:[ ]*$/m.exec(block);
  if (!head) return names;

  for (const line of block.slice(head.index + head[0].length).split('\n')) {
    if (line.trim() === '') continue;
    if (line.search(/\S/) <= head[1].length) break;   // dedented: out of the Environment block
    const name = /^\s*([A-Z][A-Z0-9_]*):/.exec(line);
    if (name) names.add(name[1]);
  }
  return names;
}

/** Every `AWS::Serverless::Function` in the template, with its handler and its own env vars. */
function templateFunctions() {
  const body = template.slice(template.indexOf('\nResources:'));
  const heads = [...body.matchAll(/^ {2}([A-Za-z0-9]+):[ ]*$/gm)];

  return heads.flatMap((head, i) => {
    const block = body.slice(head.index, heads[i + 1]?.index ?? body.length);
    if (!block.includes('Type: AWS::Serverless::Function')) return [];
    const handler = /^\s*Handler:\s*(\S+)\s*$/m.exec(block);
    assert.ok(handler, `${head[1]}: a function with no Handler`);
    return [{ name: head[1], handler: handler[1], vars: envVarsIn(block) }];
  });
}

/** Env vars the code behind one handler reads, following its transitive local imports. */
function envVarsRead(entry) {
  const names = new Set();
  const seen = new Set();
  const queue = [entry];

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);

    const src = read(file);
    for (const [, name] of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(name);
    // Static, side-effect and dynamic imports alike; only relative ones, since the rest is the SDK.
    for (const [, spec] of src.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) {
      queue.push(new URL(spec, new URL(file, ROOT)).href.slice(ROOT.href.length));
    }
  }
  return names;
}

/** Env vars the Lambda code reads at runtime, minus the ones AWS provides itself. */
const PROVIDED_BY_LAMBDA = new Set([
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_LAMBDA_FUNCTION_NAME', 'AWS_EXECUTION_ENV',
  'AWS_LAMBDA_LOG_GROUP_NAME', 'AWS_LAMBDA_FUNCTION_MEMORY_SIZE', 'NODE_OPTIONS',
  // Local tooling only, never read inside a Lambda.
  'PANTHIYA_STACK',
]);

test('every environment variable a function reads is set on that function or in Globals', () => {
  const globals = envVarsIn(template.slice(template.indexOf('\nGlobals:'), template.indexOf('\nResources:')));
  assert.ok(globals.has('MODEL_ID'), 'MODEL_ID is set in Globals, and must stay allowed from there');

  const functions = templateFunctions();
  assert.equal(functions.length, 8, 'the template defines 8 Lambdas — a selector that found none would pass');

  const missing = [];
  for (const fn of functions) {
    const entry = `backend/${fn.handler.replace(/\.[^./]+$/, '')}.mjs`;
    for (const name of envVarsRead(entry)) {
      if (PROVIDED_BY_LAMBDA.has(name)) continue;
      if (fn.vars.has(name) || globals.has(name)) continue;
      missing.push(`${fn.name} (${entry}) reads ${name}, set on neither it nor Globals`);
    }
  }

  assert.deepEqual(missing, [],
    `these would be undefined in a deployed Lambda:\n  ${missing.join('\n  ')}`);
});

test('tables() names every table the data model defines', async () => {
  // Point every variable at a recognisable value, then check nothing comes back undefined.
  const expected = {
    CLASSES_TABLE: 'classes', STUDENTS_TABLE: 'students', ATTENDANCE_TABLE: 'attendance',
    FEES_TABLE: 'fees', MARKS_TABLE: 'marks', MESSAGES_TABLE: 'messages',
    AUDIT_LOG_TABLE: 'audit_log', REDTEAM_RUNS_TABLE: 'redteam_runs',
  };
  const saved = { ...process.env };
  Object.assign(process.env, expected);

  try {
    // Imported lazily: a static import would pull the AWS SDK into this dependency-free process.
    const { tables } = await import('../../backend/lib/ddb.mjs');
    const resolved = tables();

    assert.equal(Object.keys(resolved).length, 8, 'the data model has 8 tables');
    for (const [key, value] of Object.entries(resolved)) {
      assert.ok(value !== undefined, `tables().${key} is undefined — env var name mismatch`);
      assert.ok(Object.values(expected).includes(value), `tables().${key} resolved to "${value}"`);
    }
  } finally {
    for (const key of Object.keys(expected)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

/**
 * Every `- Sid:` statement in the template, with its Action and Resource lists.
 *
 * This replaced a regex that looked for a forbidden action within 400 characters of the string
 * `AuditLog`. Adding the audit log ARN to the end of TeacherReadWriteOwnDomain's Resource list —
 * the exact requirement-10.4 violation the check exists to stop — puts 850 characters between the
 * two, so the match came back null and the test passed. A window is not a scope; the statement is.
 *
 * Both fields are read in either YAML form, inline (`Action: dynamodb:PutItem`) or as a block list,
 * because which one is used is a formatting choice and must not change what is enforced.
 */
function statements() {
  const heads = [...template.matchAll(/^([ ]*)- Sid:[ ]*(\S+)[ ]*$/gm)];

  return heads.map((head, i) => {
    const indent = head[1].length;
    const rest = template.slice(head.index + head[0].length, heads[i + 1]?.index ?? template.length);
    const lines = [];
    for (const line of rest.split('\n')) {
      if (line.trim() === '') continue;
      if (line.search(/\S/) <= indent) break;   // dedented: out of this statement
      lines.push(line);
    }
    return { sid: head[2], actions: field(lines, 'Action'), resources: field(lines, 'Resource') };
  });
}

/** One `Action:`/`Resource:` field of a statement, inline or as a block list, as an array. */
function field(lines, name) {
  const at = lines.findIndex((line) => new RegExp(`^\\s*${name}:`).test(line));
  if (at === -1) return [];

  const [, indent, inline] = new RegExp(`^([ ]*)${name}:[ ]*(.*)$`).exec(lines[at]);
  if (inline !== '') return [inline.trim()];

  const items = [];
  for (const line of lines.slice(at + 1)) {
    if (line.search(/\S/) <= indent.length) break;      // dedented: out of this field
    const item = /^\s*-[ ]+(.*)$/.exec(line);
    if (item) items.push(item[1].trim());
  }
  return items;
}

test('the audit log table is only ever granted append and read permissions', () => {
  // Requirement 10.4 is the audit log being append-only: a row that is written and never changed
  // or removed. That is enforced by the absence of a capability, which is easy to add back by
  // accident while editing IAM — so this walks the statements rather than the characters.
  //
  // An allow-list, not a block-list: dynamodb:BatchWriteItem deletes as happily as it writes, and
  // the next action AWS adds would slip past a list of the three names known today.
  const APPEND_OR_READ = new Set([
    'dynamodb:PutItem',
    'dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:Scan',
    'dynamodb:DescribeTable', 'dynamodb:ConditionCheckItem',
  ]);

  const all = statements();
  assert.ok(all.length > 8, `found ${all.length} IAM statements — a selector that found none would pass`);

  const touching = all.filter((s) => s.resources.some((r) => r.includes('AuditLogTable')));
  assert.ok(
    touching.some((s) => s.actions.includes('dynamodb:PutItem')),
    'no statement grants PutItem on audit_log — the log could not be written, so this test is reading the template wrong',
  );

  const violations = touching.flatMap((s) => s.actions
    .filter((action) => !APPEND_OR_READ.has(action))
    .map((action) => `${s.sid} grants ${action} on audit_log`));

  assert.deepEqual(violations, [],
    `audit_log must stay append-only (req 10.4):\n  ${violations.join('\n  ')}`);
});
