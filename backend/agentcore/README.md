# `backend/agentcore/` — Track A, the AgentCore harness

Read `docs/AGENTCORE-PLAN.md` first; this file is the reviewable artefact that goes with it.
**Nothing here has been run against AWS.** There are no credentials on the machine it was written
on. Every property name below is marked **VERIFIED** (quoted from a `docs.aws.amazon.com` page) or
**UNVERIFIED** (inferred, and why).

| File | What it is |
|---|---|
| `harness-config.mjs` | The single source of truth for what we send to the harness. Builders throw on a missing argument; there are no defaults. |
| `handoff.mjs` | The inline-function pause/resume loop. Pure, `invokeHarness` injected. Drops in behind `deps.invokeAgent`. |
| `create-harness.json` | **Generated** from `harness-config.mjs`. Reviewed by a human, then run. A test asserts it equals the module's output. |
| `execution-role-policy.json` | The IAM the harness needs, and the one statement the chat Lambda needs. |
| `server.mjs` | **Track B only** — the AgentCore Runtime container entrypoint. Unused on Track A; kept as the documented fallback if `CreateHarness` is denied (plan §7.2). |

Tests: `tests/unit/agentcore-config.test.mjs` (24), `tests/unit/agentcore-handoff.test.mjs` (33),
`tests/unit/agentcore.test.mjs` (21, Track B).

---

## 1. Why this is configuration and not code

`CreateHarness` marks **only `harnessName` and `executionRoleArn` as required.** Every setting that
costs money or widens what the agent can do is optional, and each default is one this project cannot
ship. That is the entire risk surface of Track A, so it is encoded as guards rather than prose:

| Omit | You get | Cost / risk |
|---|---|---|
| `model` | `global.anthropic.claude-opus-5` | **≈$41** for 2,200 turns against a US$15 budget |
| `allowedTools` | the recommended built-in set | a **shell** and filesystem write inside the agent |
| `memory` | managed memory | children's conversations in a long-term store |
| `truncation` | `summarization` | an extra model call per invocation |
| `environment` | 900 s idle / 8 h max session | memory billed throughout; ~$2.44/session at the top end |
| `systemPrompt` | AgentCore's coding-agent prompt | not this product |

`tests/unit/agentcore-config.test.mjs` is an inverted guard in the style of
`tests/unit/cost-guards.test.mjs`: it allow-lists the exact set of key paths, so a setting nobody
anticipated is a failure rather than a pass, and it proves that with ten mutants.

---

## 2. Property names: verified and unverified

### VERIFIED

| Property | Source |
|---|---|
| `harnessName`, `executionRoleArn` (the only required two), `allowedTools`, `model`, `systemPrompt`, `tools`, `memory`, `truncation`, `maxIterations`, `maxTokens`, `timeoutSeconds`, `environment` | `bedrock-agentcore-control/latest/APIReference/API_CreateHarness.html` — request syntax and per-field "Required:" lines |
| `harnessName` pattern `[a-zA-Z][a-zA-Z0-9_]{0,39}` — **underscores, not hyphens** | same page |
| `allowedTools` pattern `(\*\|@?[^/]+(/[^/]+)?)`, max 64 chars per entry | same page |
| `model.bedrockModelConfig.{modelId,apiFormat,additionalParams}` | `devguide/harness-models.html` |
| `additionalParams.guardrailConfig.{guardrailIdentifier,guardrailVersion}` and that the harness "passes this object to Amazon Bedrock with each model request" | `devguide/harness-models.html` § Apply Amazon Bedrock Guardrails |
| `apiFormat` ∈ `converse_stream` \| `responses` \| `chat_completions`, and that the latter two reach `bedrock-mantle` | same |
| stop reason `guardrail_intervened` | same ("the response stream reports `guardrail_intervened` as the stop reason") |
| `environment.agentCoreRuntimeEnvironment.lifecycleConfiguration.{idleRuntimeSessionTimeout,maxLifetime}`, range **60–28800**, idle ≤ max | `APIReference/API_HarnessAgentCoreRuntimeEnvironmentRequest.html` |
| `environment.agentCoreRuntimeEnvironment.networkConfiguration` | same page |
| `truncation.strategy` ∈ `sliding_window` \| `summarization` \| `none` | `devguide/harness-memory.html` § Context truncation |
| `tools[].{type,name,config}` and `type: "inline_function"` with `config.inlineFunction.{description,inputSchema}` | `devguide/harness-tools.html` |
| inline functions "execute on the client side, not on the harness VM… The harness pauses when the tool is called and returns the call to your code" | same |
| resume semantics: same `runtimeSessionId`, follow-up "needs only the matching user `toolResult`", resend the inline tool | same |
| per-invocation overrides of `model`, `systemPrompt`, `tools` | `devguide/harness-models.html`, `harness-tools.html` |
| `maxIterations` default **75**, `timeoutSeconds` default **3600**, `idleRuntimeSessionTimeout` default **900**, `maxLifetime` default **28800** | `devguide/harness-operations.html` § Control cost with limits |
| "Managed Memory is enabled by default"; "To avoid persistent Memory charges, disable Memory when you create the harness" | `harness-operations.html`, `harness-memory.html` |
| the Opus-5 service default when `model` is omitted | `devguide/harness-models.html` |
| `allowedTools: ["*"]` grants `shell` / `read` / `write` / `edit`; built-ins add ~3,000 input tokens | `devguide/harness-tools.html` |
| do **not** grant `bedrock-agentcore:InvokeAgentRuntimeCommand` | `devguide/harness-tools.html` (note on `allowedTools`) |
| `bedrock:ApplyGuardrail` on the harness execution role | `devguide/harness-models.html` |
| trust principal `bedrock-agentcore.amazonaws.com` for `sts:AssumeRole` | `devguide/runtime-troubleshooting.html` |
| ap-south-1 supports harness, Runtime microVMs, Gateway, Memory, Identity | `devguide/agentcore-regions.html` |

### UNVERIFIED — check these before running the call

| Thing | What I assumed, and why | How to settle it |
|---|---|---|
| **`memory: {"disabled": {}}` on *create*** | `harness-memory.html` shows disabling via **update**: `--memory '{"optionalValue": {"disabled": {}}}'`, and shows **create** without the `optionalValue` wrapper (`--memory '{"managedMemoryConfiguration": …}'`). So `disabled` is a verified union member and the *unwrapped* create shape is inferred from that asymmetry. | `API_HarnessMemoryConfiguration.html`, or one `create-harness` dry run |
| **`InvokeHarness` request/response field names** — `harnessArn`, `runtimeSessionId`, `messages`, `tools`, `model`, `systemPrompt` | Taken from the Python examples on `harness-tools.html` / `harness-models.html`, which are boto3 (snake_case params, camelCase wire names). The wire names are inferred. | `API_InvokeHarness.html` |
| **Stop reasons other than `tool_use` and `guardrail_intervened`** — `end_turn`, `stop_sequence`, `max_tokens`, `content_filtered` | Converse's set, inferred from `apiFormat: 'converse_stream'`. `handoff.mjs` **fails closed** on anything unrecognised (`unknown_stop_reason`), so a different spelling breaks loudly on the first invoke rather than returning an unchecked reply. | one live invoke |
| **Text delta shape** `contentBlockDelta.delta.text` | AWS's inline-function example only shows `delta.toolUse.input`. Text deltas are Converse's shape. | one live invoke |
| **`timeoutSeconds` minimum** | Set to 25 (under the chat Lambda's 29 s). The docs give the default (3600) but no floor. | `API_CreateHarness.html` constraints, or a `ValidationException` |
| **Whether `allowedTools` can be overridden per invocation** | Assumed **not**, which is why `allowedTools` on the harness is the **union** of all three roles' tool names. That is safe because per-invocation `tools` decides what exists and `allowedTools` only filters it — but if it *is* overridable, tightening it per role is a free extra fence. | `API_InvokeHarness.html` |
| **CloudWatch Transaction Search cost** for harness traces | Every invocation emits traces automatically. Rate read via search, not fetched. Affects ~2 cents. | the CloudWatch pricing page |

---

## 3. The commands, in order

```bash
# 0. Eligibility. Read-only, free, creates nothing. Plan §7.6.
aws sts get-caller-identity
aws bedrock-agentcore-control list-agent-runtimes --region ap-south-1 --max-results 5

# 1. The guardrail must exist first — create-harness.json references it by id.
#    From backend/agent/guardrail.json. Record the id and version.

# 2. The execution role, from execution-role-policy.json (trust policy + permissions policy).

# 3. Regenerate create-harness.json if anything in harness-config.mjs changed, then review it.
node -e "import('./backend/agentcore/harness-config.mjs').then(({createHarnessBody})=>{ \
  const P={executionRoleArn:'arn:aws:iam::REPLACE_ACCOUNT_ID:role/REPLACE_HARNESS_EXECUTION_ROLE', \
  modelId:'apac.amazon.nova-lite-v1:0',guardrailId:'REPLACE_GUARDRAIL_ID',guardrailVersion:'1'}; \
  require('fs').writeFileSync('backend/agentcore/create-harness.json', \
  JSON.stringify({PLACEHOLDERS:P,...createHarnessBody(P)},null,2)+'\n');});"
npm test    # the drift guard asserts the file equals the module

# 4. Substitute the placeholders into a copy, then create. NOT run by an agent.
aws bedrock-agentcore-control create-harness \
  --region ap-south-1 --cli-input-json file://create-harness.local.json
```

`create-harness.local.json` is the substituted copy — keep it out of git; it carries the account id.

---

## 4. What a human must check before step 4

1. **`model.bedrockModelConfig.modelId` is a Nova id.** This is the $41 line. The guard enforces it
   in code; check it with your eyes anyway, because the guard checks the *module* and you are about
   to run a *file*.
2. **`allowedTools` has no `*`, no `@`, no `/`, and no `shell`/`read`/`write`/`edit`.**
3. **`memory` is `{"disabled": {}}`** — and see the UNVERIFIED note on the create-time shape.
4. **`idleRuntimeSessionTimeout` is 60**, not 900.
5. **No `resourceConfigurations`, no `skills`, no `hooks`, no `authorizerConfiguration`.** The last
   is the sharpest: OAuth inbound auth pointed at our Cognito pool would let a browser invoke the
   harness directly with its own token, skipping the wellbeing check and `policyCheck` in
   `handleChat` entirely. Inbound auth stays SigV4, which is the default.
6. **The guardrail id and version are real**, and the guardrail is in `ap-south-1` — "Use a
   guardrail in the same AWS Region as the model request."
