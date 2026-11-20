// redteam — the HTTP boundary for the two red-team routes of design §5.
//
// This file is the boundary and nothing else: it picks the route, builds `deps`, and turns a
// return value or a thrown error into an API Gateway response. All authorisation lives in
// `runner.mjs` and all scoring in `score.mjs`, which is why those are the files the unit tests
// drive directly.
//
// Status codes carry a closed-set code and never the client's own text, for the same reason
// `DenyError` does (`backend/lib/auth.mjs`): an echoed body is a reflected payload, and on this
// route the body describes an attack.
//
//   403 denied        not a teacher session (requirement 11.1), or a run that is not the
//                     caller's own. `out_of_scope` is returned for "does not exist" as well, so a
//                     probe learns nothing from the difference.
//   400 bad_request   a malformed scoring request — including `layers_changed`, which is a run
//                     being filed under a configuration it did not start with (requirement 11.6).
//   404 not_found     a path this function does not serve.
//   500               a genuine fault. Never a partial scoreboard presented as a complete one:
//                     "35 of 36 blocked" with one write silently lost is a false claim on stage.
//
// There is no `bedrock:InvokeAgent` here and no `lambda:InvokeFunction` (design §4.0, and the IAM
// note in template.yaml). That is not an omission to be fixed: the browser runs each case against
// `POST /chat` with a token for the case's own role, so every case exercises the real path —
// distress check, agent, guardrail, role-scoped action group, policyCheck — and the role comes
// from a verified token rather than from anything this function could assert about itself.

import { fromCaller } from '../../lib/injected.mjs';
import { DenyError } from '../../lib/auth.mjs';
import { ROUTES } from './runner.mjs';
import { RunError } from './score.mjs';

const JSON_HEADERS = { 'content-type': 'application/json' };

const reply = (status, body) => ({ statusCode: status, headers: JSON_HEADERS, body: JSON.stringify(body) });

/**
 * The route this invocation is for.
 *
 * HTTP API payload v2 supplies `routeKey` ("POST /redteam/run"), which is the template's own route
 * and therefore the safest thing to dispatch on. The fallback composes the same string from the
 * request context for a locally-invoked event. Same shape as `read/index.mjs`.
 */
export function routeKeyOf(event) {
  if (typeof event?.routeKey === 'string' && event.routeKey) return event.routeKey;

  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path ?? event?.rawPath;
  return method && path ? `${method} ${path}` : '';
}

/**
 * @param event the HTTP API invocation
 * @param provided injected `{ query, put, tables }`. Omitted in Lambda, where `ddb.mjs` is loaded
 *   lazily — a *static* import of it would pull the AWS SDK into every test process, and the unit
 *   suite deliberately has no dependencies installed to pull it from.
 */
export const handler = async (event, context) => {
  const provided = fromCaller(context);
  const handle = ROUTES[routeKeyOf(event)];
  if (!handle) return reply(404, { error: 'not_found' });

  const deps = provided ?? (await import('../../lib/ddb.mjs')).deps();

  try {
    const { status, body } = await handle(event, deps);
    return reply(status, body);
  } catch (e) {
    if (e instanceof DenyError) return reply(403, { error: 'denied', reason: e.code });
    if (e instanceof RunError) return reply(400, { error: 'bad_request', reason: e.code });

    // A genuine fault (DynamoDB unavailable, a conditional check that failed). Surfaced rather
    // than swallowed: a case whose row was not written must not come back as a score.
    throw e;
  }
};
