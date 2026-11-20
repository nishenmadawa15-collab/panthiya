// What Panthiya sends to the AgentCore harness — the single source of truth for it.
//
// Track A of docs/AGENTCORE-PLAN.md: AWS runs the orchestration loop and we declare the agent as
// configuration. That makes this file the most dangerous one in the lane, because **every costly
// or unsafe setting on a harness arrives by OMITTING a field, not by setting one wrong.** The
// `CreateHarness` API reference lists only two required parameters — `harnessName` and
// `executionRoleArn`. `model`, `allowedTools`, `memory`, `truncation` and `environment` are all
// "Required: No", and each one's default is something this project cannot ship:
//
//   model omitted        → Claude Opus 5 (`global.anthropic.claude-opus-5`). ~$41 for 2,200 turns
//                          against a US$15 budget: 2.7x the entire project.
//   allowedTools omitted → the "current recommended built-in tool set", which includes `shell` and
//                          `write`/`edit`. A child-safety submission must not ship a shell.
//   memory omitted       → "the service provisions managed memory": children's conversations in
//                          AWS-managed long-term store. A retention decision, not a cost line.
//   truncation omitted   → `summarization`, which makes an EXTRA model call with our model.
//   environment omitted  → 900 s idle / 8 h max session, both billing memory the whole time.
//   systemPrompt omitted → AgentCore's own coding-agent prompt ("You are an agent. Keep working
//                          until the task is fully resolved..."), which is not this product.
//
// So nothing here is defaulted and nothing is optional. Every builder below **throws** on a missing
// argument rather than filling one in, and `tests/unit/agentcore-config.test.mjs` is an inverted
// guard in the style of `tests/unit/cost-guards.test.mjs`: it allow-lists the keys, so a setting
// nobody thought of in advance is a failure rather than a pass.
//
// VERIFIED vs UNVERIFIED property names are marked per field in backend/agentcore/README.md. Do not
// re-mark anything here as verified without a docs URL.

import { toolsFor, instructionFor } from '../functions/chat/toolspecs.mjs';
import { MAX_TOOL_TURNS } from '../functions/chat/orchestrate.mjs';

/** The three roles, in the order the artefacts list them. Reused rather than retyped. */
export const ROLES = ['teacher', 'parent', 'student'];

/**
 * `CreateHarness` pattern: `[a-zA-Z][a-zA-Z0-9_]{0,39}`. Underscores, not hyphens — every other
 * name in this project is hyphenated, so this is the one that will be mistyped.
 */
export const HARNESS_NAME = 'panthiya_harness';
export const HARNESS_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

/**
 * The models this project is costed on. An ALLOW-list, for the reason `COSTS_NOTHING_IDLE` in
 * cost-guards.test.mjs is one: being unrecognised has to be the failure. Adding a model here means
 * re-costing `docs/COST-MODEL.md` first and editing this line second, in that order.
 *
 * Nova Lite is $0.06/M in, $0.24/M out. The service default is an Opus-class model at roughly
 * twenty times that, which is the single largest budget risk in the project.
 */
export const ALLOWED_MODELS = new Set([
  'amazon.nova-lite-v1:0',
  'amazon.nova-micro-v1:0',
  'apac.amazon.nova-lite-v1:0',      // the cross-region inference profile for ap-south-1
  'apac.amazon.nova-micro-v1:0',
]);

/**
 * Session lifetime. `idleRuntimeSessionTimeout` and `maxLifetime` each accept 60–28800 seconds and
 * default to 900 and 28800; memory bills for every second a session is alive.
 *
 * 60 is the documented floor and we take it, because `runToolLoop`'s successor is single-message by
 * design — there is no conversation history being kept warm, so a cold start is the only thing a
 * longer window buys. The tradeoff runs the other way and is risk 3 of the plan: if the first live
 * run shows cold starts eating the chat Lambda's 29 seconds, raise THIS number and re-cost, rather
 * than reaching for `resourceConfigurations`.
 */
export const IDLE_TIMEOUT_SECONDS = 60;
export const MAX_LIFETIME_SECONDS = 900;

/**
 * The loop bounds, tied to the number this project already reasoned about.
 *
 * `maxIterations` defaults to **75** reasoning cycles per invocation. Seventy-five on a single
 * teacher message is a runaway, not a feature, so it is pinned to the same budget `runToolLoop`
 * uses: `MAX_TOOL_TURNS` rounds of tools plus one round to turn the results into a sentence.
 *
 * `maxTokens` is NOT the same number as `inferenceConfig.maxTokens` in chat/index.mjs, and the
 * difference matters: the API reference says it is "the maximum total number of output tokens the
 * agent can generate **across all model calls within a single invocation**", where ours is per
 * call. So it is the per-call cap times the number of calls, or a long tool conversation would be
 * truncated mid-way through for reasons nobody could see.
 *
 * `timeoutSeconds` defaults to 3600. The chat Lambda has 29 seconds because API Gateway caps at 30,
 * so an hour-long harness invocation can only ever be billed, never returned.
 */
export const MAX_ITERATIONS = MAX_TOOL_TURNS + 1;
export const PER_CALL_MAX_TOKENS = 1024;
export const MAX_TOKENS = PER_CALL_MAX_TOKENS * (MAX_TOOL_TURNS + 1);
export const TIMEOUT_SECONDS = 25;

/**
 * Tool selectors that must never appear in `allowedTools`, named so the guard's failure message can
 * say what each one would have granted.
 *
 * `*` and `@builtin` are the two that grant everything at once. The rest are the built-in set's own
 * selectors: AWS documents `shell` as "Runs shell commands in the harness filesystem" and
 * `read`/`write`/`edit` as reading, replacing and editing files. `subagent` spawns a child agent
 * that inherits the parent's tools, which would route around the per-role tool list below.
 */
export const FORBIDDEN_TOOL_SELECTORS = new Map([
  ['*', 'every configured tool plus the whole built-in set, including a shell'],
  ['@builtin', 'the whole built-in set, including a shell'],
  ['shell', 'shell commands in the harness filesystem'],
  ['read', 'reading files in the harness filesystem'],
  ['write', 'creating or replacing files in the harness filesystem'],
  ['edit', 'editing files in the harness filesystem'],
  ['file_operations', 'read, write and edit together'],
  ['subagent', 'a child agent that inherits these tools, routing around the per-role tool list'],
  ['web_fetch', 'fetching arbitrary URLs into the agent context'],
  ['todo_write', 'nothing this product needs, and more tokens in every request'],
  ['retrieve_context', 'nothing this product needs — our turns are single-message'],
]);

const required = (value, name) => {
  if (value === undefined || value === null || value === '') {
    throw new Error(`harness config: ${name} must be given explicitly — there is no safe default`);
  }
  return value;
};

/** The model id, checked against the allow-list rather than merely for presence. */
export function assertModelId(modelId) {
  required(modelId, 'modelId');
  if (!ALLOWED_MODELS.has(modelId)) {
    throw new Error(
      `harness config: ${modelId} is not a model docs/COST-MODEL.md is costed on. `
      + `The service default if this is omitted is an Opus-class model at ~$41 for 2,200 turns `
      + `against a US$15 budget. Re-cost first, then add it to ALLOWED_MODELS.`,
    );
  }
  return modelId;
}

// --- the mapper: toolsFor(role) → the harness's inline-function shape --------------------------

/**
 * One role's tools as harness inline functions.
 *
 * An inline function is the harness feature that keeps design §3.1 intact: "Tool schemas that
 * execute on the client side, not on the harness VM. The harness pauses when the tool is called and
 * returns the call to your code, which decides what to do and sends a result back." So the model
 * never reaches a Lambda — our own code does, holding the verified JWT claims, exactly as
 * `invokeTool` in chat/index.mjs already does.
 *
 * Derived from `toolsFor(role)`, which derives from `backend/agent/schemas/*.json`. That is the
 * same chain the Converse path uses, so there is still one source of truth per tool and a schema
 * change reaches the harness and the loop together. `inputSchema` is the SAME JSON Schema object
 * `toolConfig.tools[].toolSpec.inputSchema.json` carries — the harness wants it unwrapped, which is
 * the only difference between the two shapes.
 *
 * This is also the per-session role gate. `allowedTools` on the harness is a filter over the tools
 * CONFIGURED for an invocation, so a tool absent from this list does not exist to be selected: a
 * student session is never told that `recordFee` is a word.
 */
export function inlineToolsFor(role) {
  return toolsFor(role).map(({ toolSpec }) => ({
    type: 'inline_function',
    name: toolSpec.name,
    config: {
      inlineFunction: {
        description: toolSpec.description,
        inputSchema: toolSpec.inputSchema.json,
      },
    },
  }));
}

/** This role's tool names. */
export const toolNamesOf = (role) => inlineToolsFor(role).map((t) => t.name);

/**
 * Every tool name across all three roles, sorted.
 *
 * `allowedTools` is set on the harness and the harness is one resource, so this list is the union —
 * and that is safe for the reason in `inlineToolsFor`: per-invocation `tools` decides what exists,
 * `allowedTools` only decides what may be selected from it. The union is what lets ONE harness
 * serve three roles without ever offering a role another role's tool.
 */
export const ALL_TOOL_NAMES = [...new Set(ROLES.flatMap(toolNamesOf))].sort();

// --- the CreateHarness body ---------------------------------------------------------------------

/**
 * The `model` block, with the guardrail attached.
 *
 * Layer 2 lives here, and this is the sentence it rests on: "To apply a guardrail to each model
 * request, add a `guardrailConfig` object to `bedrockModelConfig.additionalParams`. The harness
 * passes this object to Amazon Bedrock with each model request." So the guardrail is attached to
 * the model call rather than called by us on the way in and out — which is what
 * `docs/NEXT-SESSION.md` §0a feared would be lost, and is not.
 *
 * `apiFormat` is pinned to `converse_stream` rather than left to default, because guardrails are
 * documented as working on that format and the other two (`responses`, `chat_completions`) route to
 * the `bedrock-mantle` endpoint, which AWS states does not support Guardrails at all.
 */
export function modelBlock({ modelId, guardrailId, guardrailVersion }) {
  assertModelId(modelId);
  required(guardrailId, 'guardrailId');
  required(guardrailVersion, 'guardrailVersion');

  return {
    bedrockModelConfig: {
      modelId,
      apiFormat: 'converse_stream',
      additionalParams: {
        guardrailConfig: { guardrailIdentifier: guardrailId, guardrailVersion },
      },
    },
  };
}

/**
 * The full `CreateHarness` request body.
 *
 * Every optional-but-dangerous parameter is present and explicit. The reviewable rendering of this
 * is `backend/agentcore/create-harness.json`, which a test asserts equals this function's output,
 * so the file a human reads before spending money cannot drift from the config the code builds.
 */
export function createHarnessBody({ executionRoleArn, modelId, guardrailId, guardrailVersion }) {
  required(executionRoleArn, 'executionRoleArn');

  return {
    harnessName: HARNESS_NAME,
    executionRoleArn,

    // Set, never defaulted: the default is Claude Opus 5.
    model: modelBlock({ modelId, guardrailId, guardrailVersion }),

    // A floor, not the real prompt. Every invocation overrides this with `instructionFor(role)`;
    // what it must never be is ABSENT, because the default is AgentCore's coding-agent prompt.
    systemPrompt: [{ text: 'Panthiya. Follow only the per-invocation system prompt.' }],

    // The union of the three roles' tools. Never `*`, never `@builtin`.
    allowedTools: ALL_TOOL_NAMES,

    // "To avoid persistent Memory charges, disable Memory when you create the harness." And the
    // stronger reason: this product's users are children, and persisting their conversations in a
    // managed long-term store is a retention decision nobody has taken.
    memory: { disabled: {} },

    // Our turns are single-message, so there is no history to truncate — and the default
    // (`summarization`) would spend an extra model call per invocation discovering that.
    truncation: { strategy: 'none' },

    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    timeoutSeconds: TIMEOUT_SECONDS,

    environment: {
      agentCoreRuntimeEnvironment: {
        // 60 s, against a 900 s default. Memory bills while a session is alive.
        lifecycleConfiguration: {
          idleRuntimeSessionTimeout: IDLE_TIMEOUT_SECONDS,
          maxLifetime: MAX_LIFETIME_SECONDS,
        },
        // No VPC, therefore no NAT gateway — the $77–95 line in docs/COST-MODEL.md §4 item 1.
        networkConfiguration: { networkMode: 'PUBLIC' },
      },
    },
  };
}

/**
 * The per-invocation overrides, built from the VERIFIED role.
 *
 * "reusable configuration on the harness, overrides at invocation time" — so the role-dependent
 * half of the agent is decided here, per request, from `sessionAttributes.role`, which came from
 * the JWT claims the API Gateway authorizer verified. The model never chooses it and a forged
 * `role` in a request body was discarded long before this function is reached.
 */
export function invocationOverrides({ role, modelId, guardrailId, guardrailVersion }) {
  if (!ROLES.includes(role)) throw new Error(`harness config: no harness configuration for role ${role}`);

  return {
    model: modelBlock({ modelId, guardrailId, guardrailVersion }),
    systemPrompt: [{ text: instructionFor(role) }],
    tools: inlineToolsFor(role),
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
  };
}
