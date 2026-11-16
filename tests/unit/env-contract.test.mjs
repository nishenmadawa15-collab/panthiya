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
import { readFileSync, readdirSync, statSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const template = read('backend/template.yaml');

/** Env var names the SAM template actually sets, from any Environment/Variables block. */
function envVarsSetByTemplate() {
  const names = new Set();
  // Matches "  SOME_NAME: !Ref Thing" / "  SOME_NAME: literal" inside the template.
  for (const [, name] of template.matchAll(/^\s{4,}([A-Z][A-Z0-9_]*):\s*(?:!|'|"|\w)/gm)) {
    names.add(name);
  }
  return names;
}

/** Walk backend/ for .mjs files, skipping node_modules and generated output. */
function backendSources(dir = 'backend') {
  const out = [];
  for (const entry of readdirSync(new URL(dir + '/', ROOT), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out') continue;
      out.push(...backendSources(path));
    } else if (entry.name.endsWith('.mjs')) {
      out.push(path);
    }
  }
  return out;
}

/** Env vars the Lambda code reads at runtime, minus the ones AWS provides itself. */
const PROVIDED_BY_LAMBDA = new Set([
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_LAMBDA_FUNCTION_NAME', 'AWS_EXECUTION_ENV',
  'AWS_LAMBDA_LOG_GROUP_NAME', 'AWS_LAMBDA_FUNCTION_MEMORY_SIZE', 'NODE_OPTIONS',
  // Local tooling only, never read inside a Lambda.
  'PANTHIYA_STACK',
]);

test('every environment variable the backend reads is set by the SAM template', () => {
  const set = envVarsSetByTemplate();
  const missing = [];

  for (const file of backendSources()) {
    const src = read(file);
    for (const [, name] of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (PROVIDED_BY_LAMBDA.has(name)) continue;
      if (!set.has(name)) missing.push(`${file} reads ${name}`);
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

test('the audit log table is never given a delete or update permission', () => {
  // Requirement 10.4 is enforced by the absence of a capability, which is easy to add back by
  // accident while editing IAM. This asserts the absence stays.
  const forbidden = template.match(/dynamodb:(DeleteItem|UpdateItem)[^\n]*\n[\s\S]{0,400}?AuditLog/g);
  assert.equal(forbidden, null, 'audit_log must never be granted DeleteItem or UpdateItem');
});
