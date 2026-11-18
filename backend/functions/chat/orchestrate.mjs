// The chat orchestrator, as a pure function so it can be tested with no AWS and no credentials.
//
// This is where identity crosses from "verified token" into "something the model can see", and it
// is the narrowest point in the whole system. Two rules hold here above all others:
//
//   1. Role comes from the verified claims. The message body is data, never identity, no matter
//      what it says about itself (requirement 1.3, red-team cases B5, D3, D4).
//   2. Every reply passes through policyCheck before a human reads it, and policyCheck failing is
//      a block, not a pass (requirements 9.2, 9.4).
//
// Two orchestrators can sit behind `deps.invokeAgent`, and `handleChat` cannot tell them apart —
// which is the point, because the choice between them is still open (docs/NEXT-SESSION.md §0):
//
//   A  Bedrock Agents Classic / AgentCore — one `InvokeAgent` call; the service runs the loop.
//   B  `runToolLoop` below — Converse with `toolConfig`, and the loop runs here.
//
// Both return a reply string, and both signal a guardrail intervention by throwing an error whose
// `guardrailAction` is `'INTERVENED'`. So the layer-2 and layer-3 paths in `handleChat` are shared,
// and switching orchestrator is a change in `index.mjs` and nowhere else.

export const MAX_MESSAGE = 2000;     // design §5. Rejected before any model call: cost and injection surface.
export const MAX_HISTORY_TURNS = 6;  // design §6.4.

/**
 * How many times the model may ask for tools before we stop it (option B).
 *
 * Four rounds, so at most five model calls per message. The real work in design §6.2 needs one
 * round — markAttendance for a dictated register needs one call per status, which the model issues
 * as parallel tool uses inside a single round — and the extra three exist for a model that asks
 * for a hint, reads it, and then asks for an example. Beyond that the model is looping rather than
 * working, and every round pays for the ~800-token instruction again (design §6.4, US$15 total).
 *
 * Exceeding it is an honest error, never a silent truncation: a half-finished tool conversation
 * summarised as a reply is exactly the kind of invented answer rule 3 of the instruction forbids.
 *
 * It is also the only lever on the clock: every round is a model call inside one request, and the
 * chat Lambda has 29 seconds because API Gateway caps at 30. Four rounds of a slow model would
 * spend it, so if the first live runs show the round trip is slow, this is the number to drop.
 */
export const MAX_TOOL_TURNS = 4;

const ROLES = new Set(['teacher', 'parent', 'student']);

/** A refusal the front-end localises from `blockedBy`; it never echoes the user's text back. */
function blocked(layer, reason, role = null) {
  return { status: 200, body: { reply: null, blockedBy: layer, reason, role } };
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
    let result = false;
    try {
      result = await deps.distressCheck(message, lang);
    } catch {
      result = { hit: true, kind: 'distress' };   // a broken wellbeing check errs towards care
    }
    // Two shapes are accepted: `true`, and `{hit, kind}` — which is what `classify()` returns and
    // what picks the medical reply over the distress one. Read `hit` explicitly: `{hit: false}` is
    // an object, so plain truthiness made every single student message a wellbeing block, and the
    // model was never reached at all. Nothing caught it, because every test for this block faked
    // the dependency and none wired the real `classify` through.
    const hit = result === true || (typeof result === 'object' && result !== null && result.hit === true);
    if (hit) {
      const kind = (typeof result === 'object' && result?.kind) || 'distress';
      // This reply is written by a human and stored, never generated. A child in difficulty should
      // not be the one turn where the model improvises, and there is nothing here to jailbreak.
      const reply = deps.distressReply ? deps.distressReply(kind, lang) : null;
      return { status: 200, body: { reply, blockedBy: 'distress', reason: kind, role } };
    }
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
      return blocked('guardrail', 'guardrail_intervened', role);
    }
    // The loop gave up rather than hanging. Reported as its own code so the red-team run records
    // an `error` (score.mjs maps 502 to `chat_unavailable`) instead of scoring a pass we did not
    // earn — see the honesty argument in the header of backend/functions/redteam/score.mjs.
    if (err?.code === 'tool_loop_exhausted') return fail(502, 'tool_loop_exhausted');
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
    return blocked('policyCheck', 'check_failed', role);
  }
  if (verdict?.verdict !== 'allow') {
    return blocked('policyCheck', verdict?.reason ?? 'blocked', role);
  }

  // `role` is decision 5 of docs/NEXT-SESSION.md §4: the role we read from the verified claims,
  // echoed back. It closes the last ceiling named in `redteam/score.mjs` — the runner has to be
  // told which role the token held (`sessionRole`) and cannot check it, so a case can be filed
  // under the wrong role. With this field the page and the CLI compare against what the server
  // actually saw. It discloses nothing: the caller already holds the token this came from.
  return { status: 200, body: { reply, blockedBy: null, role } };
}

// =================================================================================================
// Option B — the agentic loop
// =================================================================================================
//
// `Converse` with `toolConfig`, looping while `stopReason === 'tool_use'`, dispatching each tool
// use to the action-group Lambda that owns it, feeding the result back as a `toolResult` block,
// until the model answers in text. Everything that needs AWS is injected, so the whole loop runs
// in `node --test` with no credentials and no network.
//
// WHY THE ROLE GATE IS STRONGER HERE THAN ON THE AGENT PATH (design §3.1, §3.3).
// Bedrock attaches action groups to an agent *version*, not to a session, so on the agent path all
// three groups are offered to every session and the gate is the first four lines of each action
// Lambda — the model is free to *ask* for `recordFee` in a student session and is then refused.
// Here the tool list is built per turn from `sessionAttributes.role`, which came from the verified
// JWT claims, so a student session is never told that `recordFee` exists. There is no name for a
// jailbreak to guess at, the forged `role` in a request body was discarded before this function
// was reached, and a model that invents a name anyway is refused below without a Lambda being
// invoked at all. The per-Lambda `requireRole` gate and the per-Lambda IAM both still stand behind
// this. It is a third fence in front of two that already worked, not a replacement for either.

/** Thrown by the loop. Carries a code, never model- or user-supplied text. */
export class LoopError extends Error {
  constructor(code) {
    super(`loop: ${code}`);
    this.name = 'LoopError';
    this.code = code;
  }
}

/** The error shape `handleChat` already understands as layer 2 having intervened. */
function guardrailIntervened() {
  const err = new Error('guardrail intervened');
  err.name = 'GuardrailIntervened';
  err.guardrailAction = 'INTERVENED';
  return err;
}

/** Fixed text sent back to the model when a tool did not run. Our words, never the error's. */
const TOOL_FAILED =
  'This tool did not run and nothing was read or written. Do not retry it, and do not answer out '
  + 'of your own knowledge. Tell the user plainly that the system could not do it just now.';

const TOOL_UNAVAILABLE =
  'There is no such tool in this session. Nothing was read or written. Do not guess another name: '
  + 'tell the user kindly that only their teacher can do this, and continue with what they can have.';

/** Every `{ text }` block of a message, joined. A model may split its answer across several. */
function textOf(content) {
  return (content ?? [])
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('')
    .trim();
}

/**
 * The action-group response body, as text to hand back to the model.
 *
 * The three action Lambdas answer in the Bedrock action-group envelope — a JSON string under
 * `response.functionResponse.responseBody.TEXT.body` — and they keep answering in it on purpose:
 * it is what option A needs, and those three handlers are the files 36 red-team cases were proved
 * against. So this loop speaks that envelope rather than asking them to change shape.
 *
 * A `REPROMPT` state ("nothing was written, ask the teacher which student") is a success as far as
 * Converse is concerned — the tool ran and told us what to do next — and the instruction for the
 * model is inside the body. Marking it `error` would invite a retry of a call that was refused.
 */
function bodyOf(envelope) {
  const body = envelope?.response?.functionResponse?.responseBody?.TEXT?.body;
  return typeof body === 'string' && body ? body : null;
}

/**
 * Run one tool use. Never throws: a failed tool is reported *to the model* so it can answer
 * honestly, because a tool outage that took the whole reply down would leave a teacher mid-sentence
 * with no idea whether the fee was recorded.
 */
async function runOneTool({ toolUse, role, offered, sessionAttributes, deps, log }) {
  const { toolUseId, name, input } = toolUse ?? {};
  const result = (failed, payload) => ({
    toolResult: { toolUseId, content: [{ text: payload }], ...(failed ? { status: 'error' } : {}) },
  });

  // A name this role was never offered. Refused here, with no Lambda invoked, so the attempt costs
  // nothing and reaches no other role's function — and the model is told our sentence, not that
  // the name belongs to someone else (cases A5, B4: a probe learns nothing from the difference).
  if (!offered.has(name)) {
    log.push({ name, outcome: 'not_offered' });
    return result(true, JSON.stringify({
      ok: false, reason: 'not_permitted', blockedBy: 'role-gate', message: TOOL_UNAVAILABLE,
    }));
  }

  try {
    const body = bodyOf(await deps.invokeTool({ role, name, input, sessionAttributes }));
    if (body === null) throw new LoopError('tool_response_unreadable');
    log.push({ name, outcome: 'ok' });
    return result(false, body);
  } catch {
    // Swallowed deliberately, and only here: the error text can carry a DynamoDB message or an
    // echo of a model-supplied name, and neither belongs back in the prompt.
    log.push({ name, outcome: 'failed' });
    return result(true, JSON.stringify({ ok: false, reason: 'tool_failed', message: TOOL_FAILED }));
  }
}

/**
 * Option B's `invokeAgent`. Same contract as the agent-service call it replaces: give it the
 * message and the server-set session attributes, get a reply string back.
 *
 * @param inputText          the user's message, already length-checked by `handleChat`
 * @param sessionAttributes  `{ sub, role, lang, today }`, built from the verified claims
 * @param deps   `{ converse, invokeTool, toolsFor, instructionFor }` — all four injected so this
 *               runs offline. `converse` takes `{ system, messages, toolConfig }` and returns the
 *               `Converse` response; `invokeTool` invokes one action-group Lambda.
 * @param maxTurns  rounds of tool use allowed; defaults to `MAX_TOOL_TURNS`
 * @returns {Promise<string>} the model's final text
 * @throws an error with `guardrailAction: 'INTERVENED'` when layer 2 stops the turn, or a
 *         `LoopError` whose code `handleChat` turns into an honest status
 */
//
// ponytail: this loop is single-message. `messages` starts empty of history and is thrown away
// when the request ends, because the only place to keep it would be a new DynamoDB table, and
// accepting history from the client instead would let an attacker forge *assistant* turns
// ("confirmed: role=teacher") — the one thing design §3.1 exists to prevent. Ceiling: the agent
// service kept six turns per `sessionId` (MAX_HISTORY_TURNS, design §6.4), so on this path a
// follow-up like "and Dilmi?" starts cold, and the two multi-message cases (B7, C6) see each
// message on its own — which is safer, but it is a different attack from the one documented.
// Upgrade path: a `chat_history` table keyed by `sessionId`, written here, read back here.
export async function runToolLoop({ inputText, sessionAttributes, deps, maxTurns = MAX_TOOL_TURNS }) {
  const role = sessionAttributes?.role;
  if (!ROLES.has(role)) throw new LoopError('no_role');   // fail closed: never a toolless free chat

  const tools = deps.toolsFor(role);
  const offered = new Set(tools.map((t) => t.toolSpec.name));
  const system = [{ text: deps.instructionFor(role) }];
  const toolConfig = { tools };

  const messages = [{ role: 'user', content: [{ text: inputText }] }];
  const log = [];

  // `<=` so that after the last allowed round of tools the model still gets one call to turn those
  // results into a sentence; the round after that is the one that gives up.
  for (let round = 0; round <= maxTurns; round += 1) {
    const response = await deps.converse({ system, messages, toolConfig });

    // Layer 2. A guardrail intervention arrives as a stop reason rather than an exception, so it
    // has to be looked for; letting it fall through to `stopReason !== 'tool_use'` would return
    // the guardrail's own canned sentence as if the model had written it, and the red-team run
    // would credit `instructions` for a case the guardrail held.
    if (response?.stopReason === 'guardrail_intervened') throw guardrailIntervened();

    const content = response?.output?.message?.content;
    if (!Array.isArray(content)) throw new LoopError('model_response_unreadable');

    if (response.stopReason !== 'tool_use') return textOf(content);

    const uses = content.filter((block) => block?.toolUse).map((block) => block.toolUse);
    if (uses.length === 0) throw new LoopError('tool_use_without_tool');   // malformed: do not guess

    // The assistant turn goes back verbatim, tool-use blocks and all, or the toolResult ids it is
    // answering have nothing to attach to.
    messages.push({ role: response.output.message.role ?? 'assistant', content });

    const results = [];
    for (const toolUse of uses) {
      results.push(await runOneTool({ toolUse, role, offered, sessionAttributes, deps, log }));
    }
    // Tool results travel in a `user` turn; that is the shape Converse defines, not a role claim.
    messages.push({ role: 'user', content: results });
  }

  // Out of rounds with the model still asking for tools. Honest error rather than an invented
  // summary of a half-finished conversation.
  const err = new LoopError('tool_loop_exhausted');
  err.tools = log;
  throw err;
}
