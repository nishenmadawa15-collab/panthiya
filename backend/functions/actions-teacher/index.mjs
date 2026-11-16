// actions-teacher — the Bedrock action group for the Teacher role, and the only Lambda in Panthiya
// that writes fees, attendance, marks or roster rows (design §3.3).
//
// This file is the boundary and nothing else: it reads the clock, builds `deps`, dispatches on the
// action name Bedrock sent, and turns a return value or a thrown error into the response shape
// Bedrock expects. All authorisation and all business logic live in `actions.mjs`, which is why
// that file is the one the unit tests drive directly.
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
import { InputError } from './validate.mjs';

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

/**
 * @param event the Bedrock action-group invocation
 * @param provided injected `{ query, put, tables }`. Omitted in Lambda, where `ddb.mjs` is loaded
 *   lazily — a *static* import of it would pull the AWS SDK into every test process, and the unit
 *   suite deliberately has no dependencies installed to pull it from.
 */
export const handler = async (event, provided) => {
  const action = ACTIONS[event?.function];

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
