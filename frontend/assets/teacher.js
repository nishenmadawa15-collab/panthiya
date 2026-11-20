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
import {
  ApiError, apiBase, authHeaderOrThrow, bodyOrThrow, configured, ready, serverSentence,
} from './auth.js';

/* ================================================================================================
   1. Data access — the only part of this screen that knows where data comes from.
   ================================================================================================ */

// ponytail: SWAP POINT — taken. The eight functions below are this screen's entire data surface,
// and seven of them are the real call (design.md §5); MOCK is the fallback they use while the
// stack is down. `MOCKING` is `configured()` from auth.js — the same "are the four deploy outputs pasted in"
// check the sign-in panel already uses — so nothing here is edited on deploy evening: paste the
// four stack outputs into `CONFIG` in assets/auth.js and this screen is live.
//
//   sendMessage(text)     → POST /chat {message, lang} → {reply, blockedBy}
//   loadLedger()          → **still the mock, and not a swap point**: the API serves no ledger
//                           read. See its own note below; this is the one thing on this screen
//                           that `CONFIG` cannot make live.
//   loadDrafts()          → GET /teacher/drafts → {drafts[]}, newest-first and this teacher's own
//                           classes only. Nothing in here is visible to any parent yet.
//   approveDraft(id)      → POST /teacher/drafts/{id}/approve → the approval. The id is the WHOLE
//                           request: there is no field here that could supply replacement wording,
//                           because a draft's guarantee is that every sentence came from a stored
//                           row (requirement 6.1). One press, one draft, never a retry.
//   loadAudit()           → GET /teacher/audit → {entries[]}, already newest-first and already
//                           scoped to this teacher's own classes. Rendered as given: a sort or a
//                           filter here would be a second, weaker copy of a rule the server holds
//                           (requirement 10.3).
//   voiceUploadUrl(blob)  → POST /voice/upload-url {bytes, format} → {key, url, contentType}
//   putAudio(slot, blob)  → PUT the blob to `slot.url` with `Content-Type: slot.contentType` and
//                           NO Authorization header: the presigned URL is the capability, and the
//                           signed length is the blob's own size.
//   voiceTranscript(body) → POST /voice/transcript, twice over: `{key, lang}` starts the job and
//                           `{jobName, lang}` polls it, which is why the poll loop below is the
//                           client's and not the Lambda's.
const MOCKING = !configured();

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
  // Two drafts in the shape `GET /teacher/drafts` returns them — the real field names, and the
  // same fictional students as the ledger above. Neither has been sent anywhere: a draft is
  // `status: 'draft'` in DynamoDB and reaches no parent's inbox until it is approved (req 6.2).
  //
  // The second one carries a `mismatch`, which is the one thing on this screen worth having in the
  // demo: the teacher said 90, the stored mark is 72, and the draft was built from the stored row
  // (requirement 6.4). A mock without one would leave that renderer untested until demo day.
  drafts: {
    drafts: [
      {
        draftId: 'msg-0101',
        studentId: 'stu-03',
        classId: 'cls-ol-maths-thu',
        createdAt: '2026-11-19T14:30:11.204Z',
        body: 'November fees: 2,500 LKR is still outstanding. Attendance in November: present on 3 of 4 class days.',
        sourceFacts: [
          { table: 'fees', key: 'stu-03#2026-11', value: '0/2500 LKR' },
          { table: 'attendance', key: 'stu-03#2026-11-12', value: 'absent' },
        ],
        mismatch: null,
      },
      {
        draftId: 'msg-0102',
        studentId: 'stu-02',
        classId: 'cls-ol-maths-thu',
        createdAt: '2026-11-19T14:22:48.907Z',
        body: 'November test: 72 out of 100. November fees: paid in full.',
        sourceFacts: [
          { table: 'marks', key: 'stu-02#2026-11-14-november-test', value: '72/100' },
          { table: 'fees', key: 'stu-02#2026-11', value: '2500/2500 LKR' },
        ],
        mismatch: { claimed: 90, stored: 'November test on 2026-11-14: 72 out of 100' },
      },
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

/**
 * One authenticated call to this stack's API → the parsed body.
 *
 * ponytail: one local function rather than the same four lines in five callers. The token header,
 * the not-signed-in case and requirement 1.4 are one rule each, and five copies of a rule is how
 * five copies come to disagree — which is the defect this lane was called in to fix elsewhere on
 * this screen. It is not a transport layer: no retry, no queue, no interceptor, no cache. A
 * failure arrives as an `ApiError` carrying the server's own sentence (auth.js).
 */
async function api(path, { method = 'GET', body } = {}) {
  const auth = authHeaderOrThrow();
  return bodyOrThrow(await fetch(`${apiBase()}${path}`, {
    method,
    headers: body === undefined ? auth : { ...auth, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

/** 'audio/webm;codecs=opus' → 'webm'. The container token, which is all voice.mjs asks for. */
const formatOf = (blob) => String(blob?.type ?? '').split(';')[0].split('/')[1] || 'webm';

/** POST /chat → {reply, blockedBy}. Mocked: resolves `replyKey` from the current pack instead. */
export async function sendMessage(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('empty message');
  if (text.length > MAX_MESSAGE) throw new Error('message too long');

  if (MOCKING) {
    await sleep(MOCK.latencyMs);
    return { replyKey: MOCK.replyKey };
  }
  return api('/chat', { method: 'POST', body: { message: text, lang: currentLang() } });
}

/**
 * The month's fee ledger → {month, students[]}.
 *
 * ponytail: the one call on this screen that is **still the mock**, because there is nothing to
 * call. `backend/template.yaml` serves `/chat`, `/teacher/drafts`, `/teacher/audit`,
 * `/teacher/students/{id}/export`, the two voice routes and the red-team routes — and no ledger
 * read; `read/handlers.mjs` has no handler for one either. Ceiling, and it is a visible one: the
 * fees on this screen are demo data however `CONFIG` is set. A fetch to an invented path would
 * turn that into an unexplained empty table on demo day, which is worse. Upgrade path: when a
 * ledger read exists this body is `return api('/teacher/ledger');` and MOCK.ledger goes with it.
 */
export async function loadLedger() {
  await sleep(MOCK.latencyMs);
  return structuredClone(MOCK.ledger);
}

/** GET /teacher/drafts → {drafts[]}, newest first and this teacher's classes only (req 6.2). */
export async function loadDrafts() {
  if (MOCKING) {
    await sleep(MOCK.latencyMs);
    return structuredClone(MOCK.drafts);
  }
  return api('/teacher/drafts');
}

/**
 * POST /teacher/drafts/{id}/approve → the approval (requirement 6.3).
 *
 * The id is the whole request. There is deliberately no second argument: `approveParentUpdate`
 * accepts no replacement text, so there is nothing here that could put a sentence in front of a
 * parent that did not come from a stored row. The id is server-supplied — it came back from
 * `loadDrafts()` — and is still encoded, because it is being spliced into a URL path.
 */
export async function approveDraft(draftId) {
  if (typeof draftId !== 'string' || draftId.trim() === '') throw new Error('empty draftId');

  if (MOCKING) {
    await sleep(MOCK.latencyMs);
    return { ok: true, action: 'approveParentUpdate', draftId, status: 'approved' };
  }
  return api(`/teacher/drafts/${encodeURIComponent(draftId)}/approve`, { method: 'POST' });
}

/** GET /teacher/audit → {entries[]}, newest first and this teacher's classes only. */
export async function loadAudit() {
  if (MOCKING) {
    await sleep(MOCK.latencyMs);
    return structuredClone(MOCK.audit);
  }
  return api('/teacher/audit');
}

/** POST /voice/upload-url → the one object this caller may write. */
export async function voiceUploadUrl(blob) {
  if (MOCKING) {
    await sleep(MOCK.latencyMs);
    return { key: 'voice/MOCK/mock.webm', url: '', contentType: blob.type || 'audio/webm', bytes: blob.size };
  }
  // `bytes` is signed into the URL, so the capability is one key, one method and one exact length.
  // `format` is the recorder's own container token, sent as it is: voice.mjs refuses one it has not
  // been tested against (`format_unsupported`) rather than defaulting it to webm and failing the
  // job later, and a visible 400 is the outcome it asks for.
  return api('/voice/upload-url', { method: 'POST', body: { bytes: blob.size, format: formatOf(blob) } });
}

/** PUT the recording to the presigned URL. */
export async function putAudio(slot, blob) {
  if (MOCKING) {
    await sleep(MOCK.latencyMs);
    return { ok: true, bytes: blob.size, key: slot.key };
  }
  // The one request on this screen that does not go to our API, so it does not go through api():
  // the presigned URL *is* the capability, and an Authorization header on it would be a token sent
  // to a URL that has no use for one. A 403 here is an expired URL rather than a rejected
  // sign-in, so the session is left alone; S3 answers in XML, so there is no sentence to show and
  // the caller's `mic.error` is the honest line. Said once, never retried (requirement 3.6).
  const res = await fetch(slot.url, {
    method: 'PUT',
    headers: { 'content-type': slot.contentType },
    body: blob,
  });
  if (!res.ok) throw new ApiError('');
  return { ok: true, bytes: blob.size, key: slot.key };
}

/**
 * POST /voice/transcript → `{status: 'in_progress'|'done'|'failed', …}`.
 *
 * A `failed` arrives as a 200 carrying the teacher's own sentence (voice.mjs writes it in their
 * language), so it is a body to read rather than an error to throw: `transcriptFailure()` below
 * shows that sentence unchanged.
 *
 * The mock answers `in_progress` to the start call and `done` to the first poll, so the page's
 * poll loop is exercised rather than skipped. It never answers `failed`: a mock that invented a
 * failure message would be the one string on this screen that no server wrote.
 */
export async function voiceTranscript(body) {
  if (MOCKING) {
    await sleep(MOCK.latencyMs);
    if (body.jobName) return { status: 'done', jobName: body.jobName, transcript: t(MOCK.transcriptKey) };
    return { status: 'in_progress', jobName: 'panthiya-MOCK-job' };
  }
  return api('/voice/transcript', { method: 'POST', body });
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
  // The server's own sentence for a failed call, shown unedited and in preference to our key for
  // that surface — the same rule as the mic's `message` below, and for the same reason: a server
  // that said why is already saying it in the teacher's language (requirement 3.6).
  chatStatusMessage: '',
  sending: false,      // a /chat round-trip is open; the send button says so with aria-disabled
  ledgerStatusKey: '',
  drafts: null,        // [draft, …] awaiting this teacher's approval, in the server's order
  draftsStatusKey: '', // pack key only: every failure on this surface is one of our sentences
  approving: '',       // the draftId of an approval in flight, or '' — one at a time, never two
  auditStatusKey: '',
  auditStatusMessage: '',
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
  setText(dom.status, state.chatStatusMessage || (state.chatStatusKey ? t(state.chatStatusKey) : ''));
  // `aria-disabled`, not `disabled`, for the same reason as the microphone below: disabling the
  // button the teacher has just pressed drops focus to <body> for the whole Bedrock round-trip.
  // This keeps it focusable; the submit handler ignores the press.
  dom.send.setAttribute('aria-disabled', String(state.sending));

  // Keep the newest message in view without moving focus.
  dom.log.scrollTop = dom.log.scrollHeight;
}

/**
 * A `POST /chat` answer → the log entry it draws, or `null` for "that was not a message".
 *
 * Three outcomes, and keeping them apart is the point of this function existing:
 *
 *   a reply        → the server's own words, unedited. A `distress` reply arrives this way too —
 *                    it carries both text and a `blockedBy`, and the kind words are what the
 *                    teacher should read, not a line of ours about it (chat/orchestrate.mjs).
 *   a layer, no    → `chat.blocked`. It reached Panthiya and was **held on purpose**: a guardrail
 *   reply            or policyCheck block answers 200 with `reply: null` and a `blockedBy`.
 *                    `chat.error` would be the wrong sentence here — "that did not reach Panthiya"
 *                    about a message that reached it and was refused is a worse lie than silence,
 *                    which is why this string was asked for rather than that one reused.
 *   neither        → `null`, and the caller takes the error path. Not a block and not a message:
 *                    `handleChat` fails closed with a 502 on an empty agent reply, so a 200 with
 *                    nothing in it means something between here and there broke — exactly what
 *                    `scripts/redteam-cli.mjs` records as `empty_200_body` rather than as a pass.
 *                    `chat.error` is true of it.
 *
 * `replyKey` is the mock's way of answering in the current language and is checked last, so a real
 * reply or a real block is always told apart first.
 *
 * Exported for tests/unit/api-swap-frontend.test.mjs.
 */
export function replyEntry({ reply, replyKey, blockedBy } = {}) {
  if (typeof reply === 'string' && reply.trim() !== '') return { side: 'panthiya', text: reply };
  if (typeof blockedBy === 'string' && blockedBy !== '') return { side: 'panthiya', key: 'chat.blocked' };
  if (typeof replyKey === 'string' && replyKey !== '') return { side: 'panthiya', key: replyKey };
  return null;
}

/**
 * Send one message and show the reply. The single path to POST /chat.
 *
 * A typed line and a transcribed voice note both arrive here, which is the point: a transcript
 * gets no shortcut past policyCheck, the audit log or the 2000-character limit, and there is no
 * second code path that could drift from this one.
 */
async function submitMessage(text) {
  // The busy guard lives here as well as in the submit handler, because this is where both paths
  // meet: a voice note landing while a typed send is still open used to start a second round trip
  // sharing one `state.sending`, and the first to finish cleared it — the send button went live
  // mid-request. Returns false when it refused, so the caller can keep the words.
  if (state.sending) return false;

  state.messages.push({ side: 'teacher', text });
  state.chatStatusKey = 'chat.sending';
  state.chatStatusMessage = '';
  state.sending = true;
  // renderMic() as well as renderChat(), here and in the `finally`: `state.sending` is half of
  // what `micBlocked()` reads, so the microphone has to be redrawn whenever it moves or the button
  // would say it is available throughout a send it will refuse to start during.
  renderChat();
  renderMic();

  try {
    const entry = replyEntry(await sendMessage(text));
    // Nothing came back at all: not a message, so it takes the error path below rather than being
    // drawn as a blank bubble. `replyEntry()` above is where the three outcomes are told apart.
    if (!entry) throw new Error('chat answered with neither a reply nor a layer');

    state.messages.push(entry);
    state.chatStatusKey = '';
  } catch (err) {
    console.error(err);
    state.chatStatusKey = 'chat.error';
    state.chatStatusMessage = serverSentence(err);   // the server's words when it sent any, as-is
  } finally {
    state.sending = false;
    // No focus() here. It existed to undo the focus `disabled` had just thrown away; now that
    // nothing is dropped, calling it would instead yank the teacher back from wherever they moved
    // during the request — the ledger, the mic, the language picker (2.4.3, 3.2.5).
    renderChat();
    renderMic();
  }
  return true;
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
   6a. Parent updates awaiting approval (requirements 6.2, 6.3) — the approval gate, as a screen

   Numbered 6a rather than renumbering what follows: the section banners below are what several
   tests slice this file on, and moving them to add a section is churn with a trap in it.

   Two rules here, and both are requirement 6 rather than decoration:

     Nothing in this list has been sent. It is `status: 'draft'` in DynamoDB, it is in no parent's
     inbox, and the only transition out of it is the one button below (`approveDraft`). So the
     section says so in words, not only by being named "awaiting approval".

     The wording cannot be edited here, and there is no field anywhere in this section that could
     carry a replacement. A draft's whole guarantee is that every sentence in it came from a stored
     row (requirement 6.1), and an approval that could carry its own text would be a hole straight
     through it. A teacher who wants different words asks Panthiya for a new draft.
   ================================================================================================ */

// ponytail: the audit log's card classes are reused as-is for these cards — `.audit-entry` is a
// white card in a `.audit-list` grid, `.audit-value*` is a labelled evidence box, and both are
// exactly what a draft needs. A second set of identical rules under `.draft-*` names would be
// twelve lines of CSS for no pixel. Upgrade path: if the two ever need to look different, the
// class names here are the only thing to change.

/** One draft, with what it was built from and the single control that can send it. */
function draftCard(draft) {
  const card = document.createElement('li');
  card.className = 'audit-entry';

  card.append(para('audit-entry__action', t('drafts.student', { id: String(draft.studentId ?? '') })));

  // As stored, UTC and all — the same rule as the audit log's own stamp, and the same string.
  const when = document.createElement('time');
  when.className = 'audit-entry__when';
  when.setAttribute('datetime', String(draft.createdAt ?? ''));
  setText(when, t('audit.when', { ts: String(draft.createdAt ?? '') }));
  card.append(when);

  // The draft itself: the server's own sentences, through textContent, unedited (requirement 12.7).
  card.append(para('audit-value__item', String(draft.body ?? '')));

  // Requirement 6.1 on screen: the stored rows this text was assembled from, so a teacher can see
  // that it invented nothing before they put their name to it.
  const facts = Array.isArray(draft.sourceFacts) ? draft.sourceFacts : [];
  if (facts.length) {
    const box = document.createElement('div');
    box.className = 'audit-value';
    box.append(para('audit-value__label', t('drafts.based_on')));

    const list = document.createElement('ul');
    list.className = 'audit-value__list';
    for (const fact of facts) {
      const item = document.createElement('li');
      item.className = 'audit-value__item';
      setText(item, t('drafts.fact', {
        table: String(fact?.table ?? ''),
        key: String(fact?.key ?? ''),
        value: String(fact?.value ?? ''),
      }));
      list.append(item);
    }
    box.append(list);
    card.append(box);
  }

  // Requirement 6.4: the teacher stated a figure no stored row supports. The draft used the stored
  // value, and the teacher is told both before they approve — never after.
  if (draft.mismatch) {
    card.append(para('audit-entry__tombstone', t('drafts.mismatch', {
      claimed: String(draft.mismatch.claimed ?? ''),
      stored: String(draft.mismatch.stored ?? ''),
    })));
  }

  // One button, one draft. The id goes on the element rather than into a closure so the list can
  // carry a single click listener (see `start()`), and the accessible name names the student, so
  // eight "Approve and send" buttons are told apart by a screen reader and by voice control. The
  // visible words are the start of that name (2.5.3), which is why the two keys are a pair.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'composer__send';
  button.dataset.draftId = String(draft.draftId ?? '');
  button.setAttribute('aria-label', t('drafts.approve_case', { id: String(draft.studentId ?? '') }));
  // `aria-disabled`, never `disabled`: disabling the button the teacher has just pressed drops
  // focus to <body> for the whole round-trip. The click handler ignores the press instead.
  button.setAttribute('aria-disabled', String(Boolean(state.approving)));
  setText(button, t('drafts.approve'));
  card.append(button);

  return card;
}

function renderDrafts() {
  setText(dom.draftsStatus, state.draftsStatusKey ? t(state.draftsStatusKey) : '');
  dom.draftsList.replaceChildren();

  // In the order the server gave them, which is newest-first. No sort and no filter here: `GET
  // /teacher/drafts` reads only the partitions of this teacher's own classes, so a filter here
  // would be a weaker second copy of the rule that actually scopes this list.
  for (const draft of state.drafts ?? []) dom.draftsList.append(draftCard(draft));
}

/**
 * Approve one draft. The only write this screen makes, and the only way anything reaches a parent.
 *
 * Never retried: `approveParentUpdate` is idempotent server-side, but a failure here is reported
 * once and plainly, exactly as a failed voice note is — a teacher who is told nothing was sent and
 * can see the draft still waiting knows where they stand, and a silent second attempt does not
 * tell them anything. The sentence is always one of ours: a failure on this path answers with a
 * code (`denied`/`bad_request`) and no prose, so there is no server sentence to prefer.
 */
async function approveParentDraft(draftId) {
  if (state.approving || !draftId) return;

  state.approving = draftId;
  state.draftsStatusKey = 'drafts.approving';
  renderDrafts();

  try {
    await approveDraft(draftId);
    // Through the gate, so it is no longer awaiting approval: `GET /teacher/drafts` would not
    // return it again either. Dropped from the list rather than re-fetched — one approval is one
    // request, and a reload would be a second one for a row we already know the fate of.
    state.drafts = (state.drafts ?? []).filter((d) => d.draftId !== draftId);
    state.draftsStatusKey = 'drafts.approved';
  } catch (err) {
    console.error(err);
    state.draftsStatusKey = 'drafts.approve_error';
  } finally {
    state.approving = '';
    renderDrafts();
  }
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
  setText(dom.auditStatus, state.auditStatusMessage || (state.auditStatusKey ? t(state.auditStatusKey) : ''));
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
 * May a recording be **started** right now?
 *
 * `startRecording()` reads this, so the rule lives at the one door into the recorder rather than in
 * the button handler that happens to be the only caller today. The defect it closes: the mic could
 * be started while a typed send was still open, and the transcript that came back minutes later
 * found `submitMessage()` busy and landed in the typed box instead — a recording the teacher made
 * to avoid typing, handed back to be typed. The phases the recorder is already using were guarded;
 * a send on the other path was not.
 *
 * `recording` is deliberately never blocked, in either direction: a teacher who presses send while
 * recording must still be able to press stop, or they are left holding a live microphone with no
 * way to end it but reloading the page.
 *
 * Exported for tests/unit/chat-busy-frontend.test.mjs, whose corpus is phase × sending.
 */
export const micBlocked = (phase, sending) =>
  phase !== 'recording' && (micView(phase).busy || Boolean(sending));

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
  //
  // The same `micBlocked()` the recorder itself reads, so what the button says and what pressing it
  // does cannot disagree — including during a typed send, when the button would otherwise look
  // available for a recording that startRecording() will refuse.
  dom.mic.setAttribute('aria-disabled', String(micBlocked(state.mic.phase, state.sending)));
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
  // The one door into the recorder, so the guard is here and not in the caller: the button is the
  // only way in today, and a second one — a shortcut key, a "record again" link — would otherwise
  // have to remember the rule. Silent on purpose: the button is already `aria-disabled` and says
  // so to a screen reader, and a status line about a press that did nothing would be noise over
  // the "Sending…" the teacher is already reading.
  if (micBlocked(state.mic.phase, state.sending)) return;

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
  if (await submitMessage(transcript)) return;

  // A typed send is still in flight, so this one was refused rather than run alongside it. The
  // words are not thrown away and not queued behind it either: they go into the typed box, which
  // is where a failed transcription already leaves the teacher, and they send it when they choose.
  dom.input.value = dom.input.value ? `${dom.input.value} ${transcript}` : transcript;
  dom.input.focus();
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
    draftsList: el('drafts-list'),
    draftsStatus: el('drafts-status'),
    auditList: el('audit-list'),
    auditStatus: el('audit-status'),
  };

  dom.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // What `disabled` used to do, without taking the focus away to do it.
    if (state.sending) return;
    const text = dom.input.value.trim();
    if (text === '') return;
    dom.input.value = '';
    await submitMessage(text);
  });

  // One click handler and nothing else. A <button> fires click on Enter and Space, so this toggle
  // is keyboard-operable for free (requirement 12.4) — which is exactly what a press-and-hold
  // gesture would not be, since `pointerdown`/`pointerup` have no keyboard equivalent.
  dom.mic.addEventListener('click', () => {
    // What `disabled` used to do, without taking the focus away to do it (requirement 12.4). It is
    // not the busy *rule* — that is `micBlocked()`, read by startRecording() itself — only the
    // half of `aria-disabled` a browser does not do for us: ignore the press. Stopping is reached
    // before it either way, because `recording` is not a busy phase.
    if (micView(state.mic.phase).busy) return;
    if (state.mic.phase === 'recording') stopRecording();
    else void startRecording();
  });

  // One listener on the list rather than one per card: the cards are rebuilt on every language
  // switch and after every approval, and a listener per button would be re-attached each time.
  dom.draftsList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-draft-id]');
    if (!button) return;
    // What `disabled` used to do, without taking the focus away to do it: the button is already
    // `aria-disabled` while an approval is open, and this is the half a browser does not do for us.
    if (state.approving) return;
    void approveParentDraft(button.dataset.draftId);
  });

  onLang(() => { renderChat(); renderLedger(); renderDrafts(); renderAudit(); renderMic(); });
  await init({ titleKey: 'teacher.heading' });

  state.ledgerStatusKey = 'ledger.loading';
  state.draftsStatusKey = 'drafts.loading';
  state.auditStatusKey = 'audit.loading';
  renderLedger();
  renderDrafts();
  renderAudit();

  // The sign-in is still finishing when this page loads: arriving from the hosted UI means a
  // `?code=` to exchange for the token (auth.js), and `authHeader()` is null until that lands. The
  // audit read below would otherwise fail with "could not load" a quarter of a second before the
  // session it needed arrived — on a page that then sat there looking signed in. `ready` is the
  // promise auth.js exports for exactly this, and on an unconfigured page it is already resolved.
  await ready;

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
    const { drafts } = await loadDrafts();
    state.drafts = drafts;
    state.draftsStatusKey = drafts.length ? '' : 'drafts.empty';
  } catch (err) {
    console.error(err);
    state.draftsStatusKey = 'drafts.error';
  }
  renderDrafts();

  try {
    const { entries } = await loadAudit();
    state.audit = entries;
    state.auditStatusKey = entries.length ? '' : 'audit.empty';
  } catch (err) {
    console.error(err);
    state.auditStatusKey = 'audit.error';
    state.auditStatusMessage = serverSentence(err);   // the server's words when it sent any, as-is
  }
  renderAudit();
}

// type="module" defers, so the DOM is ready by now. The guard is for Node: the unit test imports
// this file for the pure helpers above and must not boot a page that has no document.
if (typeof document !== 'undefined') start();
