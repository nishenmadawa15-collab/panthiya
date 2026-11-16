---
inclusion: always
---

# Project structure & conventions

```
panthiya/
├── .kiro/                 # steering, specs, hooks (must be committed; never gitignore)
├── frontend/              # web app served by Amplify
│   ├── index.html
│   ├── teacher/ parent/ student/ redteam/
│   ├── assets/            # self-hosted fonts, icons, images
│   └── i18n/              # si.json, ta.json, en.json
├── backend/
│   ├── template.yaml      # AWS SAM template
│   ├── functions/
│   │   ├── chat/          # entry point → Bedrock agent
│   │   ├── actions-teacher/
│   │   ├── actions-parent/
│   │   ├── actions-student/
│   │   ├── policy-check/
│   │   └── voice/
│   └── seed/              # fictional demo class
├── tests/
│   ├── unit/
│   └── redteam/cases.json
├── docs/
│   ├── RED-TEAM-CASES.md
│   ├── BUILD-LOG.md
│   ├── KIRO-WRITEUP.md
│   ├── DEMO-SCRIPT.md
│   ├── SUBMISSION-BEDROCK.md
│   └── SUBMISSION-KIROWEEN.md
├── amplify.yml
├── customHttp.yml
├── README.md
└── LICENSE                # MIT
```

## Conventions
- Small commits with conventional messages: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- One feature branch per milestone (`feat/m1-teacher-chat`); merge to `main` only when tests pass, so the live site stays stable.
- Comment non-obvious code. Keep functions short. Prefer clarity over cleverness: the builder (a student) must be able to maintain this alone.
- All user-facing strings live in `frontend/i18n/` (Sinhala, Tamil, English).
- Append one line to `docs/BUILD-LOG.md` after every completed task: date, what was done, any problem and how it was solved. The write-ups are built from this log.
