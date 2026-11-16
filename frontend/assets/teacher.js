// Panthiya teacher screen: chat with Panthiya, and the fee ledger for the current month.
//
// Same hard rule as app.js: strings reach the DOM through textContent only, never as HTML.
// Model replies and student names will flow through setText() unchanged once the real API is
// wired, so the rule holds from the first line. (requirement 12.7)
//
// ponytail: this file repeats the small language shell from app.js (initialLang, loadPack, apply)
// instead of importing it, because app.js is the M0 page script and belongs to another lane. When
// a third page needs the same shell, lift those four functions into assets/i18n.mjs — one module,
// three importers — and not before.

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
   2. Language
   ================================================================================================ */

const LANGS = ['si', 'ta', 'en'];
const FALLBACK = 'en';
const STORAGE_KEY = 'panthiya.lang';

/** The only way text is allowed to enter the page. */
function setText(el, value) {
  el.textContent = value;
}

/** Fill {name} slots in a pack string. No regex, so a value with $ or \ cannot bite. */
function fillSlots(template, values) {
  let out = template;
  for (const [name, value] of Object.entries(values)) {
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}

/** Remembered choice, else the device language if we speak it, else English. */
function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    // Private mode or blocked storage: fall through to the device language.
  }
  for (const tag of navigator.languages ?? [navigator.language ?? '']) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (LANGS.includes(base)) return base;
  }
  return FALLBACK;
}

async function loadPack(lang) {
  const res = await fetch(`/i18n/${lang}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`language pack ${lang} failed: ${res.status}`);
  return res.json();
}

/* ================================================================================================
   3. State
   ================================================================================================ */

// Everything the screen shows is derived from this, so a language switch is a re-render, not a
// reload: a reply already on screen is stored as a pack key and comes back in the new language.
const state = {
  lang: FALLBACK,
  pack: {},
  messages: [],        // {side: 'teacher'|'panthiya', text?: string, key?: string}
  ledger: null,        // {month, students[]} once loaded
  chatStatusKey: '',   // pack key, or '' for no status line
  ledgerStatusKey: '',
};

/** One pack string, with optional {slot} values. Never returns undefined into the DOM. */
function t(key, values) {
  const value = state.pack[key];
  if (typeof value !== 'string') {
    console.warn(`[panthiya] missing ${state.lang} key:`, key);
    return '';
  }
  return values ? fillSlots(value, values) : value;
}

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
    return new Intl.NumberFormat(state.pack['meta.lang'] ?? state.lang).format(amount);
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

function apply(pack, lang) {
  const missing = [];

  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.dataset.i18n;
    const value = pack[key];
    if (typeof value === 'string') setText(node, value);
    else missing.push(key);
  }

  // An input placeholder is an attribute, not text content, so it needs its own pass.
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = node.dataset.i18nPlaceholder;
    const value = pack[key];
    if (typeof value === 'string') node.setAttribute('placeholder', value);
    else missing.push(key);
  }

  // Screen readers need to know which language they are pronouncing. (requirement 12.3)
  document.documentElement.lang = pack['meta.lang'] ?? lang;

  if (pack['app.name'] && pack['teacher.heading']) {
    document.title = `${pack['app.name']} · ${pack['teacher.heading']}`;
  }
  const desc = document.querySelector('meta[name="description"]');
  if (desc && pack['meta.description']) desc.setAttribute('content', pack['meta.description']);

  for (const btn of document.querySelectorAll('.lang')) {
    const isCurrent = btn.dataset.lang === lang;
    btn.setAttribute('aria-pressed', String(isCurrent));
    const full = pack[`lang.${btn.dataset.lang}.full`];
    if (full) btn.setAttribute('aria-label', full);
  }

  if (missing.length) console.warn(`[panthiya] missing ${lang} keys:`, missing);
}

function notify(message) {
  const node = document.createElement('p');
  node.className = 'noscript';
  setText(node, message);
  document.body.prepend(node);
}

async function setLang(lang, { persist = true } = {}) {
  let pack;
  try {
    pack = await loadPack(lang);
  } catch (err) {
    console.error(err);
    if (lang !== FALLBACK) return setLang(FALLBACK, { persist: false });
    notify('Panthiya could not load its text. Please refresh.');
    return;
  }

  state.pack = pack;
  state.lang = lang;
  apply(pack, lang);
  renderChat();
  renderLedger();

  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Not being able to remember the choice is not worth bothering the user about.
    }
  }
}

for (const btn of document.querySelectorAll('.lang')) {
  btn.addEventListener('click', () => setLang(btn.dataset.lang));
}

async function start() {
  await setLang(initialLang(), { persist: false });

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
