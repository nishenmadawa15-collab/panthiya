// The model-facing contract, read from the files that already define it.
//
// Option B (docs/NEXT-SESSION.md §0) runs the agent loop in our own Lambda rather than in the
// Bedrock agent service. That moves two things that used to live in the agent configuration — the
// tool list and the instruction — into this process. Neither is retyped here:
//
//   - the tool specs are derived from `backend/agent/schemas/*.json`, the same OpenAPI files that
//     would be pasted into an action group;
//   - the system prompt is the text between the two INSTRUCTION markers in
//     `backend/agent/instructions.md`, which is the same string the console field would hold.
//
// One source of truth each. A second hand-typed copy of either is how a tool description and a
// handler drift apart, and in this project a drifted description is a safety rule that is no
// longer in front of the model.
//
// Packaging: every function's `CodeUri` is the backend root (see the note in template.yaml), so
// `agent/` ships in this bundle exactly as `lib/` does. No network and no SDK is involved, so this
// module is readable in a unit test with no credentials.

import { readFileSync } from 'node:fs';

/** The three action groups of design §3.3, keyed by the one role that may reach each. */
const SCHEMA_FILES = {
  teacher: '../../agent/schemas/teacher.json',
  parent: '../../agent/schemas/parent.json',
  student: '../../agent/schemas/student.json',
};

/** Bedrock's own constraint on a tool name. A schema that breaks it would fail at invoke time. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Longest tool description we are willing to send. Converse accepts more than this; the limit is
 * here so that a schema description growing past what the model reliably reads becomes a loud
 * failure in `npm test` rather than a safety rule that quietly stopped being enforced. The longest
 * today is 638 characters (`getMyChildSummary`).
 */
const MAX_DESCRIPTION = 1024;

const INSTRUCTION_BLOCK = /<!--\s*INSTRUCTION BEGIN\s*-->([\s\S]*?)<!--\s*INSTRUCTION END\s*-->/;

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

/**
 * One role's tools, in the Converse `toolConfig.tools` shape.
 *
 * The OpenAPI request-body schema is passed through to `inputSchema.json` unchanged. It is already
 * a JSON Schema object with `type`, `required` and `properties`, and the property descriptions are
 * where most of the per-parameter rules live ("copied exactly as they wrote it", "never invent a
 * number"), so rewriting them here would be rewriting the rules.
 */
function deriveTools(role) {
  const schema = JSON.parse(read(SCHEMA_FILES[role]));
  const tools = [];

  for (const [path, methods] of Object.entries(schema.paths ?? {})) {
    const op = methods?.post;
    if (!op) continue;

    const name = op.operationId;
    if (typeof name !== 'string' || !TOOL_NAME.test(name)) {
      throw new Error(`${role}.json: ${path} has no usable operationId`);
    }

    const description = [op.summary, op.description].filter(Boolean).join('\n\n');
    if (!description) throw new Error(`${role}.json: ${name} has no description`);
    if (description.length > MAX_DESCRIPTION) {
      throw new Error(`${role}.json: ${name} description is ${description.length} characters`);
    }

    const json = op.requestBody?.content?.['application/json']?.schema;
    if (!json || json.type !== 'object') {
      throw new Error(`${role}.json: ${name} has no object request schema`);
    }

    tools.push({ toolSpec: { name, description, inputSchema: { json } } });
  }

  if (tools.length === 0) throw new Error(`${role}.json: no actions`);
  return tools;
}

// Derived once per container. The files cannot change under a running Lambda, and a cold start
// should pay for the three files it will use, not for three on every turn.
const CACHE = new Map();

/**
 * The tools a session of this role may be offered — and the whole list of them.
 *
 * This is the role gate of design §3.1 moved one step earlier than the agent service could put it.
 * Bedrock attaches action groups to an agent *version*, not to a session (design §3.3), so on the
 * agent path all three groups are visible to every session and the gate is the first four lines of
 * each action Lambda. Here the student session is never handed the teacher tool spec at all: the
 * model cannot ask for an action it was not told exists, so a jailbreak has nothing to name. The
 * per-Lambda gate and the per-Lambda IAM both still stand behind this — it is a third fence, not a
 * replacement for either.
 *
 * @param {'teacher'|'parent'|'student'} role from the verified JWT claims, never from the body
 */
export function toolsFor(role) {
  if (!Object.hasOwn(SCHEMA_FILES, role)) throw new Error(`no action group for role ${role}`);
  if (!CACHE.has(role)) CACHE.set(role, deriveTools(role));
  return CACHE.get(role);
}

/** Tool names this role may use, as a Set — what `runToolLoop` checks a tool use against. */
export function toolNamesFor(role) {
  return new Set(toolsFor(role).map((t) => t.toolSpec.name));
}

/**
 * The agent instruction, with the role preamble resolved for this session.
 *
 * `instructions.md` keeps `{role}` literal because the agent-service path bakes the instruction
 * into an agent version and resolves the role per turn through `promptSessionAttributes`. On this
 * path there is no baked version, so the substitution happens here — in the system block, which the
 * user's message cannot reach or append to.
 */
export function instructionFor(role) {
  if (!Object.hasOwn(SCHEMA_FILES, role)) throw new Error(`no instruction for role ${role}`);

  const key = `instruction:${role}`;
  if (!CACHE.has(key)) {
    const match = INSTRUCTION_BLOCK.exec(read('../../agent/instructions.md'));
    if (!match) throw new Error('instructions.md: INSTRUCTION markers not found');
    const text = match[1].trim().replaceAll('{role}', role);
    if (!text) throw new Error('instructions.md: instruction is empty');
    CACHE.set(key, text);
  }
  return CACHE.get(key);
}

export const __test__ = { MAX_DESCRIPTION, SCHEMA_FILES };
