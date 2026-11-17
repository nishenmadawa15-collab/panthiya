// Offline tests for the voice lane — the presigned upload, the Transcribe job, the transcript's
// trip into `POST /chat`, and the honest fallback when none of that works.
//
// Two things are under test throughout, and they are the two things a voice note can get wrong:
//
//   1. A presigned PUT is a capability. The key, the job name and the language are server-decided,
//      and a client-supplied key or job name is re-derived against the caller's own sub before it
//      reaches S3 or Transcribe.
//   2. A failed, empty or unsupported transcription is never presented as a success, and writes
//      nothing — requirement 3.6. Every failure path is asserted on the *absence* of a transcript
//      as well as on the message.
//
// S3, Transcribe and the chat call all arrive as injected fakes, so there is no AWS, no network and
// no credential here. The fakes record their calls, so "no job was started" is itself assertable.
//
// Each test names the requirement it pins down.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler } from '../../backend/functions/voice/index.mjs';
import { uploadUrl, transcript, LANGUAGES, MAX_AUDIO_BYTES }
  from '../../backend/functions/voice/voice.mjs';
import { handleChat } from '../../backend/functions/chat/orchestrate.mjs';

// --- fixtures ----------------------------------------------------------------------------------

const TEACHER = '11111111-2222-3333-4444-555555555555';
const OTHER_TEACHER = '99999999-8888-7777-6666-555555555555';

/** An HTTP API v2 event with claims the JWT authorizer has already verified. */
function event(routeKey, { sub = TEACHER, role = 'teacher', body } = {}) {
  return {
    routeKey,
    requestContext: { authorizer: { jwt: { claims: { sub, 'cognito:groups': [role] } } } },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/**
 * Fake S3 + Transcribe. `job` seeds what a poll will see; every call is recorded so a test can
 * assert that nothing was started, read or fetched.
 */
function fakeDeps({ job, startError, transcriptText } = {}) {
  const calls = { presigned: [], started: [], polled: [], fetched: [] };

  return {
    calls,
    bucket: 'voice-bucket',
    presignPut: async (params) => {
      calls.presigned.push(params);
      return `https://voice-bucket.s3.example/${params.key}?X-Amz-Expires=${params.expiresIn}`;
    },
    startTranscription: async (params) => {
      calls.started.push(params);
      if (startError) throw startError;
    },
    getTranscription: async (params) => {
      calls.polled.push(params);
      return job ?? { status: 'IN_PROGRESS' };
    },
    fetchTranscript: async (uri) => {
      calls.fetched.push(uri);
      return transcriptText ?? '';
    },
  };
}

const parsed = (response) => JSON.parse(response.body);

// --- who may record ----------------------------------------------------------------------------

test('req 3.5: a non-teacher session gets no presigned upload URL', async () => {
  const deps = fakeDeps();

  // `null` is a token with no recognised group claim at all, which is also not a teacher.
  for (const role of ['parent', 'student', 'admin', null]) {
    const response = await handler(event('POST /voice/upload-url', { role, body: { bytes: 4096 } }), deps);

    assert.equal(response.statusCode, 403, `role ${role} was not refused`);
    assert.equal(parsed(response).error, 'denied');
  }

  // The refusal is the first statement, so nothing was signed for any of them.
  assert.deepEqual(deps.calls.presigned, []);
});

test('req 3.5: a non-teacher session cannot start or collect a transcription', async () => {
  const deps = fakeDeps({ job: { status: 'COMPLETED', transcriptUri: 'https://x/y.json' } });

  const response = await handler(
    event('POST /voice/transcript', { role: 'parent', body: { key: `voice/${TEACHER}/x.webm`, lang: 'si' } }),
    deps,
  );

  assert.equal(response.statusCode, 403);
  assert.deepEqual(deps.calls.started, []);
  assert.deepEqual(deps.calls.polled, []);
});

// --- the key is the server's, not the client's -------------------------------------------------

test('req 3.5: the S3 key is server-decided and scoped to the calling teacher', async () => {
  const deps = fakeDeps();

  const { body } = await uploadUrl(event('POST /voice/upload-url', {
    // Everything a client could try to choose. All of it is ignored.
    body: { bytes: 4096, key: '../../etc/passwd', filename: 'notes.exe', contentType: 'text/html' },
  }), deps);

  assert.match(body.key, new RegExp(`^voice/${TEACHER}/[0-9a-f-]{36}\\.webm$`));
  assert.equal(body.contentType, 'audio/webm');
  assert.equal(deps.calls.presigned.length, 1);
  assert.equal(deps.calls.presigned[0].key, body.key);
  assert.equal(deps.calls.presigned[0].bytes, 4096);     // the URL is good for this many bytes only
  assert.ok(deps.calls.presigned[0].expiresIn <= 300);   // and for minutes, not hours
});

test('req 3.5: an oversized or unmeasured recording is refused before anything is signed', async () => {
  const deps = fakeDeps();

  for (const body of [{}, { bytes: 0 }, { bytes: 'lots' }, { bytes: MAX_AUDIO_BYTES + 1 }, { bytes: 4096, format: 'exe' }]) {
    const response = await handler(event('POST /voice/upload-url', { body }), deps);
    assert.equal(response.statusCode, 400, `${JSON.stringify(body)} was accepted`);
  }

  assert.deepEqual(deps.calls.presigned, []);
});

test('req 3.5: a client-supplied key cannot escape the caller\'s own prefix', async () => {
  const deps = fakeDeps();

  const hostile = [
    `voice/${OTHER_TEACHER}/11111111-1111-1111-1111-111111111111.webm`,  // another teacher's note
    `voice/${TEACHER}/../${OTHER_TEACHER}/11111111-1111-1111-1111-111111111111.webm`,
    `voice/${TEACHER}/11111111-1111-1111-1111-111111111111.webm/../../secret.wav`,
    `voice/${TEACHER}/11111111-1111-1111-1111-111111111111.exe`,         // outside the format allowlist
    `voice/${TEACHER}/notes.webm`,                                        // not a uuid we issued
    'secrets/credentials.json',                                           // outside voice/ entirely
    `s3://other-bucket/voice/${TEACHER}/11111111-1111-1111-1111-111111111111.webm`,
    undefined,
  ];

  for (const key of hostile) {
    const response = await handler(event('POST /voice/transcript', { body: { key, lang: 'en' } }), deps);
    assert.equal(response.statusCode, 400, `key ${key} was accepted`);
    assert.equal(parsed(response).reason, 'key_invalid');
  }

  assert.deepEqual(deps.calls.started, []);
});

test('req 3.5: a client-supplied job name cannot escape the server-chosen prefix', async () => {
  const deps = fakeDeps({ job: { status: 'COMPLETED', transcriptUri: 'https://x/y.json' } });

  const hostile = [
    'their-job-name',                                                   // no prefix at all
    `panthiya-${OTHER_TEACHER}-11111111-1111-1111-1111-111111111111`,   // another teacher's job
    'panthiya-11111111-1111-1111-1111-111111111111',                    // prefix, but no owner
    `panthiya-${TEACHER}-../${OTHER_TEACHER}-11111111-1111-1111-1111-111111111111`,
    `panthiya-${TEACHER}-not-a-uuid`,
    42,
  ];

  for (const jobName of hostile) {
    const response = await handler(event('POST /voice/transcript', { body: { jobName, lang: 'en' } }), deps);
    assert.equal(response.statusCode, 400, `job name ${jobName} was accepted`);
    assert.equal(parsed(response).reason, 'job_invalid');
  }

  assert.deepEqual(deps.calls.polled, []);   // no transcript of anyone else's was ever read
});

test('req 3.5: a teacher\'s own job name is accepted and polled', async () => {
  const deps = fakeDeps({ job: { status: 'IN_PROGRESS' } });

  const started = await transcript(event('POST /voice/transcript', {
    body: { key: `voice/${TEACHER}/11111111-1111-1111-1111-111111111111.webm`, lang: 'si' },
  }), deps);

  assert.equal(started.body.status, 'in_progress');
  assert.match(started.body.jobName, new RegExp(`^panthiya-${TEACHER}-[0-9a-f-]{36}$`));
  assert.deepEqual(deps.calls.started[0].languageCode, 'si-LK');
  assert.equal(deps.calls.started[0].mediaUri,
    `s3://voice-bucket/voice/${TEACHER}/11111111-1111-1111-1111-111111111111.webm`);
  assert.equal(deps.calls.started[0].mediaFormat, 'webm');

  const polled = await transcript(event('POST /voice/transcript', {
    body: { jobName: started.body.jobName, lang: 'si' },
  }), deps);

  assert.equal(polled.body.status, 'in_progress');
  assert.equal(deps.calls.polled[0].jobName, started.body.jobName);
  assert.equal(deps.calls.started.length, 1);   // a poll does not start a second job
});

// --- the honest fallback (requirement 3.6) -----------------------------------------------------

test('req 3.6: an unsupported spoken language is said plainly and starts no job', async () => {
  const deps = fakeDeps();

  // A UI language with no Transcribe code — the same path as setting `si: null` in LANGUAGES.
  const { status, body } = await transcript(event('POST /voice/transcript', {
    body: { key: `voice/${TEACHER}/11111111-1111-1111-1111-111111111111.webm`, lang: 'fr' },
  }), deps);

  assert.equal(status, 200);                      // the teacher must read this, so it is not an error
  assert.equal(body.status, 'failed');
  assert.equal(body.reason, 'unsupported_language');
  assert.ok(body.message.length > 0);
  assert.equal(body.transcript, undefined);       // nothing was guessed at
  assert.deepEqual(deps.calls.started, []);       // and nothing was written or spent
});

test('req 3.6: the fallback is localised, and never a different language model', async () => {
  const deps = fakeDeps({ startError: new Error('BadRequestException: unsupported language code si-LK') });

  const messages = new Map();
  for (const lang of ['si', 'ta', 'en']) {
    const { body } = await transcript(event('POST /voice/transcript', {
      body: { key: `voice/${TEACHER}/11111111-1111-1111-1111-111111111111.webm`, lang },
    }), deps);

    assert.equal(body.reason, 'unsupported_language');
    assert.equal(body.transcript, undefined);
    messages.set(lang, body.message);
  }

  // Three distinct strings: a Sinhala-speaking teacher is not told in English that Sinhala failed.
  assert.equal(new Set(messages.values()).size, 3);

  // Transcribe refused `si-LK`; nothing retried it as `en-IN`. One attempt per request, no more.
  assert.equal(deps.calls.started.length, 3);
  assert.deepEqual([...new Set(deps.calls.started.map((c) => c.languageCode))].sort(), ['en-IN', 'si-LK', 'ta-IN']);
});

test('req 3.6: a failed job is reported as failed, not as an empty transcript', async () => {
  const deps = fakeDeps({ job: { status: 'FAILED', failureReason: 'The media format is not valid' } });

  const { status, body } = await transcript(event('POST /voice/transcript', {
    body: { jobName: `panthiya-${TEACHER}-11111111-1111-1111-1111-111111111111`, lang: 'si' },
  }), deps);

  assert.equal(status, 200);
  assert.equal(body.status, 'failed');
  assert.equal(body.reason, 'transcribe_failed');
  assert.equal(body.transcript, undefined);
  assert.deepEqual(deps.calls.fetched, []);     // no transcript was fetched for a failed job
});

test('req 3.6: a failure that names the language reads as a language failure', async () => {
  const deps = fakeDeps({ job: { status: 'FAILED', failureReason: 'Unsupported language code' } });

  const { body } = await transcript(event('POST /voice/transcript', {
    body: { jobName: `panthiya-${TEACHER}-11111111-1111-1111-1111-111111111111`, lang: 'ta' },
  }), deps);

  assert.equal(body.reason, 'unsupported_language');
});

test('req 3.6: a completed job with no speech in it is not a success', async () => {
  for (const text of ['', '   ', '\n\t ', null]) {
    const deps = fakeDeps({
      job: { status: 'COMPLETED', transcriptUri: 'https://transcribe.example/out.json' },
      transcriptText: text,
    });

    const { body } = await transcript(event('POST /voice/transcript', {
      body: { jobName: `panthiya-${TEACHER}-11111111-1111-1111-1111-111111111111`, lang: 'si' },
    }), deps);

    assert.equal(body.status, 'failed', `transcript ${JSON.stringify(text)} was accepted`);
    assert.equal(body.reason, 'no_speech');
    assert.equal(body.transcript, undefined);
  }
});

test('req 3.6: an unknown job state is a stated failure, not an endless wait', async () => {
  const deps = fakeDeps({ job: { status: 'SOMETHING_NEW' } });

  const { body } = await transcript(event('POST /voice/transcript', {
    body: { jobName: `panthiya-${TEACHER}-11111111-1111-1111-1111-111111111111`, lang: 'en' },
  }), deps);

  assert.equal(body.status, 'failed');
  assert.equal(body.reason, 'transcribe_failed');
});

// --- the transcript's trip into the chat path --------------------------------------------------

test('req 3.5: a successful transcript reaches POST /chat unchanged', async () => {
  const spoken = 'කසුන් සහ දිල්මි අද පන්තියට ආවේ නැහැ. නිමල් නොවැම්බර් මාසයට 2500 ගෙවා ඇත.';

  const deps = fakeDeps({
    job: { status: 'COMPLETED', transcriptUri: 'https://transcribe.example/out.json' },
    // Trailing whitespace from the transcript file is trimmed; nothing else is touched.
    transcriptText: `  ${spoken}  `,
  });

  const { body } = await transcript(event('POST /voice/transcript', {
    body: { jobName: `panthiya-${TEACHER}-11111111-1111-1111-1111-111111111111`, lang: 'si' },
  }), deps);

  assert.equal(body.status, 'done');
  assert.equal(body.transcript, spoken);
  assert.equal(body.lang, 'si');

  // And now the real chat orchestrator, with the transcript as the message the browser would send.
  // No voice-specific branch exists in that path: a voice note is a chat turn, so it gets the
  // agent, the session attributes and policyCheck exactly as typed text does.
  const seen = [];
  const chat = await handleChat({
    claims: { sub: TEACHER, role: 'teacher' },
    body: { message: body.transcript, lang: body.lang },
    deps: {
      invokeAgent: async (args) => { seen.push(args); return 'Noted: two absences and one fee.'; },
      policyCheck: async () => ({ verdict: 'allow' }),
      today: '2026-11-17',
      sessionId: `${TEACHER}-2026-11-17`,
    },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].inputText, spoken);                  // unchanged, character for character
  assert.equal(seen[0].sessionAttributes.role, 'teacher');  // identity still from the claims
  assert.equal(seen[0].sessionAttributes.sub, TEACHER);
  assert.equal(seen[0].sessionAttributes.lang, 'si');
  assert.equal(chat.status, 200);
  assert.equal(chat.body.reply, 'Noted: two absences and one fee.');
});

test('req 3.6: a fallback carries no text that could be sent to /chat as a message', async () => {
  const deps = fakeDeps({ job: { status: 'FAILED', failureReason: 'whatever' } });

  const { body } = await transcript(event('POST /voice/transcript', {
    body: { jobName: `panthiya-${TEACHER}-11111111-1111-1111-1111-111111111111`, lang: 'en' },
  }), deps);

  // The front-end sends `transcript`, and there is none. The honest message lives in `message`,
  // which is for the teacher to read — so a failure cannot become a chat turn by accident.
  assert.equal(body.transcript, undefined);
  assert.ok(body.message);
});

// --- wiring ------------------------------------------------------------------------------------

test('design §5: the function serves the two voice routes and nothing else', async () => {
  const deps = fakeDeps();

  for (const routeKey of ['GET /voice/upload-url', 'POST /chat', 'POST /voice/', '']) {
    const response = await handler({ ...event(routeKey), routeKey }, deps);
    assert.equal(response.statusCode, 404, `${routeKey} was served`);
  }
});

test('req 3.6: every UI language is either transcribable or honestly unsupported', () => {
  // The three UI languages of requirement 12.2. A `null` here is a supported state, not a gap:
  // it produces the fallback. What must never happen is a UI language silently mapped to another
  // language's model, so each entry is either absent/null or a code for that same language.
  const expected = { si: /^si-/, ta: /^ta-/, en: /^en-/ };

  for (const [lang, pattern] of Object.entries(expected)) {
    const code = LANGUAGES[lang];
    if (code) assert.match(code, pattern, `${lang} maps to ${code}, which is a different language`);
  }
});
