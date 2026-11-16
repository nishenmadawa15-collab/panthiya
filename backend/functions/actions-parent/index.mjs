// actions-parent — the Bedrock action group for the Parent role. Read-only, by code and by IAM:
// `template.yaml` grants this function `GetItem` and `Query` and nothing else, so requirement 7.5
// and case F1 ("delete Nimal's records") hold even if every line below were wrong.
//
// Same boundary shape as `actions-teacher/index.mjs`: this file dispatches and formats, and all the
// authorisation and all the logic live in `actions.mjs`, which is the file the unit tests drive.
//
// Two return paths:
//   - `{ ok: true }`              → SUCCESS. Stored rows about the caller's own child.
//   - `{ ok: false, ask }`        → REPROMPT. Nothing read beyond the caller's own roster; the
//                                   parent is asked which of THEIR children is meant.
//   - DenyError                   → REPROMPT via `deny()`, carrying a closed-set code and our own
//                                   wording — which already names the teacher as the only route
//                                   for anything a parent may not do (requirement 7.5, case F1).
//
// No error path echoes model- or user-supplied text: reflecting the offending string would hand a
// prompt-injection payload a second trip through the model, and in this group that string is often
// another child's name.

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

/** Fixed wording per outcome. Our words, never the caller's own spelling of a name. */
const PROMPTS = {
  which_child:
    'More than one of this parent\'s own children could be meant, and nothing was read. '
    + 'Ask the parent which of the children in `options` they mean. Do not guess, and do not '
    + 'mention any name that is not in `options`.',
};

/**
 * @param event the Bedrock action-group invocation
 * @param provided injected `{ query, tables }`. Omitted in Lambda, where `ddb.mjs` is loaded
 *   lazily — a *static* import of it would pull the AWS SDK into every test process, and the unit
 *   suite deliberately has no dependencies installed to pull it from.
 */
export const handler = async (event, provided) => {
  const action = ACTIONS[event?.function];

  // An unknown or absent action name is a routing mistake or a probe, not a request. A parent
  // session asking for a write, a delete or a roster arrives here, and gets the same refusal a
  // wrong role gets — so neither learns anything from the difference (requirement 7.5, case F1).
  if (!action) return deny('not_permitted', event);

  const injected = provided ?? (await import('../../lib/ddb.mjs')).deps();

  try {
    const result = await action(event, injected);

    if (result.ok) return respond(event, result);

    const reason = result.ask;
    return respond(event, { ...result, reason, message: PROMPTS[reason] }, 'REPROMPT');
  } catch (e) {
    if (e instanceof DenyError) return deny(e, event);

    // A genuine fault (DynamoDB unavailable). Surfaced rather than swallowed: an empty summary
    // presented as "no records" would be a lie a parent could act on.
    throw e;
  }
};
