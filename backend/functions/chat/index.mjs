// POST /chat — the Lambda boundary. All the logic lives in orchestrate.mjs so it can be tested
// offline; this file only does the things that need AWS: read claims, build the clients, call out.

import { claimsFromEvent } from '../../lib/auth.mjs';
import { handleChat, runToolLoop, MAX_TOOL_TURNS } from './orchestrate.mjs';
import { toolsFor, instructionFor } from './toolspecs.mjs';
// Track A (docs/AGENTCORE-PLAN.md): the AgentCore managed harness runs the agent loop, and hands
// each tool call back to this file to execute. Both modules are under backend/, which is the
// packaged CodeUri, so they ship with this function (see the packaging note in template.yaml).
import { runHarnessTurn } from '../../agentcore/handoff.mjs';
import { invocationOverrides } from '../../agentcore/harness-config.mjs';
// Layer 3 owns the wellbeing wording as well as the blocking checks, so the chat path imports it
// rather than keeping a second copy that could drift. Both functions package the whole backend
// root (see the packaging note in template.yaml), so this import ships.
import { classify, distressReply } from '../policy-check/distress.mjs';

const AGENT_ID = process.env.BEDROCK_AGENT_ID;
const AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID;
const POLICY_CHECK_FUNCTION = process.env.POLICY_CHECK_FUNCTION;

// Track A config. `HARNESS_ID` is what decides the path (it is the id a human records after running
// `create-harness` by hand); `HARNESS_ARN` is what the invoke is addressed to. Two variables for one
// resource because the template scopes the IAM to an ARN built from the id, so an id and an ARN that
// disagree fail closed with AccessDenied rather than invoking something unintended.
const HARNESS_ID = process.env.HARNESS_ID;
const HARNESS_ARN = process.env.HARNESS_ARN;

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
 * The template's "not configured yet" default, in one place because two ids now use it.
 * `BedrockAgentId` has carried it since M1 task 1.11; `HarnessId` follows the same pattern.
 */
const PLACEHOLDER_ID = 'REPLACEME00';
const configured = (id) => Boolean(id) && id !== PLACEHOLDER_ID;

/**
 * Which orchestrator this deployment uses (docs/AGENTCORE-PLAN.md §10).
 *
 * Three paths, decided by environment so the choice stays a deploy-time one:
 *
 *   `harness` — Track A, the AgentCore managed harness. **First, because it is the only one of the
 *               three the challenge rules accept** (docs/CHALLENGE-RULES-BEDROCK.md): the required
 *               service is Managed Agents or the AgentCore harness, and a harness that is
 *               configured and then not used would be a harness that does not count.
 *   `agent`   — option A, Bedrock Agents Classic. Still wired; `CreateAgent` is denied on this
 *               account, so it cannot be reached today without a different account.
 *   `loop`    — option B, our own `Converse` + `toolConfig` loop. The documented fallback: it does
 *               not qualify for the challenge, and it is what serves when nothing else is set.
 *
 * Pure and exported so each branch is testable without a deployment; `ORCHESTRATOR` below is what
 * proves the deployed module actually asks it.
 */
export function orchestratorFor({ harnessId, agentId }) {
  if (configured(harnessId)) return 'harness';
  if (configured(agentId)) return 'agent';
  return 'loop';
}

const ORCHESTRATOR = orchestratorFor({ harnessId: HARNESS_ID, agentId: AGENT_ID });

// The only log line in this file, and it earns its place: `loop` is a *supported* path that behaves
// correctly, so a deployment that silently selected it looks exactly like a working one — every page
// answers, every test passes — while serving the orchestrator the challenge rules do not accept.
// `__test__.orchestrator` is a test hook and reaches no deployment, so without this there is no way
// to tell from CloudWatch which path served. Found 2026-11-20 while writing AGENTCORE-PLAN §11.4.
// Once per cold start, no request data, nothing secret: `HARNESS_ID` is a resource id, not a credential.
console.log(JSON.stringify({ event: 'orchestrator_selected', orchestrator: ORCHESTRATOR, harnessId: HARNESS_ID ?? null }));

/**
 * The cap, read only on the paths that use it.
 *
 * Still at module scope, so a misconfigured cap is loud at cold start rather than wrong-but-serving
 * — but only where it is read. `MAX_TURNS` is read by `invokeViaLoop` and by `invokeViaHarness`
 * (the harness runs the model loop, but the handoff rounds are still ours to bound) and by nothing
 * else. On the agent path, a typo in a variable that path never looks at used to brick the function
 * at init: the client gets a bare `500 {"message":"Internal Server Error"}`, which `score.mjs` has
 * no branch for, so the scoreboard would file a configuration mistake as `chat_error` instead of
 * `chat_unavailable`. One `InvokeAgent` call has no rounds to cap, so that stays true here.
 */
const MAX_TURNS = ORCHESTRATOR === 'agent'
  ? undefined
  : maxTurnsFromEnv(process.env.MAX_TOOL_TURNS);

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

// --- Track A: the AgentCore managed harness ----------------------------------------------------

let agentcore;

/**
 * One `InvokeHarness` call, reduced to the event array `assembleStream` consumes.
 *
 * Same lazy-import, same `for await` as `invokeAgent` above, for the same two reasons: the SDK
 * package exists only inside the Lambda runtime, and a cold start that never reaches this path
 * should not pay to load it.
 *
 * UNVERIFIED, and deliberately all in this one function so that one edit settles it on deploy
 * evening (backend/agentcore/README.md §2 lists these as inferred, with the page that decides
 * each). There are **no credentials on the machine this was written on**, so none of it could be
 * checked against the live service:
 *
 *   - the SDK client/command names `BedrockAgentCoreClient` / `InvokeHarnessCommand` and the
 *     package `@aws-sdk/client-bedrock-agentcore`;
 *   - the request field names `harnessArn`, `runtimeSessionId`, `messages`, `tools` — taken from
 *     the boto3 examples on `harness-tools.html`, whose snake_case params imply these wire names;
 *   - the response field holding the event stream (`stream`).
 *
 * How to settle it: `API_InvokeHarness.html` for the field names, `npm view
 * @aws-sdk/client-bedrock-agentcore` (or the runtime's own bundled SDK) for the client name, and
 * one live invoke for the stream field. A wrong name here throws on the first invoke, which
 * `handleChat` reports as 502 `agent_unavailable` — loud, and the right direction to be wrong in.
 */
async function invokeHarness({ harnessArn, runtimeSessionId, body }) {
  const { BedrockAgentCoreClient, InvokeHarnessCommand } =
    await import('@aws-sdk/client-bedrock-agentcore');
  agentcore ??= new BedrockAgentCoreClient({});

  const response = await agentcore.send(new InvokeHarnessCommand({
    // The address is set LAST, after the spread, so nothing in `body` can shadow it. `harnessArn` is which
    // harness runs and `runtimeSessionId` is the per-user isolation key; a key arriving from the
    // turn and winning over either of them is the shape this file should make unreachable rather
    // than merely currently-absent. Neither key is in `body` today.
    ...body,
    harnessArn,
    runtimeSessionId,
  }));

  // Collected rather than streamed on: `assembleStream` is pure over an array, which is what lets
  // the whole handoff loop be tested with plain objects and no AWS.
  const events = [];
  for await (const event of response.stream ?? []) events.push(event);
  return events;
}

/**
 * `runtimeSessionId` has a 33-character minimum.
 *
 * `${sub}-${today}` is ~47 with a real Cognito sub (a 36-character UUID), so the deployed path is
 * comfortably over — but `handler` builds that id with a `claims?.sub ?? 'anon'` fallback, and
 * `anon-2026-11-20` is 15. That fallback is unreachable today: `handleChat` returns 401 before it
 * invokes anything when there is no `sub`, so a request with no identity never gets this far. It is
 * checked anyway, and it throws rather than padding, because padding is the version that keeps
 * working: a padded id is a *valid* session id for a session nobody can account for, and two
 * anonymous callers padded the same way would share one harness session.
 *
 * UNVERIFIED that 33 is the harness's own floor — it is the documented AgentCore Runtime
 * `runtimeSessionId` constraint, and `API_InvokeHarness.html` is where it is settled. Being wrong
 * high costs nothing here; being wrong low would be a ValidationException on the first invoke.
 */
const MIN_RUNTIME_SESSION_ID = 33;
function runtimeSessionIdOf(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length < MIN_RUNTIME_SESSION_ID) {
    throw new Error(`runtimeSessionId must be at least ${MIN_RUNTIME_SESSION_ID} characters`);
  }
  return sessionId;
}

/**
 * The two harness variables must name the SAME harness, checked here rather than rested on.
 *
 * `HARNESS_ID` scopes the IAM grant (template.yaml `InvokeTheOneHarness`); `HARNESS_ARN` is what
 * the invoke is addressed to. The template says a disagreement "is refused by IAM rather than
 * invoked" — true only while `HarnessId` is a literal id, which is now a parameter pattern there
 * and a string check here, because a wildcard grant refuses nothing and the ARN is the half an
 * operator pastes by hand.
 *
 * Also the shape that otherwise 502s every single message: `HarnessId` set with `HarnessArn` still
 * at its empty default selects the harness path and then addresses nothing, which reaches the
 * client as `agent_unavailable` — indistinguishable from a Bedrock outage, when it is a one-line
 * deployment mistake. Checked per request rather than at init: the agent path's cold-start brick
 * of 2026-11-19 is the reason this file reads each path's config only on the path that uses it.
 *
 * ponytail: the tail is checked, not the account or the region, so an ARN for the right harness id
 * in the wrong account still passes here. That one IAM does refuse — the grant is built from
 * `${AWS::AccountId}`/`${AWS::Region}` — and checking it here would mean carrying the account
 * number in an env var, which docs/COST-MODEL.md's public-repo rule keeps out of this stack.
 */
function harnessArnFor(harnessId, harnessArn) {
  const arn = typeof harnessArn === 'string' ? harnessArn.trim() : '';
  if (!arn || !arn.endsWith(`:harness/${harnessId}`)) {
    throw new Error('HARNESS_ARN must address the harness HARNESS_ID names');
  }
  return arn;
}

/**
 * Track A behind option A's signature, so `handleChat` still cannot tell which one it got.
 *
 * The injected `invokeTool` is **the same function option B uses, unchanged**, and that is the
 * point of the whole lane: `backend/lib/auth.mjs` and the three action Lambdas are at zero lines
 * changed, so the files 36 red-team cases were proved against are the files that run.
 *
 * The per-invocation overrides are built once per request from the VERIFIED role, not once per
 * round: they are the same every round, and building them here means a bad role or an unconfigured
 * guardrail fails before the first model call rather than after it. `invocationOverrides` throws
 * when `guardrailId` is empty, which is correct on this path — layer 2 is attached to the harness's
 * model block, so a harness deployment with no guardrail has no layer 2 and must not serve.
 */
function invokeViaHarness({ sessionId, inputText, sessionAttributes }) {
  const harnessArn = harnessArnFor(HARNESS_ID, HARNESS_ARN);
  const runtimeSessionId = runtimeSessionIdOf(sessionId);
  const overrides = invocationOverrides({
    role: sessionAttributes?.role,
    modelId: MODEL_ID,
    guardrailId: GUARDRAIL_ID,
    guardrailVersion: GUARDRAIL_VERSION,
  });

  return runHarnessTurn({
    inputText,
    sessionAttributes,
    maxTurns: MAX_TURNS,
    deps: {
      // `turn` is `{ messages, tools }`; `overrides` is spread LAST so an operator-set key always
      // beats a key that came from the turn. `turn.tools` is the same `inlineToolsFor(role)` value
      // `overrides.tools` is, from the same verified role, so the resume contract ("include the
      // inline tool again so the pending tool remains available") is satisfied either way — which
      // is what makes this ordering free. What it buys: `systemPrompt`, the model-and-guardrail
      // block, `tools` and the iteration caps cannot be shadowed by anything the loop carries,
      // whatever a later edit adds to `turn`.
      invokeHarness: (turn) => invokeHarness({
        harnessArn, runtimeSessionId, body: { ...turn, ...overrides },
      }),
      invokeTool,
    },
  });
}

/** The three orchestrators, by the name `orchestratorFor` returns. */
const ORCHESTRATORS = {
  harness: invokeViaHarness,
  agent: invokeAgent,
  loop: invokeViaLoop,
};

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
      invokeAgent: ORCHESTRATORS[ORCHESTRATOR],
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

// `orchestrator` is the choice this module made under the environment it was loaded with. Exported
// because testing `orchestratorFor` alone proves nothing about the deployment: the cap defect of
// 2026-11-19 was exactly a validated function left exported, tested and unused at its call site.
export const __test__ = {
  todayInColombo, maxTurnsFromEnv, orchestrator: ORCHESTRATOR, runtimeSessionIdOf, harnessArnFor,
  // The map itself, so the chain name -> map -> implementation can be checked by behaviour instead
  // of by source text. Both existing pins on that chain are `assert.match` on this file's own
  // source, and this repo has been caught four times by a guard that read a declaration rather than
  // the thing it protected. A source pin would not notice `{ harness: invokeViaLoop }`.
  orchestrators: ORCHESTRATORS,
};
