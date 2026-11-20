// Offline checks for the teacher audit screen (task 3.6) and the microphone UI (task 6.4). No AWS,
// no network, no dependencies — so the run-unit-tests Kiro hook can run this on every save for free.
//
// tests/unit/frontend.test.mjs already guards what every page shares (one key set across the three
// packs, no inline script or style, no innerHTML, contrast, no .mjs under assets/). This file
// guards the two promises these two screens make, and each test names the requirement it pins:
//
//   the audit log is append-only and SAYS so, and a deletion appears in it as an appended event
//   with a tally rather than as an absence (requirement 10.3, 10.4);
//
//   the microphone is reachable by keyboard, its recording state is not carried by colour alone,
//   and a failed transcription shows the server's own words, is never retried, and is never drawn
//   as a message that was sent (requirement 12.4, 3.6);
//
//   the drafts view is the approval gate on a screen — nothing in it has been sent, the only
//   control in it is the approve button, and no field anywhere in it could supply replacement
//   wording for a draft (requirement 6.1-6.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  auditLines, tombstone, micView, transcriptFailure, loadDrafts, approveDraft,
} from '../../frontend/assets/teacher.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const HTML = read('frontend/teacher/index.html');
const JS = read('frontend/assets/teacher.js');
const CSS = read('frontend/assets/styles.css');

const LANGS = ['si', 'ta', 'en'];
const packs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(`frontend/i18n/${l}.json`))]));

/** The audit section of the markup, on its own. The rules below are about what is inside it. */
const auditSection = (() => {
  const start = HTML.indexOf('id="audit-heading"');
  const end = HTML.indexOf('</section>', start);
  assert.ok(start > 0 && end > start, 'the audit section was not found in teacher/index.html');
  return HTML.slice(HTML.lastIndexOf('<section', start), end);
})();

/** The drafts section of the markup, on its own. Same extraction as the audit one above. */
const draftsSection = (() => {
  const start = HTML.indexOf('id="drafts-heading"');
  const end = HTML.indexOf('</section>', start);
  assert.ok(start > 0 && end > start, 'the drafts section was not found in teacher/index.html');
  return HTML.slice(HTML.lastIndexOf('<section', start), end);
})();

/* --- requirement 10.4: append-only, and visibly so -------------------------------------------- */

test('req 10.4 — the audit section offers no control that could edit or remove an entry', () => {
  // The log has no update and no delete API (backend/lib/audit.mjs exports one function), so a
  // button here would be a control with nothing behind it and a promise the data model does not
  // make. A checkbox, a field or a form would read the same way.
  for (const tag of ['<button', '<form', '<input', '<select', '<textarea']) {
    assert.ok(!auditSection.includes(tag),
      `the audit section contains ${tag}; requirement 10.4 means it offers nothing to change`);
  }
});

test('req 10.4 — the page says in words that the log cannot be changed, in all three languages', () => {
  assert.ok(auditSection.includes('data-i18n="audit.immutable"'),
    'the audit section does not render audit.immutable');

  for (const lang of LANGS) {
    const value = packs[lang]['audit.immutable'];
    assert.equal(typeof value, 'string', `audit.immutable missing from ${lang}.json`);
    assert.ok(value.length > 40, `${lang}.audit.immutable is too short to state the whole promise`);
  }
  // The English wording is the one this test can read: it has to deny both verbs.
  const en = packs.en['audit.immutable'].toLowerCase();
  assert.ok(en.includes('cannot be changed'), 'audit.immutable does not say the log cannot be changed');
  assert.ok(en.includes('edit') && en.includes('delete'),
    'audit.immutable does not deny editing and deleting specifically');
});

test('req 10.4 — no write verb reaches the API from the teacher script', () => {
  // The calls are real now, so this is no longer "there is no API to call". It is the same rule
  // checked one step further in: `loadAudit()` is a GET, and nothing on this screen writes to the
  // log — there is no endpoint that could, and this page must not be the first to look for one.
  const code = JS.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  for (const verb of ['DELETE', 'PATCH']) {
    assert.ok(!new RegExp(`method:\\s*['"\`]${verb}`, 'i').test(code),
      `teacher.js issues a ${verb}; no audit API accepts one`);
  }

  // The one PUT on this screen is the voice recording, and it goes to the presigned S3 URL the
  // server handed back — never to our own API, which has no PUT route at all.
  const puts = [...code.matchAll(/fetch\(([^,]+),\s*\{\s*\n?\s*method: 'PUT'/g)].map((m) => m[1].trim());
  assert.deepEqual(puts, ['slot.url'], 'a PUT goes somewhere other than the presigned upload URL');

  // And the audit read is a read: `api()` defaults to GET and this call passes no method.
  assert.match(code, /api\('\/teacher\/audit'\)/, 'the audit log is no longer read with a plain GET');
  assert.ok(!/\/teacher\/audit'[^)]*method/.test(code), 'the audit call carries a method other than GET');
});

test('req 10.4 — a deletion is an appended entry with a tally, not an absence', () => {
  const erased = {
    action: 'deleteStudent',
    before: { studentId: 'stu-13', displayName: 'Ravindu Kumara' },
    after: { deleted: true, removed: { attendance: 4, fees: 2, marks: 1, messages: 1, student: 1 } },
  };

  assert.deepEqual(tombstone(erased), [
    { table: 'attendance', count: 4 },
    { table: 'fees', count: 2 },
    { table: 'marks', count: 1 },
    { table: 'messages', count: 1 },
    { table: 'student', count: 1 },
  ]);

  // The erased child's own row survives in `before`, which is the whole point: the record of the
  // fee he disputed outlives him leaving the class (erase.mjs, decision 1).
  assert.ok(auditLines(erased.before).some((l) => l.name === 'displayName'));

  // Every other action is not a tombstone, including one whose `after` merely has fields.
  assert.equal(tombstone({ action: 'recordFee', after: { amount: 2500, status: 'paid' } }), null);
  assert.equal(tombstone({ action: 'recordFee', after: null }), null);
  assert.equal(tombstone(undefined), null);
  // `deleted === true` is what makes a tombstone, not the presence of a `removed` field: no case
  // above carries one without the flag, so reading `after.removed` on its own stayed green — and
  // an entry that did would render in this log as "this child was deleted, 1 row removed", which
  // is the one kind of claim an append-only record a parent reads must never invent.
  assert.equal(tombstone({ action: 'recordFee', after: { removed: { fees: 1 } } }), null);
  assert.equal(tombstone({ action: 'deleteStudent', after: { deleted: 'true', removed: { fees: 1 } } }), null);
});

/* --- requirement 10.3: read honestly, and in the server's order -------------------------------- */

test('req 10.3 — a before/after pair is rendered as two labelled sides, never merged', () => {
  const before = auditLines({ studentId: 'stu-03', month: '2026-11', amount: 0, status: 'due' });
  const after = auditLines({ studentId: 'stu-03', month: '2026-11', amount: 2500, status: 'paid' });

  assert.deepEqual(before.map((l) => l.name), ['studentId', 'month', 'amount', 'status']);
  assert.equal(before.find((l) => l.name === 'amount').text, '0');
  assert.equal(after.find((l) => l.name === 'amount').text, '2500');

  // Both sides exist, separately, with their own field names. Nothing is summarised into a
  // sentence, which is where a reader stops being able to tell which figure was the old one.
  for (const key of ['audit.before', 'audit.after']) {
    for (const lang of LANGS) assert.equal(typeof packs[lang][key], 'string', `${key} missing from ${lang}.json`);
  }
  assert.notEqual(packs.en['audit.before'], packs.en['audit.after']);
});

test('req 10.1 — a missing side says so, rather than rendering as "no change"', () => {
  // `addStudent` writes `before: null` (requirement 2.4). An empty box beside a filled one reads
  // as "unchanged", which for a creation is wrong and for a deletion is the opposite of the truth.
  assert.deepEqual(auditLines(null), []);
  assert.deepEqual(auditLines(undefined), []);
  for (const lang of LANGS) assert.equal(typeof packs[lang]['audit.none'], 'string');

  // A field that is null inside a row gets the same treatment, signalled by a null text.
  assert.deepEqual(auditLines({ approvedAt: null }), [{ name: 'approvedAt', text: null }]);

  // A nested value is stringified, not dropped: nothing leaves the evidence silently.
  assert.deepEqual(auditLines({ removed: { fees: 2 } }), [{ name: 'removed', text: '{"fees":2}' }]);
});

test('req 10.3 — the page renders the server order and does not sort or filter the entries', () => {
  // `GET /teacher/audit` queries only the partitions of this teacher's own classes and merges them
  // newest-first (read/handlers.mjs). A sort or a filter here would be a second, weaker copy of a
  // rule the server holds — and a page that filtered would imply it was the one doing the scoping.
  const render = JS.slice(JS.indexOf('function renderAudit'), JS.indexOf('function renderAudit') + 600);
  assert.ok(!/\.sort\(|\.filter\(|\.reverse\(/.test(render),
    'renderAudit() re-orders or filters the entries; requirement 10.3 is the server\'s to keep');
  assert.ok(/data-i18n="audit.intro"/.test(auditSection), 'the audit section does not say whose entries these are');
  assert.ok(packs.en['audit.intro'].toLowerCase().includes('server'),
    'audit.intro does not say the server decides the scope');
});

test('req 10.3 — every action the backend audits has a word for it in all three packs', () => {
  // The seven `writeAudit` call sites. A missing key would render the raw action name, which is
  // honest but unreadable; a missing *action* would render nothing at all.
  const actions = [
    'addStudent', 'markAttendance', 'recordFee', 'addMarks',
    'draftParentUpdate', 'approveParentUpdate', 'deleteStudent',
  ];
  for (const action of actions) {
    for (const lang of LANGS) {
      assert.equal(typeof packs[lang][`audit.action.${action}`], 'string',
        `audit.action.${action} missing from ${lang}.json`);
    }
  }
});

test('req 10.1 — the timestamp is shown as stored, UTC and all, not converted to the device zone', () => {
  // Two people disputing a November fee have to read the same stamp off two screens. A log whose
  // times move with the device cannot settle that argument.
  assert.ok(/setAttribute\('datetime'/.test(JS), 'the entry timestamp is not in a <time datetime>');
  assert.ok(packs.en['audit.when'].includes('{ts}'), 'audit.when does not carry the stored timestamp');
  assert.ok(packs.en['audit.when'].includes('UTC'), 'audit.when does not say which zone it is');
  for (const lang of LANGS) assert.ok(packs[lang]['audit.when'].includes('{ts}'), `${lang}.audit.when lost {ts}`);
});

/* --- requirement 12.4: the microphone, from a keyboard ---------------------------------------- */

test('req 12.4 — the mic is a <button> toggle, so Enter and Space operate it', () => {
  const mic = HTML.slice(HTML.indexOf('id="chat-mic"') - 200, HTML.indexOf('id="chat-mic"') + 300);
  assert.ok(/<button[^>]*id="chat-mic"[^>]*type="button"/s.test(mic.replace(/\n\s*/g, ' ')),
    'the mic is not a <button type="button">');
  assert.ok(!/id="chat-mic"[^>]*\bdisabled\b/s.test(mic), 'the mic button is still disabled');
  assert.ok(/aria-pressed="false"/.test(mic), 'the mic button has no initial aria-pressed state');

  // A press-and-hold gesture needs pointerdown/pointerup, which a keyboard does not produce — so
  // a hold-to-talk mic is a mouse feature, and requirement 12.4 is not satisfied by one.
  for (const event of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
    assert.ok(!JS.includes(`'${event}'`),
      `teacher.js listens for ${event}; a hold gesture is not reachable from the keyboard`);
  }
});

test('req 12.4 — the recording state is carried by words and shape, not by colour', () => {
  // Four cues, three of which survive greyscale, forced colours and a screen reader: the button's
  // own label changes, aria-pressed flips, the status line says it, and the glyph becomes a square.
  assert.equal(micView('idle').labelKey, 'chat.mic');
  assert.equal(micView('recording').labelKey, 'mic.stop');
  assert.notEqual(micView('recording').labelKey, micView('idle').labelKey);
  assert.equal(micView('recording').pressed, true);
  assert.equal(micView('recording').statusKey, 'mic.recording');

  for (const lang of LANGS) {
    for (const key of ['mic.stop', 'mic.recording']) {
      assert.equal(typeof packs[lang][key], 'string', `${key} missing from ${lang}.json`);
    }
  }

  assert.ok(/aria-pressed/.test(JS), 'nothing sets aria-pressed on the mic button');
  assert.ok(/\.mic-live\s+\.composer__mic-glyph/.test(CSS),
    'the recording glyph does not change shape, so the state is colour alone');
});

test('req 12.4 — an unknown phase falls back to idle rather than to a blank button', () => {
  assert.equal(micView('nonsense'), micView('idle'));
  assert.equal(micView(undefined), micView('idle'));
});

test('req 12.4 — a busy phase disables the button, and recording does not', () => {
  // While the recording is uploading there is nothing to press; while it is recording there is.
  assert.equal(micView('uploading').busy, true);
  assert.equal(micView('transcribing').busy, true);
  assert.equal(micView('recording').busy, false);
  assert.equal(micView('idle').busy, false);
});

/* --- requirement 3.6: a failed transcription, told plainly ------------------------------------ */

test('req 3.6 — a failure shows the server\'s own message, unchanged', () => {
  const fromServer = 'පන්තියට තවම මේ භාෂාව කථාවෙන් තේරුම් ගත නොහැක. කිසිවක් සුරැකුණේ නැත — කරුණාකර එය ලියන්න.';
  const shown = transcriptFailure({ status: 'failed', reason: 'unsupported_language', message: fromServer });

  assert.equal(shown.message, fromServer, 'the server message was edited, translated or replaced');
  assert.equal(shown.messageKey, '', 'one of our strings was shown instead of the server\'s');
});

test('req 3.6 — a failure with no message at all still says something honest', () => {
  assert.deepEqual(transcriptFailure({ status: 'failed' }), { message: '', messageKey: 'mic.error' });
  assert.deepEqual(transcriptFailure({ message: '   ' }), { message: '', messageKey: 'mic.error' });
  assert.deepEqual(transcriptFailure(null), { message: '', messageKey: 'mic.error' });

  // Our own fallbacks say the same three things voice.mjs says: it did not work, nothing was
  // saved, type it instead.
  for (const key of ['mic.error', 'mic.denied', 'mic.unsupported', 'mic.empty', 'mic.timeout']) {
    for (const lang of LANGS) assert.equal(typeof packs[lang][key], 'string', `${key} missing from ${lang}.json`);
  }
  const en = packs.en['mic.error'].toLowerCase();
  assert.ok(en.includes('nothing was saved'), 'mic.error does not say nothing was saved');
  assert.ok(en.includes('type'), 'mic.error does not tell the teacher to type it instead');
});

test('req 3.6 — a failure is never retried and never reaches the chat log', () => {
  // failMic() is the single end of every failure path: it sets the status line, puts the cursor
  // back in the typed box, and returns. Nothing in it sends, and nothing in it tries again.
  const fail = JS.slice(JS.indexOf('function failMic'), JS.indexOf('async function startRecording'));
  assert.ok(!/submitMessage|sendMessage|voiceTranscript|voiceUploadUrl/.test(fail),
    'failMic() sends or retries; requirement 3.6 forbids both');
  assert.ok(/dom\.input\.focus\(\)/.test(fail), 'failMic() does not return focus to the typed box');
  assert.ok(/state\.messages\.push/.test(JS), 'sanity: the chat log is appended to somewhere');
  assert.ok(!/state\.messages\.push[\s\S]{0,80}transcriptFailure/.test(JS),
    'a failed transcription is pushed into the chat log as if it had been sent');
});

test('req 3.5 — a finished transcript goes to the chat exactly as it arrived', () => {
  // No post-processing anywhere in this product, on purpose: a model's guess at a fee amount or a
  // child's name must not happen silently between hearing and recording.
  const send = JS.slice(JS.indexOf('async function sendTranscript'), JS.indexOf('9. Wiring'));
  assert.ok(/submitMessage\(transcript\)/.test(send),
    'sendTranscript() does not pass the transcript through untouched');
  assert.ok(!/transcript\s*\.\s*(replace|toLowerCase|toUpperCase|slice|normalize|trim)/.test(JS),
    'teacher.js edits the transcript; voice.mjs already trimmed it and nothing else may touch it');
});

/* --- requirement 6: the approval gate, as a screen -------------------------------------------- */

test('req 6.3 — a teacher can reach the approval gate at all: the view and its one control exist', () => {
  // The defect this is here for, found 2026-11-20: `approveParentUpdate` was implemented in full,
  // tested in full and reachable by NOBODY — absent from `teacher.json` so the model was never
  // offered it, and absent from this page so no teacher could press anything. 790 tests were green
  // and no parent update could ever send. A gate nothing can open is not a gate, it is a dead end.
  assert.ok(draftsSection.includes('id="drafts-list"'), 'the drafts section renders no list');
  assert.ok(draftsSection.includes('id="drafts-status"'), 'the drafts section has no status line');
  assert.ok(/id="drafts-status"[^>]*role="status"/.test(draftsSection),
    'the drafts status line is not announced, so an approval happens silently for a screen reader');

  // The list is populated and the button built by the script, so the control is checked there.
  assert.match(JS, /button\.dataset\.draftId = /, 'teacher.js builds no approve button');
  assert.match(JS, /approveDraft\(draftId\)/, 'nothing on this page calls the approval endpoint');
  assert.match(JS, /api\(`\/teacher\/drafts\/\$\{encodeURIComponent\(draftId\)\}\/approve`, \{ method: 'POST' \}\)/,
    'the approve call is no longer the one POST route template.yaml serves for it');
  assert.match(JS, /api\('\/teacher\/drafts'\)/, 'the pending drafts are no longer read with a plain GET');
});

test('req 6.1 — nothing in the drafts section could supply wording of its own', () => {
  // `approveParentUpdate` accepts a draft id and nothing else on purpose: a draft's whole
  // guarantee is that every sentence in it came from a stored row, and an approval that could
  // carry its own text would be a hole straight through requirement 6.1. A field on this screen
  // would be the first half of building that hole.
  for (const tag of ['<form', '<input', '<select', '<textarea', 'contenteditable']) {
    assert.ok(!draftsSection.includes(tag),
      `the drafts section contains ${tag}; an approval must not be able to carry replacement text`);
  }

  // One argument, so there is nowhere for a second one to arrive — and no request body at all.
  assert.equal(approveDraft.length, 1, 'approveDraft() takes a second argument; wording could enter there');
  const call = JS.slice(JS.indexOf('export async function approveDraft'), JS.indexOf('/** GET /teacher/audit'));
  assert.ok(!/body:/.test(call), 'the approve call sends a request body; the id is the whole request');
});

test('req 6.2 — the page says in words that nothing here has been sent, in all three languages', () => {
  assert.ok(draftsSection.includes('data-i18n="drafts.intro"'), 'the drafts section does not render drafts.intro');

  for (const lang of LANGS) {
    const value = packs[lang]['drafts.intro'];
    assert.equal(typeof value, 'string', `drafts.intro missing from ${lang}.json`);
    assert.ok(value.length > 40, `${lang}.drafts.intro is too short to state the whole promise`);
  }
  // The English wording is the one this test can read, and it has to make all three claims.
  const en = packs.en['drafts.intro'].toLowerCase();
  assert.ok(en.includes('has been sent'), 'drafts.intro does not say nothing has been sent yet');
  assert.ok(en.includes('only after you approve'), 'drafts.intro does not say approval is what sends it');
  assert.ok(en.includes('cannot be changed'), 'drafts.intro does not say the wording cannot be edited here');
});

test('req 6.2 — the drafts mock answers in the shape GET /teacher/drafts really returns', async () => {
  // Nothing is deployed, so the mock is what the renderer is exercised against: a mock in the
  // wrong shape means the drafts view is tested against a fixture and broken against the server.
  // These are `read/handlers.mjs#teacherDrafts`'s own field names.
  const { drafts } = await loadDrafts();
  assert.ok(drafts.length >= 2, 'one draft does not show a list');

  for (const draft of drafts) {
    for (const field of ['draftId', 'studentId', 'classId', 'createdAt', 'body', 'sourceFacts']) {
      assert.ok(field in draft, `a mock draft has no ${field}`);
    }
    // Requirement 6.1: a draft with no stored rows behind it is the one thing this screen must
    // never show, because the "built only from your records" line would then be a claim about
    // nothing.
    assert.ok(Array.isArray(draft.sourceFacts) && draft.sourceFacts.length > 0,
      `draft ${draft.draftId} has no stored rows behind it`);
    for (const fact of draft.sourceFacts) {
      assert.deepEqual(Object.keys(fact).sort(), ['key', 'table', 'value'], 'a source fact is not {table, key, value}');
    }
  }

  assert.ok(drafts.some((d) => d.mismatch), 'no draft in the mock carries a mismatch, so requirement 6.4\'s renderer is first exercised on demo day');
  const mismatch = drafts.find((d) => d.mismatch).mismatch;
  assert.equal(typeof mismatch.claimed, 'number', 'the mismatch claim is not the parsed number drafts.mjs returns');
  assert.ok(mismatch.stored, 'the mismatch names no stored value to prefer');
});

test('req 6.4 — the stated figure and the stored one are both shown, and told apart', () => {
  // "Say she got 90" against a stored 72 (drafts.mjs#findMismatch). The teacher sees both BEFORE
  // they approve, with which is which still legible — reversed, it tells them the record is wrong.
  assert.match(JS, /t\('drafts\.mismatch', \{/, 'the drafts view does not render a mismatch at all');
  for (const lang of LANGS) {
    const value = packs[lang]['drafts.mismatch'];
    assert.equal(typeof value, 'string', `drafts.mismatch missing from ${lang}.json`);
    assert.ok(value.includes('{claimed}'), `${lang}.drafts.mismatch does not say what was stated`);
    assert.ok(value.includes('{stored}'), `${lang}.drafts.mismatch does not say what is stored`);
  }
  assert.ok(packs.en['drafts.mismatch'].toLowerCase().includes('uses the stored'),
    'drafts.mismatch does not say which of the two the draft used');
});

test('req 6.3 — approving one draft sends one request, and an empty id sends none', async () => {
  // The mock path, which is the only path a unit test can take: what is asserted is that it
  // answers an approval without going near the network, and that an id it was not given is
  // refused before anything is sent rather than becoming a request to `/teacher/drafts//approve`.
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = (...args) => {
    sent.push(args);
    throw new Error('a unit test made a network call');
  };

  try {
    const out = await approveDraft('msg-0101');
    assert.equal(out.status, 'approved');
    assert.equal(out.draftId, 'msg-0101', 'the approval is reported against a different draft than the one pressed');
    assert.deepEqual(sent, [], 'the mock approval reached the network');

    for (const bad of ['', '   ', null, undefined, 42, {}]) {
      await assert.rejects(() => approveDraft(bad), `approveDraft(${JSON.stringify(bad)}) was not refused`);
    }
    assert.deepEqual(sent, [], 'an approval with no draft id was sent anyway');
  } finally {
    globalThis.fetch = real;
  }
});

test('req 6.3 — a failed approval is said once, never retried, and the draft stays put', () => {
  // The same rule as a failed voice note (requirement 3.6) on the one surface where the stake is a
  // parent reading something: a teacher who is told nothing was sent and can still see the draft
  // waiting knows where they stand. A silent second attempt tells them nothing.
  const approve = JS.slice(JS.indexOf('async function approveParentDraft'), JS.indexOf('7. Audit log'));
  assert.ok(approve.length > 100, 'approveParentDraft() is no longer where this test looks');

  assert.ok(!/for \(|while \(|retry|setTimeout/.test(approve), 'the approval path loops or retries');
  assert.equal((approve.match(/approveDraft\(/g) ?? []).length, 1, 'the approval endpoint is called more than once');
  assert.match(approve, /state\.draftsStatusKey = 'drafts\.approve_error'/, 'a failed approval says nothing');
  // The draft only leaves the list after the await returned, so a failure leaves it on screen.
  assert.ok(approve.indexOf('await approveDraft') < approve.indexOf('state.drafts = '),
    'the draft is dropped from the list before the approval has come back');
  assert.ok(approve.indexOf('state.drafts = ') < approve.indexOf('} catch'),
    'the draft is dropped from the list on the failure path too');

  const en = packs.en['drafts.approve_error'].toLowerCase();
  assert.ok(en.includes('nothing was sent'), 'drafts.approve_error does not say nothing was sent');
  for (const lang of LANGS) {
    assert.equal(typeof packs[lang]['drafts.approve_error'], 'string', `drafts.approve_error missing from ${lang}.json`);
  }
});

test('req 12.4 — the approve button keeps focus while it works, and a second press does nothing', () => {
  // Same rule as the mic and the send button: `disabled` on the control the teacher has just
  // pressed hands focus to <body> for the whole round-trip. And the guard has to be real, because
  // aria-disabled does not stop a click: two presses on one draft would be two approvals.
  assert.ok(!/button\.disabled\s*=/.test(JS), 'teacher.js disables the approve button');
  assert.match(JS, /button\.setAttribute\('aria-disabled'/, 'the approve button never says it is busy');
  assert.match(JS, /if \(state\.approving\) return;/, 'a second press while an approval is open is not ignored');
  assert.match(JS, /if \(state\.approving \|\| !draftId\) return;/,
    'approveParentDraft() has no guard of its own, so the rule lives only in the click handler');
});

test('2.5.3 — the approve button\'s accessible name starts with the words on it, in all three languages', () => {
  // Eight identical "Approve and send" buttons are told apart by the student the draft is about.
  // The name has to CONTAIN the visible words, or a voice-control user saying what the button says
  // matches nothing — so the two keys are a pair, exactly as redteam.reply.show/show_case are.
  assert.match(JS, /setAttribute\('aria-label', t\('drafts\.approve_case'/, 'the approve button has no accessible name');
  assert.match(JS, /setText\(button, t\('drafts\.approve'\)\)/, 'the approve button carries no visible words');

  for (const lang of LANGS) {
    const label = packs[lang]['drafts.approve'];
    const name = packs[lang]['drafts.approve_case'];
    assert.ok(label && name, `${lang}.json is missing drafts.approve or drafts.approve_case`);
    assert.ok(name.startsWith(label),
      `${lang}: drafts.approve_case ("${name}") does not start with the visible label ("${label}")`);
    assert.ok(name.includes('{id}'), `${lang}: drafts.approve_case carries no {id} to tell two buttons apart`);
  }
});

test('req 6.2 — the drafts list is rendered in the server\'s order, unsorted and unfiltered', () => {
  // `GET /teacher/drafts` reads only the partitions of this teacher's own classes and returns them
  // newest-first. A sort or a filter here would be a weaker second copy of the rule that actually
  // scopes this list — and a page that filtered would imply it was the one doing the scoping.
  const render = JS.slice(JS.indexOf('function renderDrafts'), JS.indexOf('function renderDrafts') + 600);
  assert.ok(!/\.sort\(|\.filter\(|\.reverse\(/.test(render), 'renderDrafts() re-orders or filters the drafts');
  assert.ok(packs.en['drafts.intro'].length > 40, 'sanity: drafts.intro is the sentence checked above');
});

/* --- the mock, and the one swap point it hides behind ----------------------------------------- */

test('the real call is the implementation and the mock is the fallback, chosen by one value', () => {
  // This used to assert the opposite — that every call was a stand-in and `fetch(` appeared
  // nowhere — because taking the swap point was a hand edit at deploy time. It is a paste now:
  // `configured()` in auth.js is false until the four stack outputs are in `CONFIG`, and that one
  // value picks the mock. What is still worth pinning is that there is exactly ONE such value, so
  // the swap cannot be half-taken and leave this screen mixing live calls with demo data.
  assert.equal((JS.match(/SWAP POINT/g) ?? []).length, 1, 'teacher.js has no single SWAP POINT marker');
  assert.ok(JS.indexOf('const MOCK') > JS.indexOf('SWAP POINT'), 'MOCK is not under the SWAP POINT');

  for (const fn of ['loadAudit', 'loadDrafts', 'approveDraft', 'voiceUploadUrl', 'putAudio', 'voiceTranscript']) {
    assert.ok(JS.includes(`function ${fn}`), `${fn}() is missing from the data surface`);
  }

  const code = JS.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(code.match(/^const MOCKING = .*$/gm), ['const MOCKING = !configured();'],
    'the mock is switched by something other than the one `configured()` check, or by two things');
  assert.ok(/fetch\(/.test(code), 'teacher.js makes no request at all; the swap point is not taken');

  // Every mock answer sits behind that value, so a configured page cannot serve one — with the one
  // exception the ledger note explains, which has no endpoint to call and says so.
  const mockBranches = (code.match(/if \(MOCKING\)/g) ?? []).length;
  assert.equal(mockBranches, 7, 'a mock answer is reachable with CONFIG real, or a real call is unreachable');
  assert.match(code, /export async function loadLedger\(\) \{\s*await sleep/,
    'loadLedger() is the documented exception: if it is real now, this test and its note are stale');

  // The mock's audit entries carry the real field names, so the renderer is exercised by the shape
  // it will really be handed — and no real person's name (requirement 13.7).
  for (const field of ['actorSub', 'actorRole', 'targetId', 'deleted', 'removed']) {
    assert.ok(JS.includes(field), `the mock audit entries have no ${field}`);
  }
  assert.ok(JS.includes("action: 'deleteStudent'"), 'the mock has no deletion entry to show');
});
