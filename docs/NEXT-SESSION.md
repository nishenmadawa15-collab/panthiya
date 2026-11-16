# Next session — start here

Written at the end of 2026-11-16. Read this, then `.kiro/specs/panthiya/tasks.md`.

---

## Where we are

**41 of 79 tasks done. 270 tests pass. Nothing has been deployed and nothing has been spent.**

| Milestone | State |
|---|---|
| M0 hello page | Code complete. Repo public at `github.com/nishenmadawa15-collab/panthiya` with `.kiro/` committed |
| M1 data model + teacher chat | Code complete. SAM template, 8 tables, teacher actions, chat orchestrator, seed |
| M2 roles + parent view | Code complete except hosted-UI sign-in (2.3) and export/delete endpoints (2.10) |
| M3 defence layers | policyCheck done. Guardrail defined but not created in AWS. Audit screen (3.6) not built |
| M4 student tutor | Not started |
| M5 red-team page | Suite generated. Runner and page not built |
| M6 voice + polish | Not started |
| M7 docs + submissions | Not started |

Everything above runs offline. Not one line of it has met a real Bedrock agent, which is the
single largest unknown in the project.

---

## 1. What only Nishen can do, in this order

Nothing else can be verified end to end until these are done. Credentials are not the agent's to
enter.

```bash
# 1. AWS credentials — IAM user panthiya-dev, never root (PANTHIYA_SETUP.md §4)
aws configure

# 2. SAM CLI
winget install Amazon.SAM-CLI
```

**3.** AWS Console → Bedrock → **Model access**: enable `amazon.nova-micro-v1:0`,
`amazon.nova-lite-v1:0` and a Haiku-class model. Confirm Bedrock **Managed Agents** exist in
`ap-south-1`; if not, everything moves to `us-east-1` and the region parameter changes.

**4.** Amplify Hosting → connect `nishenmadawa15-collab/panthiya`, branch `main`. `amplify.yml` has
no build step, so it should go green first try.

**5.** The blocking gate, costing well under 5 cents:

```bash
node scripts/test-sinhala.mjs --yes
```

> **Why this is first.** Four milestones of code now rest on the assumption that the cheapest model
> can read Sinhala. If Nova Lite mangles it, the model changes and M1–M6 prompts change with it.
> Read the Sinhala replies by eye — the automatic check cannot tell fluent Sinhala from
> Sinhala-shaped nonsense.

---

## 2. Tomorrow's lanes

### Track B — offline, can start immediately, needs no AWS

Run these in parallel. They touch separate directories, so they will not collide.

| Lane | Specialist | Deliverable | Tasks | Notes |
|---|---|---|---|---|
| **B1** | Senior Developer | `backend/functions/actions-student/` — `getHint`, `getSimilarExample`, with **no** IAM data access | 4.1, 4.2, 4.5, 4.7 | The example must differ numerically from the question, or policyCheck blocks it (case C8). Tests must cover C1–C10 offline |
| **B2** | Frontend Developer | `frontend/student/` — tutor chat, hint cards, the styled "different example" card | 4.6 | Must render `[[EXAMPLE]] … [[/EXAMPLE]]` as a visibly distinct card. Match `parent/` conventions exactly |
| **B3** | Backend Architect | `backend/functions/redteam/` — runner, teacher-only, per-layer toggles, writes `redteam_runs` | 5.3, 5.4 | Toggles are per-run only and must not persist (req 11.6). Runner goes through `POST /chat`, so every case exercises the full path |
| **B4** | Frontend Developer | `frontend/redteam/` — case table, live Blocked/Leaked scoreboard, which layer blocked, reply text, persistent warning when a layer is off | 5.5 | This is the money shot of the demo. It reads `tests/redteam/cases.json` |
| **B5** | Identity & Access Engineer | Student export and delete endpoints; teacher audit-log screen | 2.10, 3.6 | `get`/`del` already exist in `ddb.mjs`. Audit entries must be scoped to the teacher's own classes |
| **B6** | Voice AI Integration Engineer | `backend/functions/voice/` — presigned S3 PUT, Transcribe job, transcript back to `/chat`, honest unsupported-language fallback | 6.1, 6.2, 6.3 | Can be written and unit-tested offline; only the live run needs AWS |

**Suggested order if running fewer lanes at once:** B1 + B3 first (they unblock the demo
narrative), then B2 + B4, then B5 + B6.

### Track A — serial, each step needs the previous one

| Step | Task | Who | Gate |
|---|---|---|---|
| A1 | Day-1 Sinhala gate | Nishen runs, agent reads the output | **Blocks everything below** |
| A2 | Create the Bedrock agent + the three action groups from `backend/agent/schemas/` | Nishen in console, agent guides | Record IDs as SAM parameters (1.11) |
| A3 | Create the Guardrail from `backend/agent/guardrail.json` | Nishen in console | Record ID + version (3.1) |
| A4 | `sam deploy --guided` | **Ask Nishen before running — costs money** | 1.15 |
| A5 | `node backend/seed/seed.mjs --stack panthiya --apply` | Agent, after A4 | Writes 99 fictional items |
| A6 | Amplify connect + confirm the live URL on a phone | Nishen | 0.15 |
| A7 | Run all 36 live from `/redteam`, fix every leak | Agent | 5.7 — the first real score |

---

## 3. Things to watch

**Three bugs this session survived a fully green test suite** and would have failed on AWS: the
table env-var names, the Lambda packaging root, and a front-end module served as `text/plain`.
Each now has a guard that reads the real configuration rather than a mock
(`env-contract.test.mjs`, `packaging.test.mjs`, the `.mjs` ban in `frontend.test.mjs`).

The lesson is worth carrying into tomorrow: **a passing suite is not evidence that a thing runs.**
Open the page, read the deployed config, send the real request.

**policyCheck is honest about its gaps** — see the list in `backend/agent/README.md` and the
`ponytail:` comments in `policy-check/checks.mjs`. An answer spelled as a word in prose, one-step
problems where the hint is the answer, and hex/rot13 encodings still get through. Do not claim 36/36
on stage without re-reading that list first.

**Sinhala and Tamil strings need a native-speaker review** before the demo. The two that matter most
are `parent.approved` and `parent.ask.unverified` — they carry the whole approved-vs-assistant
safety distinction. The full list is in each lane's notes and in `BUILD-LOG.md`.

**Branch convention drifted.** `structure.md` asks for one feature branch per milestone; in practice
M2/M3/M5 work landed directly on `main` after `feat/m1-teacher-chat` was merged. `main` is correct
and every test passes on it. Start tomorrow with a fresh `feat/m4-student-tutor` branch off `main`.

---

## 4. Calendar

| Date | Milestone |
|---|---|
| **Nov 18** | Bedrock challenge rules publish — check whether submitting the same project to Kiroween is allowed |
| Nov 25 | M4 student tutor done |
| Nov 26–27 | M5 red-team page, 36/36 on screen |
| Nov 28 | M6 voice + trilingual polish |
| Nov 29–30 | M7 docs, record the demo video |
| **Dec 1** | Submit to Bedrock |
| **Dec 3** | Submit to Kiroween |

Budget: ~$7 estimated against a $15 target. Spent so far: **$0**.
