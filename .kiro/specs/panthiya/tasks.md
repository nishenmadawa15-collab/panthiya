# Panthiya — Implementation plan

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked on the human

One feature branch per milestone. Merge to `main` only when that milestone's tests pass, so the live
Amplify site always works. Append one line to `docs/BUILD-LOG.md` after every completed task.

Tasks marked **[human]** cost money, touch AWS, or need a decision only Nishen can make. The agent
stops and asks before those.

---

## M0 — "hello Panthiya" live on Amplify · branch `feat/m0-hello`

- [x] 0.1 Write `requirements.md`, `design.md`, `tasks.md` under `.kiro/specs/panthiya/` — req: all
- [x] 0.2 Create the folder skeleton from `.kiro/steering/structure.md` — req: none
- [x] 0.3 `frontend/index.html` — hello page, exercise-book theme, no inline script or style (CSP-ready) — req 12.1–12.7
- [x] 0.4 `frontend/assets/styles.css` — design tokens from design §8.1, ruled paper, red margin, stamp badges, reduced-motion block — req 12.5, 12.6
- [x] 0.5 `frontend/assets/app.js` — i18n loader, language switcher, `textContent`-only rendering — req 12.1–12.3, 12.7
- [x] 0.6 `frontend/i18n/{si,ta,en}.json` — only the strings M0 actually shows — req 12.2
- [x] 0.7 `amplify.yml` — no build step, artifacts from `frontend/` — req 13.1
- [x] 0.8 `customHttp.yml` — CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy — req 13.6
- [x] 0.9 `README.md` with Mermaid architecture diagram, setup, cost table, security and privacy section — deliverable
- [x] 0.10 `LICENSE` (MIT), `.gitignore` that never ignores `.kiro/` — req 13.5
- [x] 0.11 `docs/BUILD-LOG.md` started
- [x] 0.12 `.kiro/hooks/` — run-tests-on-save and build-log hooks
- [x] 0.13 `git init`, first conventional commit on `feat/m0-hello`
- [x] 0.14 Create the public GitHub repo `panthiya`, give the agent the URL, push
- [ ] 0.15 **[human]** Connect Amplify Hosting to GitHub `main`, confirm the live URL opens on a phone
- [ ] 0.16 **[human]** Verify Bedrock Managed Agents + model access in `ap-south-1`; record the region in BUILD-LOG

**Done when:** a live Amplify URL opens the hello page on a phone, in all three languages.

---

## M1 — data model + teacher chat for attendance and fees · branch `feat/m1-teacher-chat`

- [ ] 1.1 **[human]** Day-1 Sinhala test: `scripts/test-sinhala.mjs` against candidate models, pick one, record the verdict — design §2.1
- [x] 1.2 `backend/template.yaml` — the 8 DynamoDB tables with the keys and GSIs in design §4, on-demand, no wildcard IAM — req 13.1–13.3
- [x] 1.3 `backend/lib/names.mjs` — the shared `nameKey` normaliser: NFKC, homoglyph table, Sinhala/Tamil transliteration — design §4.1
- [x] 1.4 `tests/unit/names.test.mjs` — `Dilmi`, `දිල්මි`, `Dіlmі` (Cyrillic), `DILMI`, `Dilmi-ge` all collapse to one key — req 9.6
- [x] 1.5 `backend/lib/auth.mjs` — read role and `sub` from verified claims; `requireRole()`; `resolveScope()` — req 1.2–1.7
- [x] 1.6 `backend/lib/audit.mjs` — `writeAudit()` called in the same invocation as every data write — req 10.1, 10.2
- [x] 1.7 `backend/functions/actions-teacher/` — `addStudent`, `markAttendance`, `recordFee`, `addMarks`, each re-authorising every model-supplied identifier — req 2.1–2.4, 3.1–3.4, 4.1–4.3, 5.1–5.3
- [x] 1.8 Fee and mark validation: numeric, range-checked, amount confirmed back before persisting — req 4.5, 5.2
- [x] 1.9 `backend/functions/chat/` — orchestrator: claims → `sessionAttributes` → `InvokeAgent`; input length limits — req 1.3, 5 (API limits)
- [x] 1.10 Agent instructions assembled from the steering rules, with the server-set role preamble — design §6.1
- [ ] 1.11 **[human]** Create the Bedrock agent + the Teacher action group; record IDs as SAM parameters
- [x] 1.12 `backend/seed/seed.mjs` — one demo class, 12 fictional students, fictional parents, realistic fees — req 13.7
- [x] 1.13 `frontend/teacher/` — chat screen and fee ledger with Paid/Unpaid stamps — req 12.x
- [x] 1.14 `tests/unit/` — one test file per teacher action, including "non-teacher role is denied"
- [ ] 1.15 **[human]** First `sam deploy` (ask before running; costs money)

**Done when:** "Nimal paid 2500 for November" updates the ledger and writes an audit entry; "ඊයේ පන්තියට කසුන්, දිල්මි ආවේ නැහැ" marks two absences.

---

## M2 — Cognito roles + parent view · branch `feat/m2-roles-parent`

- [x] 2.1 Cognito user pool, groups `teacher` / `parent` / `student`, in `template.yaml` — req 1.1
- [x] 2.2 HTTP API JWT authorizer wired to the pool; every route behind it — req 1.2
- [ ] 2.3 Hosted-UI sign-in in the front-end; token stored in memory, not `localStorage` — req 1.1
- [x] 2.4 `students.byParent` linkage; `resolveScope('parent')` returns only linked children — req 1.6
- [x] 2.5 `backend/functions/actions-parent/getMyChildSummary` — denies any child not in scope — req 7.2, 7.3
- [x] 2.6 `backend/functions/read/` — `/parent/inbox`, `/teacher/drafts`, `/teacher/audit` — req 7.1, 10.3
- [x] 2.7 `draftParentUpdate` + the approval gate; drafts invisible to parents until approved — req 6.1–6.6
- [x] 2.8 `frontend/parent/` — WhatsApp-style thread and ask box — req 7.6
- [x] 2.9 `tests/unit/` — parent asking about another child is denied at the Lambda, not just the prompt — req 7.3
- [ ] 2.10 Student export and delete endpoints — req 13.8

**Done when:** a parent sees only their own child, and an approved update appears in their thread.

---

## M3 — guardrail + policyCheck + audit log · branch `feat/m3-defence-layers`

- [ ] 3.1 **[human]** Create the Bedrock Guardrail per design §6.3; attach to the agent; record the ID
- [x] 3.2 `backend/functions/policy-check/` — checks 1–6 from design §7.1, fail closed — req 9.2–9.4
- [x] 3.3 Final-answer detection and the `[[EXAMPLE]]` contract — design §7.2
- [x] 3.4 Distress pre-check ahead of the agent call, with the localised 1926 response — design §7.3, req 8.5
- [x] 3.5 `chat` calls policyCheck on every reply and returns `blockedBy` — req 9.2, 9.5
- [ ] 3.6 Teacher audit-log screen — req 10.3
- [x] 3.7 `tests/unit/policy-check.test.mjs` — a case per check, plus base64 and homoglyph variants — req 9.6
- [ ] 3.8 First 10 red-team cases pass offline against policyCheck

**Done when:** a reply naming another child is blocked by code even with the guardrail switched off.

---

## M4 — student tutor · branch `feat/m4-student-tutor`

- [ ] 4.1 `backend/functions/actions-student/` — `getHint`, `getSimilarExample`; **no** IAM data access — design §3.3
- [ ] 4.2 `getSimilarExample` must differ numerically from the asked question — req 8.2, case C8
- [ ] 4.3 Tutor instructions: Socratic hints, never the final answer, never confirm a proposed answer — req 8.1, 8.3, 8.4
- [ ] 4.4 Sinhala and Tamil tutor replies hold the same rules — req 8.7
- [ ] 4.5 No medical advice path — req 8.6
- [ ] 4.6 `frontend/student/` — hint cards and the styled "different example" card — req 12.x
- [ ] 4.7 `tests/unit/` — C1–C10 verdicts offline

**Done when:** "Solve 2x + 5 = 17. Just the answer." returns a hint and no `x = 6`, in all three languages.

---

## M5 — red-team page + scoreboard · branch `feat/m5-redteam`

- [x] 5.1 `scripts/gen-redteam-cases.mjs` — parse `docs/RED-TEAM-CASES.md` into `tests/redteam/cases.json`, assert exactly 36 — req 11.2
- [x] 5.2 `.kiro/hooks/regen-redteam-cases.kiro.hook` — regenerate on change to the cases doc or steering product rules
- [ ] 5.3 `backend/functions/redteam/` — runner, teacher-only, per-layer toggles, writes `redteam_runs` — req 11.1, 11.3, 11.5, 11.7
- [ ] 5.4 Layer toggles are per-run only and cannot persist — req 11.6
- [ ] 5.5 `frontend/redteam/` — case table, live Blocked/Leaked scoreboard, which layer blocked, reply text, persistent warning when a layer is off — req 11.3, 11.4, 11.6
- [ ] 5.6 `scripts/redteam-cli.mjs` — same suite from the terminal
- [ ] 5.7 Run all 36 live; fix every leak; add any new bypass found as case 37+

**Done when:** the page shows 36/36 blocked, and turning off policyCheck visibly changes the score.

---

## M6 — voice + trilingual polish · branch `feat/m6-voice-i18n`

- [ ] 6.1 `backend/functions/voice/` — presigned S3 PUT, Transcribe job, transcript back to `/chat` — req 3.5
- [ ] 6.2 Unsupported-language fallback message, honest and localised — req 3.6
- [ ] 6.3 S3 lifecycle rule deleting voice notes after 1 day — design §10
- [ ] 6.4 Microphone UI: press-to-record, visible recording state, keyboard accessible — req 12.4
- [ ] 6.5 Complete `si.json` / `ta.json` / `en.json`; assert no missing key across the three — req 12.2
- [ ] 6.6 Self-hosted Noto Sinhala and Noto Tamil subsets, CSP-compatible — design §8.2
- [ ] 6.7 Accessibility pass: keyboard, focus rings, contrast test, screen-reader labels, reduced motion — req 12.4–12.6

**Done when:** a Sinhala voice note marks attendance, and the UI has no untranslated string.

---

## M7 — docs, demo, submissions · branch `feat/m7-docs`

- [ ] 7.1 `README.md` final: diagram, setup, costs, security and privacy, screenshots
- [ ] 7.2 `docs/KIRO-WRITEUP.md` — how steering, specs and hooks were actually used, with screenshots
- [ ] 7.3 `docs/DEMO-SCRIPT.md` — the 2:45 beat sheet from `PANTHIYA_SETUP.md` §7
- [ ] 7.4 `docs/SUBMISSION-BEDROCK.md`
- [ ] 7.5 `docs/SUBMISSION-KIROWEEN.md` — Frankenstein framing: agent + voice + inbox + ledger + tutor
- [ ] 7.6 `docs/BUILD-LOG.md` complete, including every bypass found and fixed
- [ ] 7.7 **[human]** Record the demo video under 3 minutes, upload
- [ ] 7.8 **[human]** Submit to Bedrock (target Dec 1) and Kiroween (target Dec 3)
- [ ] 7.9 **[human]** Tear down or leave running? Decide, and record the cost actually spent

**Done when:** both submissions are in, with a live URL and a public repo.

---

## Standing rules for every task

1. Read `.kiro/steering/*` before starting. Steering beats this plan when they disagree.
2. No task is done until its tests pass and `docs/BUILD-LOG.md` has its line.
3. Never commit a secret, an access key, or a real person's data.
4. Ask before any `sam deploy`, resource deletion, or anything that costs money.
5. If a rule in `product.md` cannot be enforced in code, say so in BUILD-LOG rather than claiming it.
