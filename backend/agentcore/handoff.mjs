// The inline-function handoff loop — Track A's replacement for `runToolLoop`.
//
// The harness owns the agent loop now, but it does NOT own our tools. An inline function is handed
// back to us mid-loop: "The harness pauses when the tool is called and returns the call to your
// code, which decides what to do and sends a result back." So this file is the "your code" in that
// sentence, and the thing it decides is the one thing design §3.1 says the model may never decide.
//
// WHAT IS UNCHANGED, AND IS THE POINT.
//   - `backend/lib/auth.mjs`                 — zero lines.
//   - the three action Lambdas               — zero lines. They get the same action-group event,
//                                              with the same `sessionAttributes`, from the same
//                                              `invokeTool`.
//   - `handleChat` / `orchestrate.mjs`       — zero lines. `runHarnessTurn` has `runToolLoop`'s
//                                              signature and throws `runToolLoop`'s error shapes,
//                                              so it drops in behind `deps.invokeAgent` as the
//                                              third orchestrator that file was written to accept.
//   - `toolsFor` / `instructionFor`          — reused, through harness-config.mjs.
//
// TWO DELIBERATE DIFFERENCES FROM `runToolLoop`, both stricter, both reported rather than slipped
// in (docs/AGENTCORE-PLAN.md §9):
//
//   1. **Stop reasons are an allow-list.** `runToolLoop` reads "not `tool_use`" as a finished
//      answer, and the whole `reply_truncated` defect of 2026-11-19 lived in that gap: a capped
//      reply came back as text and would have been scored a pass. Here each stop reason is handled
//      by name and anything unrecognised is `unknown_stop_reason` — including an absent one, which
//      on a *stream* means the stream ended without ever saying it was done. That is not a finished
//      reply, and treating it as one is the same bug with a new coat on.
//
//   2. **The ordering defect is structural, not positional.** `runToolLoop` had to check
//      `max_tokens` *before* the tool-use refusal, because a cap landing inside a tool call leaves
//      a half-built `toolUse` block beside the text and the refusal matched first — reporting
//      `tool_use_without_stop_reason` ("the model asked for a tool and then said it was done"),
//      which nobody can act on, instead of truncation, which has an answer. Here the switch is on
//      the stop reason and content is only examined inside a branch, so the two facts can no longer
//      be read in the wrong order whatever a later edit does.
//
// No history is resent on resume. AWS: "The harness stores the authoritative assistant `toolUse`
// and pending execution in that session. The follow-up request needs only the matching user
// `toolResult`." So we never build an assistant turn at all — which retires `runToolLoop`'s "the
// assistant turn we send back carries our role" property by removing the thing it guarded.

import { MAX_TOOL_TURNS } from '../functions/chat/orchestrate.mjs';
import { inlineToolsFor, toolNamesOf, ROLES } from './harness-config.mjs';

export { MAX_TOOL_TURNS };

/** Thrown by the loop. Carries a code, never model- or user-supplied text. */
export class HandoffError extends Error {
  constructor(code) {
    super(`handoff: ${code}`);
    this.name = 'HandoffError';
    this.code = code;
  }
}

/**
 * Stop reasons that mean "the model has finished speaking".
 *
 * An allow-list, so an unrecognised stop reason is a loud failure rather than a reply nobody
 * checked. Both are Converse finish reasons and the harness runs on `converse_stream`.
 *
 * **[unverified]** that the harness emits exactly these strings. `tool_use` and
 * `guardrail_intervened` are documented for the harness stream; `end_turn`, `stop_sequence`,
 * `max_tokens` and `content_filtered` are Converse's and are inferred from `apiFormat:
 * 'converse_stream'`. If the first live invoke shows another spelling, every turn fails closed with
 * `unknown_stop_reason` — loud, one line to fix, and the right direction to be wrong in.
 */
export const FINISHED = new Set(['end_turn', 'stop_sequence']);

/** The error shape `handleChat` already understands as layer 2 having intervened. */
function guardrailIntervened() {
  const err = new Error('guardrail intervened');
  err.name = 'GuardrailIntervened';
  err.guardrailAction = 'INTERVENED';
  return err;
}

/**
 * The model provider's own content filter. Blocked like a guardrail, labelled nothing like one —
 * the distinction `orchestrate.mjs` draws because crediting layer 2 for a block in a deployment
 * where layer 2 does not exist is the one thing the red-team scoreboard exists not to do.
 */
function contentFiltered() {
  const err = new Error('content filtered by the model provider');
  err.name = 'ContentFiltered';
  err.code = 'content_filtered';
  return err;
}

/**
 * Fixed text sent back to the model when a tool did not run.
 *
 * ponytail: duplicated from `orchestrate.mjs`, where it is module-private. A drift test in
 * tests/unit/agentcore-handoff.test.mjs reads that file and asserts these strings are still in it,
 * so the two cannot part company silently. Ceiling: it is still two copies of a safety sentence.
 * Upgrade path, one line in a file this lane does not own — export `TOOL_FAILED` and
 * `toolUnavailable` from `backend/functions/chat/orchestrate.mjs` and import them here.
 */
export const TOOL_FAILED =
  'This tool did not run and nothing was read or written. Do not retry it, and do not answer out '
  + 'of your own knowledge. Tell the user plainly that the system could not do it just now.';

/** Role-branched, so a teacher is never told to ask their teacher. */
export const toolUnavailable = (role) =>
  'There is no such tool in this session. Nothing was read or written. Do not guess another name: '
  + (role === 'teacher'
    ? 'tell the user kindly that this is not something the app can do, '
    : 'tell the user kindly that only their teacher can do this, ')
  + 'and continue with what they can have.';

// --- the stream ---------------------------------------------------------------------------------

/**
 * Reassemble one `InvokeHarness` event stream into `{ stopReason, content }` — the same shape a
 * non-streaming `Converse` response carries, so the loop below reads like `runToolLoop` and the
 * properties port across one for one.
 *
 * Pure, so the stream shape is testable with an array of plain objects and no AWS.
 *
 * The events, from AWS's inline-function example: `contentBlockStart` carries
 * `start.toolUse.{toolUseId,name}` and a `contentBlockIndex`; `contentBlockDelta` carries
 * `delta.toolUse.input` as a **string fragment** that has to be concatenated across deltas;
 * `messageStop` carries `stopReason`. Text deltas (`delta.text`) are Converse's shape and are
 * **[unverified]** for the harness. `metadata` events (token usage) are ignored here.
 */
export function assembleStream(events) {
  const blocks = new Map();          // contentBlockIndex → { text } | { toolUse, input: '' }
  const order = [];
  let stopReason = null;
  let sawStop = false;

  const at = (index) => {
    if (!blocks.has(index)) {
      blocks.set(index, { text: '' });
      order.push(index);
    }
    return blocks.get(index);
  };

  for (const event of events ?? []) {
    const start = event?.contentBlockStart;
    if (start) {
      const index = start.contentBlockIndex ?? order.length;
      const use = start.start?.toolUse;
      if (!blocks.has(index)) order.push(index);
      blocks.set(index, use
        ? { toolUse: { toolUseId: use.toolUseId, name: use.name }, input: '' }
        : { text: '' });
      continue;
    }

    const delta = event?.contentBlockDelta;
    if (delta) {
      const block = at(delta.contentBlockIndex ?? 0);
      if (typeof delta.delta?.text === 'string') block.text = (block.text ?? '') + delta.delta.text;
      // A fragment may legitimately be the empty string, so this is a type check, not truthiness.
      if (typeof delta.delta?.toolUse?.input === 'string') block.input += delta.delta.toolUse.input;
      continue;
    }

    if (event?.messageStop) {
      sawStop = true;
      stopReason = event.messageStop.stopReason ?? null;
    }
  }

  const content = order.map((index) => {
    const block = blocks.get(index);
    if (!block.toolUse) return { text: block.text ?? '' };
    // The arguments arrive as JSON text. Unparseable is a malformed tool use, not an empty one:
    // `{}` here would invoke a write action with no arguments at all.
    let input;
    try {
      input = block.input === '' ? {} : JSON.parse(block.input);
    } catch {
      return { toolUse: { ...block.toolUse, unparsable: true } };
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { toolUse: { ...block.toolUse, unparsable: true } };
    }
    return { toolUse: { ...block.toolUse, input } };
  });

  return { stopReason: sawStop ? stopReason : null, content };
}

/** Every `{ text }` block, joined. A model may split its answer across several. */
const textOf = (content) => (content ?? [])
  .map((block) => (typeof block?.text === 'string' ? block.text : ''))
  .filter(Boolean)
  .join('')
  .trim();

/**
 * The action-group response body, as text to hand back to the harness.
 *
 * The three action Lambdas answer in the Bedrock action-group envelope and keep doing so: those are
 * the files 36 red-team cases were proved against, so this loop speaks their envelope rather than
 * asking them to change shape. A `REPROMPT` ("nothing was written, ask which student") is a success
 * as far as the loop is concerned — the tool ran and said what to do next — and marking it an error
 * would invite a retry of a call that was refused.
 */
function bodyOf(envelope) {
  const body = envelope?.response?.functionResponse?.responseBody?.TEXT?.body;
  return typeof body === 'string' && body ? body : null;
}

/**
 * Run one handed-back tool. Never throws: a failed tool is reported *to the model* so it can answer
 * honestly, because a tool outage that took the whole reply down would leave a teacher mid-sentence
 * with no idea whether the fee was recorded.
 */
async function runOneTool({ toolUse, role, offered, sessionAttributes, deps, log }) {
  const { toolUseId, name, input, unparsable } = toolUse ?? {};
  const result = (failed, payload) => ({
    toolResult: { toolUseId, content: [{ text: payload }], ...(failed ? { status: 'error' } : {}) },
  });

  // A name this role was never offered. Refused here, with no Lambda invoked, so the attempt costs
  // nothing and reaches no other role's function — and the model is told our sentence, not that the
  // name belongs to someone else (cases A5, B4: a probe learns nothing from the difference).
  if (!offered.has(name)) {
    log.push({ name, outcome: 'not_offered' });
    // One line, so a refusal leaves a trace rather than only a `log` discarded on success. The role
    // and the invented name, and nothing else: no `sub`, no message text, no tool input — none of
    // that belongs in CloudWatch (requirement 13.7). `name` is model-chosen, so it is capped at 64
    // and JSON-escaped; see the same note in orchestrate.mjs.
    console.warn(JSON.stringify({ event: 'tool_not_offered', role, name: String(name).slice(0, 64) }));
    return result(true, JSON.stringify({
      ok: false, reason: 'not_permitted', blockedBy: 'role-gate', message: toolUnavailable(role),
    }));
  }

  // Arguments that did not parse. Refused rather than sent on as `{}`, which would call a write
  // action with every argument missing and let `validate.mjs` decide what that meant.
  if (unparsable) {
    log.push({ name, outcome: 'unparsable' });
    return result(true, JSON.stringify({ ok: false, reason: 'tool_failed', message: TOOL_FAILED }));
  }

  try {
    const body = bodyOf(await deps.invokeTool({ role, name, input, sessionAttributes }));
    if (body === null) throw new HandoffError('tool_response_unreadable');
    log.push({ name, outcome: 'ok' });
    return result(false, body);
  } catch {
    // Swallowed deliberately, and only here: the error text can carry a DynamoDB message or an echo
    // of a model-supplied name, and neither belongs back in the prompt.
    log.push({ name, outcome: 'failed' });
    return result(true, JSON.stringify({ ok: false, reason: 'tool_failed', message: TOOL_FAILED }));
  }
}

/**
 * Track A's `invokeAgent`. Same contract as the two orchestrators it joins: give it the message and
 * the server-set session attributes, get a reply string back.
 *
 * @param inputText          the user's message, already length-checked by `handleChat`
 * @param sessionAttributes  `{ sub, role, lang, today }`, built from the verified claims
 * @param deps  `{ invokeHarness, invokeTool, runtimeSessionId, modelId, guardrailId,
 *                 guardrailVersion }`. `invokeHarness({ messages, tools, ...overrides })` resolves
 *              to the event-stream array; `invokeTool` is the SAME function the Converse path uses.
 * @param maxTurns  rounds of tool use allowed; defaults to `MAX_TOOL_TURNS`
 * @returns {Promise<string>} the model's final text
 * @throws an error with `guardrailAction: 'INTERVENED'` when layer 2 stops the turn, or a
 *         `HandoffError` whose code `handleChat` turns into an honest status
 */
export async function runHarnessTurn({ inputText, sessionAttributes, deps, maxTurns = MAX_TOOL_TURNS }) {
  const role = sessionAttributes?.role;
  if (!ROLES.includes(role)) throw new HandoffError('no_role');   // fail closed: never a toolless chat

  const tools = inlineToolsFor(role);
  const offered = new Set(toolNamesOf(role));
  const log = [];

  // The first request carries the user's message. Every later one carries only tool results, which
  // is the resume contract — the harness holds the assistant turn, so we never build one.
  let messages = [{ role: 'user', content: [{ text: inputText }] }];

  // `<=` so that after the last allowed round of tools the model still gets one call to turn those
  // results into a sentence; the round after that is the one that gives up.
  for (let round = 0; round <= maxTurns; round += 1) {
    // `tools` is resent every round on purpose: "If you supplied the inline tool as an
    // `InvokeHarness` override, include it again so the pending tool remains available."
    const { stopReason, content } = assembleStream(await deps.invokeHarness({ messages, tools }));

    // Switched on the stop reason FIRST. Content is only read inside a branch, which is what makes
    // the 2026-11-19 ordering defect unreachable rather than merely currently-absent.
    switch (stopReason) {
      // Layer 2. Documented for the harness: "When a guardrail intervenes, the response stream
      // reports `guardrail_intervened` as the stop reason."
      case 'guardrail_intervened':
        throw guardrailIntervened();

      // The same event, a different layer. See `contentFiltered` above.
      case 'content_filtered':
        throw contentFiltered();

      // The cap. Named for what it is, before anything looks at whether a tool-use block came with
      // it — a cap landing *inside* a tool call is exactly the shape that used to be misnamed.
      case 'max_tokens':
        throw new HandoffError('reply_truncated');

      case 'tool_use': {
        const uses = content.filter((b) => b?.toolUse).map((b) => b.toolUse);
        if (uses.length === 0) throw new HandoffError('tool_use_without_tool');
        // A `toolResult` with no `toolUseId` cannot be matched to its call, and the harness
        // documents that "a missing, duplicate, stale, or replayed result cannot resume the
        // handoff". Refused under its own name rather than sent and rejected.
        if (uses.some((u) => !u.toolUseId)) throw new HandoffError('tool_use_without_id');
        // Two uses sharing one id produce two results under that id and the model cannot tell which
        // answers which. Two `markAttendance` calls with different statuses is the documented
        // dictated-register case, so this is a wrong register, not a theory.
        if (new Set(uses.map((u) => u.toolUseId)).size !== uses.length) {
          throw new HandoffError('tool_use_duplicate_id');
        }

        const results = [];
        for (const toolUse of uses) {
          results.push(await runOneTool({ toolUse, role, offered, sessionAttributes, deps, log }));
        }
        // Tool results travel in a `user` turn; that is the shape the API defines, not a role claim.
        messages = [{ role: 'user', content: results }];
        break;
      }

      default: {
        if (!FINISHED.has(stopReason)) {
          // Includes `null`: on a stream, no `messageStop` means the stream ended without saying it
          // was done. Returning its text would be the `reply_truncated` defect wearing a new coat.
          throw new HandoffError('unknown_stop_reason');
        }
        // The mirror of the tool-use branch: a tool-use block whose stop reason says the turn is
        // over. Returning the text would drop the tool use silently, invoke nothing, and pass off
        // whatever the model wrote as the reply — an answer out of its own knowledge.
        if (content.some((b) => b?.toolUse)) throw new HandoffError('tool_use_without_stop_reason');
        const reply = textOf(content);
        if (!reply) throw new HandoffError('empty_reply');
        return reply;
      }
    }
  }

  // Out of rounds with the model still asking for tools. Honest error rather than an invented
  // summary of a half-finished conversation.
  const err = new HandoffError('tool_loop_exhausted');
  err.tools = log;
  throw err;
}
