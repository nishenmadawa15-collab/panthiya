// Panthiya teacher screen: chat with Panthiya, the fee ledger for the current month, the voice
// note that feeds the chat box, and the audit log of every change to money and marks.
//
// Two rules on this screen are worth stating before any code, because both are about not lying to
// a teacher:
//
//   The audit log is append-only (requirement 10.4). There is no API that updates or deletes an
//   entry, so this file renders entries and does nothing else: no edit, no delete, no re-sort, no
//   summary of a `before`/`after` pair into a sentence that loses which side is which. A deletion
//   arrives as one more appended entry whose `after` is a tombstone tally, and it is drawn as the
//   event it is rather than as an absence.
//
//   A transcript is never edited (requirement 3.5). What the server heard goes into the chat box
//   exactly as it arrived, and a failed transcription shows the server's own message unchanged and
//   never looks like something that was sent.
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

// ponytail: SWAP POINT. Nothing is deployed yet, so MOCK stands in for every call this screen
// makes. The six functions below are its entire data surface. When the stack is up (design.md §5)
// replace their bodies with fetch() calls and delete MOCK; nothing else in this file,
// teacher/index.html or styles.css has to change.
//
// Every call carries the ID token the same way, which auth.js documents in three lines:
//
//   import { authHeader, handleUnauthorized, apiBase } from './auth.js';
//   const auth = authHeader();
//   if (!auth) { handleUnauthorized(); return; }                  // not signed in: say so, do not call
//   const res = await fetch(`${apiBase()}/…`, { headers: { ...auth } });
//   if (res.status === 401) handleUnauthorized();                 // requirement 1.4, never a retry
//
//   sendMessage(text)     → POST /chat {message, lang} → {reply, blockedBy}. Drop `replyKey`.
//   loadLedger()          → the teacher ledger read → {month, students[]}.
//   loadAudit()           → GET /teacher/audit → {entries[]}, already newest-first and already
//                           scoped to this teacher's own classes. Render the array as given: a
//                           sort or a filter here would be a second, weaker copy of a rule the
//                           server holds (requirement 10.3).
//   voiceUploadUrl(blob)  → POST /voice/upload-url {bytes, format} → {key, url, contentType}.
//   putAudio(slot, blob)  → PUT the blob to `slot.url` with `Content-Type: slot.contentType` and
//                           NO Authorization header: the presigned URL is the capability, and the
//                           signed length is the blob's own size.
//   voiceTranscript(body) → POST /voice/transcript, twice over: `{key, lang}` starts the job and
//                           `{jobName, lang}` polls it, which is why the poll loop below is the
//                           client's and not the Lambda's.
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
  // Five audit entries in the shape `GET /teacher/audit` returns them — the real field names, the
  // real seven action names, `before`/`after` as whole rows, and a `sk` of `<ISO ts>#<uuid>`
  // (backend/lib/audit.mjs). Newest first, because that is how the server hands them over and this
  // page does not re-sort.
  //
  // The first entry is the one worth having in the demo: Ravindu was erased, so he is in no ledger
  // and in no class list, and the only place the fee he disputed in November still exists is here.
  // That is requirement 10.4 shown rather than asserted.
  audit: {
    entries: [
      {
        classId: 'cls-ol-maths-thu',
        sk: '2026-11-16T09:41:02.118Z#6f1c0f8e-5f6a-4d2b-9a77-2c1b8e4f0a31',
        ts: '2026-11-16T09:41:02.118Z',
        actorSub: 'SEED-TEACHER-SUB',
        actorRole: 'teacher',
        action: 'deleteStudent',
        targetId: 'stu-13',
        before: { studentId: 'stu-13', displayName: 'Ravindu Kumara', classId: 'cls-ol-maths-thu' },
        after: { deleted: true, removed: { attendance: 4, fees: 2, marks: 1, messages: 1, student: 1 } },
      },
      {
        classId: 'cls-ol-maths-thu',
        sk: '2026-11-15T16:02:55.004Z#b0b4a2d1-1c3e-4a55-8f90-71d2c6e5b4aa',
        ts: '2026-11-15T16:02:55.004Z',
        actorSub: 'SEED-TEACHER-SUB',
        actorRole: 'teacher',
        action: 'approveParentUpdate',
        targetId: 'msg-0007',
        before: { status: 'draft', approvedAt: null },
        after: { status: 'approved', approvedAt: '2026-11-15T16:02:55.004Z' },
      },
      {
        classId: 'cls-ol-maths-thu',
        sk: '2026-11-15T15:58:10.771Z#d3f8c9a4-77b1-4e0c-9d61-55a0f3b2c8e7',
        ts: '2026-11-15T15:58:10.771Z',
        actorSub: 'SEED-TEACHER-SUB',
        actorRole: 'teacher',
        action: 'recordFee',
        targetId: 'stu-03',
        before: { studentId: 'stu-03', month: '2026-11', amount: 0, status: 'due' },
        after: { studentId: 'stu-03', month: '2026-11', amount: 2500, status: 'paid' },
      },
      {
        classId: 'cls-ol-maths-thu',
        sk: '2026-11-14T11:20:44.390Z#9a2e7b05-4c18-4f3d-b7e2-0cc1d9f6a512',
        ts: '2026-11-14T11:20:44.390Z',
        actorSub: 'SEED-TEACHER-SUB',
        actorRole: 'teacher',
        action: 'addMarks',
        targetId: 'stu-02',
        before: null,
        after: { studentId: 'stu-02', test: 'November test', subject: 'Mathematics', score: 72 },
      },
      {
        classId: 'cls-ol-maths-thu',
        sk: '2026-11-12T17:05:09.620Z#2b6d4810-93af-4c71-8e55-1f0a7c3b9d64',
        ts: '2026-11-12T17:05:09.620Z',
        actorSub: 'SEED-TEACHER-SUB',
        actorRole: 'teacher',
        action: 'markAttendance',
        targetId: 'stu-01',
        before: { studentId: 'stu-01', date: '2026-11-12', status: 'present' },
        after: { studentId: 'stu-01', date: '2026-11-12', status: 'absent' },
      },
    ],
  },
  // The mock has no model behind it, so it answers with a pack key instead of a server string.
  replyKey: 'chat.mock_reply',
  // Nor is there a Transcribe job behind it. The transcript is a pack key for the same reason the
  // chat reply is: it has to come back in the language the teacher is reading.
  transcriptKey: 'mic.mock_transcript',
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

/** GET /teacher/audit → {entries[]}, newest first and this teacher's classes only. Mocked. */
async function loadAudit() {
  await sleep(MOCK.latencyMs);
  return structuredClone(MOCK.audit);
}

/** POST /voice/upload-url → the one object this caller may write. Mocked. */
async function voiceUploadUrl(blob) {
  await sleep(MOCK.latencyMs);
  return { key: 'voice/MOCK/mock.webm', url: '', contentType: blob.type || 'audio/webm', bytes: blob.size };
}

/** PUT the recording to the presigned URL. Mocked: the bytes go nowhere. */
async function putAudio(slot, blob) {
  await sleep(MOCK.latencyMs);
  return { ok: true, bytes: blob.size, key: slot.key };
}

/**
 * POST /voice/transcript → `{status: 'in_progress'|'done'|'failed', …}`. Mocked.
 *
 * The mock answers `in_progress` to the start call and `done` to the first poll, so the page's
 * poll loop is exercised rather than skipped. It never answers `failed`: a mock that invented a
 * failure message would be the one string on this screen that no server wrote.
 */
async function voiceTranscript(body) {
  await sleep(MOCK.latencyMs);
  if (body.jobName) return { status: 'done', jobName: body.jobName, transcript: t(MOCK.transcriptKey) };
  return { status: 'in_progress', jobName: 'panthiya-MOCK-job' };
}


/* ================================================================================================
   3. State
   ================================================================================================ */

// Everything the screen shows is derived from this, so a language switch is a re-render, not a
// reload: a reply already on screen is stored as a pack key and comes back in the new language.
const state = {
  messages: [],        // {side: 'teacher'|'panthiya', text?: string, key?: string}
  ledger: null,        // {month, students[]} once loaded
  audit: null,         // [entry, …] in the order the server gave them, once loaded
  chatStatusKey: '',   // pack key, or '' for no status line
  ledgerStatusKey: '',
  auditStatusKey: '',
  // `message` is a server string shown unedited; `messageKey` is one of ours. Never both.
  mic: { phase: 'idle', message: '', messageKey: '' },
};

// Built in start() rather than at module scope so tests/unit/audit-mic-frontend.test.mjs can import
// the pure helpers below in Node, where there is no document to look anything up in. Same reason as
// student.js.
let dom = null;

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

/**
 * Send one message and show the reply. The single path to POST /chat.
 *
 * A typed line and a transcribed voice note both arrive here, which is the point: a transcript
 * gets no shortcut past policyCheck, the audit log or the 2000-character limit, and there is no
 * second code path that could drift from this one.
 */
async function submitMessage(text) {
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
}

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
   7. Audit log (requirement 10.3) — read, and only read
   ================================================================================================ */

/** A <p> with a class and text. Text only, never HTML (requirement 12.7). */
function para(className, value) {
  const node = document.createElement('p');
  node.className = className;
  setText(node, value);
  return node;
}

/**
 * One `before` or `after` value as labelled lines.
 *
 * `[]` means "nothing was recorded on that side" and the renderer says so in words, because an
 * empty box next to a filled one reads as "no change" — which for a creation is wrong and for a
 * deletion is the opposite of the truth.
 *
 * A row becomes one line per field, never a sentence: summarising "0 → 2500, due → paid" into
 * prose is where a reader stops being able to tell which side is which, and a disputed fee is
 * settled on exactly that distinction.
 *
 * Field names are the data model's own (`amount`, `month`, `status`) and are deliberately NOT
 * translated. They are evidence, like a student's name — renaming a field between the row that was
 * written and the row that is read would be an edit to the record. `audit.field` carries the
 * separator, so the only translated part is punctuation.
 *
 * Exported for tests/unit/audit-mic-frontend.test.mjs.
 */
export function auditLines(value) {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [{ name: '', text: String(value) }];

  return Object.entries(value).map(([name, raw]) => ({
    name,
    // `null` stays null so the renderer can put the pack's own words there; a nested object is
    // stringified rather than flattened, so nothing is silently dropped from the evidence.
    text: raw === null || raw === undefined ? null
      : typeof raw === 'object' ? JSON.stringify(raw)
        : String(raw),
  }));
}

/**
 * The tombstone tally of a deletion, or `null` for every other entry.
 *
 * Requirement 10.4: nothing deletes an audit entry, so an erasure is one more appended entry whose
 * `after` is `{deleted: true, removed: {…}}` (backend/functions/actions-teacher/erase.mjs). The
 * tally gets its own labelled line because the one thing a reader must not conclude from a
 * deletion entry is that those records simply were never there.
 *
 * Exported for tests/unit/audit-mic-frontend.test.mjs.
 */
export function tombstone(entry) {
  const removed = entry?.after?.deleted === true ? entry.after.removed : null;
  if (!removed || typeof removed !== 'object') return null;
  return Object.entries(removed).map(([table, count]) => ({ table, count: Number(count) || 0 }));
}

/** An action name in words, falling back to the server's own name for one we do not know yet. */
const actionLabel = (action) => t(`audit.action.${action}`) || String(action ?? '');

/** A role in words. Reuses `auth.role.*`, which the sign-in panel already has in three languages. */
const roleLabel = (role) => t(`auth.role.${role}`) || String(role ?? '');

/** One side of a change, under its own heading. Two of these per entry, never merged. */
function auditValue(labelKey, value) {
  const wrap = document.createElement('div');
  wrap.className = 'audit-value';
  wrap.append(para('audit-value__label', t(labelKey)));

  const lines = auditLines(value);
  if (lines.length === 0) {
    wrap.append(para('audit-value__none', t('audit.none')));
    return wrap;
  }

  const list = document.createElement('ul');
  list.className = 'audit-value__list';
  for (const line of lines) {
    const item = document.createElement('li');
    item.className = 'audit-value__item';
    const value_ = line.text ?? t('audit.none');
    setText(item, line.name ? t('audit.field', { name: line.name, value: value_ }) : value_);
    list.append(item);
  }
  wrap.append(list);
  return wrap;
}

function auditEntry(entry) {
  const card = document.createElement('li');
  card.className = 'audit-entry';

  const tally = tombstone(entry);
  if (tally) card.classList.add('audit-entry--erased');

  card.append(para('audit-entry__action', actionLabel(entry.action)));

  // The timestamp is shown as the server stored it: ISO 8601 UTC, with the `Z` on it.
  // ponytail: not converted into the reader's own zone. Two people disputing a November fee have
  // to read the same stamp off two screens and get the same answer, and a log whose times move
  // with the device is a log that cannot settle an argument. Ceiling: a teacher in Colombo does
  // the +5:30 arithmetic. Upgrade path is showing both, never only the local one.
  const when = document.createElement('time');
  when.className = 'audit-entry__when';
  when.setAttribute('datetime', String(entry.ts ?? ''));
  setText(when, t('audit.when', { ts: String(entry.ts ?? '') }));
  card.append(when);

  card.append(para('audit-entry__meta',
    t('audit.actor', { role: roleLabel(entry.actorRole), id: String(entry.actorSub ?? '') })));
  card.append(para('audit-entry__meta', t('audit.target', { id: String(entry.targetId ?? '') })));

  if (tally) {
    card.append(para('audit-entry__tombstone', t('audit.tombstone')));
    const list = document.createElement('ul');
    list.className = 'audit-tally';
    for (const row of tally) {
      const item = document.createElement('li');
      item.className = 'audit-tally__item';
      setText(item, t('audit.tombstone_row', { what: row.table, count: formatNumber(row.count) }));
      list.append(item);
    }
    card.append(list);
  }

  const pair = document.createElement('div');
  pair.className = 'audit-pair';
  pair.append(auditValue('audit.before', entry.before), auditValue('audit.after', entry.after));
  card.append(pair);

  return card;
}

function renderAudit() {
  setText(dom.auditStatus, state.auditStatusKey ? t(state.auditStatusKey) : '');
  dom.auditList.replaceChildren();

  // In the order the server gave them, which is newest-first (requirement 10.3). No sort here.
  for (const entry of state.audit ?? []) dom.auditList.append(auditEntry(entry));
}

/* ================================================================================================
   8. Voice note (requirement 12.4 by keyboard, 3.5 and 3.6 by never editing or inventing)
   ================================================================================================ */

/**
 * What the microphone button and its status line say in each phase.
 *
 * `pressed` is both `aria-pressed` and the `.mic-live` class, so the recording state reaches a
 * screen reader, a reader in greyscale and a reader in forced-colours mode by three different
 * routes — the button's own words change too, which is the one cue no rendering mode can drop.
 *
 * Read through `micView()`, which tests/unit/audit-mic-frontend.test.mjs imports.
 */
const MIC = {
  idle:         { labelKey: 'chat.mic', statusKey: '',                 pressed: false, busy: false },
  recording:    { labelKey: 'mic.stop', statusKey: 'mic.recording',    pressed: true,  busy: false },
  uploading:    { labelKey: 'chat.mic', statusKey: 'mic.uploading',    pressed: false, busy: true },
  transcribing: { labelKey: 'chat.mic', statusKey: 'mic.transcribing', pressed: false, busy: true },
};

export const micView = (phase) => MIC[phase] ?? MIC.idle;

/**
 * What to show when `/voice/transcript` answers `status: 'failed'`.
 *
 * The server's own `message` is shown **unchanged**: `voice/voice.mjs` writes it in the teacher's
 * own language and it already says the three things that matter — it did not work, nothing was
 * saved, type it instead. Our own string is the fallback for a failure that carried no message at
 * all, never a replacement for one that did.
 *
 * Exported for tests/unit/audit-mic-frontend.test.mjs.
 */
export function transcriptFailure(body) {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  return message ? { message, messageKey: '' } : { message: '', messageKey: 'mic.error' };
}

/** How long the poll loop will wait before it stops claiming the transcript is still coming. */
const POLL_MS = 1500;
const MAX_POLLS = 40;           // 40 × 1.5 s = a minute, for a note that should take seconds

/** The live recorder, or null. Module-level because the button toggles one thing. */
let recorder = null;

/** The status line: a server message as-is, else one of ours, else the phase's own line. */
function micText() {
  const { message, messageKey, phase } = state.mic;
  if (message) return message;
  if (messageKey) return t(messageKey);
  const { statusKey } = micView(phase);
  return statusKey ? t(statusKey) : '';
}

function renderMic() {
  const view = micView(state.mic.phase);
  setText(dom.micLabel, t(view.labelKey));
  dom.mic.setAttribute('aria-pressed', String(view.pressed));
  // `aria-disabled`, not `disabled`: disabling the button the teacher has just pressed drops focus
  // to <body>, so a keyboard user loses their place for the whole upload and the next Tab starts
  // at the top of the page. This keeps the button focusable; the click handler ignores the press.
  dom.mic.setAttribute('aria-disabled', String(view.busy));
  dom.mic.classList.toggle('mic-live', view.pressed);
  setText(dom.micStatus, micText());
}

function setMicPhase(phase) {
  state.mic = { phase, message: '', messageKey: '' };
  renderMic();
}

/**
 * Every failure path ends here: said plainly, once, with the cursor back in the typed box.
 *
 * Never a retry — requirement 3.6 and the header of `voice/voice.mjs` both turn on the same point,
 * that a teacher told "done" when nothing was heard is worse off than one told plainly that it did
 * not work. And never a line that could be read as sent: nothing reaches the chat log on this path.
 */
function failMic({ message = '', messageKey = '' }) {
  state.mic = { phase: 'idle', message, messageKey };
  renderMic();
  dom.input.focus();
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return failMic({ messageKey: 'mic.unsupported' });
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    // A denied or dismissed permission prompt, or no microphone at all. One sentence, no retry.
    console.error(err);
    return failMic({ messageKey: 'mic.denied' });
  }

  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data?.size) chunks.push(event.data);
  });
  recorder.addEventListener('stop', () => {
    // Release the microphone before anything else, so the browser's recording indicator goes out
    // the moment the teacher presses stop rather than when the upload finishes.
    for (const track of stream.getTracks()) track.stop();
    recorder = null;
    void transcribe(new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }));
  });

  recorder.start();
  setMicPhase('recording');
}

function stopRecording() {
  setMicPhase('uploading');
  recorder?.stop();               // the 'stop' listener above carries on from here
}

/** Upload, start the job, poll it, and hand a finished transcript to the chat box. */
async function transcribe(blob) {
  if (!blob || blob.size === 0) return failMic({ messageKey: 'mic.empty' });

  try {
    const slot = await voiceUploadUrl(blob);
    await putAudio(slot, blob);

    setMicPhase('transcribing');
    const lang = currentLang();
    let answer = await voiceTranscript({ key: slot.key, lang });

    for (let poll = 0; poll < MAX_POLLS && answer.status === 'in_progress'; poll += 1) {
      await sleep(POLL_MS);
      answer = await voiceTranscript({ jobName: answer.jobName, lang });
    }

    if (answer.status === 'failed') return failMic(transcriptFailure(answer));
    if (answer.status !== 'done') return failMic({ messageKey: 'mic.timeout' });

    await sendTranscript(answer.transcript);
  } catch (err) {
    console.error(err);
    failMic({ messageKey: 'mic.error' });
  }
}

/**
 * A finished transcript enters the chat exactly as the server returned it.
 *
 * Not re-punctuated, not capitalised, not spell-checked, not matched against a student name, not
 * even trimmed — `voice/voice.mjs` already trimmed it, and this is the one place a second opinion
 * would be a silent edit. There is no transcript post-processing anywhere in Panthiya on purpose:
 * a guess at a fee amount or at a child's name must not happen between hearing and recording, and
 * the front end is the last place it should start.
 */
async function sendTranscript(transcript) {
  setMicPhase('idle');
  await submitMessage(transcript);
}

/* ================================================================================================
   9. Wiring
   ================================================================================================ */

async function start() {
  const el = (id) => document.getElementById(id);
  dom = {
    log: el('chat-log'),
    empty: el('chat-empty'),
    messages: el('chat-messages'),
    status: el('chat-status'),
    form: el('chat-form'),
    input: el('chat-input'),
    send: el('chat-send'),
    mic: el('chat-mic'),
    micLabel: el('chat-mic-label'),
    micStatus: el('mic-status'),
    month: el('ledger-month'),
    total: el('ledger-total'),
    list: el('ledger-list'),
    ledgerStatus: el('ledger-status'),
    auditList: el('audit-list'),
    auditStatus: el('audit-status'),
  };

  dom.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = dom.input.value.trim();
    if (text === '') return;
    dom.input.value = '';
    await submitMessage(text);
  });

  // One click handler and nothing else. A <button> fires click on Enter and Space, so this toggle
  // is keyboard-operable for free (requirement 12.4) — which is exactly what a press-and-hold
  // gesture would not be, since `pointerdown`/`pointerup` have no keyboard equivalent.
  dom.mic.addEventListener('click', () => {
    // What `disabled` used to do, without taking the focus away to do it.
    if (micView(state.mic.phase).busy) return;
    if (state.mic.phase === 'recording') stopRecording();
    else void startRecording();
  });

  onLang(() => { renderChat(); renderLedger(); renderAudit(); renderMic(); });
  await init({ titleKey: 'teacher.heading' });

  state.ledgerStatusKey = 'ledger.loading';
  state.auditStatusKey = 'audit.loading';
  renderLedger();
  renderAudit();

  try {
    const ledger = await loadLedger();
    state.ledger = ledger;
    state.ledgerStatusKey = ledger.students.length ? '' : 'ledger.empty';
  } catch (err) {
    console.error(err);
    state.ledgerStatusKey = 'ledger.error';
  }
  renderLedger();

  try {
    const { entries } = await loadAudit();
    state.audit = entries;
    state.auditStatusKey = entries.length ? '' : 'audit.empty';
  } catch (err) {
    console.error(err);
    state.auditStatusKey = 'audit.error';
  }
  renderAudit();
}

// type="module" defers, so the DOM is ready by now. The guard is for Node: the unit test imports
// this file for the pure helpers above and must not boot a page that has no document.
if (typeof document !== 'undefined') start();
