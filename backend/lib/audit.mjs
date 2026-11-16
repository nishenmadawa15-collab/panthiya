// Append-only audit log (requirement 10).
//
// THE CONTRACT (requirement 10.2): `writeAudit` is called in the SAME Lambda invocation as the data
// write it describes, immediately after it, before the handler returns. Never from a queue, never
// from a stream consumer, never "later" — a successful write that is not yet logged is an unlogged
// write, and that is the gap a disputed fee lives in. If the audit put fails, the handler must
// surface the failure to the teacher rather than report success.
//
// Requirement 4.4 runs the other way: a *denied* call writes nothing at all — no data row and no
// audit entry implying a write occurred. So every gate in `auth.mjs` throws BEFORE any call to
// this function. There is no "attempted write" audit action, by design.
//
// Requirement 10.4: this module exports exactly one function. There is no update and no delete
// here and nowhere else, so the capability does not exist in the codebase to be misused, found by
// an attacker, or called by mistake. Adding one would break `tests/unit/audit.test.mjs`.

import { randomUUID } from 'node:crypto';

/** Required string fields. A half-identified audit entry is not evidence. */
const REQUIRED = ['classId', 'actorSub', 'actorRole', 'action', 'targetId'];

/**
 * Append one audit entry.
 *
 * Key: PK `classId`, SK `<ISO-8601 UTC timestamp>#<uuid>`. The timestamp sorts newest-last within
 * a class (requirement 10.3 reads it in reverse), and the UUID suffix keeps two writes in the same
 * millisecond from colliding.
 *
 * `before` / `after` are stored as given (`null` when there was no prior or no resulting value),
 * so a dispute can be answered with both sides of the change (requirements 4.2, 10.1).
 *
 * @param {object} deps injected `{ put, tables }` — see `backend/lib/ddb.mjs`
 * @returns {Promise<{classId: string, sk: string, ts: string}>} the key that was written
 */
export async function writeAudit(deps, { classId, actorSub, actorRole, action, targetId, before, after } = {}) {
  const fields = { classId, actorSub, actorRole, action, targetId };
  for (const name of REQUIRED) {
    if (typeof fields[name] !== 'string' || !fields[name]) {
      throw new Error(`writeAudit: "${name}" is required`);
    }
  }

  const ts = new Date().toISOString();            // always UTC, always Z-suffixed
  const sk = `${ts}#${randomUUID()}`;

  await deps.put({
    TableName: deps.tables.auditLog,
    Item: {
      classId,
      sk,
      ts,
      actorSub,
      actorRole,
      action,
      targetId,
      before: before ?? null,
      after: after ?? null,
    },
    // Append-only at the database, not just by convention: a put that would land on an existing
    // key is rejected by DynamoDB, so no audit entry can ever be overwritten by this code path.
    ConditionExpression: 'attribute_not_exists(classId) AND attribute_not_exists(sk)',
  });

  return { classId, sk, ts };
}
