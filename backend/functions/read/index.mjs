// read — the HTTP boundary for the four read views of design §5.
//
// This file is the boundary and nothing else: it picks the route, builds `deps`, and turns a return
// value or a thrown error into an API Gateway response. All authorisation and all shaping live in
// `handlers.mjs`, which is why that file is the one the unit tests drive directly.
//
// Status codes carry a closed-set code and never the client's own text, for the same reason
// `DenyError` does (`backend/lib/auth.mjs`): an echoed query string is a reflected payload.
//
//   403 denied        wrong role, or an identifier outside the caller's scope. `out_of_scope` is
//                     returned for "does not exist" as well, so a probe learns nothing from it.
//   400 bad_request   a malformed request (a missing path id, a bad filter).
//   404 not_found     a path this function does not serve.
//   500               a genuine fault. Never a partial list presented as a complete one.

import { fromCaller } from '../../lib/injected.mjs';
import { DenyError } from '../../lib/auth.mjs';
import { ROUTES, ReadError } from './handlers.mjs';

const JSON_HEADERS = { 'content-type': 'application/json' };

const reply = (status, body) => ({ statusCode: status, headers: JSON_HEADERS, body: JSON.stringify(body) });

/**
 * The route this invocation is for.
 *
 * HTTP API payload v2 supplies `routeKey` ("GET /teacher/students/{id}/export"), which is the
 * template's own route and therefore the safest thing to dispatch on. The fallback composes the
 * same string from the request context for a locally-invoked event.
 */
export function routeKeyOf(event) {
  if (typeof event?.routeKey === 'string' && event.routeKey) return event.routeKey;

  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path ?? event?.rawPath;
  return method && path ? `${method} ${path}` : '';
}

/**
 * @param event the HTTP API invocation
 * @param provided injected `{ query, get, tables }`. Omitted in Lambda, where `ddb.mjs` is loaded
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
    if (e instanceof ReadError) return reply(400, { error: 'bad_request', reason: e.code });

    // A genuine fault. Surfaced rather than swallowed: an empty inbox or a short audit list
    // presented as complete is worse than an error a teacher can see and retry.
    throw e;
  }
};
