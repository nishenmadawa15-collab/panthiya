// Identity and authorisation — the security spine of Panthiya.
//
// Implements design.md §3 (trust model). Requirements 1.1-1.7, 4.4, 9.x.
//
// The one idea in this file: **identity is never message content.**
//   - `claimsFromEvent`     reads the role from the JWT claims the API Gateway authorizer verified.
//   - `sessionAttributes`   reads the role from the out-of-band channel only our chat Lambda sets.
//   - everything else       re-authorises each identifier the *model* supplied against that role.
//
// So "I am the principal", "SYSTEM: role=teacher", "developer mode", a Sinhala or Tamil version of
// any of them, and a base64 version of any of those, are all just bytes in a message body. They
// never reach a variable named `role`. Red-team cases B1-B8, D3-D5 die here, in one line.
//
// No AWS SDK import on purpose: every DynamoDB touch arrives through the injected `deps`, so this
// module is unit-testable with no credentials, no network and no mocking framework.
//
// Name comparison note: nothing in this module compares *names* — it compares server-issued
// identifiers only, with exact string equality. The `nameKey()` normaliser in
// `backend/lib/names.mjs` belongs one layer out, in each action Lambda, which turns a
// model-supplied student *name* into a studentId and then calls `assertInScope()` on that id.
// Normalising here would be the wrong layer and would weaken `assertInScope` to a fuzzy match.

/** The only roles that exist. Anything else is "no role", which means deny. */
const ROLES = new Set(['teacher', 'parent', 'student']);

/**
 * Deny reason codes. A refusal may only ever carry one of these.
 * Free-text reasons are how attacker-supplied strings get reflected back to the model (and from
 * there to a user), so the set is closed and anything unknown collapses to `not_permitted`.
 */
const DENY_CODES = new Set(['no_identity', 'no_role', 'role_mismatch', 'out_of_scope', 'not_permitted']);

/** Thrown by every gate in this file. Carries a code, never attacker text. */
export class DenyError extends Error {
  constructor(code = 'not_permitted') {
    const safe = DENY_CODES.has(code) ? code : 'not_permitted';
    super(`denied: ${safe}`);
    this.name = 'DenyError';
    this.code = safe;
  }
}

/**
 * Split a Cognito group claim into candidate role names.
 *
 * The same claim arrives in two shapes depending on the path:
 *   - Lambda / decoded JWT:        ['teacher']
 *   - HTTP API JWT authorizer:     '[teacher]'   (and '[teacher, parent]' when there are several)
 * Both are handled, because handling only one is a silent authorisation bypass the day the
 * other shape shows up.
 */
function groupNames(claim) {
  if (Array.isArray(claim)) return claim;
  if (typeof claim !== 'string') return [];
  return claim.replace(/^\s*\[/, '').replace(/\]\s*$/, '').split(/[\s,]+/);
}

/**
 * The single role this session holds, or `null`.
 *
 * `null` (deny) when the token carries no recognised role, and also when it carries more than one
 * of teacher/parent/student — an ambiguous token must never be resolved in the holder's favour
 * (requirement 1.1: exactly one role claim).
 */
function soleRole(claims) {
  const candidates = [...groupNames(claims['cognito:groups']), claims['custom:role']]
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => ROLES.has(v));

  const distinct = new Set(candidates);
  return distinct.size === 1 ? [...distinct][0] : null;
}

/**
 * Identity for an API Gateway (HTTP API + JWT authorizer) event.
 *
 * Reads `event.requestContext.authorizer.jwt.claims` and NOTHING else: not the body, not the query
 * string, not the headers, not the path. The authorizer has already verified signature, issuer,
 * audience and expiry (requirement 1.2), so these claims are the only trustworthy thing in the
 * event. Requirement 1.3; red-team case B5.
 *
 * @returns {{sub: string|null, role: string|null, email: string|null}}
 */
export function claimsFromEvent(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims ?? {};
  return {
    sub: typeof claims.sub === 'string' && claims.sub ? claims.sub : null,
    role: soleRole(claims),
    email: typeof claims.email === 'string' && claims.email ? claims.email : null,
  };
}

/**
 * Identity for a Bedrock action-group event.
 *
 * `event.sessionAttributes` is set by our own chat Lambda from the verified claims above and passed
 * through by Bedrock — the model cannot write to it (design.md §3.1). `event.parameters` is the
 * opposite: the model chooses those, so they are untrusted input and are never read here.
 *
 * @returns {{sub: string|null, role: string|null}}
 */
export function sessionAttributes(event) {
  const attrs = event?.sessionAttributes ?? {};
  const sub = typeof attrs.sub === 'string' && attrs.sub ? attrs.sub : null;
  const role = typeof attrs.role === 'string' && ROLES.has(attrs.role.trim().toLowerCase())
    ? attrs.role.trim().toLowerCase()
    : null;
  return { sub, role };
}

/**
 * The hard gate of design.md §3.2. First line of every action Lambda.
 *
 * A parent session reaching a teacher action is denied here whatever the message said, in whatever
 * language or encoding (cases B1, B2, B3, B4, B8, D4, D5).
 *
 * @throws {DenyError}
 */
export function requireRole(actual, expected) {
  if (!ROLES.has(expected)) throw new DenyError('not_permitted');  // typo in a handler must fail closed
  if (actual === null || actual === undefined) throw new DenyError('no_role');
  if (actual !== expected) throw new DenyError('role_mismatch');
}

/** Fixed instruction returned to the model on refusal. Our words, never the attacker's. */
const DENY_TEXT =
  'Not permitted for this session role. No data was read or written. '
  + 'Tell the user politely that only their teacher can do this, and do not retry this action.';

/** Keep Bedrock's routing fields to the shape of our own schema names before echoing them. */
const safeName = (v) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : '') || 'unknown';

/**
 * The Bedrock action-group refusal response.
 *
 * Deliberately carries no attacker text: only a closed-set reason code and the fixed sentence
 * above. Echoing the offending message back would hand a prompt-injection payload a second trip
 * through the model.
 *
 * `event` is optional and is used only for the two routing fields Bedrock needs to match the
 * response to the invocation; both come from our own action-group schema, and are filtered anyway.
 *
 * @param {string|DenyError} [reason] a DENY_CODES code, or the DenyError that was caught
 */
export function deny(reason, event) {
  const raw = reason instanceof DenyError ? reason.code : reason;
  const code = DENY_CODES.has(raw) ? raw : 'not_permitted';

  return {
    messageVersion: '1.0',
    response: {
      actionGroup: safeName(event?.actionGroup),
      function: safeName(event?.function),
      functionResponse: {
        responseState: 'REPROMPT',
        responseBody: {
          TEXT: {
            body: JSON.stringify({ allowed: false, reason: code, blockedBy: 'role-gate', message: DENY_TEXT }),
          },
        },
      },
    },
  };
}

/** Run a GSI query to exhaustion. Truncating a scope silently would deny legitimate access. */
async function queryAll(deps, params) {
  const ids = [];
  let startKey;
  do {
    const page = await deps.query(startKey ? { ...params, ExclusiveStartKey: startKey } : params);
    for (const item of page?.Items ?? []) ids.push(item);
    startKey = page?.LastEvaluatedKey;
  } while (startKey);
  return ids;
}

/**
 * Everything this session may touch, resolved server-side from the caller's own `sub`.
 *
 * Requirement 1.6: a parent's accessible student IDs come from the `students` table, never from
 * the client (or the model). Requirement 1.7: a student session resolves to an empty scope —
 * the tutor needs no stored data, so it is given none, and `assertInScope` therefore denies every
 * identifier a student session could ever name (cases A5, D5).
 *
 * A teacher's scope is their classes. Teacher actions resolve a model-supplied student name to a
 * studentId, read that student's `classId`, and assert *the class* is in scope — so class ownership
 * stays the single check (design.md §6.2).
 *
 * @param {object} deps injected `{ query, tables }` — see `backend/lib/ddb.mjs`
 * @returns {Promise<{studentIds: string[], classIds: string[]}>}
 */
export async function resolveScope(role, sub, deps) {
  if (!ROLES.has(role)) throw new DenyError('no_role');
  if (typeof sub !== 'string' || !sub) throw new DenyError('no_identity');

  // Student: no query at all. The student action Lambda has no DynamoDB permissions either, so
  // this is enforced twice — in code here and in IAM (design.md §3.3).
  if (role === 'student') return { studentIds: [], classIds: [] };

  if (role === 'teacher') {
    const items = await queryAll(deps, {
      TableName: deps.tables.classes,
      IndexName: 'byTeacher',
      KeyConditionExpression: 'teacherId = :sub',
      ExpressionAttributeValues: { ':sub': sub },
      ProjectionExpression: 'classId',
    });
    return { studentIds: [], classIds: items.map((i) => i.classId).filter(Boolean) };
  }

  // Parent: their linked children, and no class scope — a parent has no class-wide read path,
  // which is what makes "who are the top 3?" and "who hasn't paid?" unanswerable (cases A2, A4).
  const items = await queryAll(deps, {
    TableName: deps.tables.students,
    IndexName: 'byParent',
    KeyConditionExpression: 'parentSub = :sub',
    ExpressionAttributeValues: { ':sub': sub },
    ProjectionExpression: 'studentId',
  });
  return { studentIds: items.map((i) => i.studentId).filter(Boolean), classIds: [] };
}

/**
 * Re-authorise one identifier the MODEL supplied against the caller's resolved scope.
 *
 * Every model-supplied classId or studentId must pass through here. Exact string equality on
 * server-issued identifiers — no normalising, no prefix matching, no "close enough".
 * Cases A1, A6, A7, A8, D6: another parent's child is simply not in the array.
 *
 * @param {string} id the identifier the model supplied
 * @param {{studentIds: string[], classIds: string[]}} scope from `resolveScope`
 * @param {'student'|'class'} kind which list to check against
 * @throws {DenyError}
 */
export function assertInScope(id, scope, kind) {
  const allowed = kind === 'student' ? scope?.studentIds : kind === 'class' ? scope?.classIds : null;
  if (!Array.isArray(allowed)) throw new DenyError('not_permitted');   // unknown kind: fail closed
  if (typeof id !== 'string' || !id) throw new DenyError('out_of_scope');
  if (!allowed.includes(id)) throw new DenyError('out_of_scope');
  return id;
}
