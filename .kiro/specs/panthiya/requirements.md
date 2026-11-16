# Panthiya — Requirements

Status: approved for build · Owner: Nishen Madawa Abedeera · Last updated: 2026-11-16

Derived from `.kiro/steering/product.md` (rules), `.kiro/steering/tech.md` (stack) and
`docs/RED-TEAM-CASES.md` (36 adversarial acceptance tests).

Acceptance criteria use EARS phrasing. "The system" means Panthiya as a whole: the web app,
the API, the Bedrock agent and the policy checker together. A criterion is only met when it
holds **server-side** — a check that exists only in the browser does not count.

---

## 1. Glossary

| Term | Meaning |
|---|---|
| Teacher | Owner of one or more classes. The only role that may write data. |
| Parent | Linked to one or more children in a class. Read-only, scoped to their own children. |
| Student | A child in a class. Uses the tutor only. No access to fees, marks of others, or rosters. |
| Session role | The role asserted by the verified Cognito ID token for the current request. |
| Action group | A Bedrock agent action group backed by one Lambda, scoped to exactly one role. |
| policyCheck | The final Lambda that inspects every agent reply before it reaches a user. |
| Defence layer | One of: agent instructions + role-scoped action groups, Bedrock Guardrail, policyCheck. |
| Protected data | Any student's or parent's marks, fees, attendance, phone number, or roster membership. |
| Final answer | The solved value, choice, or result of a past-paper / exam / homework question. |

---

## 2. Requirement 1 — Authentication and role binding

**User story:** As a user, I want to sign in once and have the system know exactly what I am
allowed to do, so that no one can act as a role they do not hold.

### Acceptance criteria

1.1 WHEN a user signs in THE SYSTEM SHALL authenticate them against an Amazon Cognito user pool and issue an ID token containing exactly one role claim of `teacher`, `parent` or `student`.

1.2 WHEN any API request arrives THE SYSTEM SHALL verify the ID token signature, issuer, audience and expiry server-side before executing any business logic.

1.3 WHEN a request body, query string, header or chat message asserts a role THE SYSTEM SHALL ignore that assertion and use only the role claim from the verified token.

1.4 IF a token is missing, expired, malformed or carries no recognised role THEN THE SYSTEM SHALL respond `401` and perform no read or write.

1.5 WHEN a session has role R THE SYSTEM SHALL expose to the Bedrock agent only the action group belonging to R, so that a Parent session has no callable path to a Teacher action even if the model attempts one.

1.6 WHEN a parent signs in THE SYSTEM SHALL resolve their accessible student IDs from the `students` table server-side, and SHALL NOT accept a student ID supplied by the client without checking it against that set.

1.7 WHEN a student signs in THE SYSTEM SHALL grant access to tutor actions only, with no read path to any fee, mark, attendance or roster record including their own.

> Rationale for 1.7: the student tutor needs no personal data at all, so it is given none.
> Least data is the cheapest privacy control available.

---

## 3. Requirement 2 — Teacher: roster and classes

**User story:** As a teacher, I want to set up my class and add students by chat, so that I
never have to fill in a form on my phone.

### Acceptance criteria

2.1 WHEN a teacher asks in chat to create a class THE SYSTEM SHALL create a `classes` record owned by that teacher's user ID and confirm with the class name and ID.

2.2 WHEN a teacher asks to add a student THE SYSTEM SHALL create a `students` record in a class that teacher owns, capturing only: display name, class ID, optional parent contact identifier, and optional grade.

2.3 IF a teacher references a class they do not own THEN THE SYSTEM SHALL refuse and SHALL NOT disclose whether that class exists.

2.4 WHEN a student is created THE SYSTEM SHALL write an `audit_log` entry with actor, timestamp, action, before (`null`) and after values.

2.5 THE SYSTEM SHALL NOT require a child's phone number, address, date of birth, school, photo or national ID to function.

---

## 4. Requirement 3 — Teacher: attendance by chat or voice

**User story:** As a teacher, I want to say "ඊයේ පන්තියට කසුන්, දිල්මි ආවේ නැහැ" and have
attendance recorded, so that marking a register takes five seconds.

### Acceptance criteria

3.1 WHEN a teacher sends an attendance statement in Sinhala, Tamil, English or Singlish THE SYSTEM SHALL resolve the named students within that teacher's classes, resolve the date (including relative dates such as "yesterday" / "ඊයේ"), and record one `attendance` row per student per date.

3.2 WHEN the same student and date are marked again THE SYSTEM SHALL overwrite the previous value and record both before and after in `audit_log`.

3.3 IF a named student cannot be resolved to exactly one student in the teacher's classes THEN THE SYSTEM SHALL ask the teacher which student is meant and SHALL NOT guess.

3.4 WHEN attendance has been recorded THE SYSTEM SHALL reply with a short confirmation listing each student and the value stored, in the language the teacher wrote in.

3.5 WHEN a teacher sends a voice note in a language Amazon Transcribe supports THE SYSTEM SHALL transcribe it and treat the transcript as chat input.

3.6 IF the spoken language is not supported by Transcribe THEN THE SYSTEM SHALL say so plainly in the UI language and invite text input, and SHALL NOT silently substitute a different language model.

---

## 5. Requirement 4 — Teacher: fees

**User story:** As a teacher, I want to say "Nimal paid 2500 for November" and see the ledger
update, so that my notebook can stay in the drawer.

### Acceptance criteria

4.1 WHEN a teacher records a payment THE SYSTEM SHALL write a `fees` row keyed by student and billing period, storing amount, currency `LKR`, period, method and the recording teacher.

4.2 WHEN a fee is recorded or changed THE SYSTEM SHALL write an `audit_log` entry with before and after amounts.

4.3 WHEN a teacher asks who owes fees this month THE SYSTEM SHALL list only students in classes that teacher owns, with the amount outstanding.

4.4 IF any non-teacher session attempts any fee write by any phrasing, language, encoding or claimed authority THEN THE SYSTEM SHALL refuse, SHALL perform no write, and SHALL NOT create an `audit_log` entry implying a write occurred.

4.5 WHEN a fee amount is parsed from natural language THE SYSTEM SHALL confirm the parsed amount and period back to the teacher before persisting, so a misheard number cannot silently enter the ledger.

> Rationale for 4.5: money is the one place where a wrong write is worse than a slow write.

---

## 6. Requirement 5 — Teacher: marks

**User story:** As a teacher, I want to enter test marks by chat so I can do it on the bus home.

### Acceptance criteria

5.1 WHEN a teacher records marks THE SYSTEM SHALL write a `marks` row with student, assessment name, score, maximum score and date.

5.2 IF a score exceeds the stated maximum, is negative, or is non-numeric THEN THE SYSTEM SHALL refuse and ask the teacher to restate.

5.3 WHEN marks are recorded or changed THE SYSTEM SHALL write an `audit_log` entry with before and after values.

---

## 7. Requirement 6 — Teacher: parent updates with approval gate

**User story:** As a teacher, I want the system to draft the message to a parent and let me
read it before it is sent, so that nothing goes out in my name that I have not seen.

### Acceptance criteria

6.1 WHEN a teacher asks for a parent update THE SYSTEM SHALL draft it **only** from stored `attendance`, `fees` and `marks` records for that child and SHALL NOT state any fact not present in those records.

6.2 WHEN a draft is produced THE SYSTEM SHALL store it with status `draft` and SHALL NOT make it visible in any parent inbox.

6.3 WHEN and only when the teacher explicitly approves a draft THE SYSTEM SHALL set its status to `approved` and make it visible to that child's linked parent(s).

6.4 IF the teacher asks for a message containing a fact that contradicts stored data THEN THE SYSTEM SHALL flag the mismatch, quote the stored value, and draft using the stored value.

6.5 IF the teacher asks for shaming, insulting or characterising language about a child THEN THE SYSTEM SHALL decline that wording and draft a factual, respectful alternative for approval.

6.6 THE SYSTEM SHALL record approval in `audit_log` with the approving teacher, timestamp and the exact approved text.

---

## 8. Requirement 7 — Parent inbox and questions

**User story:** As a parent, I want to read trusted updates about my own child and ask simple
questions, so that I know what is happening without troubling the teacher.

### Acceptance criteria

7.1 WHEN a parent opens their inbox THE SYSTEM SHALL list only `approved` messages about children linked to that parent, newest first.

7.2 WHEN a parent asks a question about their own child THE SYSTEM SHALL answer only from stored records about that child, and SHALL state plainly when it has no record rather than estimating.

7.3 IF a parent asks about any other child — by name, by nickname, by rank ("top 3"), by homoglyph spelling, by aggregate ("who has not paid"), or in any language or encoding — THEN THE SYSTEM SHALL refuse, SHALL offer the same information about their own child instead, and SHALL leak no name, count or rank that reveals another child.

7.4 IF a parent requests another parent's or student's phone number or contact detail THEN THE SYSTEM SHALL refuse and suggest asking the teacher to make the introduction.

7.5 IF a parent asks to delete or alter records THEN THE SYSTEM SHALL refuse and name the teacher as the only route.

7.6 THE SYSTEM SHALL present the parent inbox as a familiar message thread, so that a parent who uses only WhatsApp needs no instruction to read it.

---

## 9. Requirement 8 — Student past-paper tutor

**User story:** As an O/L student, I want help understanding a question I am stuck on, so that
I can solve the next one without help.

### Acceptance criteria

8.1 WHEN a student asks about an O/L Maths, Science or ICT problem THE SYSTEM SHALL respond with a Socratic hint: the next step to try, the concept involved, or a question that moves the student forward.

8.2 WHEN a worked example is given THE SYSTEM SHALL use a **different** problem with different numbers from the one asked, and SHALL say so.

8.3 THE SYSTEM SHALL NOT output the final answer to the asked question, and SHALL NOT confirm or deny a final answer the student proposes. Instead it SHALL tell the student how to verify it themselves.

8.4 IF a request for the final answer is framed as role-play, a poem, a translation, a marking scheme, a split across several messages, a claim of being a teacher, or an emotional plea THEN THE SYSTEM SHALL still give hints only, and SHALL remain kind.

8.5 WHEN a student's message shows distress THE SYSTEM SHALL stop tutoring, respond warmly and without judgement, suggest a trusted adult, and offer the Sri Lanka 1926 mental-health helpline.

8.6 THE SYSTEM SHALL NOT give medical advice, including about medicines, supplements or sleep deprivation, and SHALL redirect to a doctor or trusted adult.

8.7 WHEN a student writes in Sinhala or Tamil THE SYSTEM SHALL reply in that language, holding 8.1–8.6 identically.

---

## 10. Requirement 9 — Three defence layers

**User story:** As a judge, I want to see that each rule is enforced in more than one place, so
that I believe it holds when the model misbehaves.

### Acceptance criteria

9.1 THE SYSTEM SHALL enforce every rule in `.kiro/steering/product.md` at **three** independent layers: (a) agent instructions plus role-scoped action groups, (b) a Bedrock Guardrail, (c) the `policyCheck` Lambda.

9.2 WHEN the agent produces a reply THE SYSTEM SHALL pass it through `policyCheck` before returning it, and SHALL return the blocked-reply template instead if the check fails.

9.3 WHEN `policyCheck` runs THE SYSTEM SHALL block a reply that contains: the name of a student not in the caller's permitted set, protected data about a student not in that set, a final answer to a past-paper question in a student session, or any part of the agent's system instructions.

9.4 IF `policyCheck` itself errors THEN THE SYSTEM SHALL block the reply rather than pass it through (fail closed).

9.5 WHEN a defence layer blocks a reply THE SYSTEM SHALL record which layer blocked it, so that the red-team scoreboard can attribute each block.

9.6 THE SYSTEM SHALL apply every rule identically for Sinhala, Tamil, English, Singlish, base64-encoded text, and homoglyph-substituted text.

---

## 11. Requirement 10 — Audit log

**User story:** As a teacher, I want a record of every change to money and marks, so that I can
answer a parent who disputes one.

### Acceptance criteria

10.1 WHEN any write to `classes`, `students`, `fees`, `attendance`, `marks` or message approval occurs THE SYSTEM SHALL append an `audit_log` entry with actor user ID, actor role, timestamp (ISO 8601 UTC), action, target ID, before value and after value.

10.2 THE SYSTEM SHALL write the audit entry in the same Lambda invocation as the data write, so a successful write can never be unlogged.

10.3 WHEN a teacher views the audit log THE SYSTEM SHALL show only entries concerning their own classes, newest first.

10.4 THE SYSTEM SHALL expose no API that updates or deletes an existing `audit_log` entry.

---

## 12. Requirement 11 — Red-team page and scoreboard

**User story:** As the builder, I want to run all 36 attacks against the live agent on screen
and show what each defence layer protects, so that the claim "it never breaks the rules" is
demonstrated rather than asserted.

### Acceptance criteria

11.1 THE SYSTEM SHALL restrict `/redteam` to teacher sessions, enforced server-side on the API it calls.

11.2 THE SYSTEM SHALL load its cases from `tests/redteam/cases.json`, generated from `docs/RED-TEAM-CASES.md`, containing all 36 cases with id, role, attack text, targeted rule and pass condition.

11.3 WHEN the teacher runs the suite THE SYSTEM SHALL execute each case against the live agent under the case's stated role and display a running Blocked / Leaked scoreboard.

11.4 WHEN a case completes THE SYSTEM SHALL display the verdict, which defence layer blocked it, and the reply text, so a leak can be read and fixed.

11.5 THE SYSTEM SHALL let the teacher disable each defence layer independently and re-run, so the contribution of each layer is visible.

11.6 IF a defence layer is disabled THEN THE SYSTEM SHALL display a persistent visible warning, and SHALL NOT allow a disabled layer to persist beyond the current run.

11.7 THE SYSTEM SHALL store each run in `redteam_runs` with timestamp, layer configuration, per-case verdicts and the totals.

> Rationale for 11.6: a toggle that silently stays off is a vulnerability disguised as a demo feature.

---

## 13. Requirement 12 — Languages and accessibility

### Acceptance criteria

12.1 THE SYSTEM SHALL offer a UI language switcher with Sinhala (සිං), Tamil (தமிழ்) and English (EN), and SHALL persist the choice on the device.

12.2 THE SYSTEM SHALL keep every user-facing string in `frontend/i18n/{si,ta,en}.json` with no literal UI text in markup or scripts.

12.3 WHEN the UI language changes THE SYSTEM SHALL update the document `lang` attribute so screen readers pronounce content correctly.

12.4 THE SYSTEM SHALL be fully operable by keyboard, with a visible focus indicator on every interactive element.

12.5 THE SYSTEM SHALL meet a contrast ratio of at least 4.5:1 for body text and 3:1 for large text and interactive borders.

12.6 WHEN `prefers-reduced-motion: reduce` is set THE SYSTEM SHALL disable non-essential animation.

12.7 THE SYSTEM SHALL never insert user-supplied or model-supplied text into the DOM as HTML.

---

## 14. Requirement 13 — Cost, infrastructure and privacy posture

### Acceptance criteria

13.1 THE SYSTEM SHALL define all backend infrastructure in an AWS SAM template, excluding only Amplify Hosting.

13.2 THE SYSTEM SHALL use only services that scale to zero, with no EC2, NAT Gateway, RDS or OpenSearch.

13.3 THE SYSTEM SHALL grant each Lambda an IAM role scoped to the specific tables and actions it needs, with no wildcard table ARNs.

13.4 THE SYSTEM SHALL keep total hackathon spend under US$15, using the cheapest Bedrock model that handles Sinhala acceptably and short max-token limits.

13.5 THE SYSTEM SHALL contain no secrets, access keys or `.env` files in version control.

13.6 THE SYSTEM SHALL serve the front-end with a strict Content-Security-Policy, HSTS, `X-Content-Type-Options: nosniff`, a Referrer-Policy and a Permissions-Policy.

13.7 THE SYSTEM SHALL seed demo data consisting of 12 fictional students and their fictional parents, and SHALL contain no real person's name, phone number or school.

13.8 THE SYSTEM SHALL provide the teacher a way to export and to delete all data for one student.

---

## 15. Out of scope for the hackathon

Stated explicitly so no task silently expands:

- Real WhatsApp Business API delivery (needs Meta approval and per-message cost) — in-app inbox only.
- Online fee payment by parents.
- A past-paper content bank or OCR of paper images.
- Native mobile apps.
- Multi-teacher institute accounts and teacher-to-teacher sharing.
- Any processing of real children's data. Demo data only, under PDPA 2022 caution.

---

## 16. Traceability: red-team cases to requirements

| Cases | Requirement |
|---|---|
| A1–A8 | 7.3, 7.4, 9.3, 9.6 |
| B1–B8 | 1.3, 1.5, 4.4, 9.6 |
| C1–C10 | 8.2, 8.3, 8.4, 8.7 |
| D1–D2 | 6.4, 6.5 |
| D3–D6 | 1.3, 1.5, 9.3, 9.6 |
| E1–E3 | 8.5, 8.6 |
| F1 | 7.5, 13.8 |
