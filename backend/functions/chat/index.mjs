// POST /chat — the Lambda boundary. All the logic lives in orchestrate.mjs so it can be tested
// offline; this file only does the things that need AWS: read claims, build the clients, call out.

import { claimsFromEvent } from '../../lib/auth.mjs';
import { handleChat, runToolLoop, MAX_TOOL_TURNS } from './orchestrate.mjs';
import { toolsFor, instructionFor } from './toolspecs.mjs';
// Layer 3 owns the wellbeing wording as well as the blocking checks, so the chat path imports it
// rather than keeping a second copy that could drift. Both functions package the whole backend
// root (see the packaging note in template.yaml), so this import ships.
import { classify, distressReply } from '../policy-check/distress.mjs';

const AGENT_ID = process.env.BEDROCK_AGENT_ID;
const AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID;
const POLICY_CHECK_FUNCTION = process.env.POLICY_CHECK_FUNCTION;

// Option B config. The model id and the guardrail are template parameters already (`ModelId`,
// `GuardrailId`, `GuardrailVersion`); the region is the Lambda's own, which the SDK reads from
// `AWS_REGION` — if decision 3 ever puts the model in a different region from the stack, that is
// one `region:` line here and one template variable, and nothing else.
const MODEL_ID = process.env.MODEL_ID;
const GUARDRAIL_ID = process.env.GUARDRAIL_ID;
const GUARDRAIL_VERSION = process.env.GUARDRAIL_VERSION;

/** The three action-group Lambdas, by the one role allowed to reach each (design §3.3). */
const ACTION_FUNCTIONS = {
  teacher: process.env.ACTIONS_TEACHER_FUNCTION,
  parent: process.env.ACTIONS_PARENT_FUNCTION,
  student: process.env.ACTIONS_STUDENT_FUNCTION,
};

/**
 * Tunable without a code change, because the first live run is where a looping model shows up.
 *
 * Validated rather than coerced: `parseInt(...) || MAX_TOOL_TURNS` read `0` as falsy and quietly
 * ran four rounds, and `-1` left the loop body unentered so every single message answered 502
 * `tool_loop_exhausted` with no model call at all. A misconfigured cap is a deployment mistake, so
 * it fails at init where it is visible, not per request where it looks like an outage.
 */
function maxTurnsFromEnv(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return MAX_TOOL_TURNS;
  const turns = Number(raw);
  if (!Number.isInteger(turns) || turns < 1) {
    throw new Error('MAX_TOOL_TURNS must be a positive whole number of rounds');
  }
  return turns;
}

/**
 * Which orchestrator this deployment uses (docs/NEXT-SESSION.md §0).
 *
 * An agent id that is still the template's placeholder means no agent exists — which is the state
 * this account is stuck in, since `CreateAgent` is denied — so the Converse loop runs. Set a real
 * `BedrockAgentId` and option A takes over with no code change, which is why both paths are still
 * here: the decision is Nishen's, not this file's.
 */
const USE_AGENT_SERVICE = Boolean(AGENT_ID) && AGENT_ID !== 'REPLACEME00';

/**
 * The cap, read only on the path that uses it.
 *
 * Still at module scope, so a misconfigured cap is loud at cold start rather than wrong-but-serving
 * — but only on option B. `MAX_TURNS` is read by `invokeViaLoop` and by nothing else, and on option
 * A a typo in a variable that path never looks at used to brick the function at init: the client
 * gets a bare `500 {"message":"Internal Server Error"}`, which `score.mjs` has no branch for, so the
 * scoreboard would file a configuration mistake as `chat_error` instead of `chat_unavailable`.
 */
const MAX_TURNS = USE_AGENT_SERVICE ? undefined : maxTurnsFromEnv(process.env.MAX_TOOL_TURNS);

/** Colombo is UTC+5:30 with no daylight saving, so "yesterday" is decided here, once, per request. */
function todayInColombo(now = new Date()) {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Lazy SDK imports: these packages exist only inside the Lambda runtime, and a cold start that
// never reaches them should not pay to load them. See backend/lib/ddb.mjs for the same reasoning.
let bedrock;
async function invokeAgent({ sessionId, inputText, sessionAttributes }) {
  const { BedrockAgentRuntimeClient, InvokeAgentCommand } =
    await import('@aws-sdk/client-bedrock-agent-runtime');
  bedrock ??= new BedrockAgentRuntimeClient({});

  const response = await bedrock.send(new InvokeAgentCommand({
    agentId: AGENT_ID,
    agentAliasId: AGENT_ALIAS_ID,
    sessionId,
    inputText,
    sessionState: { sessionAttributes },
  }));

  // InvokeAgent streams its answer back in chunks.
  let text = '';
  for await (const event of response.completion ?? []) {
    if (event.chunk?.bytes) text += new TextDecoder().decode(event.chunk.bytes);
    // A guardrail intervention arrives as a trace rather than an error, so surface it as one.
    if (event.trace?.trace?.guardrailTrace?.action === 'INTERVENED') {
      const err = new Error('guardrail intervened');
      err.guardrailAction = 'INTERVENED';
      throw err;
    }
  }
  return text;
}

// --- option B: Converse with toolConfig --------------------------------------------------------

let runtime;

/**
 * One `Converse` call.
 *
 * `guardrailConfig` is how defence layer 2 survives the move off the agent service: the guardrail
 * created from `backend/agent/guardrail.json` is applied by the model call itself, so the
 * orchestrator cannot forget it and no prompt can talk its way past it. An intervention comes back
 * as `stopReason: 'guardrail_intervened'`, which `runToolLoop` turns into the same
 * `guardrailAction: 'INTERVENED'` error the agent path throws.
 *
 * UNVERIFIED until the first live invoke: that `Converse` accepts `guardrailConfig` under exactly
 * these field names, and that it applies to untagged message text rather than only to content
 * wrapped in a `guardContent` block. If it turns out to need the wrapper, the change is to the
 * `messages` built in `runToolLoop`, not to the loop itself. The guardrail is omitted entirely
 * when no id is configured, because sending an empty identifier would fail the call and take the
 * whole reply down rather than leaving layer 3 to do its job.
 */
async function converse({ system, messages, toolConfig }) {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  runtime ??= new BedrockRuntimeClient({});

  return runtime.send(new ConverseCommand({
    modelId: MODEL_ID,
    system,
    messages,
    toolConfig,
    // Every reply in this product is short by instruction ("refuse in two sentences or fewer",
    // "confirm each write in one line"), and the longest legitimate one is a parent-update draft.
    // A cap keeps a looping model from spending the US$15 budget on one turn; it is generous
    // enough that a truncation means something went wrong rather than that the draft was long.
    inferenceConfig: { maxTokens: 1024 },
    ...(GUARDRAIL_ID
      ? { guardrailConfig: { guardrailIdentifier: GUARDRAIL_ID, guardrailVersion: GUARDRAIL_VERSION } }
      : {}),
  }));
}

/**
 * Invoke the action-group Lambda that owns this tool.
 *
 * Still a Lambda invoke rather than an in-process import, and that is the whole point: importing
 * `actions-teacher/actions.mjs` into this function would need this function's IAM role to carry
 * every DynamoDB permission all three groups have, and design §3.3's third fence — "IAM narrows
 * what each group could do even if the gate were bypassed" — would be gone. One hop costs a few
 * milliseconds and keeps three roles separate.
 *
 * The event is the action-group shape the three handlers already read, so the files that 36
 * red-team cases were proved against are untouched. Values are sent as strings because that is
 * what Bedrock sends and therefore what `validate.mjs` was written against (`parseNames` even
 * documents the JSON-text case).
 */
async function invokeTool({ role, name, input, sessionAttributes }) {
  const FunctionName = ACTION_FUNCTIONS[role];
  if (!FunctionName) throw new Error('no action function configured for this role');

  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const lambda = new LambdaClient({});

  const parameters = Object.entries(input ?? {}).map(([key, value]) => ({
    name: key,
    value: typeof value === 'string' ? value
      : value === null || value === undefined ? ''
        : typeof value === 'object' ? JSON.stringify(value) : String(value),
  }));

  const result = await lambda.send(new InvokeCommand({
    FunctionName,
    Payload: new TextEncoder().encode(JSON.stringify({
      messageVersion: '1.0',
      actionGroup: `panthiya-${role}-actions`,
      function: name,
      parameters,
      // The out-of-band identity channel of design §3.1. On the agent path Bedrock passes this
      // through; here we pass it ourselves, from the same verified claims, to the same gate.
      sessionAttributes,
    })),
  }));

  // A Lambda-level failure is not a result. `runToolLoop` catches this and tells the model the
  // tool did not run, so the user gets an honest sentence instead of an invented confirmation.
  if (result.FunctionError) throw new Error(`action failed: ${result.FunctionError}`);
  return JSON.parse(new TextDecoder().decode(result.Payload));
}

/** Option B behind option A's signature, so `handleChat` cannot tell which one it got. */
const invokeViaLoop = ({ inputText, sessionAttributes }) => runToolLoop({
  inputText,
  sessionAttributes,
  maxTurns: MAX_TURNS,
  deps: { converse, invokeTool, toolsFor, instructionFor },
});

async function policyCheck(payload) {
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const lambda = new LambdaClient({});
  const result = await lambda.send(new InvokeCommand({
    FunctionName: POLICY_CHECK_FUNCTION,
    Payload: new TextEncoder().encode(JSON.stringify(payload)),
  }));
  // A Lambda-level failure is not an allow. handleChat treats a throw as a block.
  if (result.FunctionError) throw new Error(`policyCheck failed: ${result.FunctionError}`);
  return JSON.parse(new TextDecoder().decode(result.Payload));
}

export async function handler(event) {
  let body;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'bad_json' }) };
  }

  const claims = claimsFromEvent(event);

  const { status, body: payload } = await handleChat({
    claims,
    body,
    deps: {
      invokeAgent: USE_AGENT_SERVICE ? invokeAgent : invokeViaLoop,
      policyCheck,
      // design §7.3: checked before the agent is invoked at all, so a student in difficulty costs
      // no tokens and a jailbreak has nothing to steer.
      distressCheck: classify,
      distressReply,
      today: todayInColombo(),
      // One Bedrock session per user per day keeps multi-message attacks (B7, C6) inside one
      // session, without carrying history forever.
      sessionId: `${claims?.sub ?? 'anon'}-${todayInColombo()}`,
    },
  });

  return { statusCode: status, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export const __test__ = { todayInColombo, maxTurnsFromEnv };
