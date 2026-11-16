---
inclusion: always
---

# Tech stack & AWS rules

## Stack
- **Front-end:** mobile-first web app (plain HTML/CSS/JS or a light framework such as Vite + Preact/React if it clearly helps). Hosted on **AWS Amplify Hosting**, deployed from GitHub `main`.
- **Auth:** Amazon Cognito user pool; role (`teacher` | `parent` | `student`) stored as a custom attribute or group and verified server-side on every request.
- **API:** Amazon API Gateway HTTP API → AWS Lambda (Node.js 20 or Python 3.12; pick one and stay consistent).
- **Agent:** Amazon Bedrock Managed Agents with one Guardrail and three role-scoped action groups (Teacher, Parent, Student). Use the cheapest model that handles Sinhala acceptably. Test Sinhala on day 1.
- **Data:** Amazon DynamoDB, on-demand billing. Tables: `classes`, `students`, `fees`, `attendance`, `marks`, `messages`, `audit_log`, `redteam_runs`.
- **Voice:** Amazon Transcribe for voice notes where the language is supported; otherwise fall back to text input with a clear message.
- **IaC:** AWS SAM (preferred) or CDK. Everything except Amplify Hosting is in the template.

## AWS rules
- Region: use one region for everything that supports Bedrock Managed Agents (prefer ap-south-1; fall back to us-east-1).
- Least-privilege IAM roles per Lambda, scoped to the specific tables and actions it needs.
- No EC2, NAT Gateway, RDS, OpenSearch or anything billed hourly. Everything must scale to zero.
- Total hackathon spend target: under $15. Prefer small max-token limits and short prompts.
- **Ask the human before** any `sam deploy`, resource deletion, or change that costs money.
- Never commit secrets, access keys or `.env` files. Use SSM Parameter Store or environment variables set at deploy time.

## Security
- Server-side authorization on every Lambda. Never trust role or IDs sent from the browser.
- A `policyCheck` Lambda runs on every agent reply before it reaches the user: block other students' data and final past-paper answers.
- Validate and length-limit all input. Never render user text with `innerHTML`.
- Amplify `customHttp.yml`: strict CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy.

## Testing
- Unit tests for every Lambda.
- Red-team suite: `tests/redteam/cases.json`, generated from `docs/RED-TEAM-CASES.md`, run against the live agent from the `/redteam` page and from a CLI script.
