// The chat orchestrator, as a pure function so it can be tested with no AWS and no credentials.
//
// This is where identity crosses from "verified token" into "something the model can see", and it
// is the narrowest point in the whole system. Two rules hold here above all others:
//
//   1. Role comes from the verified claims. The message body is data, never identity, no matter
//      what it says about itself (requirement 1.3, red-team cases B5, D3, D4).
//   2. Every reply passes through policyCheck before a human reads it, and policyCheck failing is
//      a block, not a pass (requirements 9.2, 9.4).

export const MAX_MESSAGE = 2000;     // design §5. Rejected before any model call: cost and injection surface.
export const MAX_HISTORY_TURNS = 6;  // design §6.4.

const ROLES = new Set(['teacher', 'parent', 'student']);

/** A refusal the front-end localises from `blockedBy`; it never echoes the user's text back. */
function blocked(layer, reason) {
  return { status: 200, body: { reply: null, blockedBy: layer, reason } };
}

const fail = (status, error) => ({ status, body: { error } });

/**
 * @param claims   from `claimsFromEvent` — `{ sub, role }`, already verified by the JWT authorizer
 * @param body     the parsed request body: `{ message, lang, audioKey? }`
 * @param deps     injected: `{ invokeAgent, policyCheck, distressCheck?, today, sessionId }`
 */
export async function handleChat({ claims, body, deps }) {
  // --- identity -------------------------------------------------------------------------------
  const { sub, role } = claims ?? {};
  if (!sub || !ROLES.has(role)) return fail(401, 'unauthenticated');

  // --- input ----------------------------------------------------------------------------------
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return fail(400, 'empty_message');
  if (message.length > MAX_MESSAGE) return fail(400, 'message_too_long');

  const lang = ['si', 'ta', 'en'].includes(body?.lang) ? body.lang : 'en';

  // --- wellbeing, before the model is involved at all -------------------------------------------
  // design §7.3: a student in distress gets a fixed, human-written reply. No model creativity in a
  // wellbeing moment, no tokens spent, and nothing to jailbreak.
  if (role === 'student' && deps.distressCheck) {
    let distressed = false;
    try {
      distressed = await deps.distressCheck(message, lang);
    } catch {
      distressed = true;   // if the wellbeing check is broken, err towards care, not towards tutoring
    }
    if (distressed) return blocked('distress', 'wellbeing');
  }

  // --- the model ---------------------------------------------------------------------------------
  // sessionAttributes is the out-of-band identity channel. The model can choose an action and its
  // arguments; it can never choose who it is talking to.
  const sessionAttributes = {
    sub,
    role,
    lang,
    today: deps.today,
  };

  let reply;
  try {
    reply = await deps.invokeAgent({
      sessionId: deps.sessionId,
      inputText: message,
      sessionAttributes,
      maxHistoryTurns: MAX_HISTORY_TURNS,
    });
  } catch (err) {
    if (err?.name === 'GuardrailIntervened' || err?.guardrailAction === 'INTERVENED') {
      return blocked('guardrail', 'guardrail_intervened');
    }
    return fail(502, 'agent_unavailable');
  }

  if (typeof reply !== 'string' || reply.trim() === '') return fail(502, 'empty_agent_reply');

  // --- layer 3, fail closed ----------------------------------------------------------------------
  // An exception, a timeout or an unparsable verdict all mean "we do not know whether this reply is
  // safe", and an unknown reply is not shown to a parent or a child.
  let verdict;
  try {
    verdict = await deps.policyCheck({ role, sub, userMessage: message, agentReply: reply, lang });
  } catch {
    return blocked('policyCheck', 'check_failed');
  }
  if (verdict?.verdict !== 'allow') {
    return blocked('policyCheck', verdict?.reason ?? 'blocked');
  }

  return { status: 200, body: { reply, blockedBy: null } };
}
