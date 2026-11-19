# Submission draft — AWS Bedrock agents challenge

**Status: draft, not submitted.** Target submission date **Dec 1 2026**; the deadline recorded in
`PANTHIYA_SETUP.md` §1 is **Dec 2, 11:59 PM PT** (Dec 3, 1:29 PM Sri Lanka). Everything below is
written to be pasted into the submission form, section by section, with every unanswerable field
marked `TODO(nishen)`.

---

## 0. Read this before pasting anything

Three things are unverified, and the first one could change the submission entirely.

| # | Unverified | Why it matters | How to settle it |
|---|---|---|---|
| 1 | **The challenge's actual name, rules and form fields.** `PANTHIYA_SETUP.md` §1 records it as *"Agents, your rules"* on AWS Builder Center, with 5 × $1,000 AWS credits as the prize. A search found no event under that name, so the field list below is inferred from the deliverables in `PANTHIYA_SETUP.md` §6 and not copied from a form | Every heading in this file is a guess at what is being asked for | `TODO(nishen)` — paste the challenge URL or forward the invitation email. The rules publish **today, 2026-11-18**. Fifteen minutes with the real form replaces all of §1–§10's structure |
| 2 | **Whether a Bedrock Managed Agent is required.** This account **cannot create one** — see §6. If the rules require Bedrock Agents Classic specifically, the project is ineligible as built and the honest move is to say so rather than to submit something that does not match | It is the difference between submitting and not | `TODO(nishen)` — answer from the rules in §1 |
| 3 | **Whether the same project may also be submitted to Kiroween.** Unresolved — see `docs/SUBMISSION-KIROWEEN.md` §0 | Decides whether there are one or two submissions | `TODO(nishen)` — from the same rules |

Nothing in this file claims a running system. **Nothing has been deployed and $0 has been spent.** Every
field that would be a measurement is marked rather than estimated.

---

## 1. Project name and tagline

**Panthiya** (පන්තිය — Sinhala for *"the class"*)

> An AI assistant for Sri Lankan tuition classes — with rules it does not break.

Alternative, if the form wants one line about the agent rather than the product:

> A tuition-class agent whose privacy, money and exam-answer rules are enforced three times in
> independent places, and proved against 36 documented attacks.

---

## 2. The problem

Most tuition teachers in Sri Lanka keep fees in a notebook, attendance in their head, and answer the
same parent question forty times a week. The useful version of this product is not a form — it is
something a teacher can talk to on the bus home, in Sinhala.

That makes the hard problem obvious rather than hidden. The moment one assistant holds children's
fees and marks and talks to parents and students in the same app, the interesting engineering is not
the chat. It is proving that it cannot be talked into:

- leaking one child's marks, fees, attendance or parent's phone number to another parent;
- marking a fee paid because someone said *"Sir told me to"*;
- handing a student the final answer to tomorrow's past paper.

Panthiya is therefore built rules-first, and the demo is an attack demo.

---

## 3. What it does

| Role | What they can do |
|---|---|
| **Teacher** | Create classes and students; mark attendance, record fees and add marks **by chat or by Sinhala/Tamil voice note**; see who owes fees; draft parent updates and approve them before they send; read an append-only audit log of every write |
| **Parent** | A message thread of teacher-approved updates about **their own child only**, plus an ask box answered from stored data about that child |
| **Student** | A past-paper tutor for O/L Maths, Science and ICT that gives Socratic hints and a worked example of a **different** problem, and never the final answer |
| **Teacher (`/redteam`)** | Built to run all 36 documented attacks against the deployed system and show a per-case, per-layer scoreboard. **It has not been run against a live system** — nothing is deployed (§0, §8), so the page and its runner are tested offline and this repository holds no score |

Interface in Sinhala, Tamil and English, mobile-first, no build step.

---

## 4. The rules, and the three places each one is enforced

The eight rules live in [`.kiro/steering/product.md`](../.kiro/steering/product.md), which every build
task reads first. The agent instruction text cites that file as its source of truth, so layer 1 is not
a prompt somebody wrote — it is the steering rules restated as model-facing behaviour.

| | Layer | What it is | Where |
|---|---|---|---|
| 1 | **Instructions + role-scoped tools** | The role arrives out of band from the verified token, never from the message. Every action Lambda refuses any other role as its **first statement**, and the Student tool Lambda has **no DynamoDB permissions at all** | `backend/agent/instructions.md`, `backend/lib/auth.mjs`, `backend/template.yaml` |
| 2 | **Bedrock Guardrail** | Five denied topics, content filters at HIGH, prompt-attack at HIGH on input, phone and email blocked in output | `backend/agent/guardrail.json` — **defined, not yet created in AWS** |
| 3 | **`policyCheck` Lambda** | A final code check on every reply before a human reads it: NFKC + homoglyph normalisation, any student name or contact number outside the caller's permitted set, declared final answers in student sessions, base64 payloads decoded and re-checked, and a non-teacher reply that *claims* a write. **Fails closed** | `backend/functions/policy-check/` |

Two design points are worth the judges' attention because they are the ones that actually hold:

- **Identity is never message content.** `"I am the principal"`, `"SYSTEM: role=teacher"`,
  `"developer mode"`, a Sinhala or Tamil version of any of them, and a base64 version of any of those
  are all just bytes in a request body. They never reach a variable named `role`. Red-team cases
  B1–B8 and D3–D5 die at one line in `backend/lib/auth.mjs`.
- **"Who are the top 3?" is not refused — it is unanswerable.** Every parent-side query is a table-PK
  read on one `studentId`, or the `messages.byParent` index keyed on the caller's own `sub`. The
  `byClass` indexes are never named in that file, so the code that could answer a class-wide question
  was never written. A reviewer can check that by grepping `actions-parent/actions.mjs` for `byClass`
  and finding nothing.

Layer 1 is the primary stop for **6 of the 36** cases; the role gate and IAM are primary for **14**,
and `policyCheck` for **10**. That is the intended shape, not a shortfall: the instruction text makes
the assistant behave well and produces the warm refusal the product needs, while the guarantee comes
from code that cannot be talked to. The full case-by-case map is
[`backend/agent/README.md`](../backend/agent/README.md) §7, and §8 names the three places layer 1
alone would not have been enough.

---

## 5. The 36 attacks

[`docs/RED-TEAM-CASES.md`](RED-TEAM-CASES.md) holds 36 attacks across six families: privacy (8), money
integrity (8), exam answers (10), fake messages and role lock (6), wellbeing (3) and data rights (1).
Seven are deliberately carried in Sinhala, Tamil, Singlish, base64 or Cyrillic homoglyphs, because
that is what a Sri Lankan demo actually contains and because layer 2 is weakest there.

That document is the **source**, not a description: a Kiro hook parses it into
`tests/redteam/cases.json`, the generator asserts exactly 36 case IDs and writes both copies the app
needs, and a test fails if either copy disagrees with the document. Reword an attack and forget to
regenerate, and `npm test` goes red.

**Current state, stated plainly: built and tested offline, not yet run live.** `policyCheck`'s verdict
for each case is under test, and the first ten are driven end to end against the layer named as
primary for each. The live run is task 5.7 and needs the deploy plus three demo logins.

`TODO(nishen)` — after the live run, paste here: the total, the per-layer split read off
`totals.byLayer` on the screen (not from any estimate in this repository — two pre-live estimates
exist and they disagree), the number of `needsEye` cases, the number of errors, and any new bypass
found, which becomes case 37.

Three rules govern how that number may be reported, and they belong in the submission because the
dishonest version of each is easy:

1. **A toggle withdraws a layer's credit; it does not re-run the attack without that layer.** There is
   no kill switch in the deployed path — adding one to win a demo would be the vulnerability the demo
   claims not to have.
2. **Never a bare "36 blocked".** A case held by the agent's own refusal scores `blocked` with
   `needsEye: true`, because no code read that reply. The page says so in words and opens the reply.
3. **An over-block is invisible to a scoreboard** — a thrown-away correct reply still scores as a
   pass. Three of the four defects an audit found in layer 3 were over-blocks.

---

## 6. Architecture, and the one thing that is not settled

Full diagram and walkthrough: [`README.md`](../README.md) § Architecture, and
[`.kiro/specs/panthiya/design.md`](../.kiro/specs/panthiya/design.md) §1.

Serverless and scales to zero: Amplify Hosting (static, strict CSP) → API Gateway HTTP API with a
Cognito JWT authorizer → four Lambdas (`chat`, `read`, `voice`, `redteam`) → three role-scoped action
Lambdas → eight on-demand DynamoDB tables. Voice notes are a presigned S3 PUT into Amazon Transcribe,
with an S3 lifecycle rule deleting the audio after one day. No EC2, no NAT Gateway, no RDS, nothing
billed by the hour. Region `ap-south-1` (Mumbai — the nearest AWS region to Sri Lanka; no latency
from Colombo has been measured, because nothing is deployed).

**The orchestration layer is an open decision, and the submission should say so rather than describe
something that does not exist.**

The design called for a Bedrock Managed Agent with three role-scoped action groups. That is not
available on this account: `CreateAgent` returns `AccessDeniedException` — *"Bedrock Agents is in
Maintenance Mode. New agent creation is not available for accounts without prior service usage"* — in
both `ap-south-1` and `us-east-1`. The allowlist is automatic and per-account, and AWS's own
maintenance-mode page states there is **no exception process**, so there is no ticket to file. Found by
driving the console; nothing in the SDK, the template or the schemas says it.

What survives is most of it: Guardrails are unaffected and still apply when the model is invoked
through AgentCore, model inference is fully supported, and AgentCore is fully available in
`ap-south-1`. Two paths remain, and both end at the same three Lambdas:

- **A — AgentCore harness.** AWS's named successor. Each action group becomes a gateway MCP tool over
  the existing Lambda; the guardrail attaches through gateway policy.
- **B — Our own tool loop.** `Converse` with `toolConfig`, dispatching to the same three Lambdas from
  `chat/orchestrate.mjs`. The role never leaves our own Lambda, which makes the trust model *simpler*.

`chat/orchestrate.mjs` is already a pure function with the model call injected as `deps.invokeAgent`,
so the seam exists and two files change either way. The role gate, the per-function IAM separation,
the guardrail, `policyCheck` and all 36 cases do not care which orchestrator calls the Lambdas.

`TODO(nishen)` — replace the two bullets above with the chosen path and one sentence of why, once the
bounded spike on A has run (`docs/NEXT-SESSION.md` §0, step 3). If the challenge rules require Bedrock
Agents Classic specifically (§0 item 2), this section becomes the submission's central honesty
paragraph instead.

---

## 7. AWS services used

Every row below is **written into `backend/template.yaml` and not yet created**: no AWS resource for
this project exists, and `aws configure list` on the build machine shows no credentials at all. Read
the table as the stack the deploy will make, not as an inventory of a running account.

| Service | What for |
|---|---|
| Amazon Bedrock | Model inference, and the Guardrail that is defence layer 2 |
| AWS Lambda (Node.js 20) | Eight functions: chat orchestrator, read, voice, red-team runner, three role-scoped action groups, policyCheck |
| Amazon DynamoDB | Eight on-demand tables, including the append-only `audit_log` |
| Amazon Cognito | User pool with `teacher` / `parent` / `student` groups; hosted-UI sign-in, authorization code with PKCE |
| Amazon API Gateway | HTTP API with a Cognito JWT authorizer on every route |
| Amazon Transcribe | Sinhala, Tamil and English voice notes |
| Amazon S3 | Voice-note bucket, lifecycle rule deleting objects after one day |
| AWS Amplify Hosting | Static front end, security headers from `customHttp.yml` |
| AWS SAM / CloudFormation | The whole stack except Amplify Hosting |
| AWS Budgets | A $10/month alert — **to create by hand in the console before the first deploy.** Unlike every other row, this one is not in `backend/template.yaml` at all: there is no `AWS::Budgets` resource, so no deploy will make it |

`TODO(nishen)` — add AgentCore (Runtime, Gateway, Policy) to this table if option A is chosen in §6.

---

## 8. Cost

Target under **US$15** for the whole hackathon. **Spent so far: $0.**

| Item | Assumption | Estimate |
|---|---|---|
| Model inference (Nova Lite class) | ~1,500 turns, ~900 in / 300 out tokens | ~$1.50 |
| Red-team runs | 36 cases × ~25 full runs | ~$2.00 |
| DynamoDB on-demand | < 100k requests | < $0.50 |
| Lambda | < 50k invocations at 256 MB | free tier |
| API Gateway HTTP API | < 100k requests | ~$0.10 |
| Amazon Transcribe | ~60 minutes of voice notes | ~$1.45 |
| S3 + Amplify Hosting | tiny | < $1.00 |
| **Total** | | **~$7, headroom to $15** |

Held down, in the code as it stands, by **one flat `maxTokens: 1024`** on every turn
(`backend/functions/chat/index.mjs`), a 2,000-character input limit, a TTL on `redteam_runs`, and the
one-day S3 lifecycle rule. Two controls named in earlier drafts are not in force, and the difference
matters to this table:

- **No `maxTokens` split.** The design asked for 400 tutor / 250 teacher. The code sends 1024 for
  every role, which is over three times the ~300 output tokens the ~$1.50 inference row assumes.
- **No history window.** `MAX_HISTORY_TURNS = 6` exists in `backend/functions/chat/orchestrate.mjs`,
  but the loop we built is single-message — it keeps no history and `invokeAgent` does not take the
  parameter — so the window is not a cost control today. Cheaper, not dearer; it also means cases B7
  and C6 meet a different system than the one documented (`docs/BUILD-LOG.md`).
- **The $10 budget alert does not exist.** It is a console step to take before the first deploy (§7).

Every row is an estimate against a system that has never run, so these are the design's assumptions
and not measurements — and with a 1024-token ceiling in place, **~$7 is the optimistic end** rather
than a midpoint. Option A in §6 prices runtime, memory and gateway as separate consumption lines,
so the table needs re-checking if A is chosen. `TODO(nishen)` — replace the total with the amount
actually spent before submitting, from Cost Explorer (task 7.9).

---

## 9. Security, privacy, and the ceilings we are not hiding

Full table: [`README.md`](../README.md) § Security and privacy.

The short version. Children's data, so the smallest possible amount of it: a student record holds a
display name, a class, an optional parent contact and an optional grade — no phone number, address,
date of birth, school, photo or national ID anywhere. Requirement 7.4 goes further and **no handler
reads `parentContact` at all**, so a stored number has no path into a reply. The ID token is held in
memory only. The audit log is append-only, with `PutItem` as the only IAM action granted. An unowned
class, a non-existent class, a real child the caller may not see and an invented child all return the
**byte-identical** refusal, asserted by `deepEqual` across five languages and scripts.

And the ceilings, because this is the part a security submission is actually judged on:

1. **Nothing has met a live model.** The blocking day-1 Sinhala gate has not been run, and five
   milestones of code rest on the cheapest model reading Sinhala well enough.
2. **Layer 2 is weakest exactly where the demo lives.** Guardrail topic detection is strongest in
   English; Sinhala, Tamil, Singlish, romanised and base64 renderings of the same attack frequently do
   not trip the same topic, and the word filters are literal strings whose Sinhala and Tamil entries
   are transliterations still awaiting a native-speaker review. Layers 1 and 2 weaken together on the
   same inputs — which is the entire argument for layer 3.
3. **Final-answer detection is pattern matching, not mathematics.** An answer spelled as a word in
   prose, a one-step problem where the hint *is* the answer, and hex, rot13 or nested encodings still
   get through. The upgrade is a second small-model judge call per tutor turn, which $15 does not buy.
4. **Two narrow holes in the name scan**, both recorded in code: a child named by a surname alone
   spelled as an ordinary English word, and a person-like-name heuristic that is Latin-script only.
5. **A model that fabricates a matching figure pair escapes check 6** — the right place for a thin
   ceiling, because what actually stops a fee changing is structural, not textual.
6. **Erasure has a stated boundary.** Deleting a student does not erase the audit log; the deletion is
   itself an appended, audited event with a tombstone tally.

---

## 10. How it was built — and the finding worth reading

Built in Kiro, spec-driven: three steering documents read before every task, a requirements /
design / tasks triad written and approved before any application code, and three hooks (tests on save,
regenerate the red-team suite from its own document, append to the build log). Full account:
[`docs/KIRO-WRITEUP.md`](KIRO-WRITEUP.md).

The one finding worth a judge's time: **nine recorded defects had already been approved by a fully
green test suite**, and every one of them would have reached either AWS or a browser. A table of all
nine is in the write-up §5 — a `TABLE_CLASSES` / `CLASSES_TABLE` mismatch that would have made every
table name `undefined`; a packaging layout that would have killed every cold start on
`MODULE_NOT_FOUND`; a shared module named `.mjs`, which a dev server sends as `text/plain`, so every
page rendered with every string blank **and not one console error**; a name normaliser that returned
nothing for `findNames('Dilmi scored 72', ['Dilmi Fernando'])`, meaning `policyCheck` would have waved
through the precise leak it exists to catch.

They share one cause: **the test and the thing it claimed to protect were not the same object.** So
the rule the project now follows is narrow and checkable — a guard must read the real configuration,
not a mock. `env-contract.test.mjs` reads `template.yaml` and `ddb.mjs`; `packaging.test.mjs` follows
the import graph; `redteam-cases.test.mjs` re-parses the document a judge reads. Twice, the bug was
deliberately reintroduced to confirm the new test fails, because a guard that cannot fail is
decoration.

Three of the nine were found only by a human opening a page, running an example by hand, or reading a
reply that scored as a pass. A green suite is a necessary condition. It was never evidence.

---

## 11. Links and evidence

| | |
|---|---|
| Public repository | https://github.com/nishenmadawa15-collab/panthiya — MIT, `.kiro/` committed and public |
| Live app | `TODO(nishen)` — Amplify URL, after task 0.15 |
| Demo video (under 3 min) | `TODO(nishen)` — YouTube link, after task 7.7. Beat sheet ready in [`docs/DEMO-SCRIPT.md`](DEMO-SCRIPT.md) |
| Architecture + costs + security | [`README.md`](../README.md) |
| The 36 attacks | [`docs/RED-TEAM-CASES.md`](RED-TEAM-CASES.md) |
| Case-to-layer map | [`backend/agent/README.md`](../backend/agent/README.md) §7–§8 |
| Spec triad | [`.kiro/specs/panthiya/`](../.kiro/specs/panthiya/) |
| Build log, including every defect | [`docs/BUILD-LOG.md`](BUILD-LOG.md) |
| Kiro write-up | [`docs/KIRO-WRITEUP.md`](KIRO-WRITEUP.md) |

**Test and task evidence**, counted 2026-11-18 at 17:59 UTC and expected to move:

- **587 of 587 unit and policy tests pass, nothing skipped.** Zero dependencies — the Node.js built-in
  runner — and it touches no AWS service. Four runs that evening reported `duration_ms` between
  5.5 s and 8.9 s on the build machine, so "under ten seconds" is the honest figure; your hardware
  decides the rest.
- **67 of 79 planned tasks done**, 12 open, 9 of those marked `[human]`. Re-check with `npm test` and
  `grep -c '^- \[x\]' .kiro/specs/panthiya/tasks.md`.
- **$0 spent, nothing deployed.** Every AWS step in `tasks.md` is marked `[human]` and none has run,
  which is the only honest proof that `tech.md`'s "ask before anything that costs money" rule was
  obeyed rather than agreed to.

`TODO(nishen)` — re-run both counts on the morning of submission and update this block. Do not paste
the numbers above without re-checking them; two other lanes were adding tests in the same hour these
were taken, so they were already slightly low when they were written.

---

## 12. Open questions only Nishen can close

- [ ] The challenge URL, the real rules, and the real form fields (§0 item 1).
- [ ] Whether a Bedrock Managed Agent is required, which decides eligibility (§0 item 2).
- [ ] Whether the same project may also go to Kiroween (§0 item 3).
- [ ] The orchestration decision, A or B (§6).
- [ ] The Amplify live URL (task 0.15).
- [ ] The demo video link (task 7.7).
- [ ] The live red-team score, read off the screen (task 5.7).
- [ ] The amount actually spent (task 7.9).
- [ ] Whether to submit at all if the rules require Bedrock Agents Classic. If they do, say so in the
      submission rather than describing an agent that was never created — that is the one answer this
      project cannot give dishonestly without undoing its own point.

## Pre-existing material

Disclosed in full in [`SUBMISSION-KIROWEEN.md` §12a](SUBMISSION-KIROWEEN.md): the starter pack this
repository grew from is **five documents and no application code** — the plan, the three Kiro
steering files and the 36 attack cases — all dated 2026-11-16, the day of the first commit. Three of
the five are byte-identical in the repo today.

It is repeated here rather than cross-referenced only, because **this challenge's rules have not been
read by anyone** (`docs/NEXT-SESSION.md` §0b) and a disclosure requirement is exactly the kind of
clause that differs between events. If the form asks, the answer above is the whole answer.

---

