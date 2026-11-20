// The harness configuration, guarded against its own defaults.
//
// Track A hands AWS the orchestration loop and declares the agent as configuration. That moves the
// whole risk surface from "a line of code is wrong" to "a field is missing", because the
// `CreateHarness` API reference marks only `harnessName` and `executionRoleArn` as required and
// every dangerous setting defaults to something this project cannot ship:
//
//   model omitted        → Claude Opus 5 → ~$41 for 2,200 turns against a US$15 budget
//   allowedTools omitted → the built-in set → a SHELL and filesystem write inside the agent
//   memory omitted       → managed memory → children's conversations in a long-term store
//   truncation omitted   → summarization → an extra model call per invocation
//   environment omitted  → 900 s idle / 8 h max session, billing memory throughout
//   systemPrompt omitted → AgentCore's coding-agent prompt, which is not this product
//
// -----------------------------------------------------------------------------------------------
// WRITTEN IN THE STYLE OF tests/unit/cost-guards.test.mjs, deliberately and not in a third style of
// its own. The two principles taken from that file's 2026-11-20 rebuild:
//
//   1. **An allow-list, not a block-list.** `COSTS_NOTHING_IDLE` made "being unrecognised" the
//      failure, which is how a resource type nobody thought of in advance gets caught. Here the
//      equivalent is `EXPECTED_PATHS`: the exact set of key paths the config may contain. A lane
//      adding `resourceConfigurations` (up to ~$2.44 per session), `skills` (pulls files from Git
//      into the agent's context) or `hooks` does not need to be anticipated to be caught.
//
//   2. **Absence-of-capability checks, not existence checks.** "`model` is configured" is satisfied
//      by `model: {}`, which is the omitted-field shape one level down and gets the Opus default.
//      So every check below asserts the capability, and the last test proves it: it mutates the
//      config in seven ways and asserts that the naive existence checks stayed GREEN on the ones
//      they cannot see while these go red.
//
// Unlike cost-guards.test.mjs there is no YAML to parse, so there is no parser to be defeated — the
// config is a JavaScript object and the builders throw rather than default. What replaces the
// "unreadable shape is a failure" sentinel is `EXPECTED_PATHS` equality in both directions: an
// added key fails, and so does a removed one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createHarnessBody, invocationOverrides, inlineToolsFor, toolNamesOf, assertModelId,
  ALL_TOOL_NAMES, ALLOWED_MODELS, FORBIDDEN_TOOL_SELECTORS, ROLES,
  HARNESS_NAME, HARNESS_NAME_PATTERN, IDLE_TIMEOUT_SECONDS, MAX_LIFETIME_SECONDS,
  MAX_ITERATIONS, MAX_TOKENS, TIMEOUT_SECONDS,
} from '../../backend/agentcore/harness-config.mjs';
import { toolsFor, instructionFor } from '../../backend/functions/chat/toolspecs.mjs';
import { MAX_TOOL_TURNS } from '../../backend/functions/chat/orchestrate.mjs';

/** The arguments a real deploy supplies. Every one of them is mandatory; see the throw tests. */
const ARGS = {
  executionRoleArn: 'arn:aws:iam::123456789012:role/panthiya-harness-exec',
  modelId: 'apac.amazon.nova-lite-v1:0',
  guardrailId: 'abc123def456',
  guardrailVersion: '1',
};

const CONFIG = createHarnessBody(ARGS);

// --- the reader ---------------------------------------------------------------------------------

/**
 * Every key path in an object, arrays collapsed to `[]`, sorted.
 *
 * This is the allow-list's reader, and it is total: there is no shape it silently skips, so a key
 * added at any depth appears here and fails the comparison below.
 */
export function keyPaths(value, prefix = '') {
  if (Array.isArray(value)) {
    // Collapse: `allowedTools` has eight entries and `tools` has five, and the guard is about the
    // SHAPE. The contents are checked by the capability tests, which is where they belong.
    return [`${prefix}[]`];
  }
  if (value === null || typeof value !== 'object') return [prefix];
  const keys = Object.keys(value);
  // An EMPTY object gets a path of its own, suffixed. The first version of this reader returned
  // `[]` here, which silently swallowed `memory: { disabled: {} }` — the single most important
  // value in the config — and would equally have swallowed `model: {}`, the omitted-field shape
  // this whole file exists to catch. A reader with a blind spot is the defect cost-guards.test.mjs
  // was rebuilt to remove, so: a shape this function cannot describe must not be a shape it drops.
  if (keys.length === 0) return [`${prefix}{}`];
  return keys
    .flatMap((key) => keyPaths(value[key], prefix ? `${prefix}.${key}` : key))
    .sort();
}

/**
 * Every key path the `CreateHarness` body may contain — the whole of it, in both directions.
 *
 * Adding a path here means reading its AWS documentation and re-costing `docs/COST-MODEL.md` if it
 * bills, in that order. Three paths that are deliberately NOT here, each a real way to lose the
 * budget or the safety story:
 *
 *   environment.agentCoreRuntimeEnvironment.resourceConfigurations
 *       a committed baseline billed for the WHOLE session — `minimumMemoryInMiB: 8192` is 8 GB and
 *       2 vCPU held for up to 8 hours, ~$2.44 a session, so ten forgotten sessions exceed US$15.
 *   skills
 *       "bundles of files that the agent can pull into its context on demand", from Git or S3.
 *   hooks / environmentVariables / environmentArtifact / authorizerConfiguration
 *       each one changes what the agent can reach or who can invoke it. `authorizerConfiguration`
 *       is the sharpest: OAuth inbound auth pointed at our Cognito pool would let a browser invoke
 *       the harness directly with its own token, skipping the wellbeing check and policyCheck in
 *       `handleChat` entirely. Inbound auth stays SigV4, which is the default and is why the key
 *       is absent rather than set.
 */
const EXPECTED_PATHS = [
  'allowedTools[]',
  'environment.agentCoreRuntimeEnvironment.lifecycleConfiguration.idleRuntimeSessionTimeout',
  'environment.agentCoreRuntimeEnvironment.lifecycleConfiguration.maxLifetime',
  'environment.agentCoreRuntimeEnvironment.networkConfiguration.networkMode',
  'executionRoleArn',
  'harnessName',
  'maxIterations',
  'maxTokens',
  'memory.disabled{}',   // `{}` = the empty object; see the note in `keyPaths`
  'model.bedrockModelConfig.additionalParams.guardrailConfig.guardrailIdentifier',
  'model.bedrockModelConfig.additionalParams.guardrailConfig.guardrailVersion',
  'model.bedrockModelConfig.apiFormat',
  'model.bedrockModelConfig.modelId',
  'systemPrompt[]',
  'timeoutSeconds',
  // `tools` is deliberately NOT here. It is supplied per invocation from the verified role, which
  // is what keeps a student session from being told `recordFee` exists; baking all eight onto the
  // harness would hand every role every tool.
  'truncation.strategy',
].sort();

// ---------------------------------------------------------------------------
// 0. The allow-list itself. One assertion, both directions, every depth.
// ---------------------------------------------------------------------------

test('the CreateHarness body contains exactly the keys this project has costed and read', () => {
  assert.deepEqual(keyPaths(CONFIG), EXPECTED_PATHS,
    'a key added here must be documented and re-costed first; a key removed here is a default '
    + 'arriving silently. Both are failures.');
});

test('the reader sees every depth, so the allow-list above cannot be vacuous', () => {
  // The sentinel cost-guards.test.mjs calls "a parser which found nothing cannot sail through".
  assert.ok(EXPECTED_PATHS.length >= 16, `only ${EXPECTED_PATHS.length} paths — this is the wrong object`);
  assert.ok(keyPaths({ a: { b: { c: 1 } } }).includes('a.b.c'), 'the reader does not recurse');
  assert.deepEqual(keyPaths({ a: [1, 2] }), ['a[]'], 'the reader does not collapse arrays');
  // The blind spot that was actually there, pinned so it cannot come back: an empty object is the
  // omitted-field shape (`model: {}`) and the disabled-memory shape, and dropping it would make
  // the allow-list blind to both at once.
  assert.deepEqual(keyPaths({ a: {} }), ['a{}'], 'the reader drops empty objects');
  assert.deepEqual(keyPaths({ a: { b: {} } }), ['a.b{}'], 'the reader drops nested empty objects');
  assert.notDeepEqual(keyPaths({ a: {} }), keyPaths({ a: { b: 1 } }),
    'an empty object and a populated one must not read alike');
});

// ---------------------------------------------------------------------------
// 1. The model. The $41 guard.
// ---------------------------------------------------------------------------

test('the model is named, and named as one docs/COST-MODEL.md is costed on', () => {
  const model = CONFIG.model?.bedrockModelConfig;
  assert.ok(model, 'model.bedrockModelConfig must be present — omitting it gets the Opus default');
  assert.ok(ALLOWED_MODELS.has(model.modelId), `${model.modelId} is not a costed model`);
  assert.match(model.modelId, /nova/, 'the costed models are Nova; anything else re-costs the project');
});

test('an omitted or unlisted model throws rather than defaulting', () => {
  // The omitted-field shape at every level, which is the shape an existence check cannot see.
  for (const bad of [undefined, null, '', {}]) {
    assert.throws(() => assertModelId(bad), /must be given explicitly|is not a model/,
      `assertModelId(${JSON.stringify(bad)}) must refuse`);
  }
  // The specific default AWS would apply, and the two OpenAI ids that cannot take a guardrail.
  for (const bad of ['global.anthropic.claude-opus-5', 'openai.gpt-5.4', 'openai.gpt-5.5',
    'global.anthropic.claude-sonnet-5-5']) {
    assert.throws(() => assertModelId(bad), /is not a model/, bad);
  }
  for (const good of ALLOWED_MODELS) assert.equal(assertModelId(good), good);

  // THE CALL SITES, not the declaration — the distinction this repo has now had to learn four
  // times. Every assertion above holds while `modelBlock` has stopped calling `assertModelId` at
  // all: put `modelId = modelId ?? 'apac.amazon.nova-lite-v1:0'` in its place and this file stayed
  // green, `create-harness.json` stayed byte-identical, and `createHarnessBody({ ...ARGS, modelId:
  // 'global.anthropic.claude-opus-5' })` built an Opus-class harness — ~$41 for 2,200 turns
  // against a US$15 budget. A validated function tested, exported and not reached is exactly the
  // 2026-11-19 `maxTurnsFromEnv` defect, so both entry points that reach `modelBlock` are
  // exercised here rather than the validator on its own.
  for (const bad of [undefined, null, '', {}, 'global.anthropic.claude-opus-5', 'openai.gpt-5.4']) {
    const what = JSON.stringify(bad) ?? 'undefined';
    assert.throws(() => createHarnessBody({ ...ARGS, modelId: bad }),
      /must be given explicitly|is not a model/, `createHarnessBody accepted modelId ${what}`);
    assert.throws(() => invocationOverrides({ role: 'teacher', ...ARGS, modelId: bad }),
      /must be given explicitly|is not a model/, `invocationOverrides accepted modelId ${what}`);
  }
});

test('the guardrail travels with the model request, not as a separate call', () => {
  // Layer 2 stays ATTACHED. docs/NEXT-SESSION.md §0a feared this would degrade to an explicit
  // ApplyGuardrail on the way in and out; `additionalParams.guardrailConfig` is why it does not.
  const cfg = CONFIG.model.bedrockModelConfig;
  assert.deepEqual(cfg.additionalParams.guardrailConfig, {
    guardrailIdentifier: ARGS.guardrailId,
    guardrailVersion: ARGS.guardrailVersion,
  });
  // Guardrails are documented on `converse_stream`; the other two formats route to the
  // `bedrock-mantle` endpoint, which AWS states does not support Guardrails at all.
  assert.equal(cfg.apiFormat, 'converse_stream',
    'a guardrail on the responses/chat_completions formats reaches an endpoint that has none');
});

test('a missing guardrail throws — layer 2 is not optional', () => {
  assert.throws(() => createHarnessBody({ ...ARGS, guardrailId: undefined }), /guardrailId/);
  assert.throws(() => createHarnessBody({ ...ARGS, guardrailVersion: undefined }), /guardrailVersion/);
  assert.throws(() => createHarnessBody({ ...ARGS, executionRoleArn: undefined }), /executionRoleArn/);
});

// ---------------------------------------------------------------------------
// 2. allowedTools. The shell guard.
// ---------------------------------------------------------------------------

test('allowedTools names our own tools and nothing else', () => {
  // Set equality against the names derived from backend/agent/schemas, so a tool added to a schema
  // reaches this list and a selector that is not a Panthiya tool cannot hide among them.
  assert.deepEqual([...CONFIG.allowedTools].sort(), ALL_TOOL_NAMES);
  assert.ok(CONFIG.allowedTools.length >= 8, `only ${CONFIG.allowedTools.length} tools — schemas missing?`);
});

test('no allowedTools entry can reach a shell, the filesystem, or every tool at once', () => {
  const granted = CONFIG.allowedTools.flatMap((entry) => {
    const why = FORBIDDEN_TOOL_SELECTORS.get(entry);
    if (why) return [`${entry} grants ${why}`];
    // The glob syntaxes, each of which can match a built-in without naming one.
    if (entry.includes('*')) return [`${entry} is a glob and can match a built-in`];
    if (entry.startsWith('@')) return [`${entry} selects from a server or the built-in set`];
    if (entry.includes('/')) return [`${entry} is a server-qualified selector, not one of our tools`];
    return [];
  });
  assert.deepEqual(granted, [],
    `a child-safety submission must not ship a shell:\n  ${granted.join('\n  ')}`);
});

test('every forbidden selector would be caught if it appeared', () => {
  // The guard above is only worth as much as its list, so the list is exercised rather than trusted.
  const check = (entries) => entries.flatMap((entry) => (
    FORBIDDEN_TOOL_SELECTORS.has(entry) || entry.includes('*') || entry.startsWith('@') || entry.includes('/')
      ? [entry] : []));
  for (const selector of FORBIDDEN_TOOL_SELECTORS.keys()) {
    assert.deepEqual(check([selector]), [selector], `${selector} is not caught`);
  }
  // And the documented glob forms from the harness tool-selector table.
  for (const glob of ['file_*', '@builtin/shell', '@git/git_status', '@*-mcp/status']) {
    assert.deepEqual(check([glob]), [glob], `${glob} is not caught`);
  }
});

// ---------------------------------------------------------------------------
// 3. Memory. The children's-data guard.
// ---------------------------------------------------------------------------

test('memory is explicitly disabled, not merely unconfigured', () => {
  // "When you create a harness directly with the service API and omit the memory configuration,
  // the service provisions managed memory." This product's users are children and its turns are
  // single-message by design, so there is nothing to persist and a retention decision nobody has
  // taken is the worst way to acquire one.
  assert.deepEqual(CONFIG.memory, { disabled: {} },
    'memory must be the disabled union member; omitting the key provisions managed memory');
  assert.ok(!('managedMemoryConfiguration' in CONFIG.memory));
  assert.ok(!('agentCoreMemoryConfiguration' in CONFIG.memory));
});

// ---------------------------------------------------------------------------
// 4. The session and loop bounds. The runaway guards.
// ---------------------------------------------------------------------------

test('sessions are short-lived, because memory bills for every second one is alive', () => {
  const env = CONFIG.environment.agentCoreRuntimeEnvironment;
  const life = env.lifecycleConfiguration;
  assert.equal(life.idleRuntimeSessionTimeout, IDLE_TIMEOUT_SECONDS);
  assert.equal(life.maxLifetime, MAX_LIFETIME_SECONDS);

  // The documented range is 60–28800 and the defaults are 900 and 28800.
  assert.ok(life.idleRuntimeSessionTimeout >= 60, 'below the documented floor; a ValidationException');
  assert.ok(life.idleRuntimeSessionTimeout <= 60,
    'the floor is the whole point: our turns keep no history, so a longer idle window buys only a '
    + 'warm cold start and pays for it in billed memory');
  assert.ok(life.maxLifetime <= 900, `maxLifetime ${life.maxLifetime}s — the default 28800 is 8 billed hours`);
  assert.ok(life.idleRuntimeSessionTimeout <= life.maxLifetime, 'rejected with a ValidationException');
});

test('there is no VPC, therefore no NAT gateway', () => {
  // docs/COST-MODEL.md §4 item 1: a NAT gateway is $77–95 over the judging window, 5–6x the whole
  // budget, before any traffic.
  const env = CONFIG.environment.agentCoreRuntimeEnvironment;
  assert.deepEqual(env.networkConfiguration, { networkMode: 'PUBLIC' });
  assert.ok(!JSON.stringify(CONFIG).includes('VPC'), 'a VPC needs a NAT gateway to reach AWS APIs');
});

test('the loop bounds are tied to MAX_TOOL_TURNS, not to the service defaults', () => {
  // maxIterations defaults to 75 reasoning cycles. On a single teacher message that is a runaway.
  assert.equal(MAX_ITERATIONS, MAX_TOOL_TURNS + 1);
  assert.equal(CONFIG.maxIterations, MAX_ITERATIONS);
  assert.ok(CONFIG.maxIterations <= 10, `maxIterations ${CONFIG.maxIterations} — the default 75 is a runaway`);

  // maxTokens here is per INVOCATION, across all model calls — not per call like
  // inferenceConfig.maxTokens in chat/index.mjs. Smaller than the per-call cap would truncate a
  // legitimate tool conversation; the service default is none at all.
  assert.equal(CONFIG.maxTokens, MAX_TOKENS);
  assert.ok(CONFIG.maxTokens >= 1024 * 2, 'a per-invocation cap below two calls truncates a tool loop');

  // timeoutSeconds defaults to 3600. The chat Lambda has 29 s because API Gateway caps at 30, so an
  // hour-long invocation can only be billed, never returned.
  assert.equal(CONFIG.timeoutSeconds, TIMEOUT_SECONDS);
  assert.ok(CONFIG.timeoutSeconds < 29, `timeoutSeconds ${CONFIG.timeoutSeconds} outlives the caller`);
});

test('the system prompt is present on the harness, so the coding-agent default cannot apply', () => {
  assert.ok(Array.isArray(CONFIG.systemPrompt) && CONFIG.systemPrompt.length >= 1);
  assert.ok(CONFIG.systemPrompt[0].text.trim().length > 0);
  // AgentCore's default prompt begins "You are an agent. Keep working until the task is fully
  // resolved" and describes a coding agent with a shell. It is not this product.
  assert.ok(!/Keep working until the task is fully resolved/.test(JSON.stringify(CONFIG.systemPrompt)));
});

test('truncation is named, so no extra summarisation model call arrives by default', () => {
  // The default strategy is `summarization`, which "generates the summary with the harness model".
  // Our turns are single-message, so there is never history to truncate and the default would only
  // ever cost a model call to discover that.
  assert.equal(CONFIG.truncation.strategy, 'none');
});

test('the harness name matches the API pattern, which is not this project\'s usual spelling', () => {
  // `[a-zA-Z][a-zA-Z0-9_]{0,39}` — underscores, NOT hyphens. Every other name in this project is
  // hyphenated, so this is the one that gets mistyped into a ValidationException on deploy evening.
  assert.match(HARNESS_NAME, HARNESS_NAME_PATTERN);
  assert.equal(CONFIG.harnessName, HARNESS_NAME);
  assert.ok(!HARNESS_NAME.includes('-'), 'a hyphen is rejected by CreateHarness');
});

// ---------------------------------------------------------------------------
// 5. The mapper, and the property it exists for.
// ---------------------------------------------------------------------------

test('a student session is never told that recordFee exists', () => {
  // The whole of design §3.1's third fence, in one assertion. `tools` is per invocation, so the
  // model in a student session is not handed the teacher tool spec at all: there is no name for a
  // jailbreak to guess at. The per-Lambda `requireRole` gate and the per-Lambda IAM still stand
  // behind this — it is a third fence, not a replacement for either.
  const student = toolNamesOf('student');
  const teacher = toolNamesOf('teacher');
  const parent = toolNamesOf('parent');

  assert.ok(teacher.includes('recordFee'), 'the teacher must have it, or this test proves nothing');
  for (const write of teacher) {
    assert.ok(!student.includes(write), `a student session is offered the teacher tool ${write}`);
    assert.ok(!parent.includes(write), `a parent session is offered the teacher tool ${write}`);
  }
  for (const name of parent) assert.ok(!student.includes(name), `a student is offered ${name}`);

  // Disjoint in both directions, and not by accident of ordering.
  assert.deepEqual([...new Set([...teacher, ...parent, ...student])].sort(), ALL_TOOL_NAMES);
  assert.equal(teacher.length + parent.length + student.length, ALL_TOOL_NAMES.length,
    'the three tool sets must be disjoint; an overlap would make one role reachable from another');
});

test('the inline-function tools are derived from the schemas, not retyped', () => {
  // Same source of truth as the Converse path, so a schema change reaches both or neither. A
  // second hand-typed copy of a tool description is how a safety rule stops being in front of the
  // model (the argument in the header of backend/functions/chat/toolspecs.mjs).
  for (const role of ROLES) {
    const specs = toolsFor(role);
    const inline = inlineToolsFor(role);
    assert.equal(inline.length, specs.length, role);

    for (const [i, entry] of inline.entries()) {
      const { toolSpec } = specs[i];
      assert.deepEqual(keyPaths(entry).filter((p) => !p.startsWith('config.inlineFunction.inputSchema')),
        ['config.inlineFunction.description', 'name', 'type'], `${role}.${entry.name} has an extra key`);
      assert.equal(entry.type, 'inline_function');
      assert.equal(entry.name, toolSpec.name);
      assert.equal(entry.config.inlineFunction.description, toolSpec.description);
      // The SAME object, not a copy that could be edited apart from it.
      assert.equal(entry.config.inlineFunction.inputSchema, toolSpec.inputSchema.json);
      assert.equal(entry.config.inlineFunction.inputSchema.type, 'object');
    }
  }
});

test('the real action-Lambda signatures survive the mapping', () => {
  // Derived from the schemas rather than a sketch: these are the required arguments
  // backend/functions/actions-teacher/validate.mjs is written against.
  const byName = new Map(inlineToolsFor('teacher').map((t) => [t.name, t.config.inlineFunction.inputSchema]));
  assert.deepEqual(byName.get('recordFee').required, ['studentName', 'amount', 'period']);
  assert.deepEqual(byName.get('markAttendance').required, ['names', 'date', 'status']);
  assert.deepEqual(byName.get('addMarks').required, ['studentName', 'assessment', 'score', 'maxScore']);

  const student = new Map(inlineToolsFor('student').map((t) => [t.name, t.config.inlineFunction.inputSchema]));
  assert.deepEqual([...student.keys()].sort(), ['getHint', 'getSimilarExample']);
  assert.deepEqual(student.get('getHint').required, ['questionText', 'subject']);
});

test('the per-invocation overrides carry the verified role\'s prompt and tools, and nothing else', () => {
  for (const role of ROLES) {
    const over = invocationOverrides({ ...ARGS, role });
    assert.deepEqual(Object.keys(over).sort(),
      ['maxIterations', 'maxTokens', 'model', 'systemPrompt', 'tools']);
    assert.equal(over.systemPrompt[0].text, instructionFor(role));
    assert.deepEqual(over.tools.map((t) => t.name), toolNamesOf(role));
    // The guardrail is on the override too: a per-invocation `model` REPLACES the harness's, so
    // sending one without the guardrail would silently drop layer 2 for that call.
    assert.ok(over.model.bedrockModelConfig.additionalParams.guardrailConfig.guardrailIdentifier);
  }
  for (const role of [undefined, null, '', 'admin', 'TEACHER']) {
    assert.throws(() => invocationOverrides({ ...ARGS, role }), /no harness configuration for role/,
      `role ${JSON.stringify(role)} must have no configuration at all, rather than a default one`);
  }
});

// ---------------------------------------------------------------------------
// 6. The artefact a human reads before spending money.
// ---------------------------------------------------------------------------

test('backend/agentcore/create-harness.json is exactly what the code builds', () => {
  // The reviewed file and the guarded config must be the same thing, or the review is of something
  // that is not deployed. This repo has just spent three days on documents outliving what they
  // described; this is the cheapest possible guard against another one.
  const artefact = JSON.parse(readFileSync(
    new URL('../../backend/agentcore/create-harness.json', import.meta.url), 'utf8'));

  const { PLACEHOLDERS, ...body } = artefact;
  assert.ok(PLACEHOLDERS, 'the artefact must say which values are placeholders');
  assert.deepEqual(body, createHarnessBody({
    executionRoleArn: PLACEHOLDERS.executionRoleArn,
    modelId: PLACEHOLDERS.modelId,
    guardrailId: PLACEHOLDERS.guardrailId,
    guardrailVersion: PLACEHOLDERS.guardrailVersion,
  }), 'regenerate it: node -e "..." — see backend/agentcore/README.md');

  // And the placeholders must be obviously placeholders, so none of them is deployed by accident.
  assert.match(PLACEHOLDERS.executionRoleArn, /REPLACE/);
  assert.match(PLACEHOLDERS.guardrailId, /REPLACE/);
});

test('the execution role reaches the model and the guardrail, and nothing of ours', () => {
  // The security property Track A buys and must not give back: our tools are INLINE functions,
  // handed back to our own chat Lambda, so the harness never invokes a Lambda and never touches
  // DynamoDB. If `lambda:InvokeFunction` ever appears on this role, somebody has moved the tools
  // onto a Gateway target — which is the §3.2 path the plan declines, and it takes the
  // `sessionAttributes` identity channel with it.
  const iam = JSON.parse(readFileSync(
    new URL('../../backend/agentcore/execution-role-policy.json', import.meta.url), 'utf8'));

  const statements = iam.HarnessExecutionRole.PermissionsPolicy.Statement;
  const actions = statements.flatMap((s) => [].concat(s.Action));
  assert.deepEqual(actions.filter((a) => /^(lambda|dynamodb|s3|secretsmanager|sts):/.test(a)), [],
    'the harness execution role must not reach our data or our Lambdas');
  assert.ok(actions.includes('bedrock:ApplyGuardrail'), 'layer 2 needs this or every turn fails');
  assert.ok(actions.some((a) => a.startsWith('bedrock:InvokeModel')), 'the harness makes the model call');
  assert.deepEqual(actions.filter((a) => a === '*' || a === 'bedrock:*'), [],
    'no wildcard action on a role AWS assumes');

  // Only tracing may use a `*` resource; everything else is scoped.
  for (const s of statements) {
    const wild = [].concat(s.Resource).filter((r) => r === '*');
    if (wild.length) assert.equal(s.Sid, 'Tracing', `${s.Sid} uses Resource "*"`);
  }

  // The documented tool-restriction bypass, asserted absent from the caller's additions.
  const caller = JSON.stringify(iam.ChatLambdaAdditions.Statement);
  for (const bypass of ['InvokeAgentRuntimeCommand', 'InvokeAgentRuntimeCommandShell']) {
    assert.ok(!caller.includes(bypass),
      `${bypass} executes commands without passing through the LLM, routing around allowedTools`);
  }
  assert.match(caller, /bedrock-agentcore:InvokeHarness/);
  // And the trust policy is confused-deputy-proofed rather than open to the whole service.
  const trust = iam.HarnessExecutionRole.TrustPolicy.Statement[0];
  assert.equal(trust.Principal.Service, 'bedrock-agentcore.amazonaws.com');
  assert.ok(trust.Condition?.StringEquals?.['aws:SourceAccount'], 'no aws:SourceAccount condition');
});

test('the /ping handler can never start sending time_of_last_update', () => {
  // A source-level guard beside the behavioural one in tests/unit/agentcore.test.mjs, because the
  // failure mode is a later edit ADDING the field back as a helpful-looking improvement. AWS:
  // advancing it on every ping "prevents the idle timeout from ever firing. Sessions then live
  // until MaxLifetime" — i.e. it silently converts guard 4 above into an 8-hour billed session.
  const source = readFileSync(new URL('../../backend/agentcore/server.mjs', import.meta.url), 'utf8');
  const code = source.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!code.includes('time_of_last_update'),
    'server.mjs must not send time_of_last_update — see the comment on the /ping branch');
});

// ---------------------------------------------------------------------------
// 7. The proof. Seven mutated configs, each a real way to lose a guard, and
//    on each one the naive existence checks are recorded as passing or not.
//
//    Kept because "the new check is better" is a claim, and this is the only
//    form of it that goes red if someone reverts the inversion.
// ---------------------------------------------------------------------------

/** The naive assertions this file replaces, as predicates: true means the naive guard passed. */
const NAIVE = {
  'model is configured': (c) => Boolean(c.model),
  'allowedTools is set': (c) => Array.isArray(c.allowedTools) && c.allowedTools.length > 0,
  'memory is addressed': (c) => 'memory' in c,
  'the session lifecycle is set': (c) =>
    Boolean(c.environment?.agentCoreRuntimeEnvironment?.lifecycleConfiguration),
};

/** The guards above, as functions of an arbitrary config object. */
const GUARDS = {
  'the key allow-list': (c) => assert.deepEqual(keyPaths(c), EXPECTED_PATHS),
  'the model is costed': (c) => {
    assert.ok(c.model?.bedrockModelConfig, 'no bedrockModelConfig');
    assert.ok(ALLOWED_MODELS.has(c.model.bedrockModelConfig.modelId), 'uncosted model');
  },
  'no tool reaches a shell': (c) => {
    for (const entry of c.allowedTools ?? []) {
      assert.ok(!FORBIDDEN_TOOL_SELECTORS.has(entry), entry);
      assert.ok(!entry.includes('*') && !entry.startsWith('@') && !entry.includes('/'), entry);
    }
    assert.deepEqual([...(c.allowedTools ?? [])].sort(), ALL_TOOL_NAMES);
  },
  'memory is disabled': (c) => assert.deepEqual(c.memory, { disabled: {} }),
  'sessions are short': (c) => {
    const life = c.environment?.agentCoreRuntimeEnvironment?.lifecycleConfiguration;
    assert.ok(life, 'no lifecycleConfiguration');
    assert.ok(life.idleRuntimeSessionTimeout <= 60, 'idle window too long');
    assert.ok(life.maxLifetime <= 900, 'maxLifetime too long');
  },
};

/**
 * The mutants. `naiveCatchesIt` is recorded per mutant rather than assumed for all of them —
 * cost-guards.test.mjs could assert the old assertions missed every one of its three, and being
 * honest about which of these the naive checks would in fact have caught is worth more than
 * forcing them all into the same column.
 */
const MUTANTS = {
  // 1. The omitted-field shape one level down. This is THE shape an existence check cannot see,
  //    and it is realistic: a lane adds `model` and forgets the union member.
  'model present but its union member omitted — gets the Opus default': {
    naiveCatchesIt: false,
    mutate: (c) => ({ ...c, model: {} }),
  },

  // 2. The same, one level deeper.
  'bedrockModelConfig present but modelId omitted': {
    naiveCatchesIt: false,
    mutate: (c) => ({ ...c, model: { bedrockModelConfig: { apiFormat: 'converse_stream' } } }),
  },

  // 3. The documented wildcard. ~$41 of model is one risk; a shell in a child-safety product is
  //    the other, and the naive "allowedTools is set" is perfectly happy with it.
  'allowedTools reduced to the wildcard — grants a shell': {
    naiveCatchesIt: false,
    mutate: (c) => ({ ...c, allowedTools: ['*'] }),
  },

  // 4. A shell added alongside the real tools, so the list still looks like ours.
  'a shell selector appended to the real tool list': {
    naiveCatchesIt: false,
    mutate: (c) => ({ ...c, allowedTools: [...c.allowedTools, 'shell'] }),
  },

  // 5. Memory "configured" — as managed memory, which is the charge and the retention question.
  'memory switched from disabled to managed': {
    naiveCatchesIt: false,
    mutate: (c) => ({ ...c, memory: { managedMemoryConfiguration: { strategies: ['SEMANTIC'] } } }),
  },

  // 6. The 8-hour session. Set explicitly, within the documented range, and invisible to every
  //    existence check — this is the ~$2.44-a-session shape.
  'the session lifecycle widened to the service defaults': {
    naiveCatchesIt: false,
    mutate: (c) => ({
      ...c,
      environment: {
        agentCoreRuntimeEnvironment: {
          ...c.environment.agentCoreRuntimeEnvironment,
          lifecycleConfiguration: { idleRuntimeSessionTimeout: 900, maxLifetime: 28800 },
        },
      },
    }),
  },

  // 7. A committed baseline: 8 GB and 2 vCPU held for the WHOLE session. No existence check knows
  //    the key exists, which is exactly why the guard is an allow-list rather than a block-list.
  'resourceConfigurations added — a baseline billed for the whole session': {
    naiveCatchesIt: false,
    mutate: (c) => ({
      ...c,
      environment: {
        agentCoreRuntimeEnvironment: {
          ...c.environment.agentCoreRuntimeEnvironment,
          resourceConfigurations: [{ minimumMemoryInMiB: 8192 }],
        },
      },
    }),
  },

  // 8. Skills: "bundles of files that the agent can pull into its context on demand", from Git.
  'skills added — arbitrary files pulled into the agent context': {
    naiveCatchesIt: false,
    mutate: (c) => ({ ...c, skills: [{ name: 'aws', source: 'AWS_SKILLS' }] }),
  },

  // 9. OAuth inbound auth. A browser could then invoke the harness directly with its Cognito
  //    token, skipping the wellbeing check and policyCheck in handleChat entirely.
  'OAuth inbound auth added — the chat Lambda becomes bypassable': {
    naiveCatchesIt: false,
    mutate: (c) => ({ ...c, authorizerConfiguration: { customJWTAuthorizer: { discoveryUrl: 'x' } } }),
  },

  // 10. One the naive checks DO catch, recorded so the column means something.
  'memory omitted entirely': {
    naiveCatchesIt: true,
    mutate: ({ memory, ...rest }) => rest,
  },
};

test('the inverted guard catches every shape an existence check would wave through', () => {
  // Sanity: everything passes on the real config, or the mutations below prove nothing at all.
  for (const [name, holds] of Object.entries(NAIVE)) {
    assert.equal(holds(CONFIG), true, `naive "${name}" should pass on the real config`);
  }
  for (const [name, guard] of Object.entries(GUARDS)) {
    assert.doesNotThrow(() => guard(CONFIG), `guard "${name}" should pass on the real config`);
  }

  for (const [what, { mutate, naiveCatchesIt }] of Object.entries(MUTANTS)) {
    const mutant = mutate(CONFIG);
    assert.notDeepEqual(mutant, CONFIG, `${what}: the mutation changed nothing`);

    const naiveRed = Object.entries(NAIVE)
      .filter(([, holds]) => !holds(mutant))
      .map(([name]) => name);

    if (naiveCatchesIt) {
      assert.ok(naiveRed.length > 0, `${what}: recorded as caught by a naive check, but none went red`);
    } else {
      // This is the defect, stated as a test: every naive check stayed green on this shape.
      assert.deepEqual(naiveRed, [],
        `${what}: a naive check now catches it — this record is stale, update naiveCatchesIt`);
    }

    // And at least one real guard goes red on it, whatever the naive ones did.
    const red = Object.entries(GUARDS).filter(([, guard]) => {
      try { guard(mutant); return false; } catch { return true; }
    }).map(([name]) => name);

    assert.ok(red.length > 0, `${what}: no guard caught it — the inversion is not done`);
  }
});
