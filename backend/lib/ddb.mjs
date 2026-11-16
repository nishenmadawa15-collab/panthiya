// DynamoDB access, kept to one tiny file so every other module can stay AWS-free and testable.
//
// Both SDK packages ship inside the nodejs20.x Lambda runtime, so they are imported but never
// installed — the repo has no dependencies (see package.json). Nothing under tests/ imports this
// file: the unit tests inject a fake `{ query, put, tables }` instead, which is why they run
// offline with no credentials.

// The SDK is imported lazily rather than at the top of the file. Two reasons, both real:
//   1. It only exists inside the nodejs20.x runtime, so a top-level import makes this module
//      impossible to load on a laptop — which meant `tables()` could not be tested offline at all,
//      and the env-var mismatch below went unnoticed.
//   2. A cold start that never queries DynamoDB never pays to load it.
let sdk;
async function loadSdk() {
  sdk ??= {
    ...(await import('@aws-sdk/client-dynamodb')),
    ...(await import('@aws-sdk/lib-dynamodb')),
  };
  return sdk;
}

let client;

/** Lazy singleton, so a cold start that never touches DynamoDB never builds one. */
export async function docClient() {
  if (!client) {
    const { DynamoDBClient, DynamoDBDocumentClient } = await loadSdk();
    client = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION ?? 'ap-south-1' }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
  }
  return client;
}

/**
 * Table names from the environment — set per function in template.yaml, never hard-coded.
 *
 * These names must match the Globals/Environment block of backend/template.yaml exactly. They did
 * not once: this file read TABLE_CLASSES while the template set CLASSES_TABLE, so every table name
 * would have been `undefined` in a deployed Lambda. Unit tests cannot catch that class of bug,
 * because they inject a fake `deps`. `tests/unit/env-contract.test.mjs` now checks it instead.
 */
export function tables() {
  return {
    classes: process.env.CLASSES_TABLE,
    students: process.env.STUDENTS_TABLE,
    attendance: process.env.ATTENDANCE_TABLE,
    fees: process.env.FEES_TABLE,
    marks: process.env.MARKS_TABLE,
    messages: process.env.MESSAGES_TABLE,
    auditLog: process.env.AUDIT_LOG_TABLE,
    redteamRuns: process.env.REDTEAM_RUNS_TABLE,
  };
}

export const query = async (params) => {
  const { QueryCommand } = await loadSdk();
  return (await docClient()).send(new QueryCommand(params));
};

export const put = async (params) => {
  const { PutCommand } = await loadSdk();
  return (await docClient()).send(new PutCommand(params));
};

/** The injected dependency object every other module takes. One call at the top of a handler. */
export function deps() {
  return { query, put, tables: tables() };
}
