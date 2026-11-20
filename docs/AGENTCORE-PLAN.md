# Getting Panthiya onto AgentCore in twelve days

**Written 2026-11-20 by lane E4.** No AWS credentials exist on this machine and nothing is
deployed, so **not one AWS or `sam` command was run to produce this file.** Every claim is either
quoted from AWS's own documentation (URLs in §8) or derived from code in this repository. Anything
that cannot be settled without credentials is marked **[unverifiable offline]** and says what would
settle it.

This file answers the question `docs/NEXT-SESSION.md` §0a left open, now that the challenge rules
have been read: *"Build a working agent on **Amazon Bedrock Managed Agents or the Amazon Bedrock
AgentCore managed harness** that performs one defined job"*, qualification being pass/fail with no
exceptions.

---

## 1. The verdict

### 1.1 The headline, in four lines

1. **AgentCore Runtime can host our existing tool loop as-is.** Verified. It is a container host;
   the orchestration loop is explicitly ours. `backend/functions/chat/orchestrate.mjs` moves inside
   unchanged.
2. **But "managed harness" is the name of a different product**, and that product *does* impose its
   own orchestration contract — it replaces `runToolLoop` with AWS's loop.
3. **The harness nevertheless preserves everything that matters**, through a documented feature
   called *inline functions* that is almost exactly the shape of our existing `invokeTool`. The
   three action Lambdas, `backend/lib/auth.mjs`, `sessionAttributes`, `toolsFor(role)`,
   `instructionFor(role)`, the guardrail and all 36 red-team cases survive either way.
4. So the recommendation is the **harness**, because it matches the rules' wording under both
   readings and — the practical reason — **needs no container, no Docker and no ARM64 build**, which
   removes the single largest new prerequisite from an already-serial twelve-day plan.

**Confidence: high on the technical facts, medium on the qualification reading.** The technical
facts are quoted verbatim below from `docs.aws.amazon.com` and are not ambiguous. What is ambiguous
is whether a judge reading "the AgentCore managed harness" means the `CreateHarness` product or
AgentCore-the-managed-service generally. That is a reading of the rules, not of the docs, and §7
risk 1 says who must settle it and how.

### 1.2 Runtime: the loop is ours. Verified.

The decisive page is AWS's own comparison, `devguide/harness-vs-runtime.html`:

> **AgentCore Runtime** is a *serverless hosting environment*. You bring agent code - written in any
> framework or no framework - wrap it with the AgentCore SDK's `BedrockAgentCoreApp` entrypoint,
> package it into an ARM64 container, push it to Amazon ECR, and deploy. ***The orchestration loop
> is yours.***

And the custom-agent tutorial, `devguide/getting-started-custom.html`, removes the SDK from the
requirement list:

> This tutorial shows how to deploy a custom agent without using the AgentCore CLI. **A custom agent
> is an agent built without using the AgentCore Python SDK.**

with the whole contract being four bullets (`devguide/runtime-http-protocol-contract.html`):

> Your agent must be deployed as a containerized application meeting these specifications:
> **Host**: `0.0.0.0` · **Serving port**: `8080` by default · **Platform**: ARM64 container
> — Required for compatibility with the AgentCore Runtime environment

> + **Invocation endpoint**: POST endpoint for agent interactions, at `/invocations` by default (required)
> + **Ping endpoint**: GET endpoint at `/ping` for health checks (required)
> + **Docker container**: ARM64 containerized deployment package

So: **nothing about Python, nothing about a framework, nothing about an AWS-defined agent shape.**
An ARM64 container that answers two HTTP paths. Node.js qualifies. `runToolLoop` goes inside it
verbatim. **M1–M6 survives in full.**

### 1.3 The harness: the loop is AWS's. Also verified.

From the same comparison page:

> **AgentCore harness** is a *managed agent harness* - the orchestration loop itself is provided,
> powered by [Strands Agents]. You declare what the agent is (model, system prompt, tools, memory,
> limits) as configuration, and AgentCore runs the loop. ... The harness is a managed abstraction
> that runs inside Runtime - CloudTrail records harness operations under
> `AWS::BedrockAgentCore::Runtime`.

and the feature grid is blunt about the cost:

| Feature | Harness | Runtime |
|---|---|---|
| Choice of agent framework | ❌ No | 🔵 Custom (your code) |
| Non-agent-loop patterns (graph, workflow style) | ❌ No | 🔵 Custom |
| Inline / client-side tools | 🔵 Custom (your code) | 🔵 Custom |

It went **GA on 2026-06-17** and `devguide/harness.html` states:

> **AgentCore harness is available in GA across all regions shown [in the regions table].**

So the harness is not a preview and not a waitlist — which is the opposite of both Agents Classic
and BMA.

### 1.4 Why the harness does not cost us the security model: inline functions

This is the finding that makes the recommendation possible. From `devguide/harness-tools.html`:

> **Inline functions:** Tool schemas that execute on the client side, not on the harness VM. **The
> harness pauses when the tool is called and returns the call to your code, which decides what to do
> and sends a result back.** This is the pattern for human-in-the-loop approvals and custom
> integrations.

Read that against what `backend/functions/chat/index.mjs` already does. `invokeTool` receives a
tool name and arguments the model chose, and invokes the action Lambda **with
`sessionAttributes` built from the verified JWT claims**. The harness's inline-function handoff is
the same control flow with the harness holding the loop instead of us:

```
model asks for recordFee
  → harness pauses, returns the toolUse to OUR chat Lambda
  → our Lambda (which holds the verified claims) invokes actions-teacher
      with sessionAttributes = { sub, role, lang, today }   ← unchanged payload
  → requireRole / resolveScope / assertInScope run exactly as today
  → our Lambda sends the toolResult back to the harness
```

**Design §3.1's claim survives verbatim: the role never leaves our own Lambda.** It is never a
field the model can write, never a header the harness synthesises, and never inferred from message
content. And two more things survive that looked at first as if they would not:

- **`toolsFor(role)`.** Tools are overridable per call — *"Use the SDK when you need to override the
  tools for one invocation without changing the deployed harness."* So a student session is still
  never told that `recordFee` exists, which is the third fence `orchestrate.mjs` argues for.
- **`instructionFor(role)`.** `systemPrompt` is overridable the same way — *"These apply only to
  this call; the harness defaults stay intact."*

One harness, not three, with `tools` and `systemPrompt` passed per invocation from the verified role.

### 1.5 What the harness does cost us

Named plainly, because this is the part that is not free:

| Lost | Size |
|---|---|
| `runToolLoop` and its 23 tests | The function is replaced by the harness's loop. Its *properties* are not lost — they move into the inline-function handoff loop (§6), which needs its own tests. Same logic, new home. |
| One response object | The harness answers as an **event stream** (`response["stream"]`), not a single `Converse` response. The handoff loop has to consume `contentBlockStart` / `contentBlockDelta` / `messageStop` and reassemble. More code than `Converse`. |
| Latency headroom | Each tool round trip is a **separate `InvokeHarness` call** from our Lambda. With `MAX_TOOL_TURNS = 4` that is up to five calls inside the chat Lambda's 29 seconds. §7 risk 3. |

### 1.6 Where this is ambiguous, said plainly

- **Whether Track B (Runtime) qualifies** is a rules reading, not a docs question. Both readings are
  defensible and I will not pick the convenient one. §7 risk 1.
- **Whether `InvokeHarness` returns within our latency budget** cannot be known offline. Measurable
  in one call once credentials exist.
- **Whether this account may call `CreateHarness`** cannot be known offline. §7 risk 2 and the probe
  in §7.6.

---

## 2. What has to exist in `ap-south-1`

**The settled region decision survives. Mumbai is not the problem it was for BMA.** From
`devguide/agentcore-regions.html`, the Asia Pacific (Mumbai) column:

| Feature | `ap-south-1` | Required for this submission? |
|---|---|---|
| **AgentCore harness** | ✓ Yes | **Required** on Track A |
| **AgentCore Runtime microVMs** | ✓ Yes | **Required** on both tracks (the harness runs inside Runtime) |
| AgentCore Runtime Instances | ✓ Yes | No — that is the EC2-backed compute type, which bills per instance. Do not use it |
| **AgentCore Gateway** | ✓ Yes | **No** — see §3, we decline it |
| **AgentCore Memory** | ✓ Yes | **No** — and it should be switched *off*, see §5.3 |
| **AgentCore Identity** | ✓ Yes | **No** — inbound auth is SigV4 and there are no third-party tokens to vault |
| AgentCore Observability | ✓ Yes | Optional, recommended. Needs CloudWatch Transaction Search enabled once per account |
| Policy in AgentCore | ✓ Yes | No |
| AgentCore Evaluations / optimization | ✓ Yes | No |
| AgentCore Built-in Tools (Browser, Code Interpreter) | ✓ Yes | **No — and must be actively excluded.** §5.3 |
| AWS Agent Registry | **No** | No |
| Web Search / Web Answer | **No** | No |
| AgentCore payments | **No** | No |

**Nothing required is missing from `ap-south-1`, and nothing required is preview-gated the way
Agents Classic turned out to be.** So `backend/template.yaml` and `docs/NEXT-SESSION.md` keep
`ap-south-1`, the §0a "region reopens" consequence does **not** fire, and the Sinhala gate can run
against Nova in the region the stack already targets. That removes the second-biggest consequence
of the §0a decision tree.

One footnote for the Runtime track only: **platform version V2 is available in `ap-south-1`**
(`devguide/runtime-how-it-works.html` lists it), which matters because V2 is the version with
consistent cold starts and automatic idle-memory reclaim. V1 is the default if `platformVersion` is
omitted.

### 2.1 Is anything allowlisted or prior-usage gated?

**No documented gate — but that is absence of a published process, not proof of access.** The
evidence, which is as strong as it gets without credentials:

- A public 22-region support table, a public pricing page with rates, public CloudFormation
  resource types (`AWS::BedrockAgentCore::Runtime`, `::GatewayTarget`), a console path, and a GA
  announcement dated 2026-06-17.
- The troubleshooting page's own `AccessDeniedException` entry names **exactly two** causes:

  > **Missing permissions for the caller.** Make sure that the caller's credentials has
  > `bedrock-agentcore:CreateAgentRuntime`.
  > **Execution Role cannot be assumed by Amazon Bedrock AgentCore.**

  There is **no prior-service-usage clause, no allowlist, no waitlist and no "no exception process"
  sentence** — which is precisely the opposite of what Agents Classic publishes. Agents Classic
  documents its block; AgentCore documents only ordinary IAM.

**[unverifiable offline]** Settled by §7.6, one read-only command.

---

## 3. How the three action Lambdas attach

### 3.1 The recommendation: inline functions. No Gateway.

**`backend/lib/auth.mjs` does not change. Not one line.** The action Lambdas keep receiving the
Bedrock action-group event shape they already read — `messageVersion`, `actionGroup`, `function`,
`parameters`, `sessionAttributes` — because our own Lambda keeps building it, exactly as
`invokeTool` in `backend/functions/chat/index.mjs` does today. The only thing that changes is who
tells our Lambda which tool to run: the harness, instead of our own `runToolLoop`.

The tool declaration, per invocation, derived from the real signatures in `toolsFor(role)` (which
already produces `{ toolSpec: { name, description, inputSchema: { json } } }` from
`backend/agent/schemas/{teacher,student,parent}.json`):

```jsonc
// one entry per tool the verified role is allowed, built from toolsFor(role)
{
  "type": "inline_function",
  "name": "recordFee",
  "config": {
    "inlineFunction": {
      "description": "<the toolSpec description, unchanged>",
      "inputSchema": { "type": "object", "properties": { /* the toolSpec json, unchanged */ },
                       "required": ["studentName", "amount", "currency", "period"] }
    }
  }
}
```

`inputSchema` here is the same JSON Schema object `toolConfig.tools[].toolSpec.inputSchema.json`
already carries, so **`toolspecs.mjs` and the three schema files are reused as they stand** — this
is a different wrapper around the same schemas, not a second copy of them.

### 3.2 Why not a Gateway target, even though that is AWS's documented path

A Gateway target wrapping the Lambdas as MCP tools is the documented path, and it is also the wrong
one here. The reason is identity, and it is specific. From `devguide/gateway-add-target-lambda.html`:

> **Event object** — A map of `properties` from the `inputSchema` to their values, as returned by
> the tool.
>
> **Context object** — ... `bedrockAgentCoreMessageVersion` ... `bedrockAgentCoreGatewayId` ...
> `bedrockAgentCoreTargetId` ... `bedrockAgentCoreToolName` ... `bedrockAgentCorePropagatedHeaders`

**There is no `sessionAttributes` on that path and no equivalent of it.** The consequences, traced
through the actual code:

1. `sessionAttributes(event)` in `auth.mjs` returns `{ sub: null, role: null }`.
2. `requireRole(null, 'teacher')` throws `DenyError('no_role')`.
3. **Every teacher, parent and student action is denied.** The product does nothing at all.

The only documented way to get identity across is header propagation —
`metadataConfiguration.allowedRequestHeaders`, read back out of
`context.client_context.custom['bedrockAgentCorePropagatedHeaders']`. Taking that path would mean:

- **a change to `backend/lib/auth.mjs`** — a second identity reader for the gateway shape, in the
  one file the repo calls "the security spine";
- the role moving from a field our own code writes into a Lambda payload, to **an HTTP header on an
  MCP request**, trusted because a gateway target's allowlist is configured correctly;
- the gateway's documented tool-name prefixing (`${target_name}___${tool_name}`) breaking the
  `DISPATCH[event.function]` lookup in all three `index.mjs` files — AWS says so itself: *"Tool name
  prefixes will need to be manually stripped off from the toolname in your AWS Lambda function"*
  and *"If you are using an existing AWS Lambda function and import it as a tool into the gateway,
  you will need to change the function code to account for a schema change for event and context
  objects"*;
- the flat event object replacing the `parameters` array that `validate.mjs` was written against.

**That is three Lambda rewrites plus a change to the security spine, for no qualification benefit
whatsoever** — the harness accepts inline functions and Gateway tools equally, and the rules say
nothing about Gateway. Declined. Cost of declining: $0 (§5).

**One honest caveat.** I could not verify from the docs whether a harness invocation can cause a
Gateway target to propagate a caller-supplied header. So I am not claiming the Gateway path is
*impossible* — I am claiming it is strictly more surface for zero gain, and that its identity
channel is **[unverifiable offline]** while the inline-function one is documented.

### 3.3 The one change to a file this lane does not own

`backend/functions/chat/index.mjs` gains a third `invokeAgent` implementation beside `invokeAgent`
(option A) and `invokeViaLoop` (option B) — which is exactly what that file and
`orchestrate.mjs` were built for. `orchestrate.mjs`'s own header says:

> Two orchestrators can sit behind `deps.invokeAgent`, and `handleChat` cannot tell them apart

This becomes the third. **`handleChat` does not change. `orchestrate.mjs` does not change.** The new
function `invokeViaHarness({ inputText, sessionAttributes })` must:

1. `invoke_harness` with `harnessArn`, a `runtimeSessionId`, `model` (**explicitly** Nova Lite — see
   §5.3), `systemPrompt: [{ text: instructionFor(role) }]`, `tools` from `toolsFor(role)` mapped to
   inline functions, `allowedTools` listing **only** those names, and `additionalParams.guardrailConfig`.
2. Consume the stream; on `messageStop` with `stopReason === 'tool_use'`, run the tool through the
   **existing** `invokeTool` and send the `toolResult` back on the same `runtimeSessionId`.
3. Reproduce the three refusals `runToolLoop` makes today, because they are red-team properties and
   not conveniences: a name not in `offered` is refused **without invoking any Lambda**; a tool that
   threw is reported to the model as `TOOL_FAILED` and never as a result; and running out of rounds
   is an honest `tool_loop_exhausted`, never an invented summary.
4. Throw the error shapes `handleChat` already understands — which the guardrail does for free,
   because the harness reports interventions with the **same stop reason** (§4).

---

## 4. Where the Guardrail attaches

**It attaches in the same place on both tracks, and layer 2 is not weakened on either.** This
corrects the worry carried in `docs/NEXT-SESSION.md` §0a: the "guardrails are **not supported**"
sentence is about **`bedrock-mantle`** — the BMA endpoint — and not about AgentCore.

**Track A (harness).** Documented explicitly, `devguide/harness-models.html`:

> ### Apply Amazon Bedrock Guardrails
> Use Amazon Bedrock Guardrails to filter harmful content or block denied topics in model inputs and
> outputs. To apply a guardrail to each model request, add a `guardrailConfig` object to
> `bedrockModelConfig.additionalParams`. **The harness passes this object to Amazon Bedrock with each
> model request.**
>
> To use Amazon Bedrock Guardrails with the harness, configure `bedrockModelConfig` with the
> `converse_stream` API format. ...
>
> Use a guardrail in the same AWS Region as the model request. **When a guardrail intervenes, the
> response stream reports `guardrail_intervened` as the stop reason.**

Three things follow, and all three are good news:

1. `backend/agent/guardrail.json` is used **unchanged**. Layer 2 stays *attached to the model call*,
   not downgraded to an explicit `ApplyGuardrail` on the way in and out. The §0a regression that
   BMA forced does not happen here.
2. **`guardrail_intervened` is the same literal stop reason `runToolLoop` already matches** — so
   `guardrailIntervened()` and the whole layer-2 attribution path in `handleChat` and
   `redteam/score.mjs` work with no change.
3. AWS's own example in that section uses **`us.amazon.nova-micro-v1:0`** — a Nova model. So the
   §0a coupling between the Sinhala gate and layer 2 (`openai.gpt-5.4`/`5.5` cannot take a
   guardrail) **dissolves**, because we are not on an OpenAI model and not on `bedrock-mantle`.

One new IAM line is needed on the **harness execution role** (not on the chat Lambda's role, which
already has it):

```json
{ "Effect": "Allow", "Action": "bedrock:ApplyGuardrail",
  "Resource": "arn:aws:bedrock:ap-south-1:<account>:guardrail/<id>" }
```

**Track B (Runtime).** Nothing changes at all. The container calls `Converse` with
`guardrailConfig` — the code in `backend/functions/chat/index.mjs` as it stands. AgentCore Runtime
is compute; it is not in the model-invocation path and has no opinion about guardrails. The only
move is that the `bedrock:InvokeModel` and `bedrock:ApplyGuardrail` permissions migrate from the
chat Lambda's role to the **Runtime execution role**.

**Still [unverifiable offline], and unchanged from `docs/NEXT-SESSION.md`:** that `guardrailConfig`
evaluates plain message text rather than needing a `guardContent` wrapper. That was already on the
Nov 22–23 SWAP POINT list and stays there.

---

## 5. The cost delta

Current model: `docs/COST-MODEL.md` — **~$2.50 typical, ~$9.80 ceiling, $15 target, $0 spent.**

### 5.1 The rates, from `aws.amazon.com/bedrock/agentcore/pricing`

| Line | Rate |
|---|---|
| Runtime v1 | $0.0895 per vCPU-hour · $0.00945 per GB-hour |
| Runtime v2 | $0.1276 per vCPU-hour · $0.0169 per GB-hour (consumption) |
| Gateway | $0.005 per 1,000 invocations · $0.02 per 100 tools indexed per month |
| Memory | $1.00/GB ingested · $0.10/GB-month · $0.75 per 1,000 long-term records/month |
| Identity | **$0 when used through AgentCore Runtime or Gateway** |
| **The harness itself** | **$0** — *"There is no additional charge for the harness itself."* |

Billing is per second with a 1-second minimum. The formula AWS publishes
(`devguide/harness-operations.html`) is the one that matters:

> `CPU cost = consumed vCPU-seconds / 3,600 * vCPU-hour rate`
> `Memory cost = sum of peak GB consumed in each second / 3,600 * GB-hour rate`
>
> Don't estimate CPU cost from wall-clock invocation or session duration alone. **Model and tool I/O
> waits don't incur CPU charges when no other process uses CPU. However, memory consumption remains
> billable.**

That sentence is the whole cost story: **a Panthiya turn is almost entirely I/O wait, so CPU is
nearly free, and the bill is memory × how long a session stays alive.**

### 5.2 The arithmetic

Assumptions, stated so they can be disagreed with: **2,200 turns** over the window (COST-MODEL §3:
50 gate + 900 red team + 250 rehearsal + 1,000 judge); **~400 sessions** (a red-team sweep is
rapid-fire inside one session, judge use is a handful of turns); **0.3 GB** resident for a Node
process plus two SDK clients, 0.8 GB at the ceiling; **1 vCPU-second** of real compute per turn, 3
at the ceiling; **4 s** wall clock per turn, 12 at the ceiling; `idleRuntimeSessionTimeout` set to
**60 s** (§5.3 guard 4).

**Track A — harness (recommended), on the Runtime v1 rates it inherits:**

| Line | Typical | Ceiling |
|---|---|---|
| CPU: 2,200 × 1 vCPU-s = 0.611 vCPU-h × $0.0895 | $0.055 | 2,200 × 3 = 1.833 vCPU-h × $0.0895 = $0.164 |
| Memory: (2,200 × 4 s active) + (400 × 60 s idle) = 32,800 s × 0.3 GB = 2.73 GB-h × $0.00945 | $0.026 | (2,200×12)+(700×60) = 68,400 s × 0.8 GB = 15.2 GB-h × $0.00945 = $0.144 |
| Harness charge | $0.00 | $0.00 |
| Gateway / Memory / Identity (all declined or free) | $0.00 | $0.00 |
| ECR (no container on this track) | $0.00 | $0.00 |
| Observability traces → CloudWatch ingest **[rate partly unverified]** | $0.02 | $0.10 |
| **AgentCore delta** | **+$0.10** | **+$0.41** |

**Track B — Runtime hosting our loop, on v2 consumption rates:**

| Line | Typical | Ceiling |
|---|---|---|
| CPU: 0.611 vCPU-h × $0.1276 | $0.078 | 1.833 × $0.1276 = $0.234 |
| Memory (v2 reclaims idle memory after 120 s): (8,800 + 400×120) s × 0.3 GB = 4.73 GB-h × $0.0169 | $0.080 | (26,400 + 700×120) s × 0.8 GB = 24.5 GB-h × $0.0169 = $0.415 |
| ECR image storage, ~0.25 GB × $0.10/GB-mo × 2.3 mo | $0.058 | 0.5 GB → $0.115 |
| Observability **[partly unverified]** | $0.02 | $0.10 |
| **AgentCore delta** | **+$0.24** | **+$0.86** |

### 5.3 The new totals — and the loud flag

| | Typical | Ceiling | Headroom vs $15 |
|---|---|---|---|
| COST-MODEL.md as it stands | $2.50 | $9.80 | $12.50 / $5.20 |
| **+ Track A (harness)** | **~$2.60** | **~$10.21** | **$12.40 / $4.79** |
| + Track B (Runtime) | ~$2.74 | ~$10.66 | $12.26 / $4.34 |

**The budget survives — and the $77–95 NAT-gateway line in `docs/COST-MODEL.md` §4 item 1 comes
off the table.** `networkConfiguration: {"networkMode": "PUBLIC"}` is the documented default in
every AWS example; there is no VPC, no subnet and no NAT on either track. That was the single
largest threat in the cost model and it was tied to the *supplied CDK bundle*, not the service.

> ### 🚨 The budget-breakers are the DEFAULTS, not the rates. Four guards, all mandatory.
>
> **Guard 1 — set `model` explicitly, or pay 2.7× the entire budget.**
> `devguide/harness-models.html`: *"If you create a harness with the API ... and omit the model, the
> harness uses the service default ... In commercial AWS Regions, that model is Anthropic's Claude
> Opus 5 on Amazon Bedrock (`global.anthropic.claude-opus-5`)."* At Opus-class list prices, 2,200
> turns is **≈ $41** against a $15 budget. The model must be set on `CreateHarness` **and** the
> `ModelId` template parameter must stay the single source of truth for it.
>
> **Guard 2 — set `allowedTools` to exactly our tool names.**
> *"`allowedTools: ["*"]` permits every configured tool ... including `shell` and filesystem tools
> that can read, create, or modify files"*, and the default when it is **omitted** is the
> recommended built-in set. For a product whose entire submission is about an agent that does not
> break its rules, shipping it with a shell is indefensible on safety grounds alone; it also costs
> *"approximately 3,000 input tokens to each model request"* ≈ **$0.59** over the window.
>
> **Guard 3 — turn AgentCore Memory off.** *"Managed Memory is enabled by default."* Our loop is
> single-message by design (the `ponytail:` note in `orchestrate.mjs`), so it buys nothing — and it
> would place children's conversations in AWS-managed long-term memory, which is a **privacy and
> retention decision this project has not taken**, not merely a cost line. Flag it to Nishen, do not
> let it arrive by default.
>
> **Guard 4 — keep sessions short-lived.** `idleRuntimeSessionTimeout` defaults to **900 s**
> (range 60–28800) and `maxLifetime` to **28800 s (8 hours)**. A V2 runtime with
> `resourceConfigurations` set to `minimumMemoryInMiB: 8192` holds an 8 GB / 2 vCPU baseline *for
> the whole session* — **≈ $2.44 per session**, so ten forgotten sessions exceed the budget on their
> own. Three sub-guards: never set `resourceConfigurations`; set
> `idleRuntimeSessionTimeout: 60`; and **never send `time_of_last_update` on `/ping`** — AWS
> documents that advancing it on every ping *"prevents the idle timeout from ever firing. Sessions
> then live until MaxLifetime"*. That last one is **already pinned by a test in this lane**
> (`tests/unit/agentcore.test.mjs`).
>
> Also keep `maxIterations` (default **75**) in line with `MAX_TOOL_TURNS` (4). Seventy-five
> reasoning cycles on a single teacher message is a runaway, not a feature.

One small saving, noted for honesty: the harness enables **automatic prompt caching** for Bedrock
`converse_stream` models, so the repeated ~800-token instruction gets cache-read pricing. Not
quantified; it moves the number the right way.

---

## 6. The twelve-day plan

Against the serial critical path in `docs/NEXT-SESSION.md` §0c. **Today is Nov 20; submission Dec 1;
deadline Dec 2, 11:59 PM PT.** The AgentCore work adds roughly **11 agent-hours and ~1 hour of
Nishen's** on Track A, and **+6 agent-hours and +1.5 Nishen-hours** on Track B (Docker, ECR, ARM64).
That is the single best argument for Track A in a plan whose first eight days are serial.

### 6.1 What an agent can do with no credentials — **≈ 9 h, all of it startable today**

| # | Work | Hours | Status |
|---|---|---|---|
| 1 | **This document** | — | ✅ done |
| 2 | **The Runtime entrypoint + 21 tests** (`backend/agentcore/server.mjs`) | 2 | ✅ done — Track B fallback only |
| 3 | **The dangerous defaults, as guards** — `tests/unit/agentcore-config.test.mjs`, an inverted allow-list in the `cost-guards.test.mjs` style, proved with ten mutants | 2 | ✅ done |
| 4 | **`toolsFor(role)` → inline-function mapper** (`harness-config.mjs`). Reuses the existing schemas; no new schema file | 1.5 | ✅ done |
| 5 | **The inline-function handoff loop** (`handoff.mjs`), pure, `invokeHarness` injected | 3 | ✅ done |
| 6 | **Port the `chat-loop.test.mjs` properties** corpus-first per the Nov 19 rule — `tests/unit/agentcore-handoff.test.mjs` | 2 | ✅ done |
| 7 | **The `CreateHarness` + IAM artefacts**, reviewable, not applied — `create-harness.json`, `execution-role-policy.json`, `README.md` | 1 | ✅ done |

**The whole Track A build is done offline: 78 tests (21 + 24 + 33), `npm test` 771/771.** Nothing in
it is blocked on Nishen, and nothing in it touched AWS.

What remains offline is small: the SSE/event-stream reader at the Lambda boundary (`assembleStream`
is written and tested, but the thing that turns a real `InvokeHarness` response into the event array
it consumes is one `for await` over the SDK's stream, and its field names are **[unverifiable
offline]**), and wiring `invokeViaHarness` into `backend/functions/chat/index.mjs` — §10.

### 6.2 What needs credentials — **≈ 6 h (Track A) / 12 h (Track B)**

| By | Work | Hours |
|---|---|---|
| Nov 20 | **The probe** (§7.6) — one read-only command, free. Settles eligibility | 0.1 |
| Nov 21 | Harness execution role + `CreateHarness` + **first `InvokeHarness`**. Measures the three unverifiables: latency, the guardrail stop reason, the stream shape | 2 |
| Nov 21 | 🚦 **The Sinhala gate** against Nova in `ap-south-1` — unchanged, and now *not* coupled to an OpenAI model (§4) | 1 |
| Nov 22 | `sam deploy --guided`, `demo-users.mjs --apply`, `seed --apply` — **unchanged from §0c** | 1 |
| Nov 22 | Wire `invokeViaHarness` into `chat/index.mjs`, redeploy, first live `/chat` through the harness | 2 |
| *(Track B only)* | Docker Desktop, `buildx`, ARM64 build, ECR repo, `CreateAgentRuntime`, `InvokeAgentRuntime` | +6 |

**§0c's Nov 21 row — "the A/B/C orchestration decision" — is now spent instead on building, because
§1 settles it.** That is the day this document buys back.

### 6.3 What only Nishen can do

Unchanged from `docs/NEXT-SESSION.md` §0c except where marked **NEW**:

| | | Why it is only Nishen's |
|---|---|---|
| 1 | **Sign in to AWS; `aws configure`; `winget install Amazon.SAM-CLI`** | Still the first row. Everything is behind it |
| 2 | **NEW — re-read ONE sentence on the rules page** and decide whether "the AgentCore managed harness" means `CreateHarness` or AgentCore generally | **5 minutes, and it eliminates a 6-hour fork.** §7 risk 1. No agent can read a judge's intent |
| 3 | **NEW — approve AgentCore Memory being off** (§5.3 guard 3) | It is a children's-data retention decision, not a cost one |
| 4 | **NEW — Docker Desktop**, *only* if Track B is chosen | A Windows install an agent cannot approve. §7 risk 4 |
| 5 | Decide the Kiro write-up; request the 4,000 Kiro credits before Dec 1 12:00 PT | Unchanged |
| 6 | **`docs/TRANSLATION-REVIEW.md` Priority 0 and 1** | Unchanged, and still the only work nobody else can do at all |
| 7 | Approve the deploy; record the demo video; submit | Unchanged |

### 6.4 The dates, merged into §0c

| By | Change from §0c |
|---|---|
| **Nov 20** | **+ the AgentCore probe** (replaces the BMA probe as the decisive one). **+ Nishen's rules sentence.** The BMA probe is now optional — BMA is the *other* branch of the rules sentence, not our path |
| **Nov 21** | **Was** "the A/B/C decision". **Now**: build the harness, run the Sinhala gate against Nova in `ap-south-1` |
| **Nov 22** | Unchanged — deploy, demo users, seed — **plus** wire `invokeViaHarness` |
| **Nov 22–23** | The four SWAP POINTs — **one is retired** (the guardrail/model coupling, §4) and **two are added**: `InvokeHarness` latency against the 29-second ceiling, and the stream event shape |
| **Nov 23–24** | 🎯 the 36 live cases — unchanged |
| **Nov 24–25** | Verification pass 4 — unchanged, and now with a brand-new orchestration path to be wrong about |
| **Nov 25 → Dec 1** | Unchanged |

**The slack is still four days and it is still small.** AgentCore does not consume it on Track A.
On Track B it consumes about one day of it.

---

## 7. The honest risk list

### 7.1 Risk 1 — the rules mean `CreateHarness` and we built on Runtime (or the reverse)

**The biggest risk in this document, and the cheapest to retire.** Impact: a non-qualifying
submission, which under pass/fail-with-no-exceptions means the work does not reach judging.
Mitigation: Nishen re-reads the sentence (§6.3 row 2) **on Nov 20, before any build**. Secondary
mitigation: **Track A satisfies both readings**, because the harness *is* the managed harness and
*runs inside Runtime* — so if the reading is genuinely unclear, build Track A and the question stops
mattering. This is why Track A is recommended despite replacing a loop that already works.

### 7.2 Risk 2 — AgentCore is gated on this account, like Agents Classic

Probability **low** (§2.1: no documented gate, GA, public everything). Impact **fatal**.
Retired by §7.6 in one command on Nov 20.
**Fallback if it fires: there is none that qualifies.** If `CreateHarness` *and* `CreateAgentRuntime`
*and* BMA are all closed on this account, then the two services the rules name are both unreachable
and this account cannot produce a qualifying entry. That is not an engineering problem and must go
to Nishen the same hour, with the exact error text, to decide between asking the organisers and
using a different AWS account. **Knowing this on Nov 20 rather than Dec 1 is the entire point of
running the probe first.**

### 7.3 Risk 3 — the 29-second ceiling

The chat Lambda has 29 s because API Gateway caps at 30. On Track A each tool round trip is a
separate `InvokeHarness` call, so `MAX_TOOL_TURNS = 4` means up to **five** round trips plus the
harness's own model calls plus a possible microVM cold start. Measurable only live.
**Mitigations, in order of preference:** drop `MAX_TOOL_TURNS` to 2 (the code already anticipates
this — *"if the first live runs show the round trip is slow, this is the number to drop"*); keep
`idleRuntimeSessionTimeout` above zero so same-day sessions stay warm; on Track B, set
`platformVersion: V2`, which *"keeps cold-start latency consistent regardless of concurrency or
image size"*. This risk trades directly against guard 4 — short sessions are cheap and cold.

### 7.4 Risk 4 — ARM64 on Windows (Track B only)

`docker buildx` on Windows 11 needs Docker Desktop, which is an install, a reboot and a licence
question. Mitigation: AWS's own troubleshooting page offers the escape — *"Alternatively, you can
use CodeBuild"* — so the ARM64 build can run in AWS and never touch this machine.
**Does not apply to Track A at all**, which is one of the strongest practical arguments for it.

### 7.5 Risk 5 — the harness's defaults

Covered as guards in §5.3. Listed here too because **each one arrives silently**: a wrong model, a
shell tool, children's data in managed memory, and an 8-hour session are all what you get by
*omitting* a field, not by setting one wrong. The guard against this class is a single reviewed
`CreateHarness` request body, checked line by line before it is sent — which is §6.1 item 6, and
why that item exists.

### 7.6 The probe

**`scripts/bma-probe.mjs` does not cover AgentCore.** I read it. It is a correct and careful probe
for a *different service*: it signs as `SERVICE = 'bedrock-mantle'`, hits
`bedrock-mantle.<region>.api.aws`, calls `/v1/models` and `/openai/v1/agents/sessions`, and its
`BMA_REGIONS` are the three BMA preview regions with a warning that `ap-south-1` is deliberately not
one of them. **AgentCore is a different signing name (`bedrock-agentcore`), a different host
(`bedrock-agentcore-control.<region>.amazonaws.com`), a different API and a different region list.**
Nothing in that file reaches it.

**This lane does not own `scripts/**` and has not edited it. It also does not need to**, which is the
lazier and better answer: the AgentCore probe needs no script at all.

```bash
# read-only, free, creates nothing. Run both; they answer different questions.
aws sts get-caller-identity
aws bedrock-agentcore-control list-agent-runtimes --region ap-south-1 --max-results 5
```

Reading it, in the spirit of `bma-probe.mjs`'s own `verdict()`:

| Result | Means |
|---|---|
| **A list (even empty)** | The account can reach the AgentCore control plane in Mumbai. The namespace is open. Proceed |
| **`AccessDeniedException` naming the IAM identity** (*"not authorized to perform: bedrock-agentcore:ListAgentRuntimes"*) | **Our own policy**, not the account. `AmazonBedrockFullAccess` predates this service. Add `bedrock-agentcore:*` to `panthiya-dev` and re-run. **Conclude nothing about the challenge from this** |
| **A message about the account** — prior service usage, allowlist, not enabled | The §7.2 fallback. Record the exact text in `docs/BUILD-LOG.md` before anything else |
| **`Unknown service` / command not found** | The AWS CLI is too old. It is 2.36.49, which post-dates GA by a year, so this is unlikely — but it is a tooling answer, not a verdict |

**It is not the whole answer, and this file says so for the same reason `bma-probe.mjs` does.**
`List` proves the namespace is reachable; it does not prove `CreateHarness` will succeed, which
additionally needs an execution role that `bedrock-agentcore.amazonaws.com` can assume. The sharp
test is the real `CreateHarness` on Nov 21 — but a `List` that comes back clean on Nov 20 is worth
a night's sleep, and a `List` that comes back blocked saves eleven days.

**If another lane does want this in `scripts/`**, the exact change to `bma-probe.mjs` would be: add
`'bedrock-agentcore'` as a second `SERVICE` with host `bedrock-agentcore-control.<region>.amazonaws.com`,
replace `BMA_REGIONS` with the AgentCore region list, and swap the path for `/runtimes`. The SigV4
signer, the `verdict()` structure and `networkFailure()` are all reusable as they stand — they are
the valuable half of that file and they are service-agnostic. **But the two `aws` commands above do
the job for free, so this is listed as a possibility, not a recommendation.**

### 7.7 Risks that are NOT on this list, and why

- **NAT gateway / VPC cost.** Retired. `networkMode: PUBLIC`, documented, no VPC on either track.
- **Region.** Retired. `ap-south-1` has everything required (§2).
- **Guardrail unsupported.** Retired. Supported on both tracks with the same stop reason (§4).
- **The model being coupled to the guardrail.** Retired — that was a `bedrock-mantle` constraint.
- **A self-hosted exec server a judge's live URL depends on.** Retired. That was option C only.
- **Preview access changing during the 45-day judging window** (`COST-MODEL.md` §5). Retired:
  AgentCore harness is GA, not preview.

---

## 8. Sources, all read 2026-11-20

All `docs.aws.amazon.com/bedrock-agentcore/latest/devguide/` unless noted. The `.md` suffix serves a
plain-text version of each page; the `.html` versions are JavaScript-rendered and return only a
title to a fetcher, which is worth knowing for the next session.

- `harness-vs-runtime.html` — the conceptual split and the feature grid. **The decisive page.**
- `harness.html` — what the harness is; GA across the regions table; "no separate harness charge".
- `harness-tools.html` — the five tool types; **inline functions**; `allowedTools` and the wildcard
  warning; the ~3,000-token built-in overhead; Gateway attachment.
- `harness-models.html` — per-invocation overrides; **Apply Amazon Bedrock Guardrails**; the Claude
  Opus 5 service default; automatic prompt caching; `apiFormat` and the `bedrock-mantle` note.
- `harness-operations.html` — the cost formula; the limits table with defaults and ranges;
  `CreateHarness`/`UpdateHarness` CloudTrail names; "Managed Memory is enabled by default".
- `runtime-service-contract.html` + `runtime-http-protocol-contract.html` — protocols, ports, the
  `/invocations` and `/ping` contract, ping status values, the error table incl. **424
  RuntimeClientError**.
- `getting-started-custom.html` — "a custom agent is an agent built without using the AgentCore
  Python SDK"; the ARM64/ECR/`CreateAgentRuntime` path; `networkMode: PUBLIC`.
- `runtime-how-it-works.html` — sessions (15-min idle, 8-hour max); platform versions V1/V2 and
  V2's region list incl. `ap-south-1`; resource configurations and how they bill.
- `runtime-troubleshooting.html` — the `AccessDeniedException` causes (**two, neither an
  allowlist**); MMDSv2 since 2026-06-30; the `time_of_last_update` session leak; CodeBuild for
  ARM64; image size limits.
- `agentcore-regions.html` — the 22-region feature table.
- `gateway-add-target-lambda.html` — the Lambda target event/context shape, `ToolDefinition`, the
  tool-name prefix, propagated headers.
- `aws.amazon.com/bedrock/agentcore/pricing` — all rates in §5.1.

**One AWS statement is relied on but was read through search rather than fetched directly**, and is
marked as such wherever used: that CloudWatch Transaction Search ingest rates apply to AgentCore
Observability traces. It affects two cents and no decision.

---

## 9. Track A is built — and three things about it are deliberately different

Added 2026-11-20 after the coordinator chose Track A. The build is in `backend/agentcore/`
(`harness-config.mjs`, `handoff.mjs`) with 57 new tests plus the 21 Track B ones;
`backend/agentcore/README.md` is the reviewable artefact and marks every property name VERIFIED or
UNVERIFIED. **Nothing was run against AWS.**

Every property in `tests/unit/chat-loop.test.mjs` that belongs to the loop was re-proved against the
new one, corpus-first — including the two the 2026-11-19 passes paid for: that a capped reply is
`reply_truncated` and not `tool_use_without_stop_reason` *even when it carries a half-built `toolUse`
block*, and that `guardrail_intervened` is the literal stop reason layer 2 is attributed from. Three
things are not the same, and none of them is a quiet change:

**1. Stop reasons are an allow-list, so an unknown one fails closed.** `runToolLoop` reads "not
`tool_use`" as a finished answer. That gap *is* the `reply_truncated` defect: a capped reply came
back as text and would have been scored a pass. `handoff.mjs` handles each stop reason by name and
anything unrecognised — **including an absent one** — is `unknown_stop_reason`. On a stream, no
`messageStop` means the stream ended without ever saying it was done, which is not a finished reply.
This is the one row where the ported corpus deliberately **differs** from `chat-loop.test.mjs`,
which expects an absent stop reason to be a finished reply; the test says so in place.

*The cost of this choice, stated:* if the harness spells its finish reason as something other than
`end_turn` or `stop_sequence`, **every turn fails** with `unknown_stop_reason` on the first live
invoke. That is loud, one line to fix, and the right direction to be wrong in — but it is a new
SWAP POINT for Nov 22–23 and it belongs on that list.

**2. The ordering defect is now structural rather than positional.** The loop switches on the stop
reason and only reads `content` inside a branch, so "did the cap land inside a tool call?" can no
longer be answered in the wrong order by a later edit. The old fix depended on two `if`s staying in
the right sequence.

**3. One `chat-loop` property is retired rather than ported.** "The assistant turn we send back
carries our role, whatever role the response claimed" has nothing to guard here: AWS states the
harness "stores the authoritative assistant `toolUse` and pending execution in that session" and the
follow-up "needs only the matching user `toolResult`", so **we never build an assistant turn at
all.** A test pins the absence (`no assistant turn must ever be sent`) so a later edit cannot
reintroduce an echoed `output.message.role`.

### What the harness contract could NOT carry, and what was done instead

Nothing in the security model. One thing in the wording, and it is reported rather than worked
around: `TOOL_FAILED` and `toolUnavailable()` are module-private in
`backend/functions/chat/orchestrate.mjs`, a file this lane does not own, so `handoff.mjs` carries a
second copy. Two copies of a safety sentence is how a rule stops being the rule, so a drift test
reads that file and asserts the originals are still in it character for character. **The one-line
fix is in §10.**

### And one thing the build found that the plan had not

`allowedTools` is set on the *harness*, and the harness is one resource, while `tools` is supplied
per *invocation*. So `allowedTools` has to be the **union** of all three roles' tool names. That is
safe — per-invocation `tools` decides what exists and `allowedTools` only filters what may be
selected from it, so a student session is still never told `recordFee` is a word — but it is not
what §3.1 implied, and whether `allowedTools` is also overridable per invocation is
**[unverifiable offline]** (`API_InvokeHarness.html`). If it is, tightening it per role is a free
extra fence.

---

## 10. Changes needed in files this lane does not own

Reported, not made. Three trees are live with other lanes.

### `backend/functions/chat/index.mjs` — the wiring

1. **Add `invokeViaHarness`** beside `invokeAgent` (option A) and `invokeViaLoop` (option B), and
   select it the way `USE_AGENT_SERVICE` already selects between the other two. It calls
   `runHarnessTurn` from `backend/agentcore/handoff.mjs` with `deps: { invokeHarness, invokeTool }`
   — **the existing `invokeTool`, unchanged.** That is what keeps `auth.mjs` and the three action
   Lambdas at zero lines changed.
2. **Add the stream reader.** `invokeHarness` must call `InvokeHarness` and turn its response into
   the event array `assembleStream` consumes — one `for await` over the SDK stream, collecting the
   raw events. Field names **[unverifiable offline]**; `README.md` §2 lists them as UNVERIFIED.
3. **Export `TOOL_FAILED` and `toolUnavailable`** from `orchestrate.mjs` (two `export` keywords) and
   import them in `handoff.mjs`, deleting the duplicate. §9 explains why this is worth doing.
4. **`runtimeSessionId` must be at least 33 characters.** `${sub}-${today}` is ~47 with a Cognito
   sub, so this is fine today — but the `claims?.sub ?? 'anon'` fallback would produce
   `anon-2026-11-20`, which is 15. `handleChat` returns 401 before invoking when there is no `sub`,
   so it is unreachable; it is named because it is a one-line hardening in a file I cannot edit.

### `backend/template.yaml` — the IAM and the parameters

1. **Add `bedrock-agentcore:InvokeHarness`** on the harness ARN to the chat Lambda's role.
2. **Do NOT add `bedrock-agentcore:InvokeAgentRuntimeCommand`** or
   `...CommandShell`. AWS: *"To prevent direct command execution, do not grant
   `bedrock-agentcore:InvokeAgentRuntimeCommand` in your IAM policies."* Either one executes
   commands **without passing through the LLM**, routing around every restriction in
   `allowedTools`. This is the sharpest IAM line in the whole change.
3. **`bedrock:InvokeModel` and `bedrock:ApplyGuardrail` move** off the chat Lambda's role and onto
   the harness execution role — the harness makes the model call now. Leaving them costs nothing
   but widens the Lambda for no reason.
4. **Two new parameters**, `HarnessId` and `HarnessArn`, alongside the existing `BedrockAgentId`
   placeholder pattern, so the orchestrator choice stays a deploy-time decision.
5. The harness execution role itself is **not** a template resource unless someone wants it to be —
   `CreateHarness` is run by hand on Nov 21 and the role has to exist first. `execution-role-policy.json`
   is the body.

### `tests/unit/cost-guards.test.mjs` — one line

`COSTS_NOTHING_IDLE` would need nothing new (no AgentCore resource is in the template), but if
`HarnessId`/`HarnessArn` are added as parameters, the `Parameters` reader in that file will see them
and should be checked. Named so it is not a surprise.

### `docs/COST-MODEL.md` — the session lead has these

The NAT-gateway row in §4 item 1 comes off the table on this path, and the "BMA preview access"
availability risk in §5 does not apply to a GA service. Both already handed over.
