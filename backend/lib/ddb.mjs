// DynamoDB access, kept to one tiny file so every other module can stay AWS-free and testable.
//
// Both SDK packages ship inside the nodejs20.x Lambda runtime, so they are imported but never
// installed — the repo has no dependencies (see package.json). Nothing under tests/ imports this
// file: the unit tests inject a fake `{ query, put, tables }` instead, which is why they run
// offline with no credentials.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

let client;

/** Lazy singleton, so a cold start that never touches DynamoDB never builds one. */
export function docClient() {
  client ??= DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.AWS_REGION ?? 'ap-south-1' }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
  return client;
}

/** Table names from the environment — set per function in template.yaml, never hard-coded. */
export function tables() {
  return {
    classes: process.env.TABLE_CLASSES,
    students: process.env.TABLE_STUDENTS,
    attendance: process.env.TABLE_ATTENDANCE,
    fees: process.env.TABLE_FEES,
    marks: process.env.TABLE_MARKS,
    messages: process.env.TABLE_MESSAGES,
    auditLog: process.env.TABLE_AUDIT_LOG,
    redteamRuns: process.env.TABLE_REDTEAM_RUNS,
  };
}

export const query = (params) => docClient().send(new QueryCommand(params));
export const put = (params) => docClient().send(new PutCommand(params));

/** The injected dependency object every other module takes. One call at the top of a handler. */
export function deps() {
  return { query, put, tables: tables() };
}
