# *Agents, your rules: Bedrock Managed Agents build* — the rules, read from the rules page

**Read 2026-11-20 from the live page, signed out — it is public.**
<https://builder.aws.com/build/hackathons/61c39fba-1383-37e7-bd5c-3f9d889d89fc/agents-your-rules-bedrock-managed-agents-build>
(the **Rules** tab is `?tab=rules` on that URL; the page is client-rendered, so a plain fetch returns
`Loading hackathons…` — it has to be opened in a browser, which is why three sessions could not find it.)

This file is a **summary in our own words** with the decisive phrases quoted short. It is not the
rules. Where this file and the page disagree, **the page wins** — re-read it before submitting.

---

## 1. What it settles, and it is not what the repo assumed

| Question the repo carried as open | Answer |
|---|---|
| Does the event exist, and where | **Yes.** AWS Builder Center, live, 929 participants when read. `PANTHIYA_SETUP.md` §1 was right and Devpost was always the wrong site |
| Deadline | **Dec 2 2026, 11:59 PM PT** — Dec 3, 1:29 PM in Sri Lanka. The repo's claim is now confirmed by the rules page itself |
| Is Sri Lanka eligible | **Yes.** The exclusion list names fifteen countries and three regions; Sri Lanka is not among them. 18+, and a `builder.aws.com` profile is required |
| May the same project also go to Kiroween | The rules require the agent to be **original and not previously published**, and limit **one entry per person or team**. Nothing forbids entering it elsewhere — matching what the Kiroween rules already said |
| **Which service is required** | Quoting the one sentence that decides this project's architecture: **"an agent built on Amazon Bedrock Managed Agents or the Amazon Bedrock AgentCore managed harness"** |

## 2. Why that last row is the whole story

Agents Classic cannot be created on this account — `CreateAgent` returns `AccessDeniedException`,
the allowlist is automatic, and AWS publishes no exception process. That leaves **AgentCore**.

**Option B — our own `Converse` + `toolConfig` loop, built and passing 23 tests — is not, by itself,
an agent built on either named service.** It was the safe engineering choice while the rules were
unknown; as a submission on its own it fails the qualification check. §0a of `docs/NEXT-SESSION.md`
is therefore decided by the rules rather than by preference, and `docs/AGENTCORE-PLAN.md` is the
lane answering what that costs — in particular whether AgentCore Runtime can host the loop we
already have, which would mean the tool loop moves rather than dies.

## 3. The qualification check is pass/fail, with no exceptions

A submission missing **any** of the following does not reach judging, however good the project is.
Each row is a thing that must be *in the published project*, not merely true of the code.

| # | Required | Where Panthiya stands today |
|---|---|---|
| 1 | A working agent on BMA or the AgentCore harness, doing **one defined job** | **The gap.** Everything else exists; the agent does not. See `docs/AGENTCORE-PLAN.md` |
| 2 | A written rule set in plain language: what it may access, what it must refuse, how it handles edge cases | `backend/agent/instructions.md` + `backend/agent/README.md` — needs assembling into the project text |
| 3 | How **each** rule is enforced — guardrails, scoped IAM, action-group limits, confirmation steps — with an architecture description or diagram | Three defence layers, the IAM separation and `policy-check/` already exist. **The diagram does not yet exist** (task 7.1) |
| 4 | A stress test of **at least five** adversarial prompts, **at least one a prompt injection**, each with what it tried and how the agent answered | 36 cases in `tests/redteam/cases.json`, never run live. The live run is the evidence; estimates are not |
| 5 | A project published **on AWS Builder Center** covering the agent, the job, the rules, the enforcement, the stress-test results, the build process, **and any rule that broke in testing and how it was fixed** | `docs/SUBMISSION-BEDROCK.md` is the draft. The "what broke" half is the strongest material this repo owns — `docs/BUILD-LOG.md` records every bypass and every defect found behind a green suite |
| 6 | A link to the code repository or a demo, **and at least one screenshot of the agent running** | Repo is public; the screenshot needs the deploy |
| 7 | An original agent, not previously published | Yes |
| 8 | If a repository is given it must be **public under an approved OSI licence** | `LICENSE` — MIT. Satisfied |
| 9 | If a demo video is given it must be public, with no third-party trademarks or copyrighted music | Kiroween requires a video; this one does not. One video can serve both if it stays clean |

## 4. How it is scored, once it qualifies

Two gates, Dec 3 – Dec 18, four criteria at 25% each: technical innovation and originality; craft
and execution (does the agent do its job reliably and do the rules hold under the stress test);
usefulness and impact; and creativity and storytelling (how clearly the project explains the rules,
the testing and what was learned). Top 50 by composite score advance to a panel of AWS judges, who
pick five winners. Prize: $1,000 in AWS credits and a swag bundle each; winners the week of Dec 21.

Two sentences from the About page are worth building toward, because they describe this project:
layered controls — a guardrail **and** a scoped IAM policy **and** an action confirmation — score
higher than prompt instructions alone; and honest write-ups about what broke count in the
entrant's favour.

## 5. What only Nishen can do here

1. **Join the hackathon.** The *Your project* tab says only "Join this hackathon to get started" —
   the submission surface does not exist until he joins, with a Builder Center profile, under his
   own account. No agent should join on his behalf.
2. **Publish the project** on Builder Center — the submission is a written project there, not a form.
3. **Confirm eligibility details** that are his to state: 18+, country of residence, not an Amazon
   employee. Verification can be against LinkedIn or other public profiles at the finalist stage.

## 6. What is still unverified

- Whether **AgentCore** is reachable on this account at all. Agents Classic was not, and nothing
  read today says AgentCore is ungated. `scripts/bma-probe.mjs` is the cheap answer and it needs
  credentials.
- Everything about the agent's live behaviour. Nothing in this project has run against AWS yet.
