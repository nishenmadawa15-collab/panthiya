# Next session — start here

Written at the end of 2026-11-17. Read this, then `.kiro/specs/panthiya/tasks.md`, then the
2026-11-17 block of `docs/BUILD-LOG.md` — the defects it records are the reason some of the lanes
below are shaped the way they are.

---

## Where we are

**57 of 79 tasks done. 440 tests pass, nothing skipped. Nothing has been deployed and nothing has
been spent.**

| Milestone | State |
|---|---|
| M0 hello page | Code complete |
| M1 data model + teacher chat | Code complete |
| M2 roles + parent view | Code complete except hosted-UI sign-in (2.3) |
| M3 defence layers | policyCheck done and audited. Guardrail defined but not created in AWS (3.1). Audit screen (3.6) not built |
| M4 student tutor | **Done** — action group, tutor page, C1–C10 proved offline |
| M5 red-team | Runner, scoreboard page and CLI done. The live run (5.7) needs AWS **and two demo logins** |
| M6 voice + polish | Backend done (6.1–6.3). Mic UI, i18n completeness, fonts and the a11y pass remain |
| M7 docs + submissions | Not started |

Three commits sit on `feat/m4-student-tutor`, which has not been merged. Everything still runs
offline, and not one line of it has met a real Bedrock agent — still the single largest unknown.

---

## 1. What only Nishen can do, in this order

Nothing below the gate can be verified end to end until these are done. Credentials are not the
agent's to enter.

```bash
# 1. AWS credentials — IAM user panthiya-dev, never root (PANTHIYA_SETUP.md §4)
aws configure

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

**5. New, and it blocks the demo: two more Cognito logins — a demo parent and a demo student.**
`POST /chat` takes the role from the verified JWT and must keep doing so (requirement 1.3), so the
parent and student red-team cases cannot be run with a teacher token. The seed creates fictional
students, not logins. Without them an honest run of the suite is **2 of 36 cases and 34 errors** —
which is what both the page and the CLI will correctly report, rather than quietly scoring a
teacher-answered privacy question as a pass.

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
| A2 | Create the Bedrock agent + the three action groups from `backend/agent/schemas/` | Nishen in console, agent guides | Record IDs as SAM parameters (1.11) |
| A3 | Create the Guardrail from `backend/agent/guardrail.json` | Nishen in console | Record ID + version (3.1) |
| A4 | `sam deploy --guided` | **Ask Nishen before running — costs money** | 1.15 |
| A5 | `node backend/seed/seed.mjs --stack panthiya --apply` | Agent, after A4 | Writes 99 fictional items |
| A6 | Amplify connect + confirm the live URL on a phone | Nishen | 0.15 |
| A7 | **Take the three SWAP POINTs**: `frontend/assets/redteam.js` (`tokenFor`, `postChat`, `postRun`, delete `MOCK`/`mockScore`) and `frontend/assets/student.js` (`askTutor`) | Agent, after A4 and D1 | The pages run on mocks until this |
| A8 | Run all 36 live from `/redteam`, and from `scripts/redteam-cli.mjs` for a diffable record. Fix every leak; add any new bypass as case 37+ | Agent | 5.7 — the first real score |
| A9 | `README.md` final, `SUBMISSION-*.md`, and the build log's last entry | Agent | 7.1, 7.4, 7.5, 7.6 |

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
`totals.byLayer` — "20 held by role scoping, 9 by the guardrail, 7 by policyCheck".

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

**The branch.** `feat/m4-student-tutor` — three commits, green, unmerged. Decide whether M4–M6 go to
`main` before the deploy; `amplify.yml` watches `main`, so Amplify will show nothing until they do.

---

## 4. Decisions still open

| # | Decision | Needed by |
|---|---|---|
| 1 | Merge `feat/m4-student-tutor` into `main`? Amplify watches `main` | before 0.15 |
| 2 | Public GitHub repo URL (placeholder `github.com/<your-user>/panthiya` is in README and `index.html`) | M0 go-live |
| 3 | Region: `ap-south-1` if Bedrock Managed Agents and the model are available there, else `us-east-1` | before the first deploy |
| 4 | Model choice after the day-1 Sinhala test | before M1 merge |
| 5 | Should `chat/orchestrate.mjs` echo the `role` it read from the verified claims? One line, and it closes the last ceiling in `score.mjs` — the page and the CLI could then verify the session role instead of trusting the caller's own label | before 5.7 |
| 6 | Native review of every Sinhala and Tamil string (the table above) | before M6 is called done |
| 7 | Nov 18 — whether the Bedrock challenge rules permit a parallel Kiroween submission | Nov 18 |

---

## 5. Calendar

| Date | Milestone |
|---|---|
| **Nov 18** | Bedrock challenge rules publish — check whether submitting the same project to Kiroween is allowed |
| Nov 25 | M4 student tutor done — **done early, on Nov 17** |
| Nov 26–27 | M5 red-team page, 36/36 on screen — page and CLI built; the live score needs the deploy and the two demo logins |
| Nov 28 | M6 voice + trilingual polish |
| Nov 29–30 | M7 docs, record the demo video |
| **Dec 1** | Submit to Bedrock |
| **Dec 3** | Submit to Kiroween |

Budget: ~$7 estimated against a $15 target. Spent so far: **$0**.
