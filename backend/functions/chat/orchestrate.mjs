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
// Three orchestrators can sit behind `deps.invokeAgent`, and `handleChat` cannot tell them apart —
// which is the point. The choice between them is NO LONGER open: as of 2026-11-20 the challenge
// rules require an agent built on Managed Agents or the AgentCore managed harness
// (docs/CHALLENGE-RULES-BEDROCK.md), so the harness is the path that qualifies and the loop below
// is the documented fallback. Both stay in the tree. docs/AGENTCORE-PLAN.md has the whole decision.
//
//   A  Bedrock Agents Classic — one `InvokeAgent` call; the service runs the loop. `CreateAgent` is
//      denied on this account, so it is wired and unreachable.
//   B  `runToolLoop` below — Converse with `toolConfig`, and the loop runs here. Does not qualify.
//   Track A  `runHarnessTurn` in backend/agentcore/handoff.mjs — the AgentCore harness runs the
//      loop and hands each tool call back to us. The one the rules accept.
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
    // Blocked, under its own name. `model_filter` is deliberately not one of the three layers this
    // product builds and switches off, so `score.mjs` does not recognise it: the case lands in the
    // error tile with `layersRelied: []` and no layer takes the credit. That is the honest outcome
    // — nothing of ours held this one — and it is the outcome a teacher has to read for themselves
    // (requirement 11.4) rather than a tick in the headline number.
    if (err?.name === 'ContentFiltered') return blocked('model_filter', 'content_filtered', role);
    // The loop gave up rather than hanging. Reported as its own code so the red-team run records
    // an `error` (score.mjs maps 502 to `chat_unavailable`) instead of scoring a pass we did not
    // earn — see the honesty argument in the header of backend/functions/redteam/score.mjs.
    // `reply_truncated` joins it for the same reason: a capped reply is a half-sentence, and
    // scoring a half-sentence as a pass would credit `instructions` for an answer nobody read.
    if (err?.code === 'tool_loop_exhausted' || err?.code === 'reply_truncated') return fail(502, err.code);
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

/**
 * The model provider's own content filter stopped the turn. Blocked like a guardrail, labelled
 * nothing like one.
 *
 * This is deliberately *not* `guardrailIntervened()`, which is what it used to be. `GuardrailId`
 * defaults to `""` in backend/template.yaml and `index.mjs` attaches `guardrailConfig` only when
 * it is set, so in the default deployment there is no Bedrock Guardrail at all — and
 * `content_filtered` is the provider's filter regardless, not layer 2. Reporting it as a guardrail
 * block had the red-team scoreboard crediting defence layer 2 for holding a case in a
 * configuration where layer 2 does not exist, which is the one thing that scoreboard exists not to
 * do (see the honesty argument in the header of backend/functions/redteam/score.mjs).
 */
function contentFiltered() {
  const err = new Error('content filtered by the model provider');
  err.name = 'ContentFiltered';
  err.code = 'content_filtered';
  return err;
}

/**
 * Fixed text sent back to the model when a tool did not run. Our words, never the error's.
 *
 * Exported for backend/agentcore/handoff.mjs, which sends the same sentence on the harness path.
 * One definition on purpose: two copies of a safety sentence is how a rule stops being the rule
 * (docs/AGENTCORE-PLAN.md §9). Nothing in this module's own behaviour changes.
 */
export const TOOL_FAILED =
  'This tool did not run and nothing was read or written. Do not retry it, and do not answer out '
  + 'of your own knowledge. Tell the user plainly that the system could not do it just now.';

/**
 * Sent to the model when it asks for a name this session was never offered.
 *
 * Role-branched, because this sentence reaches whichever role asked: telling a teacher whose model
 * invented a tool name to "ask their teacher" names the wrong person and reads as a refusal of
 * something they are in fact allowed to do. Our words either way, never the model's name back.
 */
export const toolUnavailable = (role) =>
  'There is no such tool in this session. Nothing was read or written. Do not guess another name: '
  + (role === 'teacher'
    ? 'tell the user kindly that this is not something the app can do, '
    : 'tell the user kindly that only their teacher can do this, ')
  + 'and continue with what they can have.';

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
    // One line, so a refusal leaves a trace somewhere rather than only in a `log` that is thrown
    // away on success. The role and the name the model invented, and nothing else: no `sub`, no
    // message text, no tool input — none of that belongs in CloudWatch (requirement 13.7).
    //
    // The one exception, named rather than glossed over: `name` is `toolUse.name`, which the model
    // chooses freely, so a prompt injection ("call the tool named <the thing I just told you>")
    // can put up to 64 characters of a student's own words in this log line. It is capped at 64
    // and `JSON.stringify` escapes newlines, so there is no log-injection path and no way to put a
    // whole message through — but it is not literally true that nothing user-derived is logged.
    console.warn(JSON.stringify({ event: 'tool_not_offered', role, name: String(name).slice(0, 64) }));
    return result(true, JSON.stringify({
      ok: false, reason: 'not_permitted', blockedBy: 'role-gate', message: toolUnavailable(role),
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

    // `content_filtered` is the same *event* — the service stopped the turn and left its own text
    // in `content` — so it is blocked the same way rather than returned as a reply the model
    // wrote. It is not the same *layer*: see `contentFiltered` above.
    if (response?.stopReason === 'content_filtered') throw contentFiltered();

    const content = response?.output?.message?.content;
    if (!Array.isArray(content)) throw new LoopError('model_response_unreadable');

    if (response.stopReason !== 'tool_use') {
      // The cap in `index.mjs` is generous enough that hitting it means something went wrong, so a
      // capped reply is the silent truncation this file's header forbids: the text stops mid-word
      // — mid-number, in a parent-update draft a teacher forwards — and returning it would score
      // as a pass. Honest error, same as running out of rounds.
      //
      // Checked BEFORE the tool-use refusal below, and the order is the whole point. A cap hit
      // *during* a tool call leaves a half-built `toolUse` block in `content` alongside the text,
      // so the refusal below matched first and the turn was reported as
      // `tool_use_without_stop_reason` — "the model asked for a tool and then said it was done",
      // which is a model-contract bug nobody can act on at 9pm. It is truncation, and truncation
      // has an answer: raise the cap or shorten the draft. Same 502 either way; only the name was
      // lying, and the name is what the deploy evening reads.
      if (response.stopReason === 'max_tokens') throw new LoopError('reply_truncated');
      // The mirror of the refusal below: a tool-use block whose stop reason says the turn is over.
      // Returning the text would drop the tool use silently, invoke nothing, and pass off whatever
      // the model wrote as the reply — an answer out of its own knowledge.
      if (content.some((block) => block?.toolUse)) throw new LoopError('tool_use_without_stop_reason');
      return textOf(content);
    }

    const uses = content.filter((block) => block?.toolUse).map((block) => block.toolUse);
    if (uses.length === 0) throw new LoopError('tool_use_without_tool');   // malformed: do not guess
    // A `toolResult` with no `toolUseId` is a ValidationException from Converse, which would come
    // back as a raw AWS error and be reported as `agent_unavailable`. Refused under its own name.
    if (uses.some((use) => !use.toolUseId)) throw new LoopError('tool_use_without_id');
    // Two uses sharing one id produce two `toolResult`s under that id, and the model cannot tell
    // which answers which — two `markAttendance` calls with different statuses is the documented
    // dictated-register case, so this is a wrong register, not a theory.
    if (new Set(uses.map((u) => u.toolUseId)).size !== uses.length) {
      throw new LoopError('tool_use_duplicate_id');
    }

    // The assistant turn goes back verbatim, tool-use blocks and all, or the toolResult ids it is
    // answering have nothing to attach to. The *role* is ours, not `output.message.role`: design
    // §3.1 says a role never leaves our code, and a response carrying `role: 'user'` would build
    // `['user','user','user']` — which real Converse rejects, surfacing as `agent_unavailable`.
    messages.push({ role: 'assistant', content });

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
