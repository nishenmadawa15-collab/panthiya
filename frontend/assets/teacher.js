// Panthiya teacher screen: chat with Panthiya, and the fee ledger for the current month.
//
// Same hard rule as app.js: strings reach the DOM through textContent only, never as HTML.
// Model replies and student names will flow through setText() unchanged once the real API is
// wired, so the rule holds from the first line. (requirement 12.7)
//
// The language shell lives in assets/i18n.js and is shared by every page. It owns the data-i18n
// pass, the title, document.lang, the language buttons and the textContent-only rule; this file
// registers a re-render with onLang() so a language switch redraws dynamic content in place.

import { init, t, setText, onLang, currentLang } from './i18n.js';

/* ================================================================================================
   1. Data access — the only part of this screen that knows where data comes from.
   ================================================================================================ */

// ponytail: SWAP POINT. No backend exists yet. sendMessage() and loadLedger() below are the entire
// data surface of this screen; MOCK is their stand-in. When POST /chat and the teacher ledger read
// land (design.md §5), replace the two function bodies with fetch() calls carrying the Cognito ID
// token, delete MOCK, and drop `replyKey` from the chat reply. Nothing else in this file,
// teacher/index.html or styles.css has to change.
const MOCK = {
  // The same fictional class as backend/seed/demo-class.json — IDs, names and amounts must stay in
  // step with that file, or the demo shows one set of students on screen and another in DynamoDB.
  // product.md "Demo data": never a real name, phone number or school.
  //
  // status is 'paid' | 'due', and nothing else. Attendance is a separate table and a separate
  // question; an "absent" badge in a money column reads as a payment state, which it is not.
  // Requirement 4.3 asks this view for one thing: who owes, and how much.
  ledger: {
    month: '2026-11',
    students: [
      { id: 'stu-01', name: 'Kasun Perera',           status: 'paid', outstanding: 0 },
      { id: 'stu-02', name: 'Dilmi Fernando',         status: 'paid', outstanding: 0 },
      { id: 'stu-03', name: 'Nimal Silva',            status: 'due',  outstanding: 2500 },
      { id: 'stu-04', name: 'Tharindu Bandara',       status: 'paid', outstanding: 0 },
      { id: 'stu-05', name: 'Sanduni Jayawardena',    status: 'paid', outstanding: 0 },
      { id: 'stu-06', name: 'Ishara Gunasekara',      status: 'due',  outstanding: 2500 },
      { id: 'stu-07', name: 'Amila Rathnayake',       status: 'paid', outstanding: 0 },
      { id: 'stu-08', name: 'Hashini Wickramasinghe', status: 'paid', outstanding: 0 },
      { id: 'stu-09', name: 'Ruwan Dissanayake',      status: 'due',  outstanding: 2500 },
      { id: 'stu-10', name: 'Nethmi Senanayake',      status: 'paid', outstanding: 0 },
      { id: 'stu-11', name: 'Mathavan Selvarajah',    status: 'paid', outstanding: 0 },
      { id: 'stu-12', name: 'Keerthana Thevarajah',   status: 'due',  outstanding: 2500 },
    ],
  },
  // The mock has no model behind it, so it answers with a pack key instead of a server string.
  replyKey: 'chat.mock_reply',
  latencyMs: 400,
};

const MAX_MESSAGE = 2000; // design.md §5 rejects a longer message with 400 before any model call.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** POST /chat → {reply}. Mocked: resolves `replyKey` from the current pack instead. */
async function sendMessage(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('empty message');
  if (text.length > MAX_MESSAGE) throw new Error('message too long');
  await sleep(MOCK.latencyMs);
  return { replyKey: MOCK.replyKey };
}

/** GET the teacher's ledger → {month, students[]}. Mocked. */
async function loadLedger() {
  await sleep(MOCK.latencyMs);
  return structuredClone(MOCK.ledger);
}


/* ================================================================================================
   3. State
   ================================================================================================ */

// Everything the screen shows is derived from this, so a language switch is a re-render, not a
// reload: a reply already on screen is stored as a pack key and comes back in the new language.
const state = {
  messages: [],        // {side: 'teacher'|'panthiya', text?: string, key?: string}
  ledger: null,        // {month, students[]} once loaded
  chatStatusKey: '',   // pack key, or '' for no status line
  ledgerStatusKey: '',
};

const el = (id) => document.getElementById(id);

const dom = {
  log: el('chat-log'),
  empty: el('chat-empty'),
  messages: el('chat-messages'),
  status: el('chat-status'),
  form: el('chat-form'),
  input: el('chat-input'),
  send: el('chat-send'),
  month: el('ledger-month'),
  total: el('ledger-total'),
  list: el('ledger-list'),
  ledgerStatus: el('ledger-status'),
};

/* ================================================================================================
   4. Formatting
   ================================================================================================ */

/** '2026-11' → "November 2026" in the current language.
    Not Intl.DateTimeFormat: CLDR's Sinhala long months are the traditional lunar names ("ඉල්" for
    November), which is not what a teacher writes on a fee book, and some Chrome builds have no
    Sinhala data at all and quietly answer in English. The twelve names live in the packs instead. */
function formatMonth(iso) {
  const [year, month] = String(iso).split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return String(iso);
  return t('ledger.month', { month: t(`month.${month}`), year: String(year) });
}

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

/** The rupee prefix lives in the pack, so it can be translated. */
const money = (amount) => t('ledger.amount', { amount: formatNumber(amount) });

/* ================================================================================================
   5. Chat
   ================================================================================================ */

function bubble(message) {
  const wrap = document.createElement('p');
  wrap.className = `msg msg--${message.side === 'teacher' ? 'teacher' : 'panthiya'}`;

  const whoKey = message.side === 'teacher' ? 'chat.sender_teacher' : 'chat.sender_panthiya';
  const who = document.createElement('span');
  who.className = 'msg__who';
  who.dataset.i18n = whoKey;
  setText(who, t(whoKey));

  const body = document.createElement('span');
  body.className = 'msg__text';
  // A teacher message is their own words and is never translated; a Panthiya reply is a pack key
  // until the real API starts returning text.
  setText(body, message.text ?? t(message.key));

  wrap.append(who, body);
  return wrap;
}

function renderChat() {
  dom.messages.replaceChildren();
  for (const message of state.messages) dom.messages.append(bubble(message));

  dom.empty.hidden = state.messages.length > 0;
  setText(dom.status, state.chatStatusKey ? t(state.chatStatusKey) : '');

  // Keep the newest message in view without moving focus.
  dom.log.scrollTop = dom.log.scrollHeight;
}

dom.form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const text = dom.input.value.trim();
  if (text === '') return;

  dom.input.value = '';
  state.messages.push({ side: 'teacher', text });
  state.chatStatusKey = 'chat.sending';
  dom.send.disabled = true;
  renderChat();

  try {
    const { reply, replyKey } = await sendMessage(text);
    state.messages.push({ side: 'panthiya', text: reply, key: replyKey });
    state.chatStatusKey = '';
  } catch (err) {
    console.error(err);
    state.chatStatusKey = 'chat.error';
  } finally {
    dom.send.disabled = false;
    renderChat();
    dom.input.focus();
  }
});

/* ================================================================================================
   6. Fee ledger
   ================================================================================================ */

// The three stamps a fee row can carry. Reuses the M0 stamp classes; --due is the new one.
const STAMP = {
  paid:   { className: 'stamp--paid',   key: 'stamps.paid' },
  due:    { className: 'stamp--due',    key: 'stamps.due' },
  absent: { className: 'stamp--absent', key: 'stamps.absent' },
};

function ledgerRow(student) {
  const row = document.createElement('li');
  row.className = 'ledger__row';

  const name = document.createElement('span');
  name.className = 'ledger__name';
  setText(name, student.name);

  const amount = document.createElement('span');
  amount.className = 'ledger__amount';
  setText(amount, money(student.outstanding));

  const mark = STAMP[student.status] ?? STAMP.due;
  const stamp = document.createElement('span');
  stamp.className = `stamp ${mark.className}`;
  stamp.dataset.i18n = mark.key;
  setText(stamp, t(mark.key));

  row.append(name, amount, stamp);
  return row;
}

function renderLedger() {
  setText(dom.ledgerStatus, state.ledgerStatusKey ? t(state.ledgerStatusKey) : '');
  dom.list.replaceChildren();

  const data = state.ledger;
  if (!data) {
    setText(dom.month, '');
    setText(dom.total, '');
    return;
  }

  setText(dom.month, formatMonth(data.month));
  // Requirement 4.3: the amount outstanding, for this teacher's students only.
  const outstanding = data.students.reduce((sum, s) => sum + (Number(s.outstanding) || 0), 0);
  setText(dom.total, money(outstanding));

  for (const student of data.students) dom.list.append(ledgerRow(student));
}

/* ================================================================================================
   7. Wiring
   ================================================================================================ */

async function start() {
  onLang(() => { renderChat(); renderLedger(); });
  await init({ titleKey: 'teacher.heading' });

  state.ledgerStatusKey = 'ledger.loading';
  renderLedger();

  try {
    const ledger = await loadLedger();
    state.ledger = ledger;
    state.ledgerStatusKey = ledger.students.length ? '' : 'ledger.empty';
  } catch (err) {
    console.error(err);
    state.ledgerStatusKey = 'ledger.error';
  }
  renderLedger();
}

start();
