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
 * Requirement 10.4 — the audit log is append-only — enforced by reading the IAM rather than hoping.
 *
 * Two guards have stood here and neither could fail against the shapes a careless IAM edit takes.
 * The first looked for a forbidden action within 400 characters of the string `AuditLog`, so
 * appending the audit log ARN to the end of TeacherReadWriteOwnDomain's Resource list — the exact
 * violation it existed to stop — put 850 characters between the two and the match came back null.
 * The second walked statements, but found them with `/^ *- Sid:[ ]*(\S+)$/gm` and selected them
 * with `r.includes('AuditLogTable')`: a statement whose `Sid` was not its first key (YAML maps are
 * unordered), carried a trailing comment, or was absent altogether (`Sid` is optional in IAM) did
 * not exist as far as the check was concerned, and `Resource: "*"` or a hand-written ARN was
 * outside its scope. Five of nine real violation shapes passed.
 *
 * So this one is inverted. It does not hunt for violations among the statements it happens to
 * recognise. It reads every statement that grants a DynamoDB action, insists it can name the table
 * behind every one of that statement's resources, and insists that the set of statements able to
 * reach the audit log is exactly the two that are meant to. A shape this parser cannot read is a
 * failure, never a pass — that is the only version of this check that can go red on a shape nobody
 * thought of in advance.
 *
 * There is no YAML parser to lean on: package.json has no dependencies by design and Node ships
 * none. So this stays indentation-driven, like `envVarsIn` above and `block()` in
 * tests/unit/cost-guards.test.mjs — but it finds a statement by its *position*, as a list item
 * under a `Statement:` key, instead of by which key it happens to start with.
 */

/** A line with any trailing `#` comment removed. A quoted `#` (`"ts#ulid"`) is left alone. */
function uncomment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line;
}

const unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/, '$2');

/**
 * Every IAM statement in the template: each list item under a `Statement:` key, as its own lines
 * with the leading `- ` blanked so all of that statement's top-level keys sit at one column.
 */
function statementBlocks() {
  const lines = template.split('\n').map(uncomment);
  const blocks = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!/(^|-[ ]+)Statement:[ ]*$/.test(lines[i])) continue;
    const owner = lines[i].indexOf('Statement:');     // the column the key itself starts at
    let item = null;

    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === '') continue;
      if (lines[j].search(/\S/) <= owner) break;      // dedented: out of this Statement: list
      const dash = /^([ ]*)-[ ]+(.*)$/.exec(lines[j]);
      if (dash && (item === null || dash[1].length === item.indent)) {
        item = { indent: dash[1].length, top: dash[1].length + 2, lines: [] };
        blocks.push(item);
        item.lines.push(' '.repeat(item.top) + dash[2]);
        continue;
      }
      if (item) item.lines.push(lines[j]);
    }
  }

  return blocks.map((block) => ({
    sid: field(block, 'Sid')[0] ?? '(a statement with no Sid)',
    actions: field(block, 'Action'),
    resources: field(block, 'Resource'),
  }));
}

/**
 * One top-level field of a statement as an array of scalars, in any of the three YAML forms a
 * hand-edited template uses: `Action: dynamodb:PutItem`, `Action: [a, b]`, and a block list.
 *
 * An empty array means "absent, or in a shape this function does not read" — and the caller turns
 * that into a failure, so an unreadable field can never be mistaken for a harmless one.
 */
function field(block, name) {
  const head = new RegExp(`^ {${block.top}}${name}:[ ]*(.*)$`);
  const at = block.lines.findIndex((line) => head.test(line));
  if (at === -1) return [];

  const inline = head.exec(block.lines[at])[1].trim();
  if (inline !== '') {
    const flow = /^\[(.*)\]$/.exec(inline);
    return (flow ? flow[1].split(',') : [inline]).map(unquote).filter((v) => v !== '');
  }

  const items = [];
  for (const line of block.lines.slice(at + 1)) {
    if (line.trim() === '') continue;
    if (line.search(/\S/) <= block.top) break;        // dedented: out of this field
    const item = /^[ ]*-[ ]+(\S.*)$/.exec(line);
    if (!item) return [];                             // a nested shape: not read, so not trusted
    items.push(unquote(item[1]));
  }
  return items;
}

/** Logical id → `TableName` for every DynamoDB table the template defines. */
function dynamoTables() {
  const heads = [...template.matchAll(/^ {2}([A-Za-z0-9]+):[ ]*$/gm)];
  const tables = new Map();

  for (const [i, head] of heads.entries()) {
    const body = template.slice(head.index, heads[i + 1]?.index ?? template.length);
    if (!/^ {4}Type:[ ]*AWS::DynamoDB::Table[ ]*$/m.test(body)) continue;
    const name = /^ {6}TableName:[ ]*(.+)$/m.exec(body);
    tables.set(head[1], name ? unquote(name[1].replace(/^!Sub[ ]+/, '')) : null);
  }
  return tables;
}

test('the audit log table is only ever granted append and read permissions', () => {
  // An allow-list, not a block-list: dynamodb:BatchWriteItem deletes as happily as it writes, and
  // the next action AWS adds would slip past a list of the three names known today.
  const APPEND_OR_READ = new Set([
    'dynamodb:PutItem',
    'dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:Scan',
    'dynamodb:DescribeTable', 'dynamodb:ConditionCheckItem',
  ]);

  // The two statements allowed to name the audit log at all: one appends, one reads. Anything else
  // — a new Sid, a renamed one, a statement with no Sid — fails here and has to be read by a human
  // before it is granted. That is the inversion: being unrecognised is the failure.
  const MAY_REACH_AUDIT_LOG = ['AuditLogAppendOnly', 'ReadOnlyViews'];

  // A DynamoDB grant. `*` and `dynamodb:*` are in scope precisely because they include DeleteItem.
  const grantsDynamo = (action) => /^(\*|dynamodb[:*])/.test(action);

  const all = statementBlocks();
  const tables = dynamoTables();
  assert.ok(tables.has('AuditLogTable'), 'no AuditLogTable in the template — this is the wrong file');

  // Two sentinels: a parser that found nothing, or that saw fewer statements than there are `Sid`
  // keys, would otherwise sail through every assertion below.
  const sidKeys = [...template.matchAll(/^[ ]*(-[ ]+)?Sid:/gm)].length;
  assert.ok(all.length >= 14 && all.length >= sidKeys,
    `found ${all.length} IAM statements for ${sidKeys} Sid keys — this guard is not reading the template`);

  const unreadable = [];
  const wildcards = [];
  const reaching = new Set();

  for (const statement of all) {
    if (!statement.actions.some(grantsDynamo)) continue;

    if (statement.resources.length === 0) {
      unreadable.push(`${statement.sid}: a DynamoDB grant whose Resource this guard cannot read`);
      continue;
    }

    for (const resource of statement.resources) {
      // Nothing in this template needs one, and a wildcard covers the audit log by definition.
      if (resource.includes('*')) {
        wildcards.push(`${statement.sid} grants DynamoDB on ${resource}`);
        continue;
      }
      // Either the logical id (`!GetAtt AuditLogTable.Arn`) or the real table name
      // (`arn:…:table/${AWS::StackName}-audit-log`). A resource naming neither — a `!Ref` to a
      // name parameter, say — is unreadable, and unreadable is a failure.
      const named = [...tables].filter(([id, name]) => resource.includes(id) || (name && resource.includes(name)));
      if (named.length === 0) {
        unreadable.push(`${statement.sid}: this guard cannot tell which table "${resource}" names`);
        continue;
      }
      if (named.some(([id]) => id === 'AuditLogTable')) reaching.add(statement);
    }
  }

  assert.deepEqual(unreadable, [],
    `every DynamoDB resource must name a table this guard can identify, or req 10.4 is unenforced:\n  ${unreadable.join('\n  ')}`);
  assert.deepEqual(wildcards, [],
    `a DynamoDB resource wildcard reaches the audit log, so nothing in this template may carry one:\n  ${wildcards.join('\n  ')}`);

  assert.deepEqual(
    [...reaching].map((s) => s.sid).sort(), MAY_REACH_AUDIT_LOG,
    'these are the only statements allowed to name the audit log table (req 10.4); a new one has to be read here before it is granted',
  );
  assert.ok(
    [...reaching].some((s) => s.actions.includes('dynamodb:PutItem')),
    'no statement grants PutItem on audit_log — the log could not be written, so this guard is reading the template wrong',
  );

  const violations = [...reaching].flatMap((statement) => statement.actions
    .filter((action) => !APPEND_OR_READ.has(action))
    .map((action) => `${statement.sid} grants ${action} on audit_log`));

  assert.deepEqual(violations, [],
    `audit_log must stay append-only (req 10.4):\n  ${violations.join('\n  ')}`);
});
