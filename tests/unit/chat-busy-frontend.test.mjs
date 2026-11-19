// The teacher chat has two ways in — a typed line and a voice transcript — and one `state.sending`
// flag between them. The busy guard used to sit only in the form's submit handler, so a voice note
// landing while a typed send was still open started a second round trip on the same flag, and the
// first to finish cleared it: the send button went live mid-request and the two replies raced into
// the log in whatever order they returned.
//
// Source-text checks, like tests/unit/a11y.test.mjs and tests/unit/audit-mic-frontend.test.mjs,
// because teacher.js runs in a browser and there is no DOM here: what these pin is where the guard
// lives, which is the whole defect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('a transcript refused because a send is open is kept, not dropped and not queued behind it', () => {
  const send = slice('async function sendTranscript', '9. Wiring');

  assert.match(send, /submitMessage\(transcript\)/, 'the transcript must still go through the one path');
  assert.match(send, /if \(await submitMessage\(transcript\)\) return;/,
    'sendTranscript ignores whether the send was accepted');
  assert.match(send, /dom\.input\.value =/,
    'a refused transcript is thrown away; it belongs in the typed box where the teacher can see it');
  assert.match(send, /dom\.input\.focus\(\)/, 'the cursor is not put where the words landed');
});
