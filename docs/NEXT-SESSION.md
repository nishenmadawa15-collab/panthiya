# Next session — start here

Written at the end of 2026-11-17. Read this, then `.kiro/specs/panthiya/tasks.md`, then the
2026-11-17 block of `docs/BUILD-LOG.md` — the defects it records are the reason some of the lanes
below are shaped the way they are.

---

## 0. Tonight's run sheet

The aim of this session is the one thing 455 passing tests cannot tell us: **whether any of it
works against a real Bedrock agent.** Everything else can wait, and nothing below is worth doing
out of order.

The commands are in §1. This is the order, who has to be at the keyboard, and where to stop.

| # | Step | Who | Time | Cost |
|---|---|---|---|---|
| 1 | `aws configure` (IAM user `panthiya-dev`), SAM CLI, Bedrock **model access**, and confirm Managed Agents exist in `ap-south-1` | Nishen | ~20 min | $0 |
| 2 | 🚦 **The Sinhala gate** — `node scripts/test-sinhala.mjs --yes`, and read the Sinhala replies by eye | Nishen runs, agent reads | ~5 min | under 5¢ |
| 3 | Bedrock agent + the three action groups + the Guardrail, in the console | Nishen, agent guides | ~25 min | $0 |
| 4 | 💰 `sam deploy --guided` | **Nishen approves before it runs** | ~10 min | ~$0 |
| 5 | `demo-users.mjs --apply`, then `seed --apply` — in that order, for the reason in §1 | Agent; Nishen sets the password | ~5 min | ~$0 |
| 6 | Take and verify the three SWAP POINTs | Agent | ~10 min | $0 |
| 7 | 🎯 **The 36 cases, live** — the CLI first because it is cheaper and diffable, then the page for the version a judge sees. Fix every leak | Agent | 30–40 min | ~$1–2 |

Nishen is needed for steps 1–4, roughly an hour in total. Steps 5–7 are the agent's.

**Step 2 is first for a reason.** Five milestones of code rest on the assumption that the cheapest
model can read Sinhala. If it cannot, the fix is a **parameter**, not a rewrite — switch to the
Haiku-class model, re-run the gate — but every prompt-sensitive behaviour has to be re-measured
against the new model, which means the 36 cases in step 7 and possibly some wording in
`backend/agent/instructions.md`. Doing step 2 after step 4 would mean paying for a deploy and then
discovering the score it produced was about the wrong model.

**Two decisions are needed before step 4**, both in §4: whether `feat/m4-student-tutor` merges into
`main` (Amplify watches `main`, so there is no live URL until it does), and whether
`chat/orchestrate.mjs` should echo the verified role.

**Where to stop.** Each step is a gate. If one fails, write what happened in `docs/BUILD-LOG.md`
and stop there — do not start debugging a failed deploy at one in the morning. The first live run
of anything finds things, and they are worth finding with a clear head. Nothing in this session is
on tonight's critical path except step 2, which is cheap enough to repeat.

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
   Belongs to lane **D4**, which owns the packs — and only one lane at a time may touch them.
3. **`README.md`'s status row is stale**: "M0–M3 code complete, 270 tests passing · 41/79 tasks".
   It is 455 tests and 59 of 79 now, and the repo URL and Amplify URL are still placeholders. Part
   of task 7.1.
4. **Two documents disagree about the expected by-layer split.** §3 of this file carried "20 held
   by role scoping, 9 by the guardrail, 7 by policyCheck", and `backend/agent/README.md` §7's tally
   maps to a different one. Both are pre-live guesses, and tonight's step 7 replaces them with the
   only number that matters — which is why the demo script prints neither and reads them off the
   screen.
5. **The `run-unit-tests` hook does not fire for `scripts/**`, `frontend/assets/**`,
   `backend/seed/**` or `tests/redteam/**`** — its globs cover `backend/functions`, `backend/lib`
   and `tests/unit` only. Three of today's lanes wrote code it would never have run. Two more globs
   close it; it is a decision about hook noise rather than a defect.

**Launched before this session, and running while step 1 happens:** lane **N1** (task 2.3 —
hosted-UI sign-in, the token held in memory, and the real `tokenFor(role)` that `/redteam` mocks)
and lane **N2** (tasks 7.2 and 7.3 — the Kiro write-up and the demo script). N1 is what step 6
verifies, so read its report before starting step 6: it will name what can only be checked live,
and the `template.yaml` lines its sign-in needs.

---

## Where we are

**60 of 79 tasks done. 469 tests pass, nothing skipped. Nothing has been deployed and nothing has
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

Eleven commits sit on `feat/m4-student-tutor`, which has not been merged. Everything still runs
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

### Tonight, in order, once `aws configure` is done

```bash
# a free look at what each step will do — neither of these touches AWS
node scripts/demo-users.mjs
node backend/seed/seed.mjs --stack panthiya

# after `sam deploy` has created the stack:
export PANTHIYA_DEMO_PASSWORD='<12+ chars, mixed case, a digit>'
node scripts/demo-users.mjs --apply            # three accounts, grouped, password set permanent
node backend/seed/seed.mjs --stack panthiya --apply   # 99 rows, with the real subs in them

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
| A2 | Create the Bedrock agent + the three action groups from `backend/agent/schemas/` | Nishen in console, agent guides | Record IDs as SAM parameters (1.11) |
| A3 | Create the Guardrail from `backend/agent/guardrail.json` | Nishen in console | Record ID + version (3.1) |
| A4 | `sam deploy --guided` | **Ask Nishen before running — costs money** | 1.15 |
| A5 | `node scripts/demo-users.mjs --apply` — the three logins, grouped, with a permanent password | Nishen sets `PANTHIYA_DEMO_PASSWORD`, agent runs it | **Before A6, not after.** The seed writes the subs these accounts own |
| A6 | `node backend/seed/seed.mjs --stack panthiya --apply` | Agent, after A5 | Writes 99 fictional items, with the real subs read back out of the pool. Refuses to run if A5 was skipped |
| A7 | Amplify connect + confirm the live URL on a phone | Nishen | 0.15 |
| A8 | **Take the three SWAP POINTs**: `frontend/assets/redteam.js` (`tokenFor`, `postChat`, `postRun`, delete `MOCK`/`mockScore`) and `frontend/assets/student.js` (`askTutor`) | Agent, after A6 and D1 | The pages run on mocks until this |
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

**The branch.** `feat/m4-student-tutor` — eleven commits, green, unmerged. Decide whether M4–M6 go to
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
