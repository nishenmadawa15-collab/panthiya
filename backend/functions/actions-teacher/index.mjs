// actions-teacher — the Bedrock action group for the Teacher role, and the only Lambda in Panthiya
// that writes fees, attendance, marks or roster rows (design §3.3).
//
// This file is the boundary and nothing else: it reads the clock, builds `deps`, dispatches on the
// action name Bedrock sent, and turns a return value or a thrown error into the response shape
// Bedrock expects. All authorisation and all business logic live in `actions.mjs`, which is why
// that file is the one the unit tests drive directly.
//
// Two kinds of invocation arrive here, and the difference decides the response shape:
//   - a Bedrock action-group event, which carries `function` → the envelope below;
//   - an HTTP API event, which carries `routeKey` → `statusCode` / `headers` / `body`, exactly as
//     `functions/read/index.mjs` builds it. The two teacher writes of design §5 that are buttons
//     rather than sentences (approve a draft, delete a student) arrive this way, and `HTTP_ROUTES`
//     is the whole list of them. An action absent from that table is unreachable over HTTP, and an
//     action absent from `DISPATCH` is unreachable by the model — which is how `deleteStudent`
//     stays a deliberate teacher action instead of something an agent can be argued into.
//
// Three return paths, and the difference between them matters:
//   - `{ ok: true }`          → SUCCESS. A write happened and was audited in this invocation.
//   - `{ ok: false, ask|confirm }` → REPROMPT. Nothing was written. The teacher is asked something.
//   - DenyError / InputError  → REPROMPT, carrying a closed-set code and our own wording.
//
// No error path echoes model- or user-supplied text. `deny()` in `backend/lib/auth.mjs` already
// works this way, and the two input paths here follow it: reflecting the offending string would
// hand a prompt-injection payload a second trip through the model.

import { deny, DenyError } from '../../lib/auth.mjs';
import { ACTIONS } from './actions.mjs';
import { DRAFT_ACTIONS } from './drafts.mjs';
import { HTTP_ONLY_ACTIONS } from './erase.mjs';
import { InputError } from './validate.mjs';

/** The action table of design §6.2, in full: the four writes plus the draft/approval pair. */
const DISPATCH = { ...ACTIONS, ...DRAFT_ACTIONS };

/**
 * The teacher writes that arrive over HTTP, keyed by the HTTP API `routeKey` — which is the
 * template's own route string, and therefore the safest thing to dispatch on.
 *
 * Both routes exist in `template.yaml` already. `deleteStudent` appears here and nowhere else;
 * `approveParentUpdate` is reachable both ways on purpose, because a teacher approves a draft either
 * by tapping the button in the drafts view or by saying so in the chat (requirement 6.3).
 */
const HTTP_ROUTES = {
  'DELETE /teacher/students/{id}': HTTP_ONLY_ACTIONS.deleteStudent,
  'POST /teacher/drafts/{id}/approve': DRAFT_ACTIONS.approveParentUpdate,
};

/** Keep Bedrock's routing fields to the shape of our own schema names before echoing them. */
const safeName = (v) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : '') || 'unknown';

const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;   // Asia/Colombo is UTC+5:30 all year; no DST

/**
 * Today's date in the teacher's own timezone, as `YYYY-MM-DD`.
 *
 * Read once, here at the boundary, and passed down as an argument — so "yesterday" / "ඊයේ" /
 * "நேற்று" is pure logic that a test can pin to a fixed day. The chat Lambda may override it via
 * `sessionAttributes`, which the model cannot write to (design §3.1); anything malformed there is
 * ignored rather than trusted.
 */
export function todayInColombo(event, nowMs = Date.now()) {
  const given = event?.sessionAttributes?.today;
  if (typeof given === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(given)) return given;
  return new Date(nowMs + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
}

/** One Bedrock action-group response. `state` omitted means success. */
function respond(event, body, state) {
  return {
    messageVersion: '1.0',
    response: {
      actionGroup: safeName(event?.actionGroup),
      function: safeName(event?.function),
      functionResponse: {
        ...(state ? { responseState: state } : {}),
        responseBody: { TEXT: { body: JSON.stringify(body) } },
      },
    },
  };
}

/** Fixed wording per outcome. Our words, never the attacker's, never the teacher's own spelling. */
const PROMPTS = {
  no_matching_student:
    'That name did not match exactly one student in your classes. No data was written. '
    + 'Ask the teacher which student is meant, offering the names in `options` if any are listed.',
  which_student:
    'That name matches more than one student in your classes. No data was written. '
    + 'Ask the teacher which of the students in `options` is meant. Do not guess.',
  confirm_fee:
    'Nothing has been written yet. Read the amount, currency and period back to the teacher and ask '
    + 'them to confirm. Only call recordFee again, with confirmed=true, after they agree.',
  invalid_input:
    'The teacher needs to restate this. No data was written. Ask them plainly for the value named '
    + 'by `reason`, and do not substitute a value of your own.',
};

// --- the HTTP boundary (design §5) -------------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json' };

const httpReply = (status, body) => ({ statusCode: status, headers: JSON_HEADERS, body: JSON.stringify(body) });

/**
 * The route this invocation is for, or `''` when it is not an HTTP one.
 *
 * Four lines duplicated from `functions/read/index.mjs` rather than shared: importing across
 * function directories to save them would couple two Lambdas that otherwise have nothing in common,
 * and `lib/` is for the security spine, not for request plumbing.
 */
export function routeKeyOf(event) {
  if (typeof event?.routeKey === 'string' && event.routeKey) return event.routeKey;

  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path ?? event?.rawPath;
  return method && path ? `${method} ${path}` : '';
}

/**
 * Serve one HTTP route. Status codes carry a closed-set code and never the client's own text, for
 * the same reason `DenyError` does — an echoed path parameter is a reflected payload.
 *
 *   403 denied        wrong role, or an id outside the caller's scope. A student who does not exist
 *                     returns `out_of_scope` too, so a probe learns nothing from the difference.
 *   400 bad_request   a malformed request (no id in the path).
 *   404 not_found     an HTTP route this function does not serve.
 *   500               a genuine fault, including a deletion that stopped partway. Never reported
 *                     as success: a half-erased child must be visible, and the retry is safe.
 */
async function serveHttp(event, routeKey, deps) {
  const action = HTTP_ROUTES[routeKey];
  if (!action) return httpReply(404, { error: 'not_found' });

  try {
    return httpReply(200, await action(event, deps, { today: todayInColombo(event) }));
  } catch (e) {
    if (e instanceof DenyError) return httpReply(403, { error: 'denied', reason: e.code });
    if (e instanceof InputError) return httpReply(400, { error: 'bad_request', reason: e.code });
    throw e;
  }
}

/**
 * @param event the Bedrock action-group invocation
 * @param provided injected `{ query, put, tables }`. Omitted in Lambda, where `ddb.mjs` is loaded
 *   lazily — a *static* import of it would pull the AWS SDK into every test process, and the unit
 *   suite deliberately has no dependencies installed to pull it from.
 */
export const handler = async (event, provided) => {
  // An HTTP event carries a route and no `function`; a Bedrock one is the other way round. Checked
  // in this order so a route can never be answered with a Bedrock envelope, which API Gateway would
  // hand back to the browser as a 200.
  const routeKey = routeKeyOf(event);
  if (routeKey) {
    return serveHttp(event, routeKey, provided ?? (await import('../../lib/ddb.mjs')).deps());
  }

  const action = DISPATCH[event?.function];

  // An unknown or absent action name is a routing mistake or a probe, not a request. Fail closed
  // with the same refusal a wrong role gets, so neither learns anything from the difference.
  if (!action) return deny('not_permitted', event);

  const injected = provided ?? (await import('../../lib/ddb.mjs')).deps();

  try {
    const result = await action(event, injected, { today: todayInColombo(event) });

    if (result.ok) return respond(event, result);

    // Nothing was written on this path. Say so, and say what to ask for.
    const reason = result.ask ?? 'confirm_fee';
    return respond(event, { ...result, reason, message: PROMPTS[reason] }, 'REPROMPT');
  } catch (e) {
    if (e instanceof DenyError) return deny(e, event);

    if (e instanceof InputError) {
      return respond(
        event,
        { ok: false, reason: e.code, blockedBy: 'validation', message: PROMPTS.invalid_input },
        'REPROMPT',
      );
    }

    // A genuine fault (DynamoDB down, a failed audit put). Requirement 10.2: never report success
    // for a write whose audit entry did not land, so this surfaces rather than being swallowed.
    throw e;
  }
};
