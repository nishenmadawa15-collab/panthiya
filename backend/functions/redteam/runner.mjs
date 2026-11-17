// The two red-team routes: record one scored case, and list past runs.
//
// Same design §3.2 order as every other handler, with `claimsFromEvent` because these arrive over
// HTTP, where the API Gateway JWT authorizer has already verified signature, issuer, audience and
// expiry before our code runs:
//
//   const { role, sub } = claimsFromEvent(event);   never the body, the query string or a header
//   requireRole(role, 'teacher');                   first statement (requirement 11.1)
//   every id the CLIENT supplied is re-authorised before it is used as a key
//
// The client-supplied identifier here is `runId`, and it is re-authorised by construction rather
// than by a lookup: a runId is minted as `<sub>#<startedAt>#<random>`, so a run that is not the
// caller's own cannot be named without naming their own `sub` first. That is `assertInScope`'s
// rule — exact equality against something the server issued — applied to a key `assertInScope`
// cannot speak about, since its scope lists hold studentIds and classIds and extending
// `lib/auth.mjs` with a third kind belongs to the lane that owns `backend/lib/`. The refusal code
// is the same `out_of_scope`, so a run that does not exist and a run that belongs to another
// teacher come back identical.
//
// WHY THE SUITE IS NOT PACKAGED WITH THIS FUNCTION. `tests/redteam/cases.json` lives outside the
// `CodeUri` of every function (the backend root), so a relative read of it from here is the exact
// MODULE_NOT_FOUND / ENOENT shape `tests/unit/packaging.test.mjs` exists to catch, and a copy
// under `backend/` would be a second source of truth that `tests/unit/redteam-cases.test.mjs`
// does not guard — the one file in this feature that must never be allowed to drift. So the page
// sends the case it ran (`{id, role}`) and this function validates its shape, not its contents.
// The suite's integrity is held where it is generated: the Kiro hook, the generator's `--check`
// mode and the sync test. Nothing is lost: the runner's job is to judge an outcome, and a doctored
// case id only ever corrupts the teacher's own scoreboard.
//
// WHY ONE CASE PER REQUEST. 36 cases, several of them three messages, each message a full
// `InvokeAgent` round trip: minutes of wall clock against a 29-second API Gateway integration
// timeout, so one request cannot carry the suite however it is written. Per case it also follows
// that the scoreboard updates as it goes, which is requirement 11.3's "running" score and the
// thing that makes the demo watchable, and that a teacher who sees a leak can stop without paying
// for the remaining cases (design §10).
//
// NO REPLY TEXT IS STORED. Requirement 11.7 asks for timestamps, the layer configuration, the
// per-case verdicts and the totals, and this function writes exactly that. The reply itself stays
// in the browser, where requirement 11.4 needs it read. Persisting it would move a child's name
// or an injection payload into a table and from there into a dashboard — the same reason
// `policy-check/index.mjs` logs nothing at all.

import { randomUUID } from 'node:crypto';
import { claimsFromEvent, requireRole, DenyError } from '../../lib/auth.mjs';
import { RunError, scoreCase, parseRequest, totalsFrom, layersKey, disabledLayers } from './score.mjs';

/** `redteam_runs` TTL, design §4: a run self-deletes after 30 days, which is also a cost guard. */
const TTL_DAYS = 30;

/** The `_meta` sort key of design §4. One row per run, holding the configuration and the totals. */
const META = '_meta';

/** How many past runs `GET /redteam/runs` returns. A list view with no ceiling is a timeout. */
const RUNS_LIMIT = 20;

const ttlFrom = (startedAt) => Math.floor(Date.parse(startedAt) / 1000) + TTL_DAYS * 24 * 60 * 60;

/**
 * A fresh run id.
 *
 * `sub` first so ownership is a string comparison (see the header). The ISO timestamp next so the
 * `byTeacher` index, whose sort key is `runId`, is already in chronological order and "newest
 * first" costs nothing. The random tail keeps two runs started in the same millisecond apart.
 */
const mintRunId = (sub, startedAt) => `${sub}#${startedAt}#${randomUUID().slice(0, 8)}`;

/** Re-authorise a client-supplied runId. Not-yours and does-not-exist are the same refusal. */
function ownRunId(runId, sub) {
  if (typeof runId !== 'string' || !runId.startsWith(`${sub}#`)) throw new DenyError('out_of_scope');
  if (runId.length > 200) throw new RunError('run_id_invalid');
  return runId;
}

/**
 * The request body as an object.
 *
 * API Gateway hands it over as a string; a locally-invoked event may already be parsed. Bad JSON
 * becomes a code, never an echo of what was sent (`lib/auth.mjs`, `read/handlers.mjs`).
 */
function bodyOf(event) {
  const raw = event?.body;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new RunError('bad_json');
  }
}

/** Run a query to exhaustion. A run's rows are 37 at most, and a partial total is a wrong total. */
async function queryAll(deps, params) {
  const items = [];
  let startKey;
  do {
    const page = await deps.query(startKey ? { ...params, ExclusiveStartKey: startKey } : params);
    items.push(...(page?.Items ?? []));
    startKey = page?.LastEvaluatedKey;
  } while (startKey);
  return items;
}

/** Every row of one run: the `_meta` row and one row per case scored so far. */
const rowsOfRun = (deps, runId) => queryAll(deps, {
  TableName: deps.tables.redteamRuns,
  KeyConditionExpression: 'runId = :r',
  ExpressionAttributeValues: { ':r': runId },
});

/**
 * POST /redteam/run — score one executed case, file it, and return the running totals.
 *
 * The case itself was executed by the browser against `POST /chat` under a token for the case's
 * own role; what arrives here is that outcome. This function never calls the agent: design §4.0
 * gives it no `bedrock:InvokeAgent`, deliberately, so that every case travels the same path a
 * real user's message does — including policyCheck — rather than a privileged shortcut that would
 * prove less than the demo claims.
 */
export async function runCase(event, deps) {
  const { role, sub } = claimsFromEvent(event);
  requireRole(role, 'teacher');                    // requirement 11.1, enforced server-side

  const parsed = parseRequest(bodyOf(event));

  const scoredAt = new Date().toISOString();
  const runId = parsed.runId ? ownRunId(parsed.runId, sub) : mintRunId(sub, scoredAt);
  const key = layersKey(parsed.layers);

  const existing = parsed.runId ? await rowsOfRun(deps, runId) : [];
  const meta = existing.find((r) => r.caseId === META);

  // Requirement 11.6, the half nobody writes a test for: a run is ONE configuration. Filing a
  // case into a run whose layers have since changed would produce a scoreboard that is the sum of
  // two different experiments, and the number on screen would mean nothing.
  if (meta && meta.layersKey !== key) throw new RunError('layers_changed');

  const result = scoreCase({
    caseRole: parsed.caseRole,
    sessionRole: parsed.sessionRole,
    layers: parsed.layers,
    turns: parsed.turns,
  });

  const caseRow = {
    runId,
    caseId: parsed.caseId,
    teacherId: sub,                                // so a case row is reachable by `byTeacher` too
    section: parsed.section,
    caseRole: parsed.caseRole,
    sessionRole: parsed.sessionRole,
    verdict: result.verdict,
    blockedBy: result.blockedBy,
    reason: result.reason,
    needsEye: result.needsEye,
    layersRelied: result.layersRelied,
    turns: result.turns,
    scoredAt,
    expiresAt: ttlFrom(meta?.startedAt ?? scoredAt),
  };

  // Re-running a single case replaces its row on purpose: the totals below are derived from the
  // rows, so a replaced row corrects the score instead of double-counting it.
  await deps.put({ TableName: deps.tables.redteamRuns, Item: caseRow });

  const startedAt = meta?.startedAt ?? scoredAt;
  const totals = totalsFrom([...existing.filter((r) => r.caseId !== parsed.caseId), caseRow]);

  await deps.put({
    TableName: deps.tables.redteamRuns,
    Item: {
      runId,
      caseId: META,
      teacherId: sub,
      startedAt,
      updatedAt: scoredAt,
      layers: parsed.layers,
      layersKey: key,
      layersDisabled: disabledLayers(parsed.layers),
      totals,
      expiresAt: ttlFrom(startedAt),
    },
    // The same one-configuration rule as above, enforced where it cannot be raced: two browser
    // tabs on the same run with different toggles leave one of them refused rather than both
    // averaged. DynamoDB evaluates this against the row as it stands, so an absent `_meta` (the
    // first case of a run) passes and a changed configuration does not.
    ConditionExpression: 'attribute_not_exists(runId) OR layersKey = :lk',
    ExpressionAttributeValues: { ':lk': key },
  });

  return {
    status: 200,
    body: {
      runId,
      caseId: parsed.caseId,
      verdict: result.verdict,
      blockedBy: result.blockedBy,
      reason: result.reason,
      needsEye: result.needsEye,
      layersRelied: result.layersRelied,
      turns: result.turns,
      layers: parsed.layers,
      layersDisabled: disabledLayers(parsed.layers),
      totals,
      scoredAt,
    },
  };
}

/** One `_meta` row as the page's run summary. Never the internal `layersKey`. */
const summary = (m) => ({
  runId: m.runId,
  startedAt: m.startedAt ?? null,
  updatedAt: m.updatedAt ?? null,
  layers: m.layers ?? null,
  layersDisabled: m.layersDisabled ?? [],
  totals: m.totals ?? null,
});

/**
 * GET /redteam/runs — this teacher's past runs, newest first.
 * GET /redteam/runs?runId=… — one run, with the per-case verdicts requirement 11.7 stored.
 *
 * The `byTeacher` index projects every row of every run, so the list filters for `_meta` and stops
 * as soon as it has enough of them — the index is in `runId` order, which is startedAt order by
 * construction, so "stop early" and "newest first" are the same walk.
 */
export async function listRuns(event, deps) {
  const { role, sub } = claimsFromEvent(event);
  requireRole(role, 'teacher');                    // requirement 11.1

  const asked = event?.queryStringParameters?.runId;

  if (typeof asked === 'string' && asked.trim()) {
    const runId = ownRunId(asked.trim(), sub);
    const rows = await rowsOfRun(deps, runId);
    const meta = rows.find((r) => r.caseId === META);
    // A run with no `_meta` row is a run that does not exist, and that is the same answer as a run
    // belonging to someone else (which `ownRunId` already gave).
    if (!meta) throw new DenyError('out_of_scope');

    return {
      status: 200,
      body: {
        ...summary(meta),
        cases: rows
          .filter((r) => r.caseId !== META)
          .sort((a, b) => a.caseId.localeCompare(b.caseId))
          .map((r) => ({
            caseId: r.caseId,
            section: r.section ?? null,
            caseRole: r.caseRole ?? null,
            verdict: r.verdict ?? null,
            blockedBy: r.blockedBy ?? null,
            reason: r.reason ?? null,
            needsEye: Boolean(r.needsEye),
            layersRelied: r.layersRelied ?? [],
            turns: r.turns ?? [],
            scoredAt: r.scoredAt ?? null,
          })),
      },
    };
  }

  const runs = [];
  let startKey;
  do {
    const page = await deps.query({
      TableName: deps.tables.redteamRuns,
      IndexName: 'byTeacher',
      KeyConditionExpression: 'teacherId = :sub',
      ExpressionAttributeValues: { ':sub': sub, ':meta': META },
      FilterExpression: 'caseId = :meta',
      ScanIndexForward: false,                     // newest first
    });
    for (const item of page?.Items ?? []) runs.push(summary(item));
    startKey = page?.LastEvaluatedKey;
  } while (startKey && runs.length < RUNS_LIMIT);

  return { status: 200, body: { runs: runs.slice(0, RUNS_LIMIT) } };
}

/** The two rows of design §5, as code. Keyed by the template's own route, like `read/index.mjs`. */
export const ROUTES = {
  'POST /redteam/run': runCase,
  'GET /redteam/runs': listRuns,
};
