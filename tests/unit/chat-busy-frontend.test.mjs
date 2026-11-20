// The teacher chat has two ways in — a typed line and a voice transcript — and one `state.sending`
// flag between them. The busy guard used to sit only in the form's submit handler, so a voice note
// landing while a typed send was still open started a second round trip on the same flag, and the
// first to finish cleared it: the send button went live mid-request and the two replies raced into
// the log in whatever order they returned.
//
// The second half of the same defect took another lane to find: the transcript could no longer race
// a send, but the microphone could still be *started* during one. `micBlocked()` is that guard and
// the corpus below is phase × sending, because the phases are exactly what the old guard looked at
// and `state.sending` is the thing it could not see.
//
// Part pure function, part source text: `micBlocked()` is importable and is tested by its inputs,
// and where the guard *lives* is tested by reading the file — teacher.js runs in a browser and
// there is no DOM here, and "which function holds the rule" is the whole of this defect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { micBlocked, micView } from '../../frontend/assets/teacher.js';

const JS = readFileSync(new URL('../../frontend/assets/teacher.js', import.meta.url), 'utf8');

/** One function's body, by the name of the next thing in the file. */
function slice(from, to) {
  const start = JS.indexOf(from);
  const end = JS.indexOf(to, start);
  assert.ok(start > 0 && end > start, `could not find ${from} .. ${to} in teacher.js`);
  return JS.slice(start, end);
}

test('the busy guard is in submitMessage, where both send paths meet', () => {
  const submit = slice('async function submitMessage', '6. Fee ledger');

  assert.match(submit, /if \(state\.sending\) return false;/,
    'submitMessage does not refuse a send while one is already open, so the voice-transcript path '
    + 'can run a second round trip on the same state.sending');
  // Before the push, or the refused message is already in the log.
  assert.ok(submit.indexOf('state.sending') < submit.indexOf('state.messages.push'),
    'the guard runs after the message has been appended to the log');
  assert.match(submit, /\n  return true;\n\}/, 'submitMessage does not report that it sent');

  // The handler guard stays where it is: an aria-disabled button is still clickable (req 12.4).
  const handler = slice("dom.form.addEventListener('submit'", 'One click handler');
  assert.match(handler, /if \(state\.sending\) return;/, 'the submit handler lost its own guard');
});

/* ---------------------------------------------------------------------------------------------
   The other half of the same defect: the mic could still be STARTED during an open typed send.

   `submitMessage()` refusing a second send fixed the race, but not the thing a teacher does: press
   send, see nothing happen for two seconds, reach for the microphone. The recording ran, the
   upload and the Transcribe job ran, and the transcript came back to a `submitMessage()` that was
   by then free or not — and when it was not, the words went into the typed box. A recording made
   to avoid typing, handed back to be typed.

   The corpus is every phase × sending, because the phases are exactly where the old guard looked
   and `sending` is the one it could not see.
   --------------------------------------------------------------------------------------------- */

test('the mic cannot be started during an open typed send, in any phase', () => {
  const phases = ['idle', 'recording', 'uploading', 'transcribing', 'nonsense', undefined];
  const blocked = Object.fromEntries(phases.map((phase) => [
    String(phase),
    { quiet: micBlocked(phase, false), sending: micBlocked(phase, true) },
  ]));

  // An open send blocks a start from every phase a start is possible from. This is the defect.
  assert.equal(blocked.idle.sending, true, 'the mic can still be started while a typed send is open');
  assert.equal(blocked.nonsense.sending, true, 'an unrecognised phase is a start, so it is blocked too');
  assert.equal(blocked.undefined.sending, true, 'a missing phase falls back to idle, which an open send blocks');

  // Nothing that already worked is weakened: the two busy phases stay blocked either way.
  for (const phase of ['uploading', 'transcribing']) {
    assert.equal(blocked[phase].quiet, true, `${phase} is no longer busy; a second recording can start mid-upload`);
    assert.equal(blocked[phase].sending, true, `${phase} with a send open is not blocked`);
  }

  // And a recording in progress is never blocked, in either direction. A teacher who presses send
  // while recording must still be able to press stop, or the microphone stays live until a reload.
  assert.equal(blocked.recording.quiet, false, 'a recording cannot be stopped');
  assert.equal(blocked.recording.sending, false,
    'pressing send while recording takes away the stop button, leaving the mic live');

  // Idle and quiet is the whole point of the button existing.
  assert.equal(blocked.idle.quiet, false, 'the mic can never be started at all');

  // `busy` keeps meaning what MIC says it means: micBlocked() adds the send, it does not redefine
  // the phases, so the label and aria-pressed tables are untouched.
  assert.equal(micView('recording').busy, false);
  assert.equal(micView('uploading').busy, true);
});

test('the guard is at the one door into the recorder, and the button says the same thing', () => {
  // Root cause, not symptom: in startRecording(), so a second caller cannot forget it.
  const start = slice('async function startRecording', 'function stopRecording');
  assert.match(start, /if \(micBlocked\(state\.mic\.phase, state\.sending\)\) return;/,
    'startRecording() does not refuse a start while a send is open; a guard in the click handler '
    + 'alone leaves the next caller — a shortcut key, a retry link — to remember the rule');
  assert.ok(start.indexOf('micBlocked') < start.indexOf('getUserMedia'),
    'the guard runs after the microphone permission prompt, so the teacher is asked for nothing');

  // The rendered state reads the same predicate, so the button cannot look available for a press
  // it will ignore. `aria-disabled`, never `disabled` — requirement 12.4, pinned in a11y.test.mjs.
  const render = slice('function renderMic', 'function setMicPhase');
  assert.match(render, /aria-disabled', String\(micBlocked\(state\.mic\.phase, state\.sending\)\)/,
    'the mic button does not show the open send, so it looks available while it is not');
  assert.match(render, /aria-pressed/, 'the recording state no longer reaches a screen reader');
  assert.match(render, /classList\.toggle\('mic-live'/, 'the recording state is no longer visible');

  // And `state.sending` moving has to redraw the button, or the attribute is right only by luck.
  // Comments out, code in: the comment above those calls names renderMic() to explain why it is
  // there, and counting prose would pass on the explanation alone.
  const submit = slice('async function submitMessage', '6. Fee ledger').replace(/\/\/.*$/gm, '');
  assert.equal((submit.match(/renderMic\(\)/g) ?? []).length, 2,
    'submitMessage() does not redraw the mic at both ends of the send, so the button shows the '
    + 'open send only by luck');
});

test('a transcript refused because a send is open is kept, not dropped and not queued behind it', () => {
  const send = slice('async function sendTranscript', '9. Wiring');

  assert.match(send, /submitMessage\(transcript\)/, 'the transcript must still go through the one path');
  assert.match(send, /if \(await submitMessage\(transcript\)\) return;/,
    'sendTranscript ignores whether the send was accepted');
  assert.match(send, /dom\.input\.value =/,
    'a refused transcript is thrown away; it belongs in the typed box where the teacher can see it');
  assert.match(send, /dom\.input\.focus\(\)/, 'the cursor is not put where the words landed');
});
