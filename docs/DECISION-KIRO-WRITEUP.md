# Decision brief — what the Kiro write-up says about who wrote the code

**For Nishen. Written 2026-11-19. This is the fourth of the five things only he can decide, and it
is a decision rather than a writing task — the text for every option is already drafted below, so
the whole job is picking a letter.**

Why it cannot wait for the deploy: Kiroween closes **Dec 4, 2:00 PM PT**, 20% of the score is
*"how thoroughly and skillfully does the project use Kiro"*, and the rules say in one sentence that
*"insufficient use of Kiro will result in disqualification at the Judges' sole discretion."*
`docs/SUBMISSION-KIROWEEN.md` §0 has both quotations from the official page.

---

## The facts, all checkable in this repository

| | |
|---|---|
| **What Kiro verifiably owns** | `/.kiro` — nine tracked files: a three-document spec (`requirements.md`, `design.md`, `tasks.md`, 79 numbered tasks), three `inclusion: always` steering docs, and three hooks. 18 commits touch `.kiro`. `docs/KIRO-WRITEUP.md` traces three steering clauses into the build and shows the red-team suite being generated from the document that defines it |
| **What the commit history says** | **All 45 commits carry `Co-Authored-By: Claude Opus 5`.** Not some. All of them |
| **What the write-up currently says about that** | Nothing. `docs/KIRO-WRITEUP.md` is 257 lines on the Kiro workflow and never names another tool |
| **Who reads it** | Judges with the public repo open. `git log` is one command, and the write-up itself invites them to check every claim against a file |
| **Found 2026-11-19, and it raises Kiro's verifiable share** | The starter pack this repo grew from contains **nine entries, five files, no code** — and the **spec triad is not among them**. `requirements.md`, `design.md` and `tasks.md`, 862 lines in the first commit including the 79 numbered tasks every later commit cites, were produced **in Kiro** from the §6 prompt. Read from the archive, not from memory (`SUBMISSION-KIROWEEN.md` §12a) |
| **And the steering held** | All three `.kiro/steering` documents are **byte-identical** to that archive thirty commits later — rules written on day one and never loosened to match what got built, which is the opposite of the usual direction |

So the gap is not whether Kiro was used — the specs and hooks are real and traceable. The gap is
that a document titled *"How Kiro was used to build Panthiya"* is silent on a trailer that appears
on every single commit.

---

## The three options

### A — Name the split plainly (recommended)

Add a short §0 to `docs/KIRO-WRITEUP.md` saying which tool did which work, and let `/.kiro` carry
exactly the weight it really carried.

- **Costs:** a judge scoring the 20% category sees a smaller Kiro share than a silent document
  implies.
- **Buys:** it survives any amount of repo reading, which is the only kind of reading that matters
  here. And it is the same standard the rest of the project is held to — this is the repo whose
  build log records its own four tests that passed for the wrong reason. One concealing document
  inside it would be the single weakest thing a judge could find, and it would be found by one
  command.

### B — Leave it silent (status quo)

- **Costs:** the risk above, in exchange for nothing the rules actually reward. The disqualifying
  clause is about *insufficient use* of Kiro, not about exclusive use — so silence does not buy a
  higher Kiro score, it only removes the sentence that would explain the trailers.
- **Buys:** nothing that A does not, unless a judge never opens `git log`.

### C — A, plus raise the real Kiro share before Dec 4

Do the remaining spec-side work *inside Kiro* and let it leave its own record: the 12 open tasks
ticked through Kiro, the build-log hook run on completion rather than by hand, the spec updated in
Kiro when the A/B/C orchestration decision lands.

- **Costs:** your hours, and Kiro has to be signed in anyway (human step 1).
- **Buys:** the honest §0 from A gets to describe a larger share, and the hooks get a usage record
  with dates on it rather than three files that exist.

**Recommendation: A now, C if the time exists.** A is free and removes the only reputational risk in
the submission. C is the only thing that moves the 20% score, and it is worth doing only with the
hours it actually takes, not instead of the deploy.

**The 2026-11-19 finding makes A cheaper than it looked when this brief was written.** The honest
sentence is no longer "Kiro held the rules and something else wrote the code" — it is "Kiro produced
the 862-line spec and the 79-task plan that every commit cites, its steering was fixed on day one and
never loosened, and the implementation against it was written by a coding agent." That is a larger
Kiro share than the silent version implies, and all of it is checkable from the archive and the
diff.

---

## The text, if you pick A

Paste this as a new `## 0.` at the top of `docs/KIRO-WRITEUP.md`, directly after the opening
paragraph. Correct the second paragraph to the true split before pasting — **the numbers in it are
the agent's best read of this repository, not your testimony**, and this is the one document where
that distinction matters.

> ## 0. Which tool did which work
>
> This project was built with two tools, and the honest division is worth stating before any claim
> about either. **Kiro owns the spec layer**: the three-document spec in `/.kiro/specs/panthiya`,
> the three `inclusion: always` steering documents that every task was written against, and the
> three hooks. That layer decided what got built, in what order, and under which non-negotiable
> rules — §1 and §2 below trace individual steering clauses into individual files.
>
> Two things about that layer are worth checking rather than taking on trust. The spec triad was
> **not** in the starter pack this repository grew from — `requirements.md`, `design.md` and
> `tasks.md` were produced in Kiro from the prompt recorded in `PANTHIYA_SETUP.md` §6, and they are
> 862 lines in the first commit. And all three steering documents are **byte-identical** to that
> archive thirty commits later: the rules were written on day one and never adjusted to match what
> got built.
>
> **The implementation was written by an AI coding agent driven against that spec** — every one of
> the 45 commits carries a `Co-Authored-By: Claude Opus 5` trailer, which is why this section exists
> rather than leaving a reader to find them. The spec was not decoration around hand-written code,
> and the code was not written without the spec: a task number from `tasks.md` opens most commits,
> and `docs/BUILD-LOG.md` has a row per completed task because `structure.md` requires one.
>
> We say it this way because the rest of this document asks to be checked against files, and
> because §5 is an account of nine defects this project found in its own work. A write-up that was
> quiet about its own toolchain would be the one unverified claim in a repository built to be
> verified.

---

## What to do with this file

It is a decision record, not a deliverable. Once you pick a letter, the chosen text lands in
`docs/KIRO-WRITEUP.md`, this file keeps the reasoning, and `docs/NEXT-SESSION.md` §4 loses an open
decision. If you pick A, the agent can paste it and commit in one step — the only thing it must not
do is choose the letter or edit the numbers in it.
