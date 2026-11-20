---
inclusion: always
---

# Tech stack & AWS rules

## Stack
- **Front-end:** mobile-first web app (plain HTML/CSS/JS or a light framework such as Vite + Preact/React if it clearly helps). Hosted on **AWS Amplify Hosting**, deployed from GitHub `main`.
- **Auth:** Amazon Cognito user pool; role (`teacher` | `parent` | `student`) stored as a custom attribute or group and verified server-side on every request.
- **API:** Amazon API Gateway HTTP API → AWS Lambda (Node.js 20 or Python 3.12; pick one and stay consistent).
- **Agent:** ⚠️ **Corrected 2026-11-20 — this line was wrong in a way that mattered, because this file is `inclusion: always`.** Agents Classic with action groups **cannot be created on this account** (`CreateAgent` → `AccessDeniedException`, maintenance mode, no exception process). The challenge rules require **Bedrock Managed Agents or the AgentCore managed harness**, so the path is the **AgentCore managed harness** with **inline functions**, one Guardrail, and the same three role-scoped tool sets (Teacher, Parent, Student). Inline functions hand each tool call back to our own chat Lambda, which is why `backend/lib/auth.mjs` and the three action Lambdas are unchanged. Do **not** propose gateway targets: they carry no `sessionAttributes`, so every action would be denied. See `docs/AGENTCORE-PLAN.md` and `backend/agentcore/README.md`. Use the cheapest model that handles Sinhala acceptably — Nova Lite, via `Converse`. Test Sinhala on day 1.
- **Data:** Amazon DynamoDB, on-demand billing. Tables: `classes`, `students`, `fees`, `attendance`, `marks`, `messages`, `audit_log`, `redteam_runs`.
- **Voice:** Amazon Transcribe for voice notes where the language is supported; otherwise fall back to text input with a clear message.
- **IaC:** AWS SAM (preferred) or CDK. Everything except Amplify Hosting is in the template.

## AWS rules
- Region: one region for everything. **`ap-south-1`** — AgentCore is GA there, and it is ~40 ms from Colombo. The us-east-1 fallback existed for Agents Classic availability and is no longer the reason to move; if AgentCore turns out to be gated on this account, that is an account problem, not a region problem, and it goes to Nishen rather than to a second region.
- Least-privilege IAM roles per Lambda, scoped to the specific tables and actions it needs.
- No EC2, NAT Gateway, RDS, OpenSearch or anything billed hourly. Everything must scale to zero.
- Total hackathon spend target: under $15. Prefer small max-token limits and short prompts.
- **Ask the human before** any `sam deploy`, resource deletion, or change that costs money.
- 🔒 **Never grant `bedrock-agentcore:InvokeAgentRuntimeCommand` or `...CommandShell`.** AWS: *“To prevent direct command execution, do not grant `bedrock-agentcore:InvokeAgentRuntimeCommand` in your IAM policies.”* They execute commands **without passing through the model**, routing around `allowedTools` — the guard that stops this agent being handed a shell. The chat Lambda needs `bedrock-agentcore:InvokeHarness` and nothing else from that namespace.
- Never commit secrets, access keys or `.env` files. Use SSM Parameter Store or environment variables set at deploy time.

## Security
- Server-side authorization on every Lambda. Never trust role or IDs sent from the browser.
- A `policyCheck` Lambda runs on every agent reply before it reaches the user: block other students' data and final past-paper answers.
- Validate and length-limit all input. Never render user text with `innerHTML`.
- Amplify `customHttp.yml`: strict CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy.

## Testing
- Unit tests for every Lambda.
- Red-team suite: `tests/redteam/cases.json`, generated from `docs/RED-TEAM-CASES.md`, run against the live agent from the `/redteam` page and from a CLI script.
