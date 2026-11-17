// Hosted-UI sign-in. The whole of it is one redirect out and one token exchange back.
//
// ---------------------------------------------------------------------------------------------
// WHY THE TOKEN NEVER LEAVES MEMORY (requirement 1.1)
//
// `session` below is a module-level variable and that is the only place an ID token is ever held.
// Not `localStorage`, not `sessionStorage`, not a cookie, not `window.panthiya`. A token in any
// of those is a token that any script injected into this page can read at its leisure, and this
// app holds children's marks and their parents' fees. The cost of the rule is that a reload, and
// moving from one page to another, both mean signing in again — and that is the correct trade for
// this product. After the first sign-in the second one is a silent redirect round-trip, because
// Cognito's own hosted-UI session cookie answers it without a password.
//
// The ONE thing that does touch `sessionStorage` is the PKCE record: `{state, nonce, verifier}`.
// Those are not credentials — they are single-use, useless on their own, and they have to survive
// the redirect to Cognito and back or the code flow cannot be completed at all. They are consumed
// and deleted the moment the callback arrives, before the exchange is attempted. If you are here
// because you saw `sessionStorage` and thought the rule was broken: read `FLOW_KEY` below.
//
// THE ID TOKEN, NOT THE ACCESS TOKEN. The API Gateway authorizer in `backend/template.yaml`
// verifies against the app client id as audience, and `cognito:groups` — which carries the role —
// is only ever in the ID token. An access token sent to `/chat` is a 401.
//
// THE FRONT-END READS THE ROLE; IT NEVER ASSERTS IT. `roleOf()` exists so this page can decide
// which screen to draw. It is never put in a request body, a query string or a header, and no
// page ever sends one: `backend/lib/auth.mjs#claimsFromEvent` reads the role from the claims the
// authorizer verified and ignores everything else (requirement 1.3, design.md §3.1). This is the
// distinction a future reader is most likely to get wrong, so it is said twice: reading the role
// to pick a screen is UX; the server's copy is the only one that decides anything.
// ---------------------------------------------------------------------------------------------
//
// ponytail: no auth library and no abstraction over Cognito. A hosted-UI code+PKCE flow is the
// four functions below; an SDK would be a dependency in a repo that has none, for the same bytes.
// Ceiling: no refresh token, so a session is 60 minutes (`IdTokenValidity`) and then over. Add
// rotation when there are users who stay logged in all day; a demo does not have one.

import { t, setText, onLang } from './i18n.js';

/* ================================================================================================
   1. Config — the four values `sam deploy` prints. Nothing else in the front-end knows them.
   ================================================================================================ */

// ponytail: four constants in a file, not a fetched /config.json. They change once, on the day of
// the deploy, and a fetch would add a round-trip and an await to every page for three strings.
// A8 in docs/NEXT-SESSION.md already edits two asset files by hand; this is the third.
export const CONFIG = {
  domain: 'REPLACE_AFTER_DEPLOY.auth.ap-south-1.amazoncognito.com', // Cognito::UserPoolDomain
  clientId: 'REPLACE_AFTER_DEPLOY',                                 // stack output UserPoolClientId
  userPoolId: 'REPLACE_AFTER_DEPLOY',                               // stack output UserPoolId
  apiBase: 'https://REPLACE_AFTER_DEPLOY.execute-api.ap-south-1.amazonaws.com/dev', // ApiEndpoint
};

const PLACEHOLDER = 'REPLACE_AFTER_DEPLOY';

/** False until the deploy outputs are pasted in. Shown as a message, never as a broken button. */
export const configured = () => !Object.values(CONFIG).some((v) => v.includes(PLACEHOLDER));

/** The API origin, for the swap points in `redteam.js` and `student.js`. */
export const apiBase = () => CONFIG.apiBase;

/** The issuer the ID token must carry. A pool id is `<region>_<suffix>`, so the region is in it. */
export const issuerOf = (userPoolId) =>
  `https://cognito-idp.${String(userPoolId).split('_')[0]}.amazonaws.com/${userPoolId}`;

/* ================================================================================================
   2. Pure token reading — no DOM, no network, no clock of its own. All of this is unit-tested.
   ================================================================================================ */

/** The only roles that exist. Mirrors `ROLES` in `backend/lib/auth.mjs`. */
const ROLES = ['teacher', 'parent', 'student'];

/** 5 s of slack, so a request is never sent on a token the server will have already retired. */
const SKEW_MS = 5000;

const padB64 = (s) => s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');

/**
 * The claims of a JWT, or `null` if it is not a readable one.
 *
 * This decodes; it does not verify. Nothing here is a security check — the signature is checked
 * by the API Gateway authorizer (requirement 1.2) and by nobody else. Decoding exists so the page
 * can show an email, pick a screen, and know when the session has run out.
 */
export function claimsOf(jwt) {
  if (typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const bytes = Uint8Array.from(atob(padB64(parts[1])), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)); // an email may be non-ASCII
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

/**
 * The single role these claims carry, or `null`.
 *
 * A deliberate copy of `soleRole()` in `backend/lib/auth.mjs`, including the two claim shapes and
 * including the rule that matters: **two roles is `null`, not a choice.** An ambiguous token is
 * never resolved in the holder's favour. The server decides regardless, so a mismatch between
 * these two readers can only ever show the wrong screen — but a screen that says "teacher" over
 * an API that answers "parent" is its own kind of lie, so they are kept the same.
 */
export function roleOf(claims) {
  const raw = claims?.['cognito:groups'];
  const names = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.replace(/^\s*\[/, '').replace(/\]\s*$/, '').split(/[\s,]+/)
      : [];

  const found = new Set(names.map((v) => String(v).trim().toLowerCase()).filter((v) => ROLES.includes(v)));
  return found.size === 1 ? [...found][0] : null;
}

/** When these claims stop being accepted, in ms. `0` when there is no `exp` — i.e. already over. */
export const expiresAt = (claims) => (typeof claims?.exp === 'number' ? claims.exp * 1000 : 0);

/** 60 minutes after sign-in (`IdTokenValidity` in template.yaml), minus the skew. */
export const isExpired = (claims, now = Date.now()) => expiresAt(claims) - SKEW_MS <= now;

/**
 * The redirect URI for a page, which must match a registered callback URL byte for byte.
 *
 * `index.html` is stripped because Amplify serves `/teacher/index.html` at `/teacher/` and a
 * visitor who types the long form would otherwise get `redirect_mismatch` from Cognito — an error
 * page with no explanation on it, for a URL that looks identical to the registered one.
 */
export const redirectUriFor = ({ origin, pathname }) => origin + pathname.replace(/index\.html$/, '');

/**
 * The hosted-UI authorization request. Authorization code + PKCE (S256), and nothing else:
 * no implicit flow, no client secret a browser could not keep, and no `role` parameter — there is
 * no such thing, because the role is a property of the account, not of the request.
 */
export function authorizeUrl({ domain, clientId, redirectUri, state, nonce, challenge }) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email', // `openid` for the ID token, `email` so the panel can name the account
    state,                 // CSRF binding, compared on the way back
    nonce,                 // replay binding, compared against the ID token's own claim
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `https://${domain}/oauth2/authorize?${query}`;
}

/**
 * Accept a pasted ID token for one role, or say exactly why not.
 *
 * This is the gate on the red-team page's role panel, and the **no-fallback rule lives here**: a
 * teacher token pasted into the parent box is `role_mismatch` and is thrown away. Accepting it
 * would make the parent cases run as a teacher, and a teacher legitimately answering a privacy
 * question would then score as a pass — the one lie that page must never tell. Scoring those
 * cases `error` is the correct outcome.
 *
 * @returns {{ok: true, token: string, claims: object, role: string}
 *          | {ok: false, reason: 'malformed'|'not_an_id_token'|'no_role'|'role_mismatch'|'expired'}}
 */
export function acceptRoleToken(raw, expectedRole, now = Date.now()) {
  const token = typeof raw === 'string' ? raw.trim() : '';
  const claims = claimsOf(token);
  if (!claims) return { ok: false, reason: 'malformed' };
  if (claims.token_use !== 'id') return { ok: false, reason: 'not_an_id_token' };

  const role = roleOf(claims);
  if (!role) return { ok: false, reason: 'no_role' };
  if (role !== expectedRole) return { ok: false, reason: 'role_mismatch' };
  if (isExpired(claims, now)) return { ok: false, reason: 'expired' };

  return { ok: true, token, claims, role };
}

/* ================================================================================================
   3. The session — one token, in memory, for the life of this page
   ================================================================================================ */

/**
 * The PKCE record, and the only key this app writes to any browser storage.
 *
 * It holds `{state, nonce, verifier, redirectUri}`: four single-use values that are worthless to
 * anyone who steals them (the verifier proves nothing without the matching code, and the code is
 * single-use and bound to it) and that MUST outlive the redirect, which memory cannot. It is
 * removed before the exchange is attempted, so a second callback has nothing to replay.
 */
const FLOW_KEY = 'panthiya.auth.flow';

/** The whole session. Cleared by expiry, by a 401, by sign-out, and by every reload. */
let session = null;

let dom = null;
let expiryTimer = null;
const ui = { messageKey: '', pageRole: null, packLoaded: false };

const toB64Url = (binary) => btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const randomUrlSafe = (bytes = 32) =>
  toB64Url(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))));

async function sha256UrlSafe(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toB64Url(String.fromCharCode(...new Uint8Array(digest)));
}

/** The live ID token, or `null`. Expiry is checked on every read, not on a schedule. */
export function idToken() {
  if (session && isExpired(session.claims)) clearSession('auth.expired');
  return session?.token ?? null;
}

/** The role of the signed-in session, read from its own claims. `null` when not signed in. */
export const sessionRole = () => (idToken() ? session.role : null);

/** The signed-in account's email, for the panel. `''` when the token carries none. */
export const sessionEmail = () => (idToken() ? (session.claims.email ?? '') : '');

/** The header every API call needs, or `null` — in which case do not call, show sign-in. */
export function authHeader() {
  const token = idToken();
  return token ? { Authorization: `Bearer ${token}` } : null;
}

/**
 * What to do with a 401 (requirement 1.4): drop the session and send the user back to sign-in
 * with a plain sentence. Never a silent failure, and never a retry — the authorizer rejected the
 * token, so the same token will be rejected again.
 *
 * For the SWAP POINTs in `redteam.js` and `student.js`, the whole contract is three lines:
 *
 *   const auth = authHeader();
 *   if (!auth) { handleUnauthorized(); return { status: 401, body: {} }; }   // not signed in
 *   const res = await fetch(`${apiBase()}/chat`, { method: 'POST', headers: { ...auth, ... } });
 *   if (res.status === 401) handleUnauthorized();
 */
export const handleUnauthorized = () => clearSession('auth.unauthorized');

function clearSession(messageKey = '') {
  session = null;
  clearTimeout(expiryTimer);
  ui.messageKey = messageKey;
  render();
}

function setMessage(key) {
  ui.messageKey = key;
  render();
}

/** Start the redirect. Returns only if it could not be started. */
export async function beginSignIn(loc = window.location) {
  if (!configured()) return setMessage('auth.not_configured');

  const flow = {
    state: randomUrlSafe(),
    nonce: randomUrlSafe(),
    verifier: randomUrlSafe(),
    redirectUri: redirectUriFor(loc),
  };

  try {
    sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow));
  } catch {
    // Blocked storage (some private modes): the verifier cannot survive the redirect, so the flow
    // cannot be completed. Say so rather than sending the user on a trip that ends in an error.
    return setMessage('auth.failed');
  }

  setMessage('auth.working');
  loc.assign(authorizeUrl({
    domain: CONFIG.domain,
    clientId: CONFIG.clientId,
    redirectUri: flow.redirectUri,
    state: flow.state,
    nonce: flow.nonce,
    challenge: await sha256UrlSafe(flow.verifier),
  }));
}

/**
 * Sign out for real.
 *
 * Dropping our own memory is not a sign-out: Cognito's hosted UI keeps its own session cookie, so
 * the next "Sign in" would hand back the same account without asking — on a teacher's shared
 * phone that is the whole problem. So the browser goes to Cognito's `/logout`, which clears that
 * cookie and sends it straight back here.
 */
export function signOut(loc = window.location) {
  session = null;
  clearTimeout(expiryTimer);
  if (!configured()) return clearSession();

  const query = new URLSearchParams({ client_id: CONFIG.clientId, logout_uri: redirectUriFor(loc) });
  loc.assign(`https://${CONFIG.domain}/logout?${query}`);
}

/**
 * The callback half: verify everything, then trust the claims.
 *
 * Never throws. A sign-in that half-worked must leave the page in the signed-out state with a
 * sentence on it, not in a state where the next click does something unexpected.
 */
async function completeCallback(loc) {
  const params = new URLSearchParams(loc.search);
  const code = params.get('code');
  if (!code && !params.get('error')) return;

  // Consume the record and scrub the address bar BEFORE anything is exchanged. The code is
  // single-use: leaving it in the URL means a reload re-sends it (an error the user cannot read)
  // and a copied link carries it. Deleting the record first means a second callback — a replay,
  // or a double-submitted page — has no verifier to spend.
  let flow = null;
  try {
    flow = JSON.parse(sessionStorage.getItem(FLOW_KEY) ?? 'null');
    sessionStorage.removeItem(FLOW_KEY);
  } catch {
    flow = null;
  }
  history.replaceState(null, '', redirectUriFor(loc));

  if (!code || !flow || !flow.state || params.get('state') !== flow.state) return setMessage('auth.failed');

  try {
    const res = await fetch(`https://${CONFIG.domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CONFIG.clientId,
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.verifier,
      }),
    });
    if (!res.ok) return setMessage('auth.failed');

    const body = await res.json();
    const claims = claimsOf(body.id_token);

    // Pin issuer and audience, bind the nonce, and refuse an access token in the ID token's place.
    // The authorizer will check all of this again for real; checking it here means a wrong token
    // is caught at sign-in rather than as a 401 on the user's first question.
    const ok = claims
      && claims.token_use === 'id'
      && claims.aud === CONFIG.clientId
      && claims.iss === issuerOf(CONFIG.userPoolId)
      && claims.nonce === flow.nonce
      && !isExpired(claims);
    if (!ok) return setMessage('auth.failed');

    const role = roleOf(claims);
    if (!role) return setMessage('auth.failed'); // no group, or two: there is no screen to show

    session = { token: body.id_token, claims, role };
    ui.messageKey = '';

    // So an hour-old page says "expired, sign in again" instead of looking signed in and failing
    // on the next click.
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => clearSession('auth.expired'), Math.max(0, expiresAt(claims) - Date.now()));
    render();
  } catch {
    setMessage('auth.failed'); // offline, DNS, CORS: all the same thing to the person reading it
  }
}

/* ================================================================================================
   4. The panel — markup-driven, so no page script has to know this module exists
   ================================================================================================ */

/**
 * A role's name in the current language.
 *
 * `auth.role.*` repeats three words that `redteam.role.*` already has, and that is on purpose: a
 * panel shared by four pages must not depend on a key named for one of them. The hello page's
 * `roles.*.title` were the other candidate and are honorific plurals ("ගුරුතුමා / ගුරුතුමිය"),
 * which read as a title on a card and badly inside a sentence. Built-up key, so the closed set in
 * `ROLES` is the only thing that can reach it.
 */
const roleName = (role) => (ROLES.includes(role) ? t(`auth.role.${role}`) : '');

function render() {
  if (!dom) return;
  const token = idToken();

  dom.signin.hidden = Boolean(token);
  dom.signout.hidden = !token;

  if (token) {
    // `ui.pageRole` is what this page is for, from `data-auth-role` in the markup. Comparing it
    // with the token's role is how the panel knows to say "wrong account" instead of drawing a
    // teacher screen for a parent. It decides what is *shown*. It is not sent anywhere, and the
    // server would ignore it if it were (requirement 1.3).
    const mismatch = ui.pageRole && session.role !== ui.pageRole;
    setText(dom.state, mismatch
      ? t('auth.wrong_role', { actual: roleName(session.role), expected: roleName(ui.pageRole) })
      : t('auth.signed_in', { email: sessionEmail(), role: roleName(session.role) }));
  } else {
    setText(dom.state, ui.messageKey ? t(ui.messageKey) : t('auth.signed_out', { role: roleName(ui.pageRole) }));
  }
}

function boot() {
  const root = document.getElementById('auth');
  if (!root) return; // the hello page has sign-in *entry* links and holds no token at all

  const byId = (id) => document.getElementById(id);
  dom = { state: byId('auth-state'), signin: byId('auth-signin'), signout: byId('auth-signout') };
  ui.pageRole = root.dataset.authRole ?? null;

  dom.signin.addEventListener('click', () => beginSignIn());
  dom.signout.addEventListener('click', () => signOut());

  // The page's own script owns `init()`; calling it twice would double-wire the language buttons.
  onLang(() => {
    ui.packLoaded = true;
    render();
  });

  return completeCallback(window.location).then(() => {
    if (ui.packLoaded) render();
  });
}

/**
 * Resolved once the `?code=` callback has been dealt with, so a caller that needs a token on load
 * can wait for it. The guard is for Node: the unit test imports the pure functions above and must
 * not boot a page that has no document.
 */
export const ready = typeof document === 'undefined' ? Promise.resolve() : Promise.resolve(boot());
