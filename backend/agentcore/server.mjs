// The AgentCore Runtime entrypoint — the two HTTP endpoints AWS's service contract requires, and
// nothing else.
//
// WHY THIS FILE EXISTS — AND THE ONE THING TO READ FIRST.
//
// The challenge requires an agent "built on Amazon Bedrock Managed Agents or the Amazon Bedrock
// AgentCore managed harness". There are TWO AgentCore paths, and docs/AGENTCORE-PLAN.md §1 is the
// verdict on which:
//
//   TRACK A — AgentCore harness (`CreateHarness`). AWS's *managed orchestration loop*, which is the
//     literal product the rules' phrase "managed harness" names. It needs no container and no
//     Docker, and the plan recommends it. This file is NOT used on that track.
//   TRACK B — AgentCore Runtime hosting our own `runToolLoop`. "You bring agent code - written in
//     any framework or no framework ... *The orchestration loop is yours*"
//     (devguide/harness-vs-runtime.html). This file is the entrypoint for that track.
//
// Both are live until Nishen re-reads one sentence on the rules page (plan §7, risk 1): under a
// loose reading of "harness" Track B qualifies and is simpler and faster; under a strict reading
// only Track A does. This file exists because Track B's service contract is the half that is
// awkward to get exactly right under time pressure, and it is verified verbatim below. If Track A
// is chosen, delete this file and its test — nothing else imports them.
//
// The contract citations, for Track B: "Define your agent logic using any AI framework or custom
// code" and "Add the required HTTP endpoints using the AgentCore SDK or custom implementation"
// (devguide/runtime-how-it-works.html); and the custom-agent tutorial defines "a custom agent" as
// "an agent built without using the AgentCore Python SDK" (getting-started-custom.html) — which is
// what makes a Node.js server legitimate here. On that track `runToolLoop` moves inside this
// container unchanged and the three action Lambdas stay exactly where they are.
//
// THE WHOLE CONTRACT, quoted from docs/AGENTCORE-PLAN.md §1 so it is next to the code that meets it:
//   - host `0.0.0.0`, serving port `8080`                     (runtime-http-protocol-contract.html)
//   - `POST /invocations`, JSON in, JSON out                  (ditto, "required")
//   - `GET /ping` returning `{"status": "Healthy"}`           (ditto, "required")
//   - the image must be `linux/arm64`                         (ditto, "Platform")
// Everything else in that page — SSE, WebSocket `/ws`, lifecycle hooks, session endpoints — is
// optional, and none of it is used: a Panthiya turn is one request and one reply.
//
// WHY EVERY OUTCOME IS AN HTTP 200. This is the one surprising decision here, and it is read off
// AWS's own error table rather than preferred: a container that answers 4xx or 5xx is reported to
// the caller as `424 RuntimeClientError` — "Your agent's container returned a 4xx or 5xx error -
// check your CloudWatch logs" — and for session-endpoint requests the response body is empty. So a
// non-2xx *destroys the reason*. `handleChat` in ../functions/chat/orchestrate.mjs distinguishes a
// guardrail intervention from a content filter from an exhausted loop, and the red-team scoreboard
// attributes defence layers from exactly that difference, so losing the code would silently credit
// the wrong layer. Every outcome therefore comes back 200 with the code in the body, and the
// caller's adapter turns it back into the error shape `handleChat` already understands.
//
// WHAT IS DELIBERATELY NOT HERE. No identity. This server never reads a role out of a request body
// and never decides one: `sessionAttributes` arrives already built from the JWT claims the API
// Gateway authorizer verified, is passed straight through to `runToolLoop`, and from there to the
// action Lambdas' `requireRole` gate in exactly the shape backend/lib/auth.mjs already reads
// (design §3.1). The only caller is our own chat Lambda, over SigV4. If this runtime is ever given
// OAuth inbound auth pointing at the Cognito pool, a browser could call it directly with its own
// token and skip the wellbeing check and policyCheck entirely — see §7 of the plan. Keep it SigV4.

import { MAX_MESSAGE } from '../functions/chat/orchestrate.mjs';

/** The service contract's defaults. Changing either means setting `protocolConfiguration` too. */
export const PORT = 8080;
export const HOST = '0.0.0.0';

/**
 * The largest request body this server will read.
 *
 * `handleChat` already rejects a message over `MAX_MESSAGE` before it ever calls out, so this is
 * not the user-facing limit — it is the trust boundary's own limit, because a boundary that trusts
 * its caller to have checked is not a boundary. Generous enough for 2,000 characters of Sinhala
 * (3 bytes per character in UTF-8) plus the session attributes, and small enough that a runaway
 * caller cannot make this process buffer a megabyte.
 */
export const MAX_BODY_BYTES = 16 * 1024;

const ROLES = new Set(['teacher', 'parent', 'student']);

/**
 * Every failure code this server may report, closed-set for the same reason `DENY_CODES` in
 * backend/lib/auth.mjs is: a free-text reason is how an attacker-supplied string reaches the
 * model, and then a user. Anything unrecognised collapses to `agent_unavailable`.
 *
 * The first nine are `runToolLoop`'s own `LoopError` codes; `bad_input` is this file's.
 */
export const OUTCOME_CODES = new Set([
  'no_role',
  'model_response_unreadable',
  'tool_use_without_stop_reason',
  'tool_use_without_tool',
  'tool_use_without_id',
  'tool_use_duplicate_id',
  'tool_response_unreadable',
  'tool_loop_exhausted',
  'reply_truncated',
  'bad_input',
  'guardrail_intervened',
  'content_filtered',
  'agent_unavailable',
]);

/**
 * Which code an error from `runToolLoop` reports as.
 *
 * The two name-based branches come first and are matched the way orchestrate.mjs matches them, so
 * that layer 2 is attributed to layer 2 and the model provider's own filter is not: `contentFiltered`
 * exists in that file precisely because reporting it as a guardrail had the scoreboard crediting a
 * guardrail that was not configured.
 */
export function outcomeOf(err) {
  if (err?.name === 'GuardrailIntervened' || err?.guardrailAction === 'INTERVENED') {
    return 'guardrail_intervened';
  }
  if (err?.name === 'ContentFiltered') return 'content_filtered';
  return OUTCOME_CODES.has(err?.code) ? err.code : 'agent_unavailable';
}

/**
 * The `{ prompt, sessionAttributes }` this payload asks for, or `null` if it is not a request.
 *
 * `input` is nested on purpose: AWS's troubleshooting page names the missing `input` wrapper as the
 * cause of a 422 and shows both shapes side by side, so following the documented one costs nothing
 * and avoids the one payload mistake the service calls out by name.
 *
 * Validated rather than trusted. The caller is our own Lambda, so a failure here is a deployment
 * bug — but it is reported as a code rather than thrown, because an unparsed body that took the
 * whole reply down would reach the deploy evening as `agent_unavailable` and look like an outage.
 */
export function parseInvocation(payload) {
  const input = payload?.input;
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_MESSAGE) return null;

  const attrs = input?.sessionAttributes;
  // The role is not decided here, only checked for shape: `runToolLoop` fails closed on a missing
  // role anyway, and the action Lambdas gate again. This is the earliest of the three, not the only.
  if (!ROLES.has(attrs?.role) || typeof attrs?.sub !== 'string' || !attrs.sub) return null;

  return { prompt, sessionAttributes: attrs };
}

/**
 * Read a request body, refusing one that is too large rather than buffering it.
 *
 * Over the limit it stops *accumulating* and rejects, but it does NOT destroy the request. The
 * first version did, and a test caught what that costs: destroying the socket means the caller
 * gets `UND_ERR_SOCKET` instead of a response, which the chat Lambda can only report as
 * `agent_unavailable` — a reason-less transport error, which is the one outcome this whole file is
 * arranged to avoid. So the remaining chunks are read and dropped, the request ends normally, and
 * the handler gets to answer `bad_input` on a connection that still works.
 */
export function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk) => {
      if (over) return;                     // drain and discard; the socket stays usable
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;                  // do not hold a body we have already refused
        reject(new Error('body_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    // Settling twice is a no-op on a promise, so `end` after a reject is harmless and `end` is
    // still the only place a complete body resolves.
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * The request handler, with the one thing that needs AWS injected so this whole file runs under
 * `node --test` with no credentials and no network — the same reason orchestrate.mjs is a pure
 * function.
 *
 * @param deps `{ runTurn }` — `runTurn({ prompt, sessionAttributes })` resolves to the reply
 *   string. In the container that is `runToolLoop` wired to `converse` and `invokeTool`; see §3 of
 *   docs/AGENTCORE-PLAN.md for the ten lines that do the wiring.
 */
export function createHandler(deps) {
  return async function handle(req, res) {
    const url = (req.url ?? '').split('?')[0];

    // Required by the contract. Returns bare `{status}` and NOT `time_of_last_update`, which is
    // the documented footgun: "If your ping handler sets time_of_last_update to the current time
    // on every ping, the reported idle time keeps resetting, which prevents the idle timeout from
    // firing. Sessions then live until MaxLifetime and can exhaust your session quota."
    // (runtime-troubleshooting.html). A session that never goes idle also never stops billing
    // memory, which is the single largest cost risk on this path — see §5 of the plan.
    if (req.method === 'GET' && url === '/ping') return send(res, 200, { status: 'Healthy' });

    if (req.method !== 'POST' || url !== '/invocations') return send(res, 404, { output: { error: 'not_found' } });

    let raw;
    try {
      raw = await readBody(req);
    } catch {
      return send(res, 200, { output: { error: 'bad_input' } });
    }

    let request;
    try {
      request = parseInvocation(JSON.parse(raw));
    } catch {
      request = null;
    }
    if (!request) return send(res, 200, { output: { error: 'bad_input' } });

    try {
      const reply = await deps.runTurn(request);
      // An empty reply is not a reply. `handleChat` already refuses one (`empty_agent_reply`), and
      // refusing it here as well keeps this server's contract "a reply or a code", never both-and-
      // neither — a blank string returned as success is the shape that renders an empty bubble.
      if (typeof reply !== 'string' || reply.trim() === '') {
        return send(res, 200, { output: { error: 'agent_unavailable' } });
      }
      return send(res, 200, { output: { reply } });
    } catch (err) {
      // The code only. The error's own text can carry a DynamoDB message or an echo of a
      // model-supplied tool name, and neither belongs back in a response that reaches a prompt.
      return send(res, 200, { output: { error: outcomeOf(err) } });
    }
  };
}

/** Start listening. Returns the server so a caller (and the test) can close it. */
export async function start(deps, { port = PORT, host = HOST } = {}) {
  const { createServer } = await import('node:http');
  const server = createServer(createHandler(deps));
  await new Promise((resolve) => server.listen(port, host, resolve));
  return server;
}
