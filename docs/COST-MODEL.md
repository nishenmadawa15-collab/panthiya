# Cost model — re-costed for the judging window

**Written 2026-11-19, from `backend/template.yaml` rather than from the earlier estimate.**
`.kiro/specs/panthiya/design.md` §10 carries the summary and the decisions; this file carries the
enumeration, the price basis for every row, and the sources. Where a price could not be verified
today it is marked **[unverified]** and the row says what it would take to settle it.

Nothing is deployed and **$0 has been spent**, so every figure below is forward-looking.

---

## 0. Why the old number was the wrong number — and why it still comes in under budget

The earlier table totalled ~$7 for a demo. Kiroween requires the project to stay available to
judges *"free of charge and without any restriction, for testing, evaluation and use ... until the
Judging Period ends"*, and judging runs **2026-12-16 → 2027-01-29** (`docs/SUBMISSION-KIROWEEN.md`
§0). So the stack has to stay up from submission through 2027-01-29 — **71 days, 1,704 hours** —
and §10's own warning said the thing that decides the real total is whatever bills per hour rather
than per request.

**It was right to ask and wrong about the answer.** Enumerating all 28 resources in the template
found **nothing that bills per hour, per month, or per provisioned unit.** The two candidates the
docs named are both false for this template:

| Candidate | What the template actually has |
|---|---|
| **The Cognito hosted-UI domain** "bills hourly whether or not anyone signs in" | `AWS::Cognito::UserPoolDomain` is a prefix domain. **No AWS document prices a user pool domain at all** — not the prefix one, not a custom one. Cognito bills per *monthly active user* under the pool's feature plan, and the pool gets 10,000 free MAUs a month. Three demo users and a handful of judges is **$0.00** |
| **A NAT gateway** on the BMA/AgentCore path | **There is no VPC, subnet, NAT gateway, EIP or `VpcConfig` anywhere in the template** (pinned by `tests/unit/cost-guards.test.mjs`). The NAT risk is real but belongs to the *supplied AgentCore CDK bundle* (`docs/NEXT-SESSION.md` §0a), i.e. to a decision not yet taken — and if taken, it costs **$77–$95 over this window on its own, 5–6× the whole budget** |

So the correction runs the other way: **ten weeks of availability is close to free, and the budget
is not duration-bound at all. It is model-price-bound.** The thing that can break $15 is which
model answers a chat turn, and whether anything gets put in a VPC.

---

## 1. Every resource the stack creates, split by how it bills

28 resources, counted from `backend/template.yaml`.

### Per-request — near zero while idle

| Resource | Count | Price basis |
|---|---|---|
| `AWS::DynamoDB::Table`, `PAY_PER_REQUEST`, SSE on, PITR off | 8 (+9 GSIs, all `ProjectionType: ALL`) | On-demand: no capacity charge at all while idle. Writes/reads billed per request unit |
| `AWS::Serverless::Function`, nodejs20.x, arm64, 256 MB | 8 | $0.20/M requests + ~$0.0000133/GB-s (arm64, us-east-1). A chat turn is 3 invocations ≈ $0.00001 |
| `AWS::Serverless::HttpApi` + Cognito JWT authorizer, throttled 10 rps / 20 burst | 1 | $1.00 per million requests, first 300M (us-east-1) |
| `AWS::Lambda::Permission` (Bedrock → the three action groups) | 3 | Free |
| Bedrock model inference (out of template, `ModelId` parameter) | — | Nova Lite $0.06/M input, $0.24/M output **[unverified today — the Bedrock pricing page is JS-rendered and the fetch returned no Nova rows; these are the published figures the earlier estimate also used]** |
| Bedrock Guardrails, the four policy types in `backend/agent/guardrail.json` | — | Content filters **$0.15**/1,000 text units, denied topics **$0.15**, sensitive-information (PII) **$0.10** [second source, conflicting currency], word filters **free**. 1 text unit ≤ 1,000 chars, partial units round up, input and output billed separately |
| Transcribe batch jobs | — | 60 min/month free for 12 months from the first request; thereafter the pricing page's worked example is **$0.006/min** for us-east-1 **[ap-south-1 rate unverified]** |

### Per hour or per month regardless of traffic — the category that was supposed to eat the budget

| Resource | What it actually costs idle | Price basis |
|---|---|---|
| **Nothing hourly.** No VPC, NAT gateway, EIP, load balancer, RDS, ElastiCache, OpenSearch, MSK, provisioned DynamoDB capacity, provisioned Lambda concurrency, or Bedrock provisioned throughput | **$0.00** | Verified by enumeration and pinned by a test |
| DynamoDB **storage**, 8 tables + 9 full-projection GSIs | **< $0.01/month** — the demo seed is a few hundred rows, well under 1 MB even with every GSI projecting everything | $0.25/GB-month (standard class); ap-south-1 slightly higher **[unverified]** |
| **CloudWatch Logs** — eight implicit log groups, **no `RetentionInDays` anywhere in the template, so logs never expire** | **$0.01–$0.07 over the window.** Real, and the only line that grows with nothing but time | $0.50/GB ingest, $0.03/GB-month storage (us-east-1). ap-south-1 ingest reported at ~$0.67/GB by a third party **[unverified]** |
| S3 voice bucket | **$0.00** — the 1-day lifecycle rule keeps steady state under ~10 MB | $0.023/GB-month (us-east-1), $0.025 (ap-south-1) |
| SAM managed artifact bucket — created by `sam deploy`, *not* in this template, versioned | **< $0.01** for a few hundred KB per deploy | Same S3 rate |
| Cognito user pool, app client, 3 groups, prefix domain | **$0.00** | `UserPoolTier` is not set, so the pool defaults to **Essentials**; Lite and Essentials both include **10,000 free MAUs per month per account**. The classic hosted UI (what this template's domain serves) is available on every tier. No document prices the domain itself |
| Bedrock guardrail and the hand-made agent (out of template) | **$0.00** standing | Billed per text unit / per token when called; nothing provisioned |
| `AWS::Budgets::Budget` (new, §2 below) | **$0.00** | Budgets without a Budgets *Action* are free; the first two action-enabled budgets are free and later ones are $0.10/day. This one has no action |
| Amplify Hosting (another lane's resource, included so the total is honest) | **$0.00** under the 12-month free tier (1,000 build min, 5 GB stored, 15 GB served per month), else ~$0.50 over the window | Amplify pricing / AWS Free Tier page. **The free tier is a 12-month new-account window — if this account is older, this line is real** |

### One-off

| Item | Spent | Still to come |
|---|---|---|
| Build-period inference (Sinhala gate, smoke tests, rehearsals) | **$0.00** | ~300 turns |
| Live red-team sweep, 36 cases × ~25 runs | **$0.00** | ~900 turns |
| Voice notes recorded during the build | **$0.00** | ~60 min |
| Deploys (CloudFormation, native resource types only) | **$0.00** | Free |

---

## 2. What a chat turn costs, which is the only number that matters

Per turn, with the guards that are actually in the code: `maxTokens: 1024` flat, a 2,000-character
input limit, `MAX_TOOL_TURNS = 4` (so up to five model calls per message — the figures below are
the per-model-call ceiling).

| Component | Typical | Ceiling |
|---|---|---|
| Nova Lite inference, ~1,200 in + up to 1,024 out | $0.00032 | $0.00032 |
| Guardrail, input + output, 3 billed policies at $0.40/1,000 text units | $0.0008 (2 units) | $0.0028 (7 units) |
| Lambda + DynamoDB + API Gateway | $0.00001 | $0.00002 |
| **Per turn** | **~$0.0011** | **~$0.0032** |

**Layer 2 costs two to nine times what the model costs.** That is the single most surprising line
in this exercise, and it is not a reason to weaken the guardrail — see the cut list.

---

## 3. The three totals

Window: **2026-11-19 → 2027-01-29, 71 days**, of which the judging period is 45 days
(2026-12-16 → 2027-01-29) and the build period is 15 days (to the 2026-12-04 deadline). The 12-day
gap between them is pure idle.

| Line | Typical | Ceiling |
|---|---|---|
| **Idle hosting, whole 71 days** (DynamoDB storage + CloudWatch Logs + S3 + Cognito + Amplify) | **$0.02** | **$0.60** |
| Build period: Sinhala gate + smoke, ~50 turns | $0.06 | $0.16 |
| Build period: live red team, 36 × 25 = ~900 turns | $1.00 | $2.90 |
| Build period: demo rehearsals and video takes, ~250 turns | $0.28 | $0.80 |
| Build period: Transcribe, ~60 min | $0.00 (free tier) | $1.44 **[unverified rate]** |
| Judging window: judge traffic, budgeted at 1,000 turns | $1.10 | $3.20 |
| Judging window: Transcribe, ~30 min | $0.00 (free tier) | $0.72 **[unverified rate]** |
| **Submission → 2027-01-29** | **~$2.50** | **~$9.80** |

| Answer | Figure |
|---|---|
| **Idle cost per month** | **$0.01–$0.26/month** (midpoint ~$0.05). The whole 71 days of required availability costs **under $0.60** |
| **Submission → 2027-01-29 total** | **~$2.50 typical, ~$9.80 ceiling** |
| **Headroom against US$15** | **~$12.50 typical, ~$5.20 at the ceiling** |

**The honest total does not exceed $15 — on the stack as it stands, on Nova Lite, in one region.**
What exceeds $15 is a decision not yet taken.

### Region makes a difference of cents, not dollars

`ap-south-1` prices run roughly 10–35% above `us-east-1` on the lines that could be checked (S3
$0.025 vs $0.023/GB-month; CloudWatch ingest ~$0.67 vs $0.50/GB **[third-party, unverified]**).
Every one of those lines rounds to under a dime over the window, so **the region decision in
`docs/NEXT-SESSION.md` §0a should be made on service availability and latency, not on cost.**
Option C's move to `us-east-1` neither saves nor costs anything measurable.

---

## 4. What would take it over $15, and what to cut

Listed because a table engineered to come in under budget would be worth nothing.

| # | What | Over the 71-day window |
|---|---|---|
| 1 | **Any NAT gateway** — e.g. the AgentCore Runtime CDK bundle on option A or C | **$77–$95** at $0.045–$0.056/hr, plus $0.045/GB processed. **5–6× the entire budget, before any traffic** |
| 2 | **Option C's model.** A GPT-5-class OpenAI model at ~$1.25/M in and ~$10/M out **[list price, unverified for the `bedrock-mantle` endpoint]** makes a turn ~$0.0125 instead of ~$0.0011 | ~**$27** for the same 2,200 turns — **over budget on inference alone** |
| 3 | **A paid host for the option-C exec server.** A `t4g.small` is ~$0.0168/hr | ~**$29**. $0 only if it runs on Nishen's own machine — and then the live URL a judge opens works only while that machine is on, which is a **rules** problem, not a cost one |
| 4 | Judge traffic far above the 1,000-turn budget | 10,000 turns is still only ~$11 on Nova Lite, ~$125 on a GPT-5-class model |

**The cut list, in order:**

1. **No VPC, no NAT.** If option A or C is chosen, take the documented AgentCore CLI path, which
   runs without VPC access by default, not the CDK bundle. This is the whole ball game.
2. **Keep Nova Lite (or Nova Micro) for the live app.** If the challenge requires an OpenAI model
   via BMA, use it for the demo video and the one submitted red-team run, and leave the model the
   judges' live traffic hits on the cheap one. Decision 4 and the Sinhala gate drive this anyway.
3. **Tighten the throttle before judging, not after.** `ThrottlingRateLimit: 10` / burst 20 is a
   per-second limit with no daily cap — 10 rps sustained for an hour is 36,000 turns. The cheap
   guard is a lower rate limit plus an API Gateway usage plan quota; neither exists today.
4. **Cut the live red-team sweep from 25 runs to 5** if money gets tight. Saves $0.80–$2.30, and
   the 36 offline policy tests run free on every save regardless.
5. **Add `RetentionInDays: 7`** to the log groups. Worth pennies, but it is the only line that
   grows with nothing but elapsed time, and nobody reads a December Lambda log in February.
6. **Do not cut guardrail policies to save text-unit charges**, even though layer 2 is the largest
   per-turn line. It is the safety control this submission is about. Named here so that the
   temptation is on the record as rejected.
7. **Do not tear the stack down before 2027-01-29.** The rules forbid it and it saves under $0.60.

---

## 5. The compliance read — what a judge would actually hit

The rule is that the project stays usable, so anything that stops working after N days is a
compliance question and not only a cost one.

| Thing | Breaks "available for testing"? | Read |
|---|---|---|
| **`redteam_runs` TTL, 30 days** (`TimeToLiveSpecification` on the table; `expiresAt` written by `backend/functions/redteam/runner.mjs`, `TTL_DAYS = 30`) | **No — but it silently deletes the submitted evidence.** | The feature keeps working: a judge can start a fresh run and see fresh rows. What disappears is history. A run recorded on 2026-12-03 expires **2027-01-02, twenty-seven days before judging ends**, so a judge opening `/redteam` in mid-January sees an empty list where the write-up says 36 cases were scored. **Fix: one line, `TTL_DAYS = 30` → `120`**, in a file this lane does not own. And the justification for 30 days does not survive contact with the numbers: 900 rows is about 1 MB, so **this TTL is worth $0.00/month as a cost guard** and the decision should be made on privacy grounds alone |
| **S3 voice notes, `ExpirationInDays: 1`** on the `voice/` prefix | **No.** | A voice note is transient input to a transcription that completes in the same request; nothing in the app reads the object again afterwards. The rule is a privacy control first and a cost guard second, and both arguments point the same way. Keep it. (Lifecycle expiry is asynchronous and "after 1 day", so an object always outlives the minutes-long job that reads it.) |
| **Demo account passwords** | **No — verified.** | `scripts/demo-users.mjs` sets them with `admin-set-user-password --permanent`, so they are not `FORCE_CHANGE_PASSWORD` temporaries. Had they been, the default 7-day temporary-password validity would have locked judges out in the second week of December. This is the classic version of this bug and it is already avoided |
| **Refresh token validity, 1 day** | No | A judge who returns the next day signs in again. Ordinary behaviour for a hosted-UI app |
| **BMA preview access** (option C only) | **Yes — the only genuine availability risk on this list.** | A public-preview service can change its gate, its model list or its endpoint during a 45-day judging window, and `docs/NEXT-SESSION.md` §0a already records that AWS's own pages disagree about whether the preview is public or limited. Options A and B have no equivalent exposure |
| **A self-hosted exec server** (option C only) | **Yes.** | The live URL works only while that host runs. Ten weeks of uptime on a laptop is not a thing to promise judges |
| **Transcribe and Amplify 12-month free-tier windows** | No | Cost only, and both are cents at this scale. But the window is per *account*, not per project, so it may already be spent |

---

## 6. Sources, all read 2026-11-19

- `AWS::Budgets::Budget`, `BudgetData` and `Notification` CloudFormation reference —
  `docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-budgets-budget.html`
  (and `-budgetdata`, `-notification`). `Budget` is the only required top-level property;
  `BudgetType` and `TimeUnit` are required inside it; `BudgetLimit` is required for a `COST`
  budget; `CostFilters` is optional and typed `Json`.
- AWS Budgets pricing — `aws.amazon.com/aws-cost-management/aws-budgets/pricing`. Budgets without
  actions are free; the per-budget-day charge was removed in October 2020.
- Service Authorization Reference, AWS Budget Service — `budgets:ModifyBudget` creates and
  modifies, `budgets:ViewBudget` reads; older account-level policies also gate these behind
  `aws-portal:ModifyBilling`.
- Cognito user pool feature plans —
  `docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html`: *"The
  default plan selection for new user pools is Essentials"*, and *"Managed login is available in
  the Essentials and Plus tiers. The classic hosted UI is available in all feature tiers."*
- Cognito pricing — `aws.amazon.com/cognito/pricing`: Lite and Essentials each include 10,000 MAUs
  per month free; Essentials $0.015/MAU thereafter.
- Configuring a user pool domain —
  `docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-assign-domain.html`: the
  page lists every consideration for prefix and custom domains and **prices neither**.
- Bedrock Guardrails price reduction (December 2024) — content filters to $0.15 and denied topics
  to $0.15 per 1,000 text units; word filters and regex-based sensitive-information filters free.
- Amazon Transcribe pricing — `aws.amazon.com/transcribe/pricing`: 60 minutes/month free for 12
  months from the first transcription request, billed in one-second increments.
- Amplify Hosting pricing and the AWS Free Tier web-apps page — 1,000 build minutes, 5 GB stored
  and 15 GB served per month, free for 12 months.
- CloudWatch pricing, API Gateway pricing, DynamoDB pricing, S3 pricing — us-east-1 figures as
  quoted in the tables above; the `ap-south-1` equivalents could not be read from AWS's own pages
  today and are marked where used.

**No `aws` or `sam` command was run to produce any of this.** Every figure is either read from a
published price or derived from `backend/template.yaml`, and the derivation is pinned by
`tests/unit/cost-guards.test.mjs`.
