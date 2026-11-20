// Panthiya parent inbox: the approved thread about one child, and an ask box beside it.
//
// The whole screen exists to keep one line visible: an update in the thread was written from the
// stored records and approved by the teacher (product.md rule 4, requirement 7.1); an answer in the
// ask box was not. They never share a container, a background, a bubble shape or a label.
//
// Same hard rule as teacher.js: strings reach the DOM through textContent only, never as HTML
// (requirement 12.7).
//
// The language shell lives in assets/i18n.js and is shared by every page. It owns the data-i18n
// pass, the title, document.lang, the language buttons and the textContent-only rule; this file
// registers a re-render with onLang() so a language switch redraws dynamic content in place.

import { init, t, setText, onLang, currentLang } from './i18n.js';
import {
  ApiError, apiBase, authHeaderOrThrow, bodyOrThrow, configured, ready, serverSentence,
} from './auth.js';

/* ================================================================================================
   1. Data access — the only part of this screen that knows where data comes from.
   ================================================================================================ */

// ponytail: SWAP POINT — taken. loadInbox() and askQuestion() below are this screen's entire data
// surface and the real calls (design.md §5) are their implementation; MOCK is the fallback they use
// while the stack is down. `MOCKING` is `configured()` from auth.js — the same "are the four deploy
// outputs pasted in" check the sign-in panel already uses — so nothing here is edited on deploy
// evening: paste the four stack outputs into `CONFIG` in assets/auth.js and this screen is live.
//
//   loadInbox()       → GET /parent/inbox → {messages[]}, newest first, already approved-only and
//                       already this parent's own children. Rendered as given.
//   askQuestion(text) → POST /chat {message, lang} → {reply, blockedBy}
//
// NEITHER CALL NAMES A ROLE, A CHILD OR A CLASS, and there is no field for one. The role and the
// child scope are resolved server-side from the caller's own verified Cognito `sub`
// (read/handlers.mjs#parentInbox → session() → resolveScope()), so a browser that asked for another
// family's child would be refused rather than answered. The mock below carries a child and a
// teacher name because it has no `sub` to resolve; the live response carries neither, and the
// header lines for them are hidden rather than filled from something the browser chose.
const MOCKING = !configured();

const MOCK = {
  // The same fictional class as backend/seed/demo-class.json. This parent is the parent of
  // Kasun Perera (stu-01), so every message below matches Kasun's seeded records exactly:
  // paid 2500 for 2026-11, absent on 2026-11-12, 68/100 in the November test, next session
  // 2026-11-19. product.md "Demo data": never a real name, phone number or school.
  child: { id: 'stu-01', name: 'Kasun Perera' },
  teacher: { name: 'Sunil Sir' },

  // Warm, factual, never shaming — this is what rule 4 looks like in a real message. The absence
  // note says what was missed and how to catch up; it does not scold anybody.
  // `approved` is what the teacher's approval gate sets. The mock carries unapproved: false
  // messages too, so the filter in loadInbox() is doing real work and not just decorating.
  messages: [
    { id: 'msg-01', at: '2026-11-05T17:05:00+05:30', key: 'parent.msg.fee_paid', approved: true,
      amount: 2500, month: 11 },
    { id: 'msg-02', at: '2026-11-05T19:20:00+05:30', key: 'parent.msg.marks', approved: true,
      score: 68, maxScore: 100 },
    { id: 'msg-03', at: '2026-11-12T18:40:00+05:30', key: 'parent.msg.absent', approved: true },
    { id: 'msg-04', at: '2026-11-12T18:52:00+05:30', key: 'parent.msg.next_class', approved: true,
      date: '2026-11-19' },
    // Drafted by the agent, not yet approved by Sunil Sir. A parent must never see this one.
    { id: 'msg-05', at: '2026-11-13T09:00:00+05:30', key: 'parent.msg.absent', approved: false },
  ],

  // The mock has no model behind it, so the ask box answers with a pack key instead of a server
  // string — and the answer says plainly that it has no records yet (requirement 7.2).
  answerKey: 'parent.ask.mock_answer',
  latencyMs: 400,
};

const MAX_MESSAGE = 2000; // design.md §5 rejects a longer message with 400 before any model call.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One row of `/parent/inbox` → what the thread draws.
 *
 * `body` is the text the teacher approved, shown as written. There is no `approved` flag to
 * re-check and deliberately no client-side filter standing in for one: the handler has three
 * independent reasons a draft cannot be in this list (the `begins_with` on `byParent`, the status
 * check, and the teacher-only writer of `approved#…`), and a fourth copy here would be a weaker
 * version of a rule the server holds — the same reason loadAudit() renders what it is given.
 */
const inboxMessage = (m) => ({
  id: m?.messageId,
  at: m?.approvedAt ?? m?.createdAt ?? '',
  text: typeof m?.body === 'string' ? m.body : '',
});

/**
 * The approved thread about this parent's own children → {child?, teacher?, messages[]}.
 *
 * Mocked while `CONFIG` is placeholders, and the mock keeps its own approval filter because its
 * rows are a plain array with drafts in it — the filter is doing real work there, not decorating.
 */
export async function loadInbox() {
  if (MOCKING) {
    await sleep(MOCK.latencyMs);
    const inbox = structuredClone(MOCK);
    return {
      child: inbox.child,
      teacher: inbox.teacher,
      messages: inbox.messages.filter((m) => m.approved === true),
    };
  }

  const auth = authHeaderOrThrow();
  const body = await bodyOrThrow(await fetch(`${apiBase()}/parent/inbox`, { headers: auth }));
  // No `studentId` query parameter: this parent has one inbox and the server already knows whose.
  // The live response carries no child or teacher name, so neither is invented here.
  return { messages: (body?.messages ?? []).map(inboxMessage) };
}

/**
 * POST /chat → {reply, blockedBy}, for a parent asking about their own child.
 *
 * The answer is never an approved update, so it is rendered in the ask area only — renderAsk() is
 * the only thing that can draw it.
 *
 * The length check is this side's half of design.md §5: the server answers a longer message with
 * 400 before any model call, and refusing it here costs no round-trip. The limit is the only thing
 * checked — the question is sent exactly as typed.
 *
 * Mocked while `CONFIG` is placeholders: resolves `answerKey` from the current pack instead.
 */
export async function askQuestion(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('empty question');
  if (text.length > MAX_MESSAGE) throw new Error('question too long');

  if (MOCKING) {
    await sleep(MOCK.latencyMs);
    return { answerKey: MOCK.answerKey };
  }

  // `lang` so a refusal and a wellbeing reply come back in the language the parent is reading.
  // Never a retry: a second send is a second message in the same session, and the server has
  // already recorded this one (chat/orchestrate.mjs).
  const auth = authHeaderOrThrow();
  return bodyOrThrow(await fetch(`${apiBase()}/chat`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ message: text, lang: currentLang() }),
  }));
}


/* ================================================================================================
   3. State
   ================================================================================================ */

// Everything the screen shows is derived from this, so a language switch is a re-render, not a
// reload: a message already on screen is stored as a pack key and comes back in the new language.
const state = {
  inbox: null,          // {child, teacher, messages[]} once loaded
  asked: [],            // {side: 'parent'|'assistant', text?: string, key?: string}
  threadStatusKey: 'parent.thread.loading',
  askStatusKey: '',
  // A failed call shows the server's own sentence when it sent one, and our own key when it did
  // not. Never both, and never ours written over the top of theirs (requirement 3.6) — a parent
  // reads an API Gateway or voice.mjs sentence in their own language, and rewording it here would
  // replace a true sentence with a guess. Never a status code, never a stack, never a raw error.
  threadStatusMessage: '',
  askStatusMessage: '',
  asking: false,        // a /chat round-trip is open; the send button says so with aria-disabled
};

// Built in start() rather than at module scope so that tests/unit/api-swap-frontend.test.mjs can
// import loadInbox() and askQuestion() in Node, where there is no document to look things up in.
let dom = null;

/* ================================================================================================
   4. Formatting
   ================================================================================================ */

/** 2500 → "2,500", grouped the way the current language groups digits. */
function formatNumber(amount) {
  try {
    // `currentLang()`, not `state.pack['meta.lang']`: that pack lives in i18n.js's private state,
    // and this module's own `state` has no `pack` or `lang` — so the property access threw inside
    // this try and every amount silently rendered ungrouped ("2500", never "2,500"). A silent
    // fallback is why it survived: nothing was logged and nothing looked broken.
    return new Intl.NumberFormat(currentLang()).format(amount);
  } catch {
    return String(amount);
  }
}

/** The rupee prefix lives in the pack, so it can be translated. Shared with the teacher ledger. */
const money = (amount) => t('ledger.amount', { amount: formatNumber(amount) });

/** '2026-11-12' or a full ISO stamp → "12 November 2026" in the current language.
    Not Intl.DateTimeFormat, for the reason teacher.js gives: CLDR's Sinhala long months are the
    traditional lunar names, and some Chrome builds have no Sinhala data and answer in English. */
function formatDay(iso) {
  const [year, month, day] = String(iso).slice(0, 10).split('-').map(Number);
  if (!year || !month || month < 1 || month > 12 || !day) return String(iso);
  return t('parent.day_format', { day: String(day), month: t(`month.${month}`), year: String(year) });
}

/** An ISO stamp → "5.05 pm", in the device's own clock convention.
    Intl is right here where it was wrong for months: hour and minute need no language data, and a
    parent reads the time on their phone's terms. Falls back to the raw HH:MM. */
function formatTime(iso) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(currentLang(), {
      hour: 'numeric',
      minute: '2-digit',
    }).format(when);
  } catch {
    return String(iso).slice(11, 16);
  }
}

/** The {slot} values a mock message needs. Real messages arrive as text and need none of this. */
function messageValues(message) {
  const values = { name: state.inbox?.child?.name ?? '' };
  if (message.amount != null) values.amount = money(message.amount);
  if (message.month != null) values.month = t(`month.${message.month}`);
  if (message.score != null) values.score = formatNumber(message.score);
  if (message.maxScore != null) values.max = formatNumber(message.maxScore);
  if (message.date) values.date = formatDay(message.date);
  return values;
}

/* ================================================================================================
   5. The approved thread
   ================================================================================================ */

/** A day separator, the way a chat app breaks up a long thread. */
function daySeparator(isoDate) {
  const line = document.createElement('p');
  line.className = 'thread__day';
  setText(line, formatDay(isoDate));
  return line;
}

/**
 * One approved update. Every one of these carries the approval stamp — it is text, not a colour,
 * so it survives a monochrome screen and a screen reader.
 */
function note(message) {
  const wrap = document.createElement('div');
  wrap.className = 'note';

  const head = document.createElement('p');
  head.className = 'note__head';

  const who = document.createElement('span');
  who.className = 'note__who';
  setText(who, state.inbox?.teacher?.name ?? '');

  const time = document.createElement('time');
  time.className = 'note__time';
  time.dateTime = message.at;
  setText(time, formatTime(message.at));

  head.append(who, time);

  const body = document.createElement('p');
  body.className = 'note__text';
  // A real message arrives as text; a mock message is a pack key until the API lands.
  setText(body, message.text ?? t(message.key, messageValues(message)));

  const foot = document.createElement('p');
  foot.className = 'note__foot';

  const stamp = document.createElement('span');
  stamp.className = 'stamp stamp--approved';
  stamp.dataset.i18n = 'parent.approved';
  setText(stamp, t('parent.approved'));
  foot.append(stamp);

  wrap.append(head, body, foot);
  return wrap;
}

function renderThread() {
  dom.threadMessages.replaceChildren();
  setText(dom.threadStatus, state.threadStatusMessage || (state.threadStatusKey ? t(state.threadStatusKey) : ''));

  // `/parent/inbox` answers with messages and nothing else, so a live page has no name to show
  // here. A label with a blank beside it reads as a page that failed; the whole line goes instead.
  setText(dom.child, state.inbox?.child?.name ?? '');
  setText(dom.teacher, state.inbox?.teacher?.name ?? '');
  dom.childLine.hidden = !state.inbox?.child?.name;
  dom.teacherLine.hidden = !state.inbox?.teacher?.name;

  // The API returns newest first (requirement 7.1); a thread reads oldest first, so sort back.
  const messages = [...(state.inbox?.messages ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));

  // While the inbox is still loading there is nothing to say yet, so the empty state stays hidden
  // and the status line carries the news instead.
  dom.threadEmpty.hidden = !state.inbox || messages.length > 0;

  let day = '';
  for (const message of messages) {
    const messageDay = String(message.at).slice(0, 10);
    if (messageDay !== day) {
      day = messageDay;
      dom.threadMessages.append(daySeparator(messageDay));
    }
    dom.threadMessages.append(note(message));
  }

  // Keep the newest message in view without moving focus.
  dom.thread.scrollTop = dom.thread.scrollHeight;
}

/* ================================================================================================
   6. The ask box — a different area, and it says so on every answer
   ================================================================================================ */

function askBubble(entry) {
  const isParent = entry.side === 'parent';

  const wrap = document.createElement('div');
  wrap.className = `qa qa--${isParent ? 'parent' : 'assistant'}`;

  const whoKey = isParent ? 'parent.ask.sender_parent' : 'parent.ask.sender_assistant';
  const who = document.createElement('p');
  who.className = 'qa__who';
  who.dataset.i18n = whoKey;
  setText(who, t(whoKey));

  const body = document.createElement('p');
  body.className = 'qa__text';
  // A parent's question is their own words and is never translated; an answer is a pack key until
  // the real API starts returning text.
  setText(body, entry.text ?? t(entry.key, { name: state.inbox?.child?.name ?? '' }));

  wrap.append(who, body);

  // The whole point of this screen: an answer is labelled unapproved, in words, every time.
  if (!isParent) {
    const flag = document.createElement('p');
    flag.className = 'qa__flag';
    const stamp = document.createElement('span');
    stamp.className = 'stamp stamp--unverified';
    stamp.dataset.i18n = 'parent.ask.unverified';
    setText(stamp, t('parent.ask.unverified'));
    flag.append(stamp);
    wrap.append(flag);
  }

  return wrap;
}

function renderAsk() {
  dom.askMessages.replaceChildren();
  for (const entry of state.asked) dom.askMessages.append(askBubble(entry));

  dom.askEmpty.hidden = state.asked.length > 0;
  setText(dom.askStatus, state.askStatusKey ? t(state.askStatusKey) : '');
  // `aria-disabled`, not `disabled`: disabling the button the parent has just pressed drops focus
  // to <body> for the whole Bedrock round-trip, so the keyboard loses its place and the next Tab
  // restarts at the top of the page. This keeps it focusable; the submit handler ignores the press.
  dom.askSend.setAttribute('aria-disabled', String(state.asking));

  dom.askLog.scrollTop = dom.askLog.scrollHeight;
}

function wireAskForm() {
  dom.askForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  // What `disabled` used to do, without taking the focus away to do it.
  if (state.asking) return;

  const text = dom.askInput.value.trim();
  if (text === '') return;

  dom.askInput.value = '';
  state.asked.push({ side: 'parent', text });
  state.askStatusKey = 'parent.ask.sending';
  state.asking = true;
  renderAsk();

  try {
    const { reply, answerKey } = await askQuestion(text);
    state.asked.push({ side: 'assistant', text: reply, key: answerKey });
    state.askStatusKey = '';
  } catch (err) {
    console.error(err);
    state.askStatusKey = 'parent.ask.error';
  } finally {
    state.asking = false;
    // No focus() here: it existed to undo the focus `disabled` had just thrown away. Nothing is
    // dropped now, so calling it would instead yank the parent back out of the approved thread
    // they had moved to while waiting (2.4.3, 3.2.5).
    renderAsk();
  }
  });
}

/* ================================================================================================
   7. Wiring
   ================================================================================================ */

async function start() {
  wireAskForm();
  onLang(() => { renderThread(); renderAsk(); });
  await init({ titleKey: 'parent.heading' });

  try {
    const inbox = await loadInbox();
    state.inbox = inbox;
    state.threadStatusKey = '';
  } catch (err) {
    console.error(err);
    state.threadStatusKey = 'parent.thread.error';
  }
  renderThread();
}

// type="module" defers, so the DOM is ready by now. The guard is for Node: the unit test imports
// this file for `loadInbox`/`askQuestion` and must not boot a page that has no document. Without
// it, `dom.askForm.addEventListener` ran at module scope and threw `Cannot read properties of null`
// the moment api-swap-frontend.test.mjs tried to cover this page at all -- which is how a page
// stays uncovered: the test that would have found the gap could not import the file.
if (typeof document !== 'undefined') start();
