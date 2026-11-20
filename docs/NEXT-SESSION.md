# Next session — start here

**Updated at the end of 2026-11-20.** The sections below were written on the 17th and corrected on
the 18th, 19th and 20th; where any two disagree, **the latest dated correction wins**. Read this, then
the **2026-11-20 block of `docs/BUILD-LOG.md`**, then `docs/CHALLENGE-RULES-BEDROCK.md`, then
`.kiro/specs/panthiya/tasks.md`.

---

## Where 2026-11-20 ended

> **Added at the very end of the day — a second wave ran after the first four lanes closed, and it
> was mostly about documents lying about artefacts.** Three lanes: the §10 wiring, the two
> submission drafts, and `README.md`. Plus a sweep of the files no lane owned.
>
> | | |
> |---|---|
> | **§10 is wired** | The harness is now a **deploy-time choice**: `HarnessId` set → harness, else an agent id → option A, else the loop. Harness **first**, because it is the only path the rules accept. **779 tests pass**, and `backend/lib/auth.mjs` plus all four action/read Lambdas measure at **zero lines changed** |
> | **The steering file was wrong** | `.kiro/steering/tech.md` is `inclusion: always` — read on every turn by the tool doing the building — and it still said *“Managed Agents with three role-scoped action groups”*. Corrected. This was the most expensive stale line in the repo and the cheapest to miss |
> | **Three documents described artefacts they had not re-opened** | Yesterday's rules doc told requirement 3 the architecture diagram **does not exist** (it has existed in `README.md` all along). §10 called `execution-role-policy.json` *“the body”* (it is a document holding three policies; `file://` on it returns `MalformedPolicyDocument` — the runbook now carries the extraction). And the README's diagram drew the tool-group edges from the **orchestrator** rather than our Lambda, contradicting the README's own central security claim |
> | **One wording problem that could fail qualification with every box green** | Requirement 1 wants an agent doing **one defined job**; we present **three roles**. It *is* one job and the build is already right — only the sentence is wrong. **Nishen's wording call**, in `SUBMISSION-BEDROCK.md` §0a |
> | **New on Nishen's list** | `TRANSLATION-REVIEW.md` **Priority 1c**: `parent.note` and `chat.mic_note` say nothing is deployed, which is true today and false on camera. Option A (condition them on the `MOCKING` flag that already exists) **costs no translation at all** |
> | **The submissions are no longer drafts against unknown rules** | `SUBMISSION-BEDROCK.md` §0 answers all three of its old unknowns and gains a nine-requirement qualification map. `SUBMISSION-KIROWEEN.md`'s dual-submission question is answered — as the **absence of a prohibition** in both rule sets as read, not as permission either organiser granted |
>
> **What the second wave did not change:** still $0 spent, still nothing deployed, still no
> credentials, `main` still untouched. The `InvokeHarness` call has never been made, and every
> inferred SDK name sits inside **one** function under one `UNVERIFIED` block so a single edit fixes
> all of it.


**The challenge rules were read in full, from the rules page, and they close the biggest open
decision in the project — against the way the repo was leaning.** Still no AWS credentials, still
nothing deployed, still $0 spent. Four lanes ran with no AWS at all.

| | |
|---|---|
| **The event was found, and it was public** | *Agents, your rules: Bedrock Managed Agents build*, on AWS Builder Center, live, Nov 18 – **Dec 2, 11:59 PM PT**. `docs/CHALLENGE-RULES-BEDROCK.md` has the URL, all nine qualification requirements against where this project stands, and the judging criteria. **Sri Lanka is not on the exclusion list.** Decision 7 closes |
| **And the rules disqualify option B** | A submission must be *an agent built on Amazon Bedrock Managed Agents or the AgentCore managed harness*, and the qualification check is **pass/fail with no exceptions**. Our own `Converse` loop is not that. Agents Classic cannot be created on this account. **So the path is AgentCore, and §0a is decided by the rules rather than by preference** |
| **AgentCore read properly, and most of the project survives** | `docs/AGENTCORE-PLAN.md`. The harness's **inline functions** hand each tool call back to our own Lambda, so `backend/lib/auth.mjs` and the three action Lambdas change by **zero lines** and design §3.1 survives verbatim. `ap-south-1` holds. The guardrail attaches, with the same literal stop reason the loop already matches. Budget: **~$2.60 typical, ~$10.21 ceiling** against $15 |
| **Deploy evening's four SWAP POINTs became a paste** | The real `fetch` is the implementation on every page; the mock is the automatic fallback behind `configured()`. **A8 is now: paste four stack outputs into `CONFIG` in `auth.js`, and sign in.** Verified by pasting real-shaped values, running the suite green, and restoring the placeholders |
| **Seventeen confirmed defects in the deploy-evening scripts** | Including the worst one found in this project so far: **the seed printed `Seeded 105 items` having written none**, because `BatchWriteItem` sheds rows into `UnprocessedItems` and the loop never read the response. Thirteen fixed in the lane, the rest named |
| **The three things “named rather than fixed” on the 19th** | All three fixed: the missing 500 branch in `score.mjs` (now `chat_crashed`), the cost guard that parsed the template by indentation, and the `max_tokens` + `toolUse` mis-naming |

**The two findings that should change how the next session works.**

> **A page that will not load for a fetcher is not a page that cannot be read.** `builder.aws.com`
> is client-rendered: three sessions, nine searches and an “invitation-only” conclusion, for a public
> page that opens in a browser in about a second. *Client-rendered* and *inaccessible* are different
> findings and they have different answers.
>
> **And the safe engineering choice was the disqualifying one.** Option B was built because it was
> the known quantity while the rules were unknown. It could have been finished, fully green, and
> thrown out at the gate without a judge ever reading it. **When the rules are unread, reading them
> is the work** — ahead of any amount of building.

**Also today:** `docs.aws.amazon.com` serves plain text if you append `.md` to the URL, which is the
only reason the AgentCore analysis is citable; `customHttp.yml`'s CSP note needed a **third**
`connect-src` origin for the voice bucket; SAM CLI failed to install only because the **UAC prompt
was never answered** (`winget` returned 1602); and a held reply was drawing an **empty bubble** on
the teacher's screen, which `chat.blocked` now fills.

### 🔒 One IAM permission that must never be granted — read this before writing the role

The chat Lambda needs **`bedrock-agentcore:InvokeHarness`**. AWS's own documentation says, of the
two neighbours it sits beside:

> *“To prevent direct command execution, do not grant `bedrock-agentcore:InvokeAgentRuntimeCommand`
> in your IAM policies.”*

`InvokeAgentRuntimeCommand` and `InvokeAgentRuntimeCommandShell` **execute commands without passing
through the model at all** — so they route around `allowedTools`, which is the guard that stops this
agent being handed a shell and filesystem write. They would be granted by someone pattern-matching
a prefix in a hurry, on the one evening when everything is being written in a hurry. It is recorded
here, in `docs/BUILD-LOG.md`, and in `backend/agentcore/execution-role-policy.json` itself.

### 📖 Read this before the first `InvokeHarness`, not after it

`docs/AGENTCORE-PLAN.md` gained two sections on 2026-11-20 whose whole purpose is to keep deploy
evening from being a sequence of judgement calls made at one in the morning:

- **§7.3a — the latency lookup.** Measure one round trip, read off the largest `MAX_TOOL_TURNS`
  that survives it (≤4.1 s → keep 4; 5–7 s → 2; >11 s → no cap helps, it is an async problem and a
  **day** of work). Do not take the measurement from a cold call.
- **§11 — what each first-invoke failure means.** Every unverified name in this path fails loud by
  design, which only helps if you know which guard spoke. The error text → the cause → the fix.
  **§11.2 is the important one:** an `AccessDeniedException` naming the **IAM identity** is our own
  policy and says nothing about the challenge; one naming the **account** is the fatal case and goes
  to Nishen the same hour.

🔴 **And §11.4 is the failure that does not look like one.** `HarnessId` left at `REPLACEME00`
and *everything works*: the stack comes up, every page answers, every test passes — and the
orchestrator silently selected is the `Converse` fallback, the one the rules **do not accept**. No
error, no warning, no failing test, because option B is a supported path behaving correctly. **So
the first thing to check after the first deploy is not that chat works — it is which orchestrator
answered.** A demo recorded against the loop is a demo of a disqualified project.

### What the deploy evening inherits from today

| | |
|---|---|
| **A8 is a paste** | Four stack outputs into `CONFIG` in `frontend/assets/auth.js` — `HostedUiDomain`, `UserPoolClientId`, `UserPoolId`, `ApiEndpoint` — then sign in on each page. There are no call sites left to edit. Proven by pasting real-shaped values, running the suite green, and restoring the placeholders |
| **The CSP needs three origins, not two** | API, Cognito domain, **and the voice bucket** (`VoiceBucketName`), because the microphone PUTs to a presigned S3 URL. Missing it looks like `mic.error` plus a console violation and nothing pointing at `customHttp.yml` |
| **The seed writes 105 items** | Not the 99 three documents claimed until today. If it says **PARTLY written**, re-run it — that is now safe, because the audit rows are keyed by a fixed timestamp and a second run overwrites rather than doubles |
| **Two new SWAP POINTs, and one retired** | **New:** the handoff loop fails closed on an unrecognised stop reason, so if the harness spells its finish reason as anything but `end_turn`/`stop_sequence`, **every turn fails loudly on the first live invoke** — that is deliberate, and it is the first thing to check. **New:** `InvokeHarness`'s latency against API Gateway's 29-second ceiling, with up to five round trips at `MAX_TOOL_TURNS=4`. **This is now a lookup, not a judgement call:** `docs/AGENTCORE-PLAN.md` **§7.3a** has the budget computed from `template.yaml` and a table mapping the one number you measure — a single round trip — to the largest cap that survives it (≤4.1 s → keep 4; 5–7 s → drop to 2; >11 s → no cap helps, it is an async problem and a **day** of work). Do not take the measurement from a cold first call. **Retired:** the guardrail-vs-model coupling, since we stay on Nova through `Converse` |
| **Six properties in the create body are marked UNVERIFIED** | `backend/agentcore/README.md` §4 names each one and how to settle it. The two that matter are the create-time `memory: {"disabled": {}}` wrapper and the `InvokeHarness` wire field names. **Read them by eye before running the file** — the guards check the module, and a human runs the JSON |
| **`allowedTools` is harness-wide, `tools` is per invocation** | So `allowedTools` must be the **union** of all three roles' names. Safe — per-invocation `tools` decides what exists — but it is not what the plan's §3.1 first implied, and whether `allowedTools` is *also* overridable per invocation is unverifiable offline. If it is, tightening it per role is a free extra fence |
| **Changes needed in files no lane owned** | `docs/AGENTCORE-PLAN.md` §10 has the full list: `invokeViaHarness` beside the two existing orchestrators in `chat/index.mjs` with the stream reader, exporting `TOOL_FAILED`/`toolUnavailable` from `orchestrate.mjs` (a duplicate with a drift test stands in meanwhile), moving `bedrock:InvokeModel`/`ApplyGuardrail` to the harness execution role, and `HarnessId`/`HarnessArn` parameters |

**One thing being watched rather than chased.** `redteam-cli.test.mjs`'s *“a fault on one case does not
discard the cases already paid for”* failed on two of eight full-suite runs during the session, while
two lanes were writing the file it spawns. After the lanes stopped it was green on **six isolated runs
and four full-suite runs**, so the evidence says a read of a half-written file rather than a defect.
It spawns a subprocess, which makes it the most plausible candidate in the suite for a real flake —
if it fails once more, it is real, and a test that flakes one time in four is exactly what gets
explained away at one in the morning.

**Do not restart any of today's four lanes**, or the seven from the 19th, or the six from the 18th.

---

## Where 2026-11-19 ended

**633 tests pass, nothing skipped — up from 565, and `npm test` is the only number worth quoting,
because today's lesson is partly about numbers in documents outliving what they described. 67 of 79
tasks. Nothing deployed, $0 spent — and the branch is on `origin`.** No AWS work was possible today: there are still no credentials on this machine, and
neither AWS nor Kiro is signed in to the browser the extension sees. Everything below was done
without either.

| Done | |
|---|---|
| **The push** | `feat/m4-student-tutor` → `origin`, 30 commits. `main` untouched, so the merge decision and Amplify are unchanged |
| **A second verification pass** | Same brief as the first: assume the claims are ahead of the evidence. **Six defects CONFIRMED by running them**, four lower, six areas reported clean — and **every one of them sat behind the green 565** |
| **All of them addressed — then a third pass read the fixes, and the fixes were wrong** | Two lanes fixed all six. **Verification pass 3 then pointed at that commit rather than at the code it fixed** and found ten more, six CONFIRMED — including two *misses* the fixes had introduced in `distress.mjs`, and a test that could not fail. All repaired, by lanes that built the corpus **before** touching the code: the distress corpus failed 27 of 37 rows against the then-current code, and the audit-log guard now catches 9 of 9 mutation shapes instead of 4 |
| **And the four deploy-evening scripts were read for the first time** | Three were carrying a defect that would have reported a false result with money already spent — the worst being that **the Sinhala gate could print `PASS` for a reply that did not exist**. All fixed; the human half is in the table further down |
| **`docs/TRANSLATION-REVIEW.md`** | The si/ta review surface. 261 keys per pack, the 14 safety-critical strings first, and now a **Priority 0** above them |
| **`docs/DECISION-KIRO-WRITEUP.md`** | Decision 4 as a choice of letter, with the recommended text drafted in full |
| **§0b below** | The challenge is on **AWS Builder Center**, not Devpost — which is why five searches found nothing |

**The two worst defects, because they say what to look for tomorrow.** A reply cut short by the
token cap was returned as a **finished 200** — and the longest legitimate reply in this product is
the parent-update draft a teacher forwards to a parent, so a fee message would have gone out
mid-number while the scoreboard called it a pass. And the test asserting that nothing can delete a
row from the audit log **could not fail**: granting the teacher Lambda `DeleteItem`, `UpdateItem`
*and* `BatchWriteItem` on `audit_log` left it green, because its regex window was 400 characters and
the real distance was 850.

> Three lessons, stacked, and the third cost the most to learn. *A passing suite is not evidence
> that a thing runs* (pass 1). *A suite that has never been seen to fail is not evidence that it
> tests anything* (pass 2). And **a fix verified only against the case that exposed the bug is not
> evidence that the bug is gone** (pass 3) — which is how a narrowing written to stop a maths
> question being answered with the helpline stopped *"there is no point in my life"* being caught
> at all, and how a test pinning that morning's own fix turned out to match the function's
> declaration rather than its call site.
>
> **The practical rule for tomorrow: every fix gets a corpus, not a case.** Write the inputs the
> defect is one of, confirm the corpus goes red in the places it should, then fix. That is the
> standard for the live run too, and the live run will have far more to be wrong about.

**One thing is open for Nishen that was not on yesterday's list**, and it is thirty seconds: the
wellbeing check's Sinhala medicine words were matching `බෙහෙත්` and `පෙති`, which a student's
`බෙහෙතක්` / `පෙත්තක්` do not contain — so req 8.6 could be asked straight past the gate in Sinhala.
The stems are widened and pinned by a test, erring toward catching more, but **it is a change to the
most safety-sensitive word list in the project made by a lane that does not read the language.** It
is Priority 0 in `docs/TRANSLATION-REVIEW.md`. The Tamil half of the same list has never been
reviewed by anyone.

**Three things were left unfixed on purpose**, named rather than buried: a `max_tokens` response
that also carries `toolUse` blocks reports `tool_use_without_stop_reason` (an honest 502, just
mis-named); the microphone can still be *started* during an open typed send, though a transcript can
no longer race the send; and the full per-turn trace in `runToolLoop` is still discarded on success,
because where it should go is a privacy-and-cost decision rather than a bug.

### What the deploy evening needs to know, from the scripts pass

Four scripts run that evening and three of them were carrying a defect that could have reported a
false result with money already spent. All fixed; these are the five things that are **not** fixes
and need a human.

| | |
|---|---|
| **Confirm the role echo with one live call, before the headline run** | The red-team CLI now scores against the role the **server** reports rather than the one the environment claims. If the deployed `/chat` is older than that field (decision 5), the CLI falls back to trusting the env var — silently, exactly as before. One `/chat` call that shows `role` in the body settles it |
| **Name a recording path for the submission run** | A live `--yes` run overwrites `tests/redteam/last-run.local.json`. `--record <path>` exists; use it for the run whose numbers go into the submission |
| **`test-sinhala.mjs` now exits non-zero** unless a candidate passed every case with every call answered | It used to always exit 0. The printed verdict says the same thing in words, but anything scripted around it should know |
| **Look at the terminal before the paid gate run** | Sinhala survives the script and the pipe — pinned by a test — but whether *you* see it depends on the console font, and this gate exists to be read by eye. A mangled font makes the verdict worthless |
| **`demo-users.mjs --apply` now attempts all three accounts** and prints `DO NOT SEED YET` unless all three are in place. If it says that, re-run it — the creates are idempotent — and do not run the seed until it prints the seed command itself |

### Three things named rather than fixed

- **`score.mjs` has no 500 branch.** 502/503/504 map to `chat_unavailable` and everything else to
  `chat_error`, so a genuine unhandled Lambda throw is filed as `chat_error`. The one cause that was
  reachable offline (the module-init throw) has been narrowed; the branch itself is still missing.
- **`cost-guards.test.mjs` parses the template the way the audit-log guard was just rebuilt away
  from** — by key name and indentation, so a resource whose name contains a hyphen or whose key
  carries a trailing comment is invisible to it. Its assertions are existence checks rather than
  absence-of-capability checks, so the failure mode is milder, but it is the same class.
- **`handleChat`'s guardrail branch fires on `guardrailAction === 'INTERVENED'` from any source**,
  which is correct for a real guardrail — but on the default deployment (`GuardrailId: ""`) option A
  has no guardrail either, so the same attribution question exists on that path. Only reachable with
  a live agent, so it could not be tested offline.

### And one Sinhala and Tamil string that is deliberately English

`redteam.reason.content_filtered` is in all three packs as the English sentence prefixed
`TODO(nishen)`. The alternative was a blank sentence on the screen a judge watches. It is Priority 1
in `docs/TRANSLATION-REVIEW.md` with the rest.

**Do not restart any of today's seven lanes**, or yesterday's six.

---

## Where 2026-11-18 ended

**67 of 79 tasks. 565 tests pass, nothing skipped. Fourteen commits. Nothing deployed, $0 spent,
and nothing pushed** — the branch was 29 commits ahead of `origin/main` and had never left this
machine.

> **Corrected 2026-11-19:** the push is done. `feat/m4-student-tutor` is on `origin` with 30 commits
> and the work can no longer be lost with the machine. `main` is still untouched, so the merge
> decision in §4 is unchanged and Amplify still has nothing to build.

Four lanes ran in parallel with no AWS at all, then a verification pass read what they produced, and
three more lanes fixed what it found. What that pass found is the thing to carry forward:

> **Every defect it found sat behind a green suite**, and three of them sat inside the work of lanes
> whose brief was to be careful. The worst was a demo-breaker — every student message was answered
> with the mental-health helpline, which on a live red-team run would have scored a **false pass on
> 44% of the suite** before the model was ever invoked. A pass that only re-ran the tests would have
> reported success.

Built today: the **option B tool loop** (`Converse` + `toolConfig`, 23 tests, deployable — so the
A/B/C decision is now a choice rather than a spike); `scripts/bma-probe.mjs`, which answers in one
read-only command whether this account can reach BMA and reads its own 403 for you; the three
`voice.*` keys and a pack-parity test; self-hosted Sinhala and Tamil with disjoint unicode-ranges;
the accessibility pass and the five focus defects it eventually found; `README.md` and both
submission drafts; and the Sinhala gate taught to test an OpenAI model.

Found today, and each one changes a decision: **§0a** — the challenge may be named after a service
nobody had looked at, and guardrails are **not supported** on it, which also couples the model choice
to defence layer 2 (`openai.gpt-5.4`/`5.5` cannot take a guardrail at all). **`docs/SUBMISSION-
KIROWEEN.md` §0** — the Kiroween rules, read in full: Dec 4 2:00 PM PT, judging to 2027-01-29 with
the project required to stay live throughout (so the stack cannot be torn down — and the $7 estimate
was costed for the wrong duration, **re-costed 2026-11-19 to ~$2.50 typical / ~$9.80 ceiling with
~$12.50 headroom**, because none of the twenty-eight resources bills per hour), a parallel submission
is **not** forbidden, and *"insufficient use of Kiro will result in disqualification"*.

### The five things only Nishen can do, in order

| # | | Why it is first |
|---|---|---|
| 1 | **Sign in to AWS and to Kiro** in the Chrome window the extension is attached to | Both answered with a sign-in page on the 18th. Credentials are not the agent's to enter, and everything in the console is blocked behind this |
| 2 | **The Bedrock challenge's invitation email or URL** | Still the blocker, but **2026-11-19 narrowed where to look: the event is on AWS Builder Center, not Devpost** (§0b). So the three Devpost searches were searching the wrong site. **Kiroween is currently still the only verified deadline this project has.** One read answers which service is required, whether this account is even eligible, and the other half of decision 7 |
| 3 | `aws login` as IAM user `panthiya-dev` and `winget install Amazon.SAM-CLI` | The `aws` CLI is already installed — 2.36.49. Only credentials and SAM are missing. Then step 2a (the probe) and the Sinhala gate can both run |
| 4 | **Decide what the Kiro write-up will say** | 20% of the Kiroween score is how thoroughly the project uses Kiro, and the rules disqualify insufficient use. The honest split between Kiro and other tools is not an agent's to choose, and `docs/KIRO-WRITEUP.md` is judged by people who can read this repository |
| 5 | **Request the 4,000 Kiro credits before Dec 1, 12:00 PT** | One allotment, no second chance, and the form needs the Kiro user ID or AWS account ID |
| 6 | **`docs/TRANSLATION-REVIEW.md`** — Priority 0 is thirty seconds, Priority 1 is about twenty minutes | Added 2026-11-19, and it is on this list because it is the only work in the project that **nobody else can do at all**. Priority 0 is two Sinhala words in the wellbeing check's medicine list, changed today by a lane that does not read the language. Priority 1 is the fourteen strings that carry the safety promises. Five milestones of UI are in two languages no one has checked |

### Then, in this order

1. `node scripts/bma-probe.mjs --yes` — free, read-only, and it says which of the three answers came back.
2. 🚦 the Sinhala gate, **against whichever model step 1 and the rules point at** — `node scripts/test-sinhala.mjs --yes [--model …]`.
3. The A/B/C orchestration decision (§0a), which by then is a reading of the rules rather than of the code.
4. The guardrail, the deploy, the demo logins, the seed, the four SWAP POINTs, and the first live run of the 36 — the run sheet below, unchanged.

**Do not restart the Q1/Q2/Q3 lanes or the V1/V2/V3 fixes.** All six landed on the 18th; the lane
table further down is struck through for that reason.

---

## ~~0b. The challenge is on AWS Builder Center, not Devpost~~ — **superseded 2026-11-20**

> **The event was found and the rules were read: `docs/CHALLENGE-RULES-BEDROCK.md`.** Everything
> below is kept because its reasoning about *where to look* was right and its conclusion about
> *whether it could be looked at* was wrong — the page is public and client-rendered, not unlisted.
> The deadline, the eligibility and the required service are all settled there, not here.

**First, the part that was never missing.** `PANTHIYA_SETUP.md` §1 — this project's own setup
file, committed on day one — has a two-column table whose left-hand heading reads
**"Agents, your rules" (AWS Builder Center)**, with the prize (5 × $1,000 AWS credits and swag)
and the deadline as **Dec 2, 11:59 PM PT** / Dec 3, 1:29 PM in Sri Lanka. The host was in the
repository the whole time. Three sessions read §6 of that file, which names the challenge without
naming where it lives, and went to Devpost. **Five searches were spent on a fact that was two
screens above the one being read** — which is the cheapest lesson available today: read the
project's own source document all the way through before searching the web for what it says.

Four searches on 2026-11-19 then confirmed it independently, and that is worth something too — the
repository's own claim is now corroborated from outside it:

> A GitHub repository, `romanceresnak/break-me-agentcore`, describes itself as *"Built for the*
> **Agents, your rules** *hackathon on AWS Builder Center."*

That is one other entrant's README, not a rules page — but it is the only external confirmation
that the event exists at all, and it says the host is **AWS Builder Center**. Yesterday's three
Devpost searches found nothing because Devpost is not where it lives.

What that changes, and what it does not:

| | |
|---|---|
| **Where to look** | Builder Center hackathons: `builder.aws.com/build/hackathons`, individual events at `builder.aws.com/build/hackathons/<uuid>/<slug>`. **Stop searching Devpost for this one** — and note that `PANTHIYA_SETUP.md` §1 says Kiroween is the Devpost one, which is how the two got crossed |
| **Why the agent cannot read it** | That index is client-rendered and hung on two attempts from here (`Loading hackathons…`, then a 45-second script timeout). A site-restricted search of `builder.aws.com` returns Builder Center articles and one unrelated hackathon — *Agent Experience Hackathon: Strands Decider* — but no page for this event, which is what an unlisted or invitation-only event looks like. **It needs Nishen's signed-in browser**, which is human step 1 |
| **A single hint about the service, worth exactly what it is** | That repo builds on the **AgentCore managed harness** — option **A** — and mentions a *"Bedrock Managed Agents path (preview, allow-listed)"* only as an alternative in its own table. One entrant's choice is **not** a rule, and it does not settle §0a. But it is the only external signal about which service the challenge is about, and it points at **A rather than C** |
| **What is still unverified** | The **required service**, whether this account is eligible, and whether both challenges may take the same project — none of which `PANTHIYA_SETUP.md` answers. The deadline it gives (Dec 2, 11:59 PM PT) is now a repository claim corroborated by nothing external, which is better than before and still not the rules page |

**So the ask is narrower than it was.** Not "find the rules" — open Builder Center signed in, find
*Agents, your rules* in the hackathons list, and paste the URL. If it is not in the list, the
invitation email is the only path and it is worth saying so plainly rather than searching again.

**And the Dec 2 deadline is now the one to plan against**, nine days before Kiroween's Dec 4 and
**thirteen days from today** — with the live deploy, the Sinhala gate, the guardrail, the 36-case
live run and a demo video all still ahead of it, and every one of them behind a sign-in that has not
happened.

## 0c. Thirteen days, and what has to happen on which one (written 2026-11-19)

> **Corrected 2026-11-20 — twelve days, and the first row did not happen.** The sign-in, `aws
> configure` and the SAM install were the whole of Nov 20 for Nishen and none of them is done, so
> **the serial half of this plan has not started on any of the three days it was scheduled for.**
> The slack was four days; it is now three. What *did* happen is the row nobody had scheduled: the
> rules were read, which removes the Nov 21 “A/B/C decision” row entirely and replaces it with
> build work that is already under way.
>
> | By | What changed | Who |
> |---|---|---|
> | **Nov 21** | ~~The A/B/C orchestration decision~~ — **closed by the rules.** The path is the AgentCore harness (`docs/AGENTCORE-PLAN.md`) | — |
> | **Nov 21** | **New, and it is five minutes:** re-read one sentence on the rules page — does *“the AgentCore managed harness”* mean the `CreateHarness` product specifically, or AgentCore generally? Track A satisfies both readings, so this is a confirmation rather than a gate — but it is a reading of a judge's intent, which is not an agent's to do | **Nishen** |
> | **Nov 21** | **New: approve AgentCore Memory being switched off.** It is **on by default** and would persist children's conversations in AWS-managed long-term memory. That is a data-retention decision about minors | **Nishen** |
> | **Nov 21–22** | **New:** execution role, `CreateHarness`, first `InvokeHarness` — and with it the three things that cannot be measured offline: the stream shape, the real latency against API Gateway's 29-second ceiling, and that `guardrail_intervened` arrives as documented | agent, once credentials exist |
> | **Nov 22–23** | The four SWAP POINTs row **shrinks to a paste** — four stack outputs into `CONFIG`. Add in its place: the third `connect-src` origin in `customHttp.yml`, which is new and is not optional for the microphone | agent |
> | **unchanged** | Everything from the deploy onward: seed, the 36 live, verification pass 4, the merge, the README, the video, both submissions | — |
>
> **The one thing that would still cost days rather than hours** is unchanged in shape and smaller
> in probability: AgentCore being gated on this account the way Agents Classic is. Nothing read
> today suggests it is — it is GA, with a public region table and no prior-usage clause — but it is
> **fatal if true**, because the two services the rules name would both be unreachable. Two
> read-only commands answer it the minute credentials exist:
>
> ```bash
> aws sts get-caller-identity
> aws bedrock-agentcore-control list-agent-runtimes --region ap-south-1 --max-results 5
> ```
>
> A list, even an empty one, means the namespace is open. An `AccessDenied` naming the **IAM
> identity** is our own policy and says nothing about the challenge. One naming the **account** is
> the fatal case, and it goes to Nishen the same hour with the exact error text.

Two deadlines, both now citable: **Dec 2, 11:59 PM PT** for *Agents, your rules* (`PANTHIYA_SETUP.md`
§1 — Dec 3, 1:29 PM in Sri Lanka) and **Dec 4, 2:00 PM PT** for Kiroween (Dec 5, 3:30 AM here, read
from the official rules). The Bedrock one is the binding one, and it is **thirteen days away**.

This is a plan, not a promise. It exists because the critical path is almost entirely serial — the
live run cannot start before the deploy, the deploy cannot start before the model is chosen, and the
model cannot be chosen before the gate runs — so a day lost early is a day lost at the end, and the
only parallel work left is documentation.

| By | What | Who | Blocked on |
|---|---|---|---|
| **Nov 20** | Sign in to AWS and Kiro; `aws login`; `winget install Amazon.SAM-CLI`; find the challenge on Builder Center and paste the URL | **Nishen** | nothing. Everything below is behind this |
| **Nov 20** | `node scripts/bma-probe.mjs --yes` (free), then 🚦 the **Sinhala gate** against whichever model the rules and the probe point at | agent runs the probe; **Nishen runs the gate and reads the Sinhala by eye** | the row above |
| **Nov 21** | The **A/B/C orchestration decision** (§0a), now a reading of the rules rather than of the code. B is built and tested | **Nishen decides** | the challenge URL |
| **Nov 21** | The **Guardrail** from `backend/agent/guardrail.json`, and the **$10 budget alert before the first deploy** | Nishen, agent guides | credentials |
| **Nov 22** | 💰 `sam deploy --guided`, then `demo-users.mjs --apply`, then `seed --apply`, in that order | **Nishen approves the deploy**; agent runs the rest | the guardrail and the decision |
| **Nov 22–23** | The four SWAP POINTs, and the **first live invoke** — the three things flagged as unverifiable offline: that `guardrailConfig` on `Converse` evaluates plain message text, that `guardrail_intervened` is the literal `stopReason`, and that the SDK clients are in the `nodejs20.x` runtime | agent | the deploy |
| **Nov 23–24** | 🎯 **The 36 cases, live** — the CLI first because it is cheaper and diffable, then the page a judge sees. Fix every leak; add any new bypass as case 37+ | agent | the deploy |
| **Nov 24–25** | **Verification pass 4, after the live run.** This is the one the two previous passes argue for most: every defect they found sat behind a green suite, and the live run is the first time there will be real behaviour to be wrong about | agent | the live run |
| **Nov 25** | Merge `feat/m4-student-tutor` into `main`, connect **Amplify Hosting**, confirm the live URL opens on a phone | **Nishen decides the merge**; agent prepares it | the leaks fixed |
| **Nov 26** | `README.md` final — screenshots and the live URL, the last parts of task 7.1; the live red-team numbers read off the screen rather than estimated | agent | the live URL |
| **Nov 27** | 🎥 **Record the demo video, under 3 minutes, public on YouTube** | **Nishen** | the live URL |
| **Nov 28–29** | Both submission drafts finished against what actually exists; the Kiro write-up finished per decision 4 | agent | the video link and the URL |
| **Nov 30** | **Priority 0 and Priority 1 of `docs/TRANSLATION-REVIEW.md`** at the latest — ideally weeks earlier. The Sinhala and Tamil on screen in the video is the version a judge sees | **Nishen** | nothing. Do it on any evening before this |
| **Dec 1, 12:00 PT** | ⏰ **Request the 4,000 Kiro credits.** One allotment, no second chance | **Nishen** | nothing |
| **Dec 1** | Submit to *Agents, your rules* — a day of slack before the real deadline | **Nishen** | everything above |
| **Dec 3** | Submit to Kiroween — a day of slack before Dec 4, 2:00 PM PT | **Nishen** | the same |

**The slack is deliberate and it is small.** Four days of it, against a plan where the first eight
days are serial and the first row is a sign-in that has not happened on two consecutive days. If
Nov 20 slips, everything slips with it.

**Three things would cost days rather than hours, and all three are known now rather than later:**

1. **The Sinhala gate failing on the chosen model.** The fix is a parameter rather than a rewrite —
   but every prompt-sensitive behaviour has to be re-measured against the replacement, which means
   the live 36 again. Budget two days if it happens.
2. **The challenge requiring Agents Classic specifically.** This account cannot create one and
   there is **no exception process**, so the answer would be that it is ineligible — worth knowing
   on Nov 20 rather than Dec 1, which is the whole reason the URL is the first row.
3. **The stack having to stay up until 2027-01-29.** Kiroween requires the project to stay available
   to judges throughout the judging period, so nothing can be torn down on submission day. The cost
   model is being re-costed for that window rather than for a demo.

---

## ~~0a. Read this first — the blocker may be the wrong blocker~~ — **answered 2026-11-20**

> **The A/B/C question below is closed by the rules, not by a spike.** The challenge requires an
> agent built on Bedrock Managed Agents or the **AgentCore managed harness**; Agents Classic cannot
> be created on this account; and option B, our own loop, qualifies as neither. The path is the
> **AgentCore harness**, and `docs/AGENTCORE-PLAN.md` has the verified contract, the region answer,
> the guardrail answer, the budget delta and the plan. Kept below for the reasoning, which is still
> the clearest statement of what each option costs.

**The service this project is named after may not be the service that was found to be blocked.**

`PANTHIYA_SETUP.md` §6 names the challenge: AWS **"Agents, your rules: Bedrock Managed Agents
build"**, deadline Dec 2 2026 PT. Yesterday's §0 read "Bedrock Managed Agents" as *Agents for
Amazon Bedrock* — Agents Classic, the `CreateAgent` API — and concluded, correctly **for that
service**, that this account cannot create one. But AWS shipped a **separate service with almost
exactly that name** in 2026, well before this deadline: **Amazon Bedrock Managed Agents, powered by OpenAI (BMA)**, in
public preview. A challenge with a Dec 2 2026 deadline named after it is far more likely to mean
the new preview service than the one in maintenance mode.

### What BMA actually is, from AWS's own documentation

| | |
|---|---|
| **Not Agents Classic** | A different service: stateful agent *sessions* running OpenAI models, built on a customised OpenAI Agents API. Nothing to do with `CreateAgent` |
| **Endpoint** | `https://bedrock-mantle.<region>.api.aws`, signing service `bedrock-mantle`, sessions at `/openai/v1/agents/sessions`. **Explicitly not** `bedrock-runtime` |
| **IAM** | Actions in the `bedrock-mantle:` namespace, e.g. `bedrock-mantle:CreateAgentSession`. Runs under our own IAM identities, with a session role we own |
| **Access** | API-only, no console. No allowlist, waitlist or prior-usage requirement is **documented** — but that is absence of a published process, not proof of no gate: the docs require account access to the BMA model and list *unavailable preview access* as a cause of a 404, the user guide says *public* preview while AWS's launch post says *limited* preview, and `role_arn`, `iam:PassRole` and `bedrock-mantle:CallWithBearerToken` are all needed before a session exists. Still the real difference from yesterday — Agents Classic publishes its block and its no-exception rule; this service publishes neither |
| **Regions** | `us-east-1`, `us-west-2`, `us-east-2` only. **`ap-south-1` is not one of them** |
| **Models** | BMA-supported **OpenAI** models available in that region and account. Cross-region inference profiles unsupported |
| **Tools** | Filesystem *skills* and MCP — environment-based **STDIO** MCP servers in the preview workflow, and AWS also documents **AgentCore Gateway** as an MCP tool on a BMA session, which would take the three existing Lambdas unchanged. Either way: MCP, not action groups |
| **Compute** | We must supply an execution environment: our own host running `codex exec-server`, or AgentCore Runtime. The supplied **CDK bundle** creates a NAT gateway that bills while idle — that is the bundle, not the service; the documented AgentCore CLI path runs without VPC access by default |
| **Input** | Text. No subagents, and no built-in long-term memory in the preview |
| **Guardrails** | **Settled, and against this option.** AWS states it in one sentence: *"The `bedrock-mantle` endpoint doesn't support Amazon Bedrock Guardrails."* So layer 2 cannot be attached on a BMA session. It survives as the documented alternative — `ApplyGuardrail`, which *"applies a guardrail to content that you supply directly, so it isn't tied to any model"* — but as an explicit call on the way in and on the way out, which is a real regression against A and B, and a cost that belongs in the comparison rather than in a list of unknowns |

### So there is a third option, and it is the challenge's own namesake

| | Path | What it costs |
|---|---|---|
| **A** | AgentCore harness | as yesterday |
| **B** | Our own `Converse` + `toolConfig` loop | as yesterday — but **built, tested and 23 tests deep as of 2026-11-18**, so it is now the known-good fallback rather than a plan |
| **C** | **BMA** — the service the challenge appears to be named after | A new region, a new model family, an exec server to keep running, MCP instead of action groups, **and no attachable guardrail** (above), so layer 2 becomes an explicit `ApplyGuardrail` call. In exchange it is the only path that answers "did you build on the thing the challenge asked for?" with a yes — which is worth a great deal **if** the rules ask for it, and nothing at all if they do not. That is the decision, and it is a reading of the rules rather than of the code |

### What flips if C is the answer

1. **Region reopens (decision 3).** The agent layer cannot live in `ap-south-1`. The cheapest
   coherent answer is the whole stack in `us-east-1`; splitting regions buys latency and confusion.
2. **Model reopens (decision 4), and with it the Sinhala gate.** The gate is still the first thing
   that happens — but it has to run against the **OpenAI model BMA will actually use**, not Nova
   Micro. Five milestones rest on that model reading Sinhala, and no OpenAI model has been tested
   on it. This is the single biggest unmeasured risk in the project.
3. **The three action Lambdas stay.** They get wrapped by a small STDIO MCP server inside the
   execution environment instead of being action groups. The role gate *strengthens*: the MCP
   wrapper and the session role are both ours, so the role still never leaves our code (design
   §3.1), exactly as lane B argued for option B.
4. **Layer 2 moves from *attached* to *called*, and that is now settled rather than assumed.**
   `bedrock-mantle` does not support Guardrails, so on option C the guardrail becomes an explicit
   `ApplyGuardrail` call on the input and on the reply. The scoreboard can still attribute to it,
   `backend/agent/guardrail.json` is unaffected, and the IAM for it is already in `template.yaml`.
   What changes is the claim: "a managed guardrail sits between the model and the child" becomes
   "we call the guardrail ourselves on both sides", which is honest but weaker, and the demo
   script says it either way.

   **And a constraint that bites option B too, found while checking this:** guardrails are not
   supported with every model. `openai.gpt-5.4` and `openai.gpt-5.5` are on AWS's unsupported
   list, and a request naming a guardrail with one of those fails outright —
   *"ValidationException: Guardrail is not supported with the chosen model"*. So **the Sinhala
   gate and layer 2 are now coupled**: if the gate picks an OpenAI model, check that model's card
   before assuming `guardrailConfig` will work on the `Converse` path, because the fallback is the
   same `ApplyGuardrail` call. Nova and Claude-class models are unaffected.
5. **Budget.** The preview adds no service charge beyond model inference and the resources we
   create — but the AgentCore Runtime example's NAT gateway is the kind of thing that eats a $15
   budget while idling. A self-hosted exec server is the $0 path, with one honest cost: **a judge
   opening the live URL needs that host running**, which a recorded demo does not.

### The two things that settle it, neither of which an agent can do

- **The challenge's own page.** A second search found no event by that name — nothing under
  `"Agents, your rules"`, and nothing matching "Bedrock Managed Agents" with a Dec 2 deadline. The
  invitation email or a URL answers three things in five minutes: which service is required;
  whether Agents Classic specifically is required (in which case this account is **ineligible**,
  and that is worth knowing on Nov 18 rather than Dec 1); and whether Kiroween may take the same
  project.
- **One signed request to `bedrock-mantle.us-east-1.api.aws`, once `aws login` is done.** It is
  a script now: `node scripts/bma-probe.mjs --yes` — read-only, free, and it reads its own 403 for
  you, because a 403 here has two opposite meanings and only the wording separates them. An
  identity-shaped denial is our own IAM policy (`AmazonBedrockFullAccess` predates this service and
  almost certainly does not cover the `bedrock-mantle:` namespace) and says nothing whatever about
  the challenge; an account-shaped one says BMA is as closed as Agents Classic.

  It is **not** the whole answer, and the script says so. A session also needs `role_arn`,
  `iam:PassRole` and `bedrock-mantle:CallWithBearerToken`, so a bare POST returns a 400 rather than
  a verdict — which is why `--create-probe` is off by default and why a ValidationException from it
  counts as the good news: the request got past authorisation and only the body was wrong.

**Nothing below this section is wasted.** Everything that made yesterday's §0 true of Agents
Classic is still true of Agents Classic. Guardrails, the three Lambdas, the role gate, policyCheck
and all 36 cases do not care which orchestrator calls them — which is exactly why the project
survived finding this out twice.

### Tooling, checked rather than assumed (2026-11-18)

| | |
|---|---|
| `aws` CLI | **Already installed** — 2.36.49. Yesterday's run sheet says the CLI has neither; it has one |
| Credentials | **Not configured.** `aws sts get-caller-identity` → `NoCredentials`, and `~/.aws` holds only `cli/` |
| SAM CLI | **Not installed** — `sam: command not found` |
| Node | v24.14.1, against `engines: >=20` |

**Re-checked 2026-11-20, and two of these moved:**

| | |
|---|---|
| Credentials | **Still not configured.** `aws sts get-caller-identity` → `NoCredentials` on the third consecutive day. Every AWS row in §0c is still behind this one line |
| SAM CLI | **Still not installed — but now for a reason that can be acted on.** `winget install --id Amazon.SAM-CLI` was run non-interactively: it resolved 1.173.0, downloaded the MSI and verified its hash, then the installer returned **1602, "You cancelled the installation"** — the UAC elevation prompt was never answered. It is a one-click step, not a missing package: run `winget install --id Amazon.SAM-CLI -e` and approve the prompt |
| Node | v24.14.1, unchanged |

**Two tooling facts worth keeping, because each one cost a session to learn:**

- **AWS Builder Center pages are client-rendered.** A fetch of `builder.aws.com/build/hackathons` returns `Loading hackathons…` and nothing else, which is what sent three sessions to Devpost. Opened in the browser the extension drives, the list renders in about a second — signed out. The challenge is public. The lesson generalises: *client-rendered* and *inaccessible* are not the same finding, and the browser answers in one step what a fetcher cannot answer at all.
- **`docs.aws.amazon.com` serves plain text if you append `.md` to the URL.** The HTML pages are JS-rendered and return only a title to a fetcher; `…/some-page.html` → `…/some-page.md` returns the whole page as text. The entire AgentCore analysis in `docs/AGENTCORE-PLAN.md` rests on this, and without it that lane would have returned guesses.

---

## 0. Tomorrow — start here

**Read this section before anything else. The plan changed on the evening of 2026-11-17, and the
old run sheet would send you down a path that no longer exists.**

### What changed: the agent cannot be created

Driving the AWS console found what no amount of reading the code could: **Bedrock Agents Classic is
in maintenance mode, and this account cannot create an agent.** `CreateAgent` returns
`AccessDeniedException` — *"New agent creation is not available for accounts without prior service
usage"* — in `ap-south-1` and in `us-east-1`, because the allowlist is per-account and automatic.
AWS's own page is explicit that **there is no exception process**, so there is no ticket to file.

What survives, and it is most of it:

| | |
|---|---|
| **Guardrails** | Unaffected, and still apply when the model is invoked through AgentCore — layer 2 lives |
| **Model inference** | Fully supported; the Sinhala gate is unchanged |
| **`ap-south-1`** | AgentCore is fully available in Mumbai — harness, Runtime, Gateway, Memory, Identity, Policy. The region decision stays settled |
| **The three action Lambdas** | AWS's recommended path turns an action group into an MCP tool through the AgentCore gateway, *"wrapping REST APIs and Lambda functions"* — the shape this project already has |
| **The whole security story** | The role gate, the IAM separation, policyCheck and the 36 cases do not care which orchestrator calls the Lambdas |

### The first decision tomorrow

| | Path | What it costs |
|---|---|---|
| **A** | **AgentCore harness** — AWS's named successor. Action groups become gateway MCP tools over the existing Lambdas; guardrails attach through gateway policy | A CLI and a service nobody here has used, with two weeks left. Consumption pricing across runtime, memory and gateway, so the $15 budget needs re-checking |
| **B** | **Our own loop** — `Converse` with `toolConfig`, dispatching to the same three Lambdas from `orchestrate.mjs` | Two files change in a codebase that already has everything else. The role never leaves our Lambda, which makes design §3.1 *simpler and stronger*. But it is not "an agent service", which may matter to the judges |
| ~~C~~ | ~~Ask AWS to unblock the account~~ | **Ruled out in writing.** There is no exception process |

**Decide it the way everything else here got decided: by checking rather than guessing.** Give
option A a bounded spike — a hello-world AgentCore harness in `ap-south-1` calling one existing
Lambda through the gateway, time-boxed to about two hours. If it runs, take A. If it fights back,
B is a known quantity that can be built and tested offline. Do not spend the evening theorising
about which is better.

**One thing is still missing and only Nishen has it:** the rules for the challenge this is being
built for. A search found no event called *"Agents, your rules"*, so whether Bedrock Agents Classic
specifically is required — and whether a parallel Kiroween submission is allowed — is **unverified**.
A URL or the invitation email settles both in five minutes.

### The run sheet, corrected

| # | Step | Who | Time | Cost |
|---|---|---|---|---|
| 1 | `aws login` as IAM user `panthiya-dev`, then the SAM CLI — `winget install Amazon.SAM-CLI`. **Checked 2026-11-18: the `aws` CLI is already installed (2.36.49); only credentials and SAM are missing.** No model-access step exists any more — that console page has been retired and models auto-enable on first invoke | Nishen | ~15 min | $0 |
| 2 | 🚦 **The Sinhala gate** — `node scripts/test-sinhala.mjs --yes`, and read the Sinhala replies by eye | Nishen runs, agent reads | ~5 min | under 5¢ |
| 2a | **Which service is this challenge about?** `node scripts/bma-probe.mjs --yes` — read-only, free, and it reads its own 403 for you: identity-shaped means our IAM policy, account-shaped means BMA is blocked too. Needs step 1 only | Agent runs, Nishen reads the verdict | ~2 min | $0 |
| 3 | **The orchestration decision — now A, B or C** (§0a). **B is built**: 23 tests, deployable, the known quantity. So this is no longer a spike but a choice, and the challenge rules decide it more than the code does | Nishen decides; agent has already built B | ~15 min | $0 |
| 4 | Create the **Guardrail** from `backend/agent/guardrail.json` (3.1) — unaffected by any of this | Nishen, agent guides | ~10 min | $0 |
| 5 | 💰 `sam deploy --guided` | **Nishen approves before it runs** | ~10 min | ~$0 |
| 6 | `demo-users.mjs --apply`, then `seed --apply` — in that order, for the reason in §1 | Agent; Nishen sets the password | ~5 min | ~$0 |
| 7 | Take and verify the four SWAP POINTs | Agent | ~10 min | $0 |
| 8 | 🎯 **The 36 cases, live** — the CLI first because it is cheaper and diffable, then the page for the version a judge sees. Fix every leak | Agent | 30–40 min | ~$1–2 |

**Step 2 is still early for the same reason, but it now has a prerequisite of its own.** Five
milestones rest on the model being able to read Sinhala — and §0a means nobody yet knows *which*
model that is. If the challenge is about BMA, the gate has to run against an **OpenAI** model, not
Nova Micro; the gate can now do that (`--model openai.gpt-oss-120b-1:0`, with `AWS_REGION` set to a
US region, which it warns about), and it is the only thing allowed to decide the model. So run 2a
first: it costs nothing and it says which model step 2 should be about. If the gate fails on the
chosen model the fix is a parameter rather than a rewrite — but every prompt-sensitive behaviour has
to be re-measured against the replacement, which means step 8.

**One decision is still needed before step 5** (§4): whether `feat/m4-student-tutor` merges into
`main`. Amplify watches `main`, so there is no live URL until it does, and judges read `main` — until
the merge the public repo shows an older project than either submission draft describes. The role
echo is **settled and implemented** (decision 7).

### ~~Lanes that need no AWS and can run beside all of it~~ — **all three done 2026-11-18**

**Q1, Q2 and Q3 all landed on 2026-11-18, together with option B and the BMA probe. Do not restart
them.** What they produced: the three `voice.*` keys borrowed verbatim from the voice backend plus a
parity test that cannot be satisfied by a reworded server message; self-hosted Noto Sinhala and Tamil
with disjoint unicode-ranges and zero font bytes on an English page; four real accessibility defects
fixed and two deferred with reasons; and a README that no longer claims a running system, plus both
submission drafts. The table below is kept only because its notes name the files each lane owned.

| Lane | Deliverable | Tasks |
|---|---|---|
| **Q1** | Complete the three packs: add the three `voice.*` keys (their English is in `voice.mjs`'s `FALLBACK` table), and assert no missing key. Only one lane at a time may hold the packs | 6.5 |
| **Q2** | Self-hosted Noto Sinhala and Tamil subsets, CSP-compatible — then the full accessibility pass: keyboard, focus rings, contrast, screen-reader labels, reduced motion. After Q1, so the strings it tests are final | 6.6, 6.7 |
| **Q3** | `README.md` final (7.1) — but only the parts that do not need the live URL or the demo video | 7.1 (part) |

**The Sinhala and Tamil backlog is now the largest single thing nobody has checked.** Every string
written today — `auth.*` (23), `audit.*` (22), `mic.*` (10), `redteam.*` (69), `student.*` (22),
plus the seven corrected notes — was written by someone who does not speak either language. The
priority list is in §3.

**Where to stop.** Each step is a gate. If one fails, write what happened in `docs/BUILD-LOG.md` and
stop there rather than debugging a failed deploy at one in the morning. The first live run of
anything finds things, and they are worth finding with a clear head.

### The sign-in needs two deploys, not one

Task 2.3 landed before this session, and applying what it needed to `template.yaml` turned up a
sequencing wrinkle worth knowing before step 4 rather than during it.

Every hosted-UI callback URL is built from a new `SiteOrigin` parameter, and Cognito matches those
URLs **byte for byte** — but the Amplify origin does not exist until Amplify is connected, which is
step A7, *after* the first deploy. So:

```bash
sam deploy --guided                                    # step 4; SiteOrigin defaults to localhost
# connect Amplify (A7), note the origin, then:
sam deploy --parameter-overrides SiteOrigin=https://main.d1234abcd.amplifyapp.com
```

Until that second deploy, the hosted UI works from a local static server and not from the live
site. It costs nothing and takes a minute; it just has to be known in advance.

Then paste four values into `CONFIG` in `frontend/assets/auth.js` — `domain`, `clientId`,
`userPoolId`, `apiBase`, all four from stack outputs (`HostedUiDomain`, `UserPoolClientId`,
`UserPoolId`, `ApiEndpoint`). Until all four are real the panel says so rather than offering a dead
button, and `connect-src` in `customHttp.yml` needs the API origin **and** the Cognito domain,
because the PKCE token exchange is a `fetch` to `/oauth2/token`.

**The most likely live failure**, in order: `redirect_mismatch` (a callback URL differs by a
trailing slash, or the browser is on `/teacher/index.html` rather than `/teacher/`); sign-in
succeeding but the panel saying it did not finish (one of the five callback checks failed, or the
account is in no group or two — confirm step 5 grouped them); and a CORS failure on the token
exchange, which looks identical to being offline in the UI, so watch the network tab. Do **not**
test by opening the HTML from disk: `crypto.subtle` is undefined on `file://`.

### Five things to settle before the demo is recorded

Found by the lane that wrote `docs/KIRO-WRITEUP.md` and `docs/DEMO-SCRIPT.md` (tasks 7.2, 7.3, both
done), and all five confirmed by hand. None of them blocks tonight's steps 1–7; all five are
visible to a judge.

1. **The parent inbox is empty after a real seed.** `demo-class.json` has no `messages` block and
   `seed.mjs` writes none — the only thread content anywhere is the `MOCK` in `parent.js`. So the
   beat "a fee is recorded and the parent gets an approved update" has no data behind it unless a
   draft is created and approved by hand first. **Decision:** seed a `messages` block — with
   `approved` true on some and false on at least one, so the approval filter is still doing real
   work — or accept the manual pass. Recommended: seed it, because it is the one beat whose setup
   is currently undocumented.
2. **Four on-screen notes are no longer true**, and all four are visible in beats 2–5:
   `teacher.note` ("the backend lands in M1"), `parent.note` ("connects to a real class in M4"),
   `student.note` ("not connected to a model yet"), `chat.mic_note` ("Voice notes arrive in M6").
   **Done.** Rewritten to say what is true now — built and tested, nothing deployed — along with
   `chat.mock_reply`, `status.now` and `status.next`, which were stale in the same way. All of the
   new Sinhala and Tamil is unreviewed.
3. **`README.md`'s status row is stale**: "M0–M3 code complete, 270 tests passing · 41/79 tasks".
   **All three parts of that sentence were wrong.** The row it quotes was not the row in the file;
   455/59 was itself already stale; and the repo URL was never a placeholder (that decision is now
   closed in §4). Task 7.1 has since rewritten the row as a **dated snapshot plus the two commands
   that re-derive it** — `npm test`, and `grep -c "^- \[x\]" .kiro/specs/panthiya/tasks.md`. Re-run
   them before either submission rather than trusting a number in any document, this one included.
   The Amplify URL and the demo video are the only true placeholders left in it.
4. **Two documents disagree about the expected by-layer split.** §3 of this file carried "20 held
   by role scoping, 9 by the guardrail, 7 by policyCheck", and `backend/agent/README.md` §7's tally
   maps to a different one. Both are pre-live guesses, and tonight's step 7 replaces them with the
   only number that matters — which is why the demo script prints neither and reads them off the
   screen.
5. **Done** — the `run-unit-tests` hook now also fires for `scripts/**`, `frontend/assets/**` and
   `backend/seed/**`. It previously covered — its globs cover `backend/functions`, `backend/lib`
   and `tests/unit` only. Three of today's lanes wrote code it would never have run. Two more globs
   close it; it is a decision about hook noise rather than a defect.

**Launched before this session, and running while step 1 happens:** lane **N1** (task 2.3 —
hosted-UI sign-in, the token held in memory, and the real `tokenFor(role)` that `/redteam` mocks)
and lane **N2** (tasks 7.2 and 7.3 — the Kiro write-up and the demo script). N1 is what step 6
verifies, so read its report before starting step 6: it will name what can only be checked live,
and the `template.yaml` lines its sign-in needs.

---

## Where we are

**67 of 79 tasks done. 802 tests pass, nothing skipped. Nothing has been deployed and nothing has
been spent.** (Both counted 2026-11-20 at the end of the session, by hand: `npm test` → 802/802, and `grep -c` on `tasks.md` → 67 done, 12 open. The task count has not moved in two days
because every remaining task is behind the credentials gate or behind Nishen; the test count moved
**587 → 802** in the same two days.

> **Verification pass 4 ran at the end of the day: 41 mutations against production files, 38 red,
> one surviving — and the surviving one was the *fourth* instance of this repo's signature
> failure: a validated function, exported, tested, and **unreached at its call site**. Production was
> correct; the test was the defect. All four were found by mutation and none by reading. **What it did
> not cover is listed honestly in that pass's own report — `bma-probe`, `demo-users` and
> `api-swap-frontend` were not mutated at all, and `agentcore.test.mjs` and `audit-mic-frontend` got
> one mutation each out of ~20. That is where pass 5 starts.** **Pass 5 has since run:** 33 more mutations over those five files, **11 survived**, 9 guards fixed, **no production defects**. Its own uncovered list is `frontend/assets/student.js` and `parent.js` (never mutated directly), most of `redteam.js` beyond its three network functions, and the accessibility/CSS source guards — that is where **pass 6** starts. Re-derive rather than trust either.)
>
> **The one ceiling pass 4 named has been closed.** The chain *selected name → orchestrator map →
> implementation* was pinned by two source-text `assert.match` calls and nothing else. It is now
> checked behaviourally, and the experiment that justifies it is worth remembering: leaving the map
> text **perfectly correct** while making `invokeViaHarness` delegate to `invokeViaLoop` left **783 pass,
> 1 fail** — the one failure being the new test. Both source pins stayed green while every request
> would have been served by the orchestrator the rules do not accept.

| Milestone | State |
|---|---|
| M0 hello page | Code complete |
| M1 data model + teacher chat | Code complete |
| M2 roles + parent view | Code complete, sign-in included |
| M3 defence layers | policyCheck done and audited, audit screen done. Guardrail defined but not created in AWS (3.1) — and **how it attaches now depends on §0a**: on a `Converse` call it rides in `guardrailConfig`; on BMA it may have to become an explicit `ApplyGuardrail` call |
| M4 student tutor | **Done** — action group, tutor page, C1–C10 proved offline |
| M5 red-team | Runner, scoreboard page and CLI done. The live run (5.7) needs AWS **and two demo logins** |
| M6 voice + polish | **Done** (6.1–6.7) — backend, mic UI, the three packs complete and parity-tested, self-hosted Sinhala and Tamil, and the accessibility pass. No browser or screen reader has run, so the a11y pass is a code audit, not a verified one |
| M7 docs + submissions | Write-up, demo script, README and both submission drafts done (7.1 part, 7.2–7.5). What remains needs the live URL, the video, the measured red-team score, and eight screenshots |

Sixteen commits sit on `feat/m4-student-tutor`, which has not been merged. Everything still runs
offline, and not one line of it has met a real Bedrock agent — still the single largest unknown.

---

## 1. What only Nishen can do, in this order

Nothing below the gate can be verified end to end until these are done. Credentials are not the
agent's to enter.

> **Rewritten 2026-11-20.** Three items came off this list today — the challenge URL, the rules and
> the eligibility question — and three went on. In order, and the first four are the same four that
> have been first for three days:
>
> | # | | Time |
> |---|---|---|
> | 1 | **Sign in to AWS**, then `aws login` as IAM user `panthiya-dev` (never root). Everything else on this page is behind it | ~10 min |
> | 2 | **`winget install --id Amazon.SAM-CLI -e`, and answer the UAC prompt.** It was attempted today: the package resolved, the MSI downloaded and its hash verified, and the installer returned **1602, “you cancelled”**, because the elevation prompt went unanswered. It is one click | ~2 min |
> | 3 | **Join the hackathon** at `builder.aws.com/build/hackathons/61c39fba-1383-37e7-bd5c-3f9d889d89fc/agents-your-rules-bedrock-managed-agents-build`. The *Your project* tab says only *“Join this hackathon to get started”* — **there is no submission surface until you join**, it needs a Builder Center profile, and it is your account, not an agent's | ~5 min |
> | 4 | 🚦 **The Sinhala gate**, and read the replies by eye. No automatic check can tell fluent Sinhala from Sinhala-shaped nonsense, and five milestones rest on it | ~5 min |
> | 5 | **One sentence on the rules page**: does *“the AgentCore managed harness”* mean the `CreateHarness` product, or AgentCore generally? Track A satisfies both readings, so this confirms rather than blocks — but it is a reading of a judge's intent | ~5 min |
> | 6 | **Approve AgentCore Memory being switched off.** On by default; it would put children's conversations into AWS-managed long-term memory. A data-retention decision about minors, not a cost choice | ~2 min |
> | 7 | **`docs/TRANSLATION-REVIEW.md`** — Priority 0 is thirty seconds, Priority 1 is about twenty minutes, and it is now **four** strings awaiting translation rather than two. **Plus Priority 1c, which is a decision rather than a translation:** `parent.note` and `chat.mic_note` say nothing is deployed — true today, false on camera. Option A there costs **no translation at all**, so read that one first; it may remove work rather than add it. Still the only work in this project that nobody else can do at all | ~25 min |
> | 8 | **Decide the Kiro write-up** (`docs/DECISION-KIRO-WRITEUP.md`), and **request the 4,000 Kiro credits before Dec 1, 12:00 PT** — one allotment, no second chance | — |
> | 9 | Approve the deploy; decide the merge to `main`; record the demo video; submit | — |
>
> **Closed today and off this list for good:** find the challenge, confirm the deadline, confirm
> eligibility, and decide A/B/C.

```bash
# 1. AWS credentials — IAM user panthiya-dev, never root (PANTHIYA_SETUP.md §4)
aws login --region ap-south-1

# 2. SAM CLI
winget install Amazon.SAM-CLI
```

**3.** AWS Console → Bedrock → **Model access**: enable `amazon.nova-micro-v1:0`,
`amazon.nova-lite-v1:0` and a Haiku-class model. Confirm Bedrock **Managed Agents** exist in
`ap-south-1`; if not, everything moves to `us-east-1` and the region parameter changes (0.16).

**4.** The blocking gate, costing well under 5 cents:

```bash
node scripts/test-sinhala.mjs --yes
```

> **Why this is still first.** Five milestones of code now rest on the assumption that the cheapest
> model can read Sinhala. Read the Sinhala replies by eye — the automatic check cannot tell fluent
> Sinhala from Sinhala-shaped nonsense.

**5. The demo logins — and the part of this that was not obvious.** `POST /chat` takes the role
from the verified JWT and must keep doing so (requirement 1.3), so the parent and student red-team
cases cannot be run with a teacher token: without those accounts an honest run is **2 of 36 cases
and 34 errors**, which is what both the page and the CLI correctly report rather than scoring a
teacher-answered privacy question as a pass.

But creating the accounts is not the hard part. **Linking them is, and getting the order wrong
produces a demo that looks deployed and answers nothing.** `demo-class.json` carries
`SEED-TEACHER-SUB` and `SEED-PARENT-01…12` as placeholders, and every scope here is resolved
server-side from the caller's own Cognito `sub`:

| Role | With a placeholder sub in the data |
|---|---|
| teacher | `classes.byTeacher` matches nothing → **no classes in scope** → every teacher action answers `out_of_scope`. The teacher chat refuses everything |
| parent | `students.byParent` matches nothing → their **own** child is refused and the inbox is empty |
| student | works — a student session resolves to an empty scope by design (requirement 1.7) |

So the users come **before** the seed, because the seed is what writes the subs. It reads them back
out of the pool by email, so there is nothing to copy and paste wrongly, and it refuses to write
if the logins are missing rather than writing rows that look right and resolve to nothing.

Two more things that each cost an evening if missed, both now handled in
`scripts/demo-users.mjs`: an admin-created user lands in `FORCE_CHANGE_PASSWORD` and needs
`admin-set-user-password --permanent` before any scripted sign-in works, and the app client was
SRP-only, so there was **no way at all** to get an ID token outside a browser — `template.yaml` now
enables `ALLOW_ADMIN_USER_PASSWORD_AUTH`, which is an admin API needing IAM credentials and
unreachable from a browser, so the public client is not weakened.

**Exactly one child is linked to the parent login** (Kasun, `stu-01`). If all twelve were, "show me
Dilmi's marks" would be a legitimate request from a parent who really is Dilmi's parent, and the
privacy half of the suite would be measuring nothing. The seed refuses to write if that is ever
not true.

### Tonight, in order, once `aws login` is done

```bash
# a free look at what each step will do — neither of these touches AWS
node scripts/demo-users.mjs
node backend/seed/seed.mjs --stack panthiya

# after `sam deploy` has created the stack:
export PANTHIYA_DEMO_PASSWORD='<12+ chars, mixed case, a digit>'
node scripts/demo-users.mjs --apply            # three accounts, grouped, password set permanent
node backend/seed/seed.mjs --stack panthiya --apply   # 105 rows, with the real subs in them

# a token per role for the terminal run of the suite (they last 60 minutes)
node scripts/demo-users.mjs --tokens           # prints the export block, then:
node scripts/redteam-cli.mjs --yes
```

**6.** Amplify Hosting → connect `nishenmadawa15-collab/panthiya`, branch `main`. `amplify.yml` has
no build step, so it should go green first try (0.15).

---

## 2. Next session's lanes

Five lanes ran in parallel today against one working tree, partitioned by directory, and nothing
collided. The same partitioning applies below, with one rule learned the hard way: **only one
front-end lane at a time may touch `frontend/assets/styles.css` or `frontend/i18n/*.json`.** Both
are append-only shared files, and two lanes editing them at once is how work gets lost.

Reserved to the session lead in every wave: `backend/template.yaml`, `.kiro/**`, `docs/**`, and the
shared guards `packaging.test.mjs`, `env-contract.test.mjs`, `frontend.test.mjs`. A lane that needs
a change in one of those reports the exact change instead of making it.

### Wave 1 — can start immediately, no AWS, no overlap

| Lane | Specialist | Deliverable | Tasks | Notes |
|---|---|---|---|---|
| **D1** | Identity & Access Engineer | Hosted-UI sign-in in the front-end; the token held **in memory, never `localStorage`** | 2.3 | The critical path: the red-team page needs a token per role, and so does every live check. Owns `frontend/assets/app.js` and the sign-in markup. `Cognito::UserPoolDomain` belongs in `template.yaml` — report the YAML, do not apply it |
| **D2** | Technical Writer | `docs/KIRO-WRITEUP.md` and `docs/DEMO-SCRIPT.md` | 7.2, 7.3 | Both describe process rather than results, so neither needs the deploy. The 2:45 beat sheet is in `PANTHIYA_SETUP.md` §7. `docs/**` is otherwise reserved, so this lane owns exactly these two new files |

### Wave 2 — after D1 lands (it changes the auth plumbing both screens sit on)

| Lane | Specialist | Deliverable | Tasks | Notes |
|---|---|---|---|---|
| **D3** | Frontend Developer | Teacher audit-log screen, then the microphone UI: press-to-record, visible recording state, keyboard accessible | 3.6, 6.4 | One lane for both because both are teacher-side and both touch the shared CSS and language packs. `GET /teacher/audit` already exists in `read/handlers.mjs`; the voice contract is in `backend/functions/voice/voice.mjs` — three calls, and on `status: 'failed'` show the server's `message` as-is and never retry silently |

### Wave 3 — after every page exists, because it audits all of them

| Lane | Specialist | Deliverable | Tasks | Notes |
|---|---|---|---|---|
| **D4** | Internationalization Engineer | Complete the three packs, add the `voice.*` keys, and assert no missing key across them | 6.5 | The three `voice.*` strings are written in `voice.mjs`'s `FALLBACK` table, ready to mirror. Pack parity is already asserted in `frontend.test.mjs` |
| **D5** | Accessibility Auditor | Self-hosted Noto Sinhala and Tamil subsets, CSP-compatible; then the full a11y pass — keyboard, focus rings, contrast, screen-reader labels, reduced motion | 6.6, 6.7 | Runs after D4 so the strings it is testing are final. The red-team table scrolls sideways on a phone rather than reflowing: decide whether that bites before the demo |

### Track A — serial, each step needs the previous one

| Step | Task | Who | Gate |
|---|---|---|---|
| A1 | Day-1 Sinhala gate | Nishen runs, agent reads the output | **Blocks everything below** |
| A2 | ~~Create the Bedrock agent + the three action groups~~ — **not possible on this account**; see §0. Replaced by the A/B orchestration decision and its spike | Agent, Nishen decides | Task 1.11 is blocked until that is settled |
| A3 | Create the Guardrail from `backend/agent/guardrail.json` | Nishen in console | Record ID + version (3.1) |
| A4 | `sam deploy --guided` | **Ask Nishen before running — costs money** | 1.15 |
| A5 | `node scripts/demo-users.mjs --apply` — the three logins, grouped, with a permanent password | Nishen sets `PANTHIYA_DEMO_PASSWORD`, agent runs it | **Before A6, not after.** The seed writes the subs these accounts own |
| A6 | `node backend/seed/seed.mjs --stack panthiya --apply` | Agent, after A5 | Writes **105** items — 64 of data plus 41 audit rows, corrected 2026-11-20 from the 99 three documents claimed — with the real subs read back out of the pool. Refuses to run if A5 was skipped |
| A7 | Amplify connect + confirm the live URL on a phone | Nishen | 0.15 |
| A8 | **Take the four SWAP POINTs**: `frontend/assets/redteam.js` (`tokenFor` is already real — `postChat`, `postRun`, and delete `MOCK`/`mockScore`/`MOCKING`), `frontend/assets/student.js` (`askTutor`) and `frontend/assets/teacher.js` (six calls behind one comment: chat, ledger, audit, and the three voice calls) | Agent, after A6 and D1 | The pages run on mocks until this |
| A9 | Run all 36 live from `/redteam`, and from `scripts/redteam-cli.mjs` for a diffable record. Fix every leak; add any new bypass as case 37+ | Agent | 5.7 — the first real score |
| A10 | `README.md` final, `SUBMISSION-*.md`, and the build log's last entry | Agent | 7.1, 7.4, 7.5, 7.6 |

---

## 3. Things to watch

**Four defects were found in defence layer 3 today, by an audit whose whole brief was to assume one
was there.** All four are fixed, and the lesson is the shape of them rather than the count: three
were *over-blocks* — correct refusals and a truthful fee read-back thrown away — and the user-facing
cost of an over-block is invisible to a scoreboard, because a blocked reply scores as a pass. When
reading the live run, a case that scores "blocked" is worth opening if the reply looks like it
should have been allowed.

**A toggle withdraws a layer's credit; it does not re-run the attack without that layer.** There is
no kill switch in the deployed path, and adding one to win a demo would be the vulnerability the
demo claims not to have. Say it that way on stage.

**Never show a bare "36 blocked".** A case held by the agent's own refusal scores `blocked` with
`needsEye: true`, because no code read that reply. The page already renders it as "Needs a human
eye" with the reply open, and `error` as its own tile; the true headline comes from
`totals.byLayer`, read off the screen after the live run. Two pre-live estimates of that split exist
in this repo and they disagree with each other (§0, item 4), which is exactly why neither the demo
script nor this file quotes one.

**policyCheck is still honest about its gaps** — the list in `backend/agent/README.md` and the
`ponytail:` comments in `policy-check/checks.mjs`. An answer spelled as a word in prose, one-step
problems where the hint is the answer, and hex/rot13 encodings still get through. Two new ceilings
joined that list today, both named in the code: a model that fabricates a matching figure pair
escapes check 6, and a child named only by a surname spelled as an ordinary English word escapes
check 2.

**Two things to confirm on the first live invoke**, both flagged rather than guessed:
`@aws-sdk/s3-request-presigner` is assumed present in the `nodejs20.x` runtime on the same
precedent as `@aws-sdk/lib-dynamodb`, which `ddb.mjs` has relied on since M1 — if a cold start dies
on `MODULE_NOT_FOUND`, the fallback is hand-rolled SigV4 query signing with `node:crypto`. And
`si-LK` either works in Transcribe or it does not, in which case one `null` in the language table
is the whole change.

**Sinhala and Tamil need a native-speaker review before the demo**, in this order:

| Keys | Why these first |
|---|---|
| `parent.approved`, `parent.ask.unverified` | They carry the approved-vs-assistant safety distinction |
| `student.promise`, `student.example.label`, `student.example.note`, `student.blocked` | The "hints, never the answer" promise in words |
| `redteam.warning.body`, `.alone`, `.not_persisted` | The whole requirement 11.6 warning, and the "withdraws credit" distinction |
| `redteam.score.by_layer` vs `.by_layer_withdrawn` | "Held" and "attributed" must stay distinct, or today's fix is undone in translation |
| `voice.*` (3, once lane D4 adds them) | Each says: it did not work, nothing was saved, type it instead |

Terminology to sanity-check while reviewing: si `ස්තරය` (layer), `ටෝකනය` (token), `නිර්ණය`
(verdict), `කාන්දු විය` (leaked); ta `அடுக்கு`, `டோக்கன்`, `தீர்ப்பு`, `கசிந்தது`.

**The branch.** `feat/m4-student-tutor` — sixteen commits, green, unmerged. Decide whether M4–M6 go to
`main` before the deploy; `amplify.yml` watches `main`, so Amplify will show nothing until they do.

---

## 4. Decisions still open

| # | Decision | Needed by |
|---|---|---|
| 1 | Merge `feat/m4-student-tutor` into `main`? Amplify watches `main` | before 0.15 |
| ~~2~~ | ~~Public GitHub repo URL~~ — **closed 2026-11-18**: `github.com/nishenmadawa15-collab/panthiya` is the real remote and is already in `frontend/index.html`. No placeholder was ever in the repo | — |
| 3 | Region: `ap-south-1` if Bedrock Managed Agents and the model are available there, else `us-east-1` | before the first deploy |
| 4 | Model choice after the day-1 Sinhala test | before M1 merge |
| 5 | Should `chat/orchestrate.mjs` echo the `role` it read from the verified claims? One line, and it closes the last ceiling in `score.mjs` — the page and the CLI could then verify the session role instead of trusting the caller's own label | before 5.7 |
| 6 | Native review of every Sinhala and Tamil string (the table above) | before M6 is called done |
| 7 | **Half closed 2026-11-18.** The Kiroween rules were read in full from the official page: **nothing in them forbids submitting the same project elsewhere**, the deadline is Dec 4 2:00 PM PT, and judging runs to 2027-01-29 with the project required to stay live for judges throughout (see §0b). Still open: the **Bedrock challenge itself cannot be found** — Devpost's own search for *"agents your rules"*, *"bedrock agents"* and *"managed agents"* returns no such event, on top of two web searches, so `PANTHIYA_SETUP.md` §6 is its only source. **Kiroween is currently the only verified deadline this project has** | **blocking, Nishen only — the invitation email** |

---

## 5. Calendar

| Date | Milestone |
|---|---|
| **Nov 18** | ~~Bedrock challenge rules publish~~ — **no such event could be found.** Kiroween's rules were read instead and permit a parallel submission; the Bedrock challenge needs its invitation email |
| **Dec 1, 12:00 PT** | **Kiro credit request deadline** — 4,000 credits, one allotment, requested through the Credit Request Form with the Kiro user ID or AWS account ID |
| **Dec 4, 14:00 PT** | **Kiroween submission and registration close.** No extensions, no late submissions (Dec 5, 03:30 in Sri Lanka) |
| Dec 16 – Jan 29 | **Kiroween judging.** The project must stay available to judges for testing throughout — so the stack stays up, and task 7.9 is answered |
| Nov 25 | M4 student tutor done — **done early, on Nov 17** |
| Nov 26–27 | M5 red-team page, 36/36 on screen — page and CLI built; the live score needs the deploy and the two demo logins |
| Nov 28 | M6 voice + trilingual polish |
| Nov 29–30 | M7 docs, record the demo video |
| **Dec 1** | Submit to Bedrock |
| **Dec 3** | Submit to Kiroween |

Budget: **~$2.50 typical, ~$9.80 ceiling** for everything to 2027-01-29, against a $15 target — re-costed 2026-11-19, working in `docs/COST-MODEL.md`. Spent so far: **$0**.
