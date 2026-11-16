# 📚 Panthiya (පන්තිය) — Master Setup File

**What it is:** An AI assistant for Sri Lankan tuition classes. Teachers manage fees, attendance and marks by simply talking to it (Sinhala / Tamil / English). Parents get trusted WhatsApp-style updates. Students get a past-paper tutor that gives hints, never answers.

**Tagline:** *"Your tuition class, on autopilot — and it never breaks the rules."*
**Builder:** Nishen Madawa Abedeera · Cybersecurity & Cloud Computing undergraduate, SLTC, Sri Lanka
**Repo:** `panthiya` (public, MIT)

This starter pack contains:

| File | What it's for |
|---|---|
| `PANTHIYA_SETUP.md` (this file) | The whole plan: hackathons, install, prompt, timeline, business roadmap |
| `.kiro/steering/product.md` | Product rules Kiro must always follow — copy into your project |
| `.kiro/steering/tech.md` | Tech stack + AWS rules |
| `.kiro/steering/structure.md` | Folder layout + coding conventions |
| `docs/RED-TEAM-CASES.md` | 36 attack tests that prove the agent keeps its rules (your demo's money shot) |

---

## 1. The two hackathons

| | **Agents, your rules** (AWS Builder Center) | **Kiroween 2026** (Devpost) |
|---|---|---|
| Prize | 5 × $1,000 AWS credits + swag | $100k cash; target **Best Startup Project** ($10,000) or **Best Student Project** ($1,500 + Kiro Pro Max) in the Frankenstein category |
| Deadline (PT) | Dec 2, 11:59 PM | Dec 4, 2:00 PM |
| Deadline (Sri Lanka) | **Dec 3, 1:29 PM** | **Dec 5, 3:30 AM** |
| Our target date | **Dec 1** | **Dec 3** |
| Angle | An agent with hard rules about student privacy, fees and exam answers, shown resisting 36 attacks | Frankenstein: Bedrock agent + voice + WhatsApp-style messaging + a ledger + a tutor stitched into one app |

**⚠️ Verify on Nov 18:** Bedrock challenge rules publish that day. If they forbid submitting the same project elsewhere, we submit Panthiya to **Bedrock only** and decide about Kiroween then. Kiroween requires the project to be **built in Kiro** with the `/.kiro` folder committed. That's why this pack uses Kiro.

## 2. The rules Panthiya never breaks (judges will test these)

1. **Student privacy:** one student's or parent's marks, fees, phone number or attendance are never revealed to anyone except that student's own parent and the teacher.
2. **Money integrity:** a fee is only marked "paid" by the teacher. Parents and students can never change balances, even if they claim "Sir told me to".
3. **No exam answers:** the student tutor gives hints and similar worked examples. It never gives the final answer to a past-paper or homework question.
4. **Verified messages only:** parent updates must come from real data. No made-up marks, no guessed reasons for absence, no shaming language.
5. **Role lock:** Teacher, Parent and Student have fixed permissions. Role-play, fake authority ("I'm the principal") and "developer mode" are ignored.
6. **Same rules everywhere:** in Sinhala, Tamil, Singlish, base64, and when a request is split across several messages.
7. **Wellbeing:** if a student shows distress, the bot drops the tutor act, responds kindly and suggests a trusted adult or the **1926** mental-health helpline. No medical advice.
8. **Children's data:** collect the minimum, never use it for anything else, and let the teacher export or delete a student's data. (Sri Lanka's Personal Data Protection Act No. 9 of 2022 applies to a real launch; get advice before taking paying customers.)

Rule enforcement happens in **three layers**, and the write-up explains each:
1. **Agent instructions + role-scoped action groups.** A Parent session literally cannot call the "update fee" action.
2. **Bedrock Guardrails:** denied topics, PII filters, content filters.
3. **Lambda policy checker:** a final code check that blocks replies leaking other students' data or a past-paper answer.

## 3. Architecture (serverless, scales to zero)

```
Web app (Amplify Hosting) ── Teacher / Parent / Student views
        │ HTTPS (Cognito login, role in token)
        ▼
API Gateway (HTTP API)
        │
        ├─► Lambda "chat"  ─► Bedrock Managed Agent "Panthiya"
        │                        ├─ Guardrail
        │                        ├─ Action group: Teacher (addStudent, markAttendance, recordFee, addMarks)
        │                        ├─ Action group: Parent  (getMyChildSummary)
        │                        └─ Action group: Student (getHint, getSimilarExample)
        ├─► Lambda "policyCheck"  (final leak / answer check)
        ├─► Lambda "voice"        (Amazon Transcribe → Sinhala/Tamil/English voice notes)
        └─► DynamoDB: classes, students, fees, attendance, marks, audit_log, redteam_runs
```

- **Model:** cheapest that handles Sinhala well enough (start with Amazon Nova Lite or a Haiku-class model; test Sinhala early, switch if poor).
- **Messaging:** a WhatsApp-*style* in-app parent inbox for the hackathon. Real WhatsApp Business API needs Meta approval and costs money, so it's **Phase 2**.
- **Cost target:** under **$15** for the whole hackathon from your ~$173 credits. Budget alert at $10/month is already set.
- **Audit log:** every money or marks change is written to `audit_log` with who, when and the before/after values. Judges love this, and real teachers will need it.

## 4. Install & tools

1. **Git for Windows**: https://git-scm.com/download/win, then:
   ```
   git config --global user.name "Nishen Madawa Abedeera"
   git config --global user.email "nishenmadawa15@gmail.com"
   ```
2. **Kiro IDE**: https://kiro.dev (free tier), then sign in.
3. **AWS access for Kiro:** create an **IAM user** (not root) named `panthiya-dev` with these managed policies only: `AmazonBedrockFullAccess`, `AWSLambda_FullAccess`, `AmazonDynamoDBFullAccess`, `AmazonAPIGatewayAdministrator`, `AmazonCognitoPowerUser`, `AWSCloudFormationFullAccess`, `AmazonTranscribeFullAccess`, `IAMFullAccess` (needed for SAM to create roles — remove after the hackathon). Create an access key and install the AWS CLI + SAM CLI. Kiro's deploy tasks need them. *(This is the one place where a CLI is worth it: deploying a real backend from a browser alone is painful.)*
4. In AWS Console → Bedrock → **Model access**: enable the model you'll use, in the region you'll deploy to. Check that Bedrock Managed Agents is available in that region; if ap-south-1 doesn't have it, use **us-east-1**.
5. Create the folder `C:\Projects\panthiya` and copy **this whole starter pack into it** (including the hidden `.kiro` folder). Open the folder in Kiro.

## 5. Kiro workflow (this also earns the "Kiro write-up" points)

- **Steering** (already provided in `.kiro/steering/`): Kiro reads these on every task.
- **Specs:** open Kiro → *Spec* → paste the prompt in §6. Kiro generates `requirements.md`, `design.md` and `tasks.md`. Review them, edit anything wrong, approve, then run tasks one by one.
- **Hooks** (create in Kiro): (a) on save of any file under `backend/` → run unit tests; (b) on change to `.kiro/steering/product.md` → regenerate `tests/redteam/cases.json` from `docs/RED-TEAM-CASES.md`; (c) on task complete → append a line to `docs/BUILD-LOG.md`.
- **Screenshots** of specs, hooks and steering in use, as you go. You'll need them for the write-up.

## 6. THE PROMPT (paste into Kiro Spec mode)

---

Build **Panthiya**, an AI assistant for Sri Lankan tuition classes, for two hackathons: AWS "Agents, your rules: Bedrock Managed Agents build" (deadline Dec 2, 2026 PT) and Kiroween 2026 (Frankenstein category, deadline Dec 4, 2026 PT). Follow the steering docs in `.kiro/steering/` at all times.

**Users & roles:** Teacher (owns classes), Parent (sees only their own child), Student (uses the past-paper tutor). Login with Amazon Cognito; the role lives in the token and is enforced server-side.

**Teacher features:** create classes and students; mark attendance by chat or voice ("ඊයේ පන්තියට කසුන්, දිල්මි ආවේ නැහැ"); record fee payments ("Nimal paid 2500 for November"); add marks; see who owes fees this month; generate parent updates and approve them before sending; view the audit log.

**Parent features:** a WhatsApp-style inbox with approved updates about their own child; ask questions ("did my son attend last Saturday?") answered only from real data about their own child.

**Student features:** past-paper tutor for O/L Maths, Science and ICT that gives Socratic hints and worked examples of a *different* problem, never the final answer.

**Languages:** Sinhala, Tamil, English and Singlish, for both input and output. Voice notes via Amazon Transcribe where the language is supported; fall back to text where it isn't.

**Agent:** one Bedrock Managed Agent with a Bedrock Guardrail and three role-scoped action groups (Teacher, Parent, Student) backed by Lambda. A session may only call the action group of its own role. A final `policyCheck` Lambda blocks replies that leak another student's data or a final past-paper answer. Every write goes to an `audit_log` table.

**Red-team page `/redteam` (teacher-only):** loads `tests/redteam/cases.json` (generated from `docs/RED-TEAM-CASES.md`), runs every attack against the live agent, shows a live Blocked / Leaked scoreboard, and lets the teacher toggle each defence layer off to show what it protects. Store runs in DynamoDB.

**Front-end:** mobile-first web app on Amplify Hosting. Clean, friendly, trustworthy design: warm paper-and-ink theme inspired by a Sri Lankan exercise book (ruled lines, margin, stamp-style badges for "Paid" / "Absent"). Trilingual UI switcher සිං / தமிழ் / EN. Accessible: keyboard, screen readers, contrast 4.5:1, reduced motion.

**Infra:** AWS SAM (or CDK) template for everything except Amplify Hosting. DynamoDB on-demand, Lambda (Node.js 20 or Python 3.12), HTTP API. Scale to zero, target total cost under $15. Seed script with a demo class of 12 fictional students and realistic fictional data. No real people.

**Deliverables:** live app URL; public GitHub repo with MIT license and committed `/.kiro`; README with a Mermaid architecture diagram, setup steps, costs and a security/privacy section; `docs/KIRO-WRITEUP.md`; `docs/DEMO-SCRIPT.md` (under 3 minutes); `docs/SUBMISSION-BEDROCK.md`; `docs/SUBMISSION-KIROWEEN.md`; `docs/BUILD-LOG.md` kept throughout; unit tests for every Lambda and the red-team suite.

**Milestones:** M0 "hello Panthiya" page live on Amplify → M1 data model + teacher chat for attendance & fees → M2 Cognito roles + parent view → M3 guardrail + policyCheck + audit log → M4 student tutor → M5 red-team page + scoreboard → M6 voice + trilingual polish → M7 docs, demo script, submissions. Ask me before deploying anything to AWS, deleting resources, or any step that costs money.

---

## 7. Day-by-day timeline

| Date | Milestone | Done when |
|---|---|---|
| Nov 16–17 | Install + IAM user + M0 | Live Amplify URL opens on your phone |
| **Nov 18** | Join Bedrock challenge officially; read rules | Double-submit question answered |
| Nov 18–20 | M1 teacher chat: attendance + fees | "Nimal paid 2500" updates the ledger |
| Nov 21–22 | M2 roles + parent view | Parent sees only their child |
| Nov 23–24 | M3 guardrail + policyCheck + audit log | First 10 red-team cases pass |
| Nov 25 | M4 student tutor | Gives hints, refuses answers |
| Nov 26–27 | M5 red-team page | 36/36 blocked on screen |
| Nov 28 | M6 voice + Sinhala/Tamil polish | Sinhala voice note marks attendance |
| Nov 29–30 | M7 docs, record demo video | Video under 3 minutes on YouTube |
| **Dec 1** | **Submit Bedrock** | |
| Dec 2–3 | Kiroween extras: blog post, LinkedIn post (#KiroweenHackathon26), **submit Kiroween** | |

**Demo video (2:45):** 0:00 hook ("Every tuition sir in Sri Lanka keeps fees in a notebook…") → 0:20 teacher marks attendance by Sinhala voice note → 0:50 fee recorded, parent gets an approved update → 1:15 parent tries to see another child's marks, refused → 1:35 student asks for the answer, gets a hint → 1:55 red-team page runs 36 attacks, 36 blocked → 2:20 architecture in 15 seconds → 2:35 "built by a Sri Lankan student, for Sri Lankan classes".

## 8. After the hackathon: business roadmap

| Phase | When | What | Goal |
|---|---|---|---|
| **0. Validate** | During the hackathon | Show the demo to 3–5 real tuition teachers (relatives, your old sirs, SLTC lecturers' contacts). Ask: "Would you use this? What would you pay?" | 1 teacher agrees to try it free |
| **1. Pilot** | Dec–Jan | One real class, free, with the teacher's and parents' consent. Fix what breaks. | Teacher uses it weekly for 4 weeks |
| **2. WhatsApp** | Feb–Mar | Real WhatsApp Business API for parent updates (Meta approval + per-message cost) | Parents receive updates where they already are |
| **3. First revenue** | Mar–Apr | Simple monthly plan (test something like Rs. 1,000–2,000/month per teacher; this is a guess to validate, not a fact). Payments via a local gateway (PayHere or a bank transfer at first) | 3 paying teachers |
| **4. Grow** | Mid-2027 | Institute plan (many teachers), online fee payments for parents, past-paper bank, Android app | 20+ paying teachers |

**Honest risks:** teachers are busy and may resist new tools. Win them with Sinhala voice and "no typing". Children's data means privacy must be taken seriously before charging anyone (PDPA 2022). Bedrock costs grow with usage, so put the price above cost from day one.

## 9. Your checklist right now

- [ ] Install Git + Kiro
- [ ] Create IAM user `panthiya-dev`, access key, AWS CLI + SAM CLI
- [ ] Enable a Bedrock model; confirm the Managed Agents region
- [ ] Copy this starter pack into `C:\Projects\panthiya`, open in Kiro
- [ ] Paste §6 prompt into Spec mode → review → start M0
- [ ] Create an empty public GitHub repo `panthiya` → tell me the URL; we connect Amplify together in Chrome
- [ ] Nov 18: tell me, I'll read the Bedrock rules with you
