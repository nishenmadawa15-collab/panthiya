// actions-student — the Bedrock action group for the Student role. No data access at all, by code
// and by IAM: `template.yaml` gives this function no `Policies` block, so its role carries only
// CloudWatch Logs write and nothing in a student session can reach a mark, a fee or another child
// (design §3.3; cases A5, B4).
//
// Same boundary shape as the other two groups: this file dispatches and formats, and all the
// authorisation and all the logic live in `actions.mjs`, which is the file the unit tests drive.
//
// One visible difference from `actions-parent/index.mjs`: there is **no `deps` argument and no
// lazy `ddb.mjs` import**. The absence is the design statement — this handler has no database
// client to be talked into using.
//
// Three return paths:
//   - `{ ok: true }`              → SUCCESS. Fixed hint scaffolding, or a verified example.
//   - `{ ok: false, ask }`        → REPROMPT. Nothing was returned; the model is told what to do
//                                   instead, in our words (wellbeing, or hint rather than example).
//   - DenyError                   → REPROMPT via `deny()`, carrying a closed-set code.
//
// No error path echoes model- or user-supplied text: reflecting the offending string would hand a
// prompt-injection payload a second trip through the model, and in this group that string is often
// a plea from a frightened child.

import { deny, DenyError } from '../../lib/auth.mjs';
import { ACTIONS } from './actions.mjs';

/** Keep Bedrock's routing fields to the shape of our own schema names before echoing them. */
const safeName = (v) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : '') || 'unknown';

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

/** Fixed wording per outcome. Our words, never the student's own. */
const PROMPTS = {
  // Requirements 8.5 and 8.6. The instruction is long because this is the one reply where a
  // generic refusal would be the wrong product (backend/agent/README.md on case E3): the student
  // gets a warm redirect and real study advice, not a wall. It costs tokens only on a hit.
  wellbeing:
    'Stop tutoring this message. No hint and no example were returned, and no medicine, dose or '
    + 'supplement exists in this tool to return — do not supply one, and do not continue with the '
    + 'question. Reply warmly in the student\'s own language, in a few sentences: say that what '
    + 'they are feeling matters and that they are not alone, suggest someone they trust today — a '
    + 'parent, their teacher or an older relative — and give the free Sri Lanka helpline 1926. If '
    + 'the message asked about medicine, tablets, supplements or staying awake, say plainly that '
    + 'only a doctor can advise that, and offer healthy study habits instead: short study blocks '
    + 'with breaks, sleep before the paper, and water. Do not judge, and do not retry this action.',
  no_safe_example:
    'No worked example was returned, because no stored example differs enough from this question '
    + 'to be a different problem. Do not invent one, and do not work through the student\'s own '
    + 'question. Call getHint instead and walk them through their question one step at a time, '
    + 'saying plainly that you will do it that way.',
};

/**
 * @param event the Bedrock action-group invocation
 */
export const handler = async (event) => {
  const action = ACTIONS[event?.function];

  // An unknown or absent action name is a routing mistake or a probe, not a request. A student
  // session talked into naming a teacher or parent action arrives here and gets the same refusal
  // a wrong role gets, so neither learns anything from the difference (cases A5, B4).
  if (!action) return deny('not_permitted', event);

  try {
    const result = await action(event);

    if (result.ok) return respond(event, result);

    const reason = result.ask;
    return respond(event, { ...result, reason, message: PROMPTS[reason] }, 'REPROMPT');
  } catch (e) {
    if (e instanceof DenyError) return deny(e, event);

    // Nothing in this group does I/O, so a throw here is a bug in our own code rather than an
    // outage. Surfaced rather than swallowed: a tutor that silently returned nothing would look
    // to the student like being ignored.
    throw e;
  }
};
