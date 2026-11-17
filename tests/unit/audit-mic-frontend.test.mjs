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
//   as a message that was sent (requirement 12.4, 3.6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { auditLines, tombstone, micView, transcriptFailure } from '../../frontend/assets/teacher.js';

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

test('req 10.4 — no write verb anywhere in the teacher script', () => {
  // There is no API to call, so the absence is checked rather than described. `loadAudit()` is a
  // read, and this page has no other business with the log.
  const code = JS.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const verb of ['DELETE', 'PATCH', 'PUT']) {
    assert.ok(!new RegExp(`method:\\s*['"\`]${verb}`, 'i').test(code),
      `teacher.js issues a ${verb}; the audit log has no such API`);
  }
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

/* --- the mock, and the one swap point it hides behind ----------------------------------------- */

test('both screens run on one clearly-marked mock, with a single SWAP POINT', () => {
  // Nothing is deployed, so every call this page makes is a stand-in. One marker, so taking it out
  // is one edit and cannot be half-done (the same discipline as redteam.js and student.js).
  assert.equal((JS.match(/SWAP POINT/g) ?? []).length, 1, 'teacher.js has no single SWAP POINT marker');
  assert.ok(JS.indexOf('const MOCK') > JS.indexOf('SWAP POINT'), 'MOCK is not under the SWAP POINT');

  for (const fn of ['loadAudit', 'voiceUploadUrl', 'putAudio', 'voiceTranscript']) {
    assert.ok(JS.includes(`function ${fn}`), `${fn}() is missing from the data surface`);
  }
  // Comments stripped first: the SWAP POINT comment spells out the fetch() calls that replace the
  // mock, which is a description of one and not a use of one.
  const code = JS.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/fetch\(/.test(code), 'teacher.js already calls fetch(); the SWAP POINT comment is now stale');

  // The mock's audit entries carry the real field names, so the renderer is exercised by the shape
  // it will really be handed — and no real person's name (requirement 13.7).
  for (const field of ['actorSub', 'actorRole', 'targetId', 'deleted', 'removed']) {
    assert.ok(JS.includes(field), `the mock audit entries have no ${field}`);
  }
  assert.ok(JS.includes("action: 'deleteStudent'"), 'the mock has no deletion entry to show');
});
