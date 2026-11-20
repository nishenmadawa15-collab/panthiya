# Nishen — everything only you can do (2026-11-20)

**12 days left.** Bedrock submission: **Dec 2, 11:59 PM PT** (Sri Lanka: **Dec 3, 1:29 PM**).
Kiroween: **Dec 4, 2:00 PM PT**.

Every item here is something an agent cannot do: it needs credentials, your account, or your
judgement. Everything else I do.

> **When you see a code block, copy only that.** One command per block. Pasting a sentence into a
> terminal gives you `syntax error`.

---

## 🔴 Part 1 — nothing else can move until these four are done

Four days have been lost at exactly this point. Once these are done, the deploy, the 36 live
cases, the video and both submissions can all start.

### 1.1 Console sign-in for `panthiya-dev` — **browser** (3 min)

**No access keys, ever.** Credentials come from `aws login`: short-lived, refreshed by the CLI,
nothing long-term to leak. *(Changed 2026-11-20 — the old access-key steps are gone.)*

Already done by the agent: the user `panthiya-dev` exists, with the eight managed policies, the
inline `panthiya-deploy-extra` (`docs/iam/panthiya-dev-extra.json`) and `SignInLocalDevelopmentAccess`
(what `aws login` itself needs). It has **no access key**.

What only you can do — give it a console password:

1. AWS Console (as root, this once) → **IAM** → **Users** → **panthiya-dev**
2. **Security credentials** tab → **Enable console access** → set a password
3. Note the account's **IAM sign-in URL** shown there (`https://477013660512.signin.aws.amazon.com/console`)

### 1.2 `aws login` — in a **separate PowerShell window** (1 min)

It opens a browser, so it **cannot run inside Claude Code**. Windows search → **PowerShell**:

```
aws login --region ap-south-1
```

Sign in as **IAM user `panthiya-dev`** — **not root**. Then check:

```
aws sts get-caller-identity
```

The `Arn` must end in **`user/panthiya-dev`**. If it says `root`, sign out of the console in that
browser and run `aws login` again. The session lasts up to 12 hours; when a command says the token
has expired, run `aws login` again.

> If a tool cannot read `aws login` credentials, a temporary session can be handed to it with
> `aws configure export-credentials --format powershell` — still short-lived, still no key.

### 1.3 SAM CLI — **same PowerShell window** (2 min)

```
winget install --id Amazon.SAM-CLI -e
```

Windows will pop up *"Do you want to allow this app to make changes?"* → click **Yes**.
**Yesterday's attempt failed only because that prompt went unanswered** (exit code 1602 =
*"you cancelled the installation"*). It is one click.

```
sam --version
```

### 1.4 Join the hackathon — **browser** (5 min)

```
https://builder.aws.com/build/hackathons/61c39fba-1383-37e7-bd5c-3f9d889d89fc/agents-your-rules-bedrock-managed-agents-build
```

The *Your project* tab says only **"Join this hackathon to get started"**. **There is no submission
surface until you join** — and no way to see what fields the form even asks for. It needs your own
Builder Center profile, so an agent cannot do it.

After you join: tell me what fields the submission form has, and I will shape
`docs/SUBMISSION-BEDROCK.md` to match it exactly.

**→ Tell me when these four are done, and I will take it from there.**

---

## 🟡 Part 2 — four decisions (wording and policy, not code)

I am not making these, because they are yours. Each one has my recommendation — say "yes" and I
will implement it.

### 2.1 Approve switching AgentCore Memory **off**

AgentCore Memory is **on by default**. Left on, it persists **children's chat conversations** in
AWS-managed long-term memory.

**My recommendation: off.** `backend/agentcore/create-harness.json` already sets
`memory: {"disabled": {}}` — but that is a **data-retention decision about minors**, which is
yours to make, not mine to assume.

- [x] **Off — approved** (2026-11-20)

### 2.2 Approve the §3 "one job" paragraph

Qualification **requirement 1** asks for an agent doing **one defined job**. Our
`docs/SUBMISSION-BEDROCK.md` §3 opens with a table of **three roles** — which, read cold, looks
like three jobs.

It is one job: **running a tuition class under eight rules**. The three roles are **scoped tool
sets** of that job, which is exactly how it is built — one harness, with `tools` and
`systemPrompt` passed per invocation from the verified role.

**The build is already right. Only the sentence was missing.** That makes it the cheapest possible
way to fail: every checkbox green, and the qualification check is pass/fail.

**I have written the paragraph** into §3, marked `⚠️ DRAFT, awaiting Nishen's approval`. §1 also
has a **third** tagline option that names the job.

- [x] **Read and approved** (2026-11-20)
- [x] Tagline: **3** for the submission (safest against the pass/fail check); 1 stays the product line (2026-11-20)

### 2.3 Requirement 8.3 — the *"nor deny"* clause

The requirement says the student tutor may neither **confirm nor deny** an answer. Today:

| What the tutor says | What happens now |
|---|---|
| `Yes.` | **blocked** ✅ |
| `No.` | allowed ❌ |
| `That is incorrect, try once more.` | allowed ❌ |

**But enforcing it as written causes a worse problem:** *"That's not right — look again at the
method you used"* is **exactly what a tutor is supposed to do**. Blocking it removes the point of
the product.

**My recommendation:** narrow the requirement. A plain "no" is fine; what must stay blocked is a
denial that **carries the answer** (`No, it's 7`) or that can be used as a **binary search**. Then
record it as a ceiling in `docs/TRACEABILITY.md`.

- [x] **Narrow the requirement** — done in `requirements.md` 8.3 (2026-11-20)

### 2.4 `401` or `403`

Requirement **1.4** says `401`. But **four of five functions** return `403`, and
`tests/unit/read.test.mjs:342` asserts the 403 **as correct**.

The token *is* verified; it just has no role. That means *"I know who you are, you may not do
this"* = **`403`**. `401` means *"I don't know who you are"*.

**My recommendation: the code is right, move the requirement.**

- [x] **Change the requirement to `403`** — done in `requirements.md` 1.4 (2026-11-20)

---

## 🟢 Part 3 — Translation (the only code work nobody else can do)

`docs/TRANSLATION-REVIEW.md` → **read Priority 1c first.**

Its **option A** needs **no translation at all** (condition the two notes on the `MOCKING` flag
that already exists). So reading that one first can **remove** work from this list rather than
add it.

- [ ] **Priority 1c** — choose A / B / C ← **start here**
- [ ] **Priority 0** — 30 seconds
- [ ] **Priority 1** — about 20 minutes
- [ ] **Priority 1b** — `teacher.note`, `student.note` (si + ta)

**Why I don't do this:** no automated check can tell fluent Sinhala from Sinhala-shaped nonsense.
Five milestones rest on it, and the judges will be reading your language.

---

## 🔵 Part 4 — dated items (**these cannot be recovered if missed**)

| When | What |
|---|---|
| **before Dec 1, 12:00 PT** | 🔴 **Request the 4,000 Kiro credits.** One allotment, no second chance |
| Nov 21 | Re-read **one sentence** on the rules page (below) |
| Dec 1 | Submit Bedrock (target) |
| Dec 3 | Submit Kiroween (target) |
| **until 2027-01-29** | The project must stay **live** — do not tear it down |

**That one sentence:** does *"the AgentCore managed harness"* on the rules page mean the
`CreateHarness` product specifically, or AgentCore generally? **Our path satisfies both readings**,
so this **confirms rather than blocks** — but it is a reading of a judge's intent, which is not an
agent's to make.

---

## ⚪ Part 5 — after the deploy (only once credentials exist)

Not possible yet. **I will tell you when each one is ready.**

- [ ] 🚦 **The Sinhala gate** — run `scripts/test-sinhala.mjs` and **read the replies by eye**
- [ ] **Approve the deploy** — `sam deploy`, the first thing that spends money
- [ ] **Merge `feat/m4-student-tutor` → `main`?** It is **41 commits** ahead. `amplify.yml` watches
      `main`, so Amplify shows nothing until it lands
- [ ] **The Kiro write-up decision** — `docs/DECISION-KIRO-WRITEUP.md` (A / B / C)
- [ ] **Record the demo video** — `docs/DEMO-SCRIPT.md`, under 3 minutes, with an 11-item
      prerequisite table
- [ ] **Submit both**

---

## ⚠️ One IAM permission to never grant, on deploy evening

```
bedrock-agentcore:InvokeAgentRuntimeCommand
bedrock-agentcore:InvokeAgentRuntimeCommandShell
```

AWS's own documentation: *"To prevent direct command execution, do not grant
`bedrock-agentcore:InvokeAgentRuntimeCommand` in your IAM policies."*

Both of them **execute commands without passing through the model at all** — which routes
completely around `allowedTools`, the guard that stops this agent being handed a shell and
filesystem write.

The chat Lambda needs **`bedrock-agentcore:InvokeHarness`** and nothing else from that namespace.
The prefix looks almost identical, so it is exactly what someone pattern-matches at 1am on the one
evening everything is being written in a hurry. That is why it is recorded in **four** places.

---

## Status (end of 2026-11-20)

| | |
|---|---|
| Tests | **790 pass**, 0 fail (633 yesterday) |
| Tasks | 67 / 79 |
| Spent | **$0** — nothing deployed |
| `main` | untouched |
| Commits today | 9 |
| Challenge rules | **read** — `docs/CHALLENGE-RULES-BEDROCK.md` |
| Orchestrator | **AgentCore harness** — decided by the rules, not by preference |

**What I am doing now:** making the approval gate reachable (`approveParentUpdate` into the teacher
schema, plus a drafts view), and tests for the `parent.js` fetch swap. Neither needs credentials.

**Ready to start the moment credentials exist:** the two read-only probes → the Sinhala gate →
execution role → `CreateHarness` → the first `InvokeHarness` → deploy → seed → the 36 live cases →
verification pass → README screenshots → both submissions.
