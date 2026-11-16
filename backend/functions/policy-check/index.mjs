// policy-check — defence layer 3, and the last thing between the model and a parent or a child.
//
// This file is the boundary and nothing else: it validates the invocation, reads roster *names*
// from DynamoDB, and hands everything to the pure checks in `checks.mjs`. It is invoked
// synchronously by the chat Lambda on every reply (design §7), with the payload as the whole
// event, and it answers with `{verdict, layer, reason}` and nothing else.
//
// Three properties hold here, in this order of importance:
//
//   1. **Fail closed.** Every path out of `policyCheck` that is not a completed set of passing
//      checks returns `block` — a thrown query, a malformed payload, an unknown role, a missing
//      reply (requirement 9.4). `handleChat` additionally treats a throw, a timeout, `undefined`
//      and an unrecognised verdict as a block, so the two agree rather than overlap by luck.
//   2. **No attacker text leaves this function.** The verdict carries a closed-set reason code.
//      Nothing is logged: a log line holding the reply would move a prompt-injection payload into
//      CloudWatch and from there into a human's eyes.
//   3. **Names come from the roster, never from the reply.** `findNames` returns our own stored
//      spellings, and this function then discards even those. The red-team scoreboard gets a
//      reason code; it never gets a child's name.

import { runChecks, REASONS } from './checks.mjs';
import { foldedKey } from '../../lib/names.mjs';

const ROLES = new Set(['teacher', 'parent', 'student']);

const blocked = (reason) => ({ verdict: 'block', layer: 'policyCheck', reason });

/** Every spelling we store for one student, plus the single words of each — a reply may use one. */
function namesOf(student) {
  const full = [student?.displayName, student?.nameSinhala, student?.nameTamil, ...(student?.aliases ?? [])]
    .filter((v) => typeof v === 'string' && v.trim());

  const parts = full.flatMap((name) => name.split(/\s+/));
  // A part only counts when it normalises to something substantial. Dropping the short ones is
  // what stops an initial ("K.") or a one-syllable particle from folding to a key that matches
  // half the dictionary — an over-matching key here would block every reply, not leak one.
  return [...new Set([...full, ...parts.filter((p) => foldedKey(p).length >= 3)])];
}

/** Run a GSI query to exhaustion: a truncated roster is a roster with a hole in it. */
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

/**
 * The two name lists check 2 and check 3 need, resolved server-side from the caller's own `sub`.
 *
 * Parent: their linked children are `permitted`; every other child in those children's classes is
 * `foreign`. Both come from the `students` table — the same rows the action groups read, so a name
 * cannot be permitted here and refused there.
 *
 * A name that folds to the same key as a permitted name is left out of `foreign`: with the folding
 * of design §4.1 the two are indistinguishable, and a reply about the caller's own child must not
 * be blocked because a classmate's name happens to fold the same way.
 *
 * ponytail: teacher and student sessions return two empty lists, so check 2 cannot fire for them.
 * A teacher is entitled to their whole roster, and this function cannot see which classes they own
 * (`classes` is not in this Lambda's IAM policy, by design — template.yaml grants `students` only).
 * A student session has no path from a Cognito `sub` to a `studentId` at all. Ceiling: a reply that
 * names a child from *another* teacher's class is caught by the role gate and `assertInScope`
 * (design §3.2), not here. Upgrade when policyCheck is given `classes` read access.
 */
export async function loadNames(deps, { role, sub }) {
  if (role !== 'parent') return { permittedNames: [], foreignNames: [] };

  const own = await queryAll(deps, {
    TableName: deps.tables.students,
    IndexName: 'byParent',
    KeyConditionExpression: 'parentSub = :sub',
    ExpressionAttributeValues: { ':sub': sub },
  });

  const permittedNames = own.flatMap(namesOf);
  const permittedKeys = new Set(permittedNames.map(foldedKey).filter(Boolean));

  const foreign = new Set();
  for (const classId of new Set(own.map((s) => s.classId).filter(Boolean))) {
    const roster = await queryAll(deps, {
      TableName: deps.tables.students,
      IndexName: 'byClass',
      KeyConditionExpression: 'classId = :c',
      ExpressionAttributeValues: { ':c': classId },
    });
    for (const student of roster) {
      for (const name of namesOf(student)) {
        const key = foldedKey(name);
        if (key && !permittedKeys.has(key)) foreign.add(name);
      }
    }
  }

  return { permittedNames, foreignNames: [...foreign] };
}

/** DynamoDB arrives lazily, so this module loads — and the whole suite runs — with no AWS SDK. */
async function defaultDeps() {
  const { deps } = await import('../../lib/ddb.mjs');
  return deps();
}

/**
 * The verdict. Matches the contract `backend/functions/chat/orchestrate.mjs` expects.
 *
 * @param {object} input `{ role, sub, userMessage, agentReply, lang }`
 * @param {object} [deps] injected `{ query, tables }`; the real DynamoDB when omitted
 * @returns {Promise<{verdict: 'allow'|'block', layer: 'policyCheck', reason: string}>}
 */
export async function policyCheck(input, deps) {
  try {
    const { role, sub, userMessage, agentReply } = input ?? {};

    // Validate before spending a query. An unknown role is not a role (requirement 9.4), and a
    // parent session with no `sub` must not resolve to "no foreign names" and sail through.
    if (!ROLES.has(role)) return blocked(REASONS.badInput);
    if (typeof agentReply !== 'string' || agentReply.trim() === '') return blocked(REASONS.badInput);
    if (role !== 'student' && (typeof sub !== 'string' || !sub)) return blocked(REASONS.badInput);

    const names = await loadNames(deps ?? await defaultDeps(), { role, sub });

    const { verdict, reason } = runChecks({
      role,
      userMessage: typeof userMessage === 'string' ? userMessage : '',
      agentReply,
      ...names,
    });
    return { verdict, layer: 'policyCheck', reason };
  } catch {
    // A roster lookup that threw means we do not know whether this reply is safe, and an unknown
    // reply is not shown to a parent or a child. The error itself is deliberately not propagated
    // and not logged: it could carry the reply text.
    return blocked('check_failed');
  }
}

export const handler = (event) => policyCheck(event);
