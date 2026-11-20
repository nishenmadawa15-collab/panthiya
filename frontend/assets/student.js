// Panthiya student tutor: hint scaffolding as cards, and a worked example that says in words it
// is somebody else's problem.
//
// The reply from POST /chat is model prose, not a form. The one piece of structure in it is the
// `[[EXAMPLE]] … [[/EXAMPLE]]` contract from backend/agent/instructions.md: text inside the
// wrapper is a *different* problem worked through, text outside it is a hint and is held to the
// strict rules by defence layer 3. This file draws those two as two different cards, because
// drawing them the same way would hand a student an answer in a box labelled "hint" — the exact
// failure requirement 8.3 exists to prevent.
//
// Same hard rule as parent.js: strings reach the DOM through textContent only, never as HTML
// (requirement 12.7).
//
// The language shell lives in assets/i18n.js and is shared by every page. It owns the data-i18n
// pass, the title, document.lang, the language buttons and the textContent-only rule; this file
// registers a re-render with onLang() so a language switch redraws the hints in place.

import { init, t, setText, onLang, currentLang } from './i18n.js';
import { apiBase, authHeaderOrThrow, bodyOrThrow, configured, serverSentence } from './auth.js';

/* ================================================================================================
   1. The reply splitter — the only part of this screen with a rule it must get exactly right.
   ================================================================================================ */

// Both delimiters, or it is not an example. Mirrors the pattern in policy-check/checks.mjs.
const EXAMPLE = /\[\[EXAMPLE\]\]([\s\S]*?)\[\[\/EXAMPLE\]\]/gi;

/** Non-empty, trimmed lines. A model writes bullets and steps one per line; keep them that way. */
function lines(chunk) {
  return chunk.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

/** Hint prose → one card per blank-line-separated paragraph.
    ponytail: a blank line starts a new card and that is the whole layout rule. No markdown
    parser: a "- " or a "1." arrives as the plain text it is. Lift this only if a live reply reads
    badly as paragraphs — a parser here would be a second place for model text to become markup. */
function hintCards(chunk) {
  return chunk
    .split(/\n[ \t]*\n/)
    .map(lines)
    .filter((block) => block.length > 0)
    .map((block) => ({ kind: 'hint', lines: block }));
}

/**
 * A model reply → an ordered list of `{kind: 'hint' | 'example', lines[]}` segments.
 *
 * Deliberately mirrors `splitExamples()` in backend/functions/policy-check/checks.mjs, including
 * its safety rule: an opening delimiter with no closing one is **not** an example, so a
 * half-written wrapper cannot smuggle an answer into the card that says "this is not your
 * problem". The two must agree — that file decides what is allowed to arrive, this one decides
 * how it is drawn, and a disagreement between them is a leak or a broken-looking demo.
 *
 * Exported for tests/unit/student-frontend.test.mjs, which checks it against the backend splitter.
 */
export function splitReply(reply) {
  const text = typeof reply === 'string' ? reply : '';
  const segments = [];
  let at = 0;

  for (const match of text.matchAll(EXAMPLE)) {
    segments.push(...hintCards(text.slice(at, match.index)));
    const inner = lines(match[1]);
    if (inner.length > 0) segments.push({ kind: 'example', lines: inner });
    at = match.index + match[0].length;
  }
  segments.push(...hintCards(text.slice(at)));

  return segments;
}

/* ================================================================================================
   2. Data access — the only part of this screen that knows where a reply comes from.
   ================================================================================================ */

// ponytail: SWAP POINT — taken. askTutor() below is the entire data surface of this screen and the
// real `POST /chat` (design.md §5) is its implementation; MOCK and mockReply() are the fallback it
// uses while the stack is down. `MOCKING` is `configured()` from auth.js — the same "are the four
// deploy outputs pasted in" check the sign-in panel uses — so there is nothing to edit here on
// deploy evening: paste the four stack outputs into `CONFIG` in assets/auth.js and this screen is
// live. A real reply arrives as one block of text with the `[[EXAMPLE]]` delimiters already inside
// it, which is what `reply` carries and `mock` does not.
const MOCKING = !configured();

const MOCK = { latencyMs: 400 };

// The mock has no model behind it, so it answers with pack keys instead of a server string. The
// first question gets the hint scaffolding alone and later ones get a worked example as well:
// both shapes are real — a reply may legitimately carry no example at all, because layer 3
// discards answer-shaped text that arrives without both delimiters — and the demo has to show
// each of them at least once.
let mockTurn = 0;

const MAX_MESSAGE = 2000; // design.md §5 rejects a longer message with 400 before any model call.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST /chat → `{reply, blockedBy}` for a student asking about a question they are stuck on.
 *
 * The length check is this side's half of design.md §5: the server answers a longer message with
 * 400 before any model call, and refusing it here as well costs a child no round-trip. The limit
 * is the only thing checked — the question itself is sent exactly as typed.
 *
 * Mocked while `CONFIG` is placeholders: returns which mock shape to render instead of a reply.
 */
export async function askTutor(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('empty question');
  if (text.length > MAX_MESSAGE) throw new Error('question too long');

  if (MOCKING) {
    await sleep(MOCK.latencyMs);
    mockTurn += 1;
    return { mock: mockTurn > 1 ? 'example' : 'hint', blockedBy: null };
  }

  // `lang` so a refusal and a wellbeing reply come back in the language the student is reading.
  // Never a retry: a second send is a second message in the same session, and a student in
  // difficulty must not be answered twice (chat/orchestrate.mjs checks distress before anything).
  const auth = authHeaderOrThrow();
  return bodyOrThrow(await fetch(`${apiBase()}/chat`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ message: text, lang: currentLang() }),
  }));
}

/**
 * The mock's reply text, built fresh in the current language.
 *
 * The delimiters are added here rather than stored in the language packs: they are a contract with
 * policyCheck, not UI text, and a translator must never be in a position to break them.
 */
function mockReply(shape) {
  const parts = [t('student.mock_hint')];
  if (shape === 'example') {
    parts.push(`[[EXAMPLE]] ${t('student.mock_example')} [[/EXAMPLE]]`, t('student.mock_transfer'));
  }
  return parts.join('\n\n');
}

/* ================================================================================================
   3. State
   ================================================================================================ */

// Everything on screen is derived from this, so a language switch is a re-render, not a reload: a
// mock hint already on screen is stored as a shape name and comes back in the new language.
const state = {
  turns: [],        // {side: 'student', text} | {side: 'tutor', reply?, mock?, blockedBy?}
  statusKey: '',
  // A failed send shows the server's own sentence when it sent one, and our `student.error` when
  // it did not. Never both, and never one of ours written over the top of one of theirs — the same
  // rule the voice note follows in teacher.js (requirement 3.6).
  statusMessage: '',
  sending: false,   // a /chat round-trip is open; the send button says so with aria-disabled
};

// Built in start() rather than at module scope so that tests/unit/student-frontend.test.mjs can
// import splitReply() from this file in Node, where there is no document to look things up in.
let dom = null;

/* ================================================================================================
   4. Rendering
   ================================================================================================ */

/** A <p> with a class and text. Text only, never HTML (requirement 12.7). */
function para(className, value) {
  const node = document.createElement('p');
  node.className = className;
  setText(node, value);
  return node;
}

/** A card holding one <p> per line of a segment. */
function card(className, textClassName, segment) {
  const wrap = document.createElement('div');
  wrap.className = className;
  for (const line of segment.lines) wrap.append(para(textClassName, line));
  return wrap;
}

/** The student's own question. Their words, so never translated and never re-rendered. */
function question(entry) {
  const wrap = document.createElement('div');
  wrap.className = 'student-ask';
  wrap.append(
    para('student-ask__who', t('student.sender_student')),
    para('student-ask__text', entry.text),
  );
  return wrap;
}

/**
 * A worked example. Three things mark it out, and only one of them is visual: its own frame, and
 * two lines of text saying it is a different problem. A student reading in greyscale, in
 * high-contrast mode or through a screen reader still gets told.
 */
function exampleCard(segment) {
  const wrap = card('student-example', 'student-example__text', segment);
  wrap.prepend(para('student-example__label', t('student.example.label')));
  wrap.append(para('student-example__note', t('student.example.note')));
  return wrap;
}

/** A refusal or a wellbeing reply: not a hint, so it is not drawn as one. */
function notice(text) {
  const wrap = document.createElement('div');
  wrap.className = 'student-notice';
  wrap.append(para('student-notice__text', text));
  return wrap;
}

function reply(entry) {
  const wrap = document.createElement('div');
  wrap.className = 'student-reply';
  wrap.append(para('student-reply__who', t('student.sender_tutor')));

  // A blocked reply carries no hint to draw. `distress` is the one layer that sends its own kind
  // words back (chat/orchestrate.mjs), so show those when they are there and ours when they are
  // not; the student is never told which layer fired.
  if (entry.blockedBy) {
    wrap.append(notice(entry.reply ?? t('student.blocked')));
    return wrap;
  }

  // `mock` is set only by the mock, so a live reply can never reach mockReply(): a 200 that somehow
  // carried neither a reply nor a `blockedBy` would otherwise draw the demo hint as if a tutor had
  // written it, which is the one thing a page running live must not do. It falls through to the
  // notice below instead.
  const segments = splitReply(entry.reply ?? (entry.mock ? mockReply(entry.mock) : ''));

  // Nothing left after splitting means the reply was empty or was only a stray delimiter. Saying
  // so beats an empty card that looks like a page still loading.
  if (segments.length === 0) {
    wrap.append(notice(t('student.blocked')));
    return wrap;
  }

  for (const segment of segments) {
    wrap.append(segment.kind === 'example'
      ? exampleCard(segment)
      : card('student-hint', 'student-hint__text', segment));
  }
  return wrap;
}

function render() {
  dom.messages.replaceChildren();
  for (const entry of state.turns) {
    dom.messages.append(entry.side === 'student' ? question(entry) : reply(entry));
  }

  dom.empty.hidden = state.turns.length > 0;
  setText(dom.status, state.statusMessage || (state.statusKey ? t(state.statusKey) : ''));
  // `aria-disabled`, not `disabled`: disabling the button the student has just pressed drops focus
  // to <body> for the whole Bedrock round-trip, so the keyboard loses its place and the next Tab
  // restarts at the top of the page. This keeps it focusable; submit() ignores the press.
  dom.send.setAttribute('aria-disabled', String(state.sending));

  // Keep the newest hint in view without moving focus.
  dom.log.scrollTop = dom.log.scrollHeight;
}

/* ================================================================================================
   5. Wiring
   ================================================================================================ */

async function submit(event) {
  event.preventDefault();
  // What `disabled` used to do, without taking the focus away to do it.
  if (state.sending) return;

  const text = dom.input.value.trim();
  if (text === '') return;

  dom.input.value = '';
  state.turns.push({ side: 'student', text });
  state.statusKey = 'student.sending';
  state.statusMessage = '';
  state.sending = true;
  render();

  try {
    const { reply: replyText, mock, blockedBy } = await askTutor(text);
    state.turns.push({ side: 'tutor', reply: replyText, mock, blockedBy });
    state.statusKey = '';
  } catch (err) {
    console.error(err);
    state.statusKey = 'student.error';
    state.statusMessage = serverSentence(err);   // the server's words when it sent any, as-is
  } finally {
    state.sending = false;
    // No focus() here: it existed to undo the focus `disabled` had just thrown away. Nothing is
    // dropped now, so calling it would instead yank the student back from wherever they had moved
    // during the request (2.4.3, 3.2.5).
    render();
  }
}

async function start() {
  const el = (id) => document.getElementById(id);
  dom = {
    log: el('student-log'),
    empty: el('student-empty'),
    messages: el('student-messages'),
    status: el('student-status'),
    form: el('student-form'),
    input: el('student-input'),
    send: el('student-send'),
  };

  dom.form.addEventListener('submit', submit);

  onLang(() => render());
  await init({ titleKey: 'student.heading' });
}

// type="module" defers, so the DOM is ready by now. The guard is for Node: the unit test imports
// this file for splitReply() and must not boot a page that has no document.
if (typeof document !== 'undefined') start();
