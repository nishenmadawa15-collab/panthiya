// POST /chat — the Lambda boundary. All the logic lives in orchestrate.mjs so it can be tested
// offline; this file only does the things that need AWS: read claims, build the clients, call out.

import { claimsFromEvent } from '../../lib/auth.mjs';
import { handleChat } from './orchestrate.mjs';

const AGENT_ID = process.env.BEDROCK_AGENT_ID;
const AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID;
const POLICY_CHECK_FUNCTION = process.env.POLICY_CHECK_FUNCTION;

/** Colombo is UTC+5:30 with no daylight saving, so "yesterday" is decided here, once, per request. */
function todayInColombo(now = new Date()) {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Lazy SDK imports: these packages exist only inside the Lambda runtime, and a cold start that
// never reaches them should not pay to load them. See backend/lib/ddb.mjs for the same reasoning.
let bedrock;
async function invokeAgent({ sessionId, inputText, sessionAttributes }) {
  const { BedrockAgentRuntimeClient, InvokeAgentCommand } =
    await import('@aws-sdk/client-bedrock-agent-runtime');
  bedrock ??= new BedrockAgentRuntimeClient({});

  const response = await bedrock.send(new InvokeAgentCommand({
    agentId: AGENT_ID,
    agentAliasId: AGENT_ALIAS_ID,
    sessionId,
    inputText,
    sessionState: { sessionAttributes },
  }));

  // InvokeAgent streams its answer back in chunks.
  let text = '';
  for await (const event of response.completion ?? []) {
    if (event.chunk?.bytes) text += new TextDecoder().decode(event.chunk.bytes);
    // A guardrail intervention arrives as a trace rather than an error, so surface it as one.
    if (event.trace?.trace?.guardrailTrace?.action === 'INTERVENED') {
      const err = new Error('guardrail intervened');
      err.guardrailAction = 'INTERVENED';
      throw err;
    }
  }
  return text;
}

async function policyCheck(payload) {
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const lambda = new LambdaClient({});
  const result = await lambda.send(new InvokeCommand({
    FunctionName: POLICY_CHECK_FUNCTION,
    Payload: new TextEncoder().encode(JSON.stringify(payload)),
  }));
  // A Lambda-level failure is not an allow. handleChat treats a throw as a block.
  if (result.FunctionError) throw new Error(`policyCheck failed: ${result.FunctionError}`);
  return JSON.parse(new TextDecoder().decode(result.Payload));
}

export async function handler(event) {
  let body;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'bad_json' }) };
  }

  const claims = claimsFromEvent(event);

  const { status, body: payload } = await handleChat({
    claims,
    body,
    deps: {
      invokeAgent,
      policyCheck,
      today: todayInColombo(),
      // One Bedrock session per user per day keeps multi-message attacks (B7, C6) inside one
      // session where policyCheck sees the whole thread, without carrying history forever.
      sessionId: `${claims?.sub ?? 'anon'}-${todayInColombo()}`,
    },
  });

  return { statusCode: status, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export const __test__ = { todayInColombo };
