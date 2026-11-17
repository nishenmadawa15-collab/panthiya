// The two steps of a voice note, and an honest answer for every way they can fail.
//
// Requirements 3.5 and 3.6. A tuition teacher records attendance and fees by talking on the bus
// home, in Sinhala, Tamil, English or Singlish. The fallback matters as much as the happy path: a
// teacher told "done" when nothing was transcribed is worse off than one told plainly that it did
// not work, so **no path in this file can turn a failed or empty transcription into a success.**
//
// Same design §3.2 order as every other handler, with `claimsFromEvent` because these arrive over
// HTTP where the JWT authorizer has already verified the token (requirement 1.2):
//
//   const { role, sub } = claimsFromEvent(event);   never the body, the query string or a header
//   requireRole(role, 'teacher');                   first statement after reading the claims
//   const owner = keySafeSub(sub);                  the caller's own sub, the only name we build on
//
// There is no `resolveScope` here because this function reads and writes no student data at all —
// `template.yaml` gives it no table permissions, so requirement 3.5 is bounded by IAM as well as
// by code. The transcript re-enters the system the ordinary way: the browser posts it to
// `POST /chat` as `message`, which runs the full agent path including policyCheck. Nothing here
// bypasses that.
//
// **A presigned PUT is a capability, so three things are server-decided and never taken from the
// client:** the S3 key, the Transcribe job name and the language code.
//
//   - key       `voice/<caller sub>/<uuid>.<format>`. A client-supplied key is checked against
//               that exact shape, with the caller's own sub, before it reaches Transcribe — so a
//               teacher can neither write to nor transcribe anything under another teacher's
//               prefix, and cannot name an object outside `voice/` at all (the IAM policy is
//               scoped to `voice/*`, and this is the half of the check IAM cannot make).
//   - job name  `panthiya-<caller sub>-<uuid>`. The `panthiya-` prefix is what the Transcribe IAM
//               policy is scoped to (design §4.0); the sub segment is what stops a poll for
//               someone else's job from returning their transcript.
//   - language  from the UI language only, via `LANGUAGES` below. Never auto-detected: requirement
//               3.6 forbids silently substituting a different language model, and a Sinhala note
//               transcribed as English is exactly the silent corruption that would produce.
//
// A client-supplied filename, content type or job name is untrusted input and is used for nothing
// but a 400.

import { randomUUID } from 'node:crypto';
import { claimsFromEvent, requireRole, DenyError } from '../../lib/auth.mjs';

/** Every refusal a malformed request can produce. Closed set, like `ReadError` in `read/`. */
const VOICE_CODES = new Set([
  'bad_request', 'bytes_required', 'bytes_too_large', 'format_unsupported', 'key_invalid', 'job_invalid',
]);

/** Thrown for a malformed request. Carries a code, never the client's own text. */
export class VoiceError extends Error {
  constructor(code = 'bad_request') {
    const safe = VOICE_CODES.has(code) ? code : 'bad_request';
    super(`bad request: ${safe}`);
    this.name = 'VoiceError';
    this.code = safe;
  }
}

/** design §5: audio ≤ 1 MB. A voice note is seconds long; anything larger is a mistake or abuse. */
export const MAX_AUDIO_BYTES = 1024 * 1024;

/** Short on purpose. The URL is a write capability, and the recording is already in hand. */
export const URL_TTL_SECONDS = 120;

const KEY_PREFIX = 'voice/';     // the only prefix the IAM policy allows, and the lifecycle rule targets
const JOB_PREFIX = 'panthiya-';  // design §4.0: the Transcribe IAM policy is scoped to this prefix

/**
 * Container formats a browser recorder actually produces, mapped to the content type we hand back.
 * Doubles as the allowlist for the extension in a client-supplied key, and Transcribe's
 * `MediaFormat` is this same token — one table, so the three can never disagree.
 */
const FORMATS = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  wav: 'audio/wav',
};
const DEFAULT_FORMAT = 'webm';   // what MediaRecorder gives on Android Chrome, which is the demo phone

/**
 * UI language → Amazon Transcribe language code. The whole of requirement 3.6 turns on this table.
 *
 * `en-IN` rather than `en-US` because the English spoken in a Sri Lankan classroom, numbers and
 * names included, is far closer to it.
 *
 * **If a language is not supported, set it to `null` here.** That single edit makes the honest
 * fallback appear with no other change, and no job (and no cost) is incurred. A UI language that is
 * absent from this table behaves the same way, which is why an unknown `lang` is answered honestly
 * instead of being quietly defaulted to English.
 *
 * ponytail: whether Transcribe batch accepts `si-LK` has not been verified against the live API —
 * nothing in this project has met AWS yet. The code does not depend on the answer: a rejection at
 * `StartTranscriptionJob` lands on the same fallback as a `null` here. Verify it on the first live
 * run and set `si: null` if it is refused.
 */
export const LANGUAGES = {
  si: 'si-LK',
  ta: 'ta-IN',
  en: 'en-IN',
};

/**
 * The honest fallback of requirement 3.6, in the three UI languages.
 *
 * Every one of these says the same three things: it did not work, nothing was saved, please type it
 * instead. None of them guesses at what was said, and none is ever shown next to a transcript.
 *
 * NEEDS NATIVE-SPEAKER REVIEW — the Sinhala and Tamil wording below was not written by a native
 * speaker. The keys match `voice.<reason>` so `frontend/i18n/{si,ta,en}.json` (task 6.5) can hold
 * the reviewed wording; the front-end should prefer its own string and treat these as the
 * API-level fallback for a key it does not have yet.
 */
const FALLBACK = {
  unsupported_language: {
    en: 'Panthiya cannot understand this language by voice yet. Nothing was saved — please type it instead.',
    si: 'පන්තියට තවම මේ භාෂාව කථාවෙන් තේරුම් ගත නොහැක. කිසිවක් සුරැකුණේ නැත — කරුණාකර එය ලියන්න.',
    ta: 'பந்தியா இந்த மொழியை இன்னும் பேச்சாகப் புரிந்துகொள்ள முடியாது. எதுவும் சேமிக்கப்படவில்லை — தயவுசெய்து தட்டச்சு செய்யுங்கள்.',
  },
  no_speech: {
    en: 'No speech was found in that recording. Nothing was saved — please try again or type it instead.',
    si: 'එම පටිගත කිරීමේ කථාවක් හමු නොවීය. කිසිවක් සුරැකුණේ නැත — නැවත උත්සාහ කරන්න හෝ එය ලියන්න.',
    ta: 'அந்தப் பதிவில் பேச்சு எதுவும் கிடைக்கவில்லை. எதுவும் சேமிக்கப்படவில்லை — மீண்டும் முயலுங்கள் அல்லது தட்டச்சு செய்யுங்கள்.',
  },
  transcribe_failed: {
    en: 'The voice note could not be transcribed. Nothing was saved — please type it instead.',
    si: 'හඬ සටහන අකුරු කිරීමට නොහැකි විය. කිසිවක් සුරැකුණේ නැත — කරුණාකර එය ලියන්න.',
    ta: 'குரல் குறிப்பை எழுத்தாக மாற்ற முடியவில்லை. எதுவும் சேமிக்கப்படவில்லை — தயவுசெய்து தட்டச்சு செய்யுங்கள்.',
  },
};

// --- untrusted input ---------------------------------------------------------------------------

/** A Cognito sub is a UUID. Anything that is not safe in an S3 key and a job name fails closed. */
const SAFE_SUB = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The caller's own sub, proven safe to build a key and a job name from. */
function keySafeSub(sub) {
  if (typeof sub !== 'string' || !SAFE_SUB.test(sub)) throw new DenyError('no_identity');
  return sub;
}

/** The request body. A body we cannot parse is a bad request, not an empty one. */
function jsonBody(event) {
  if (!event?.body) return {};
  try {
    const parsed = JSON.parse(event.body);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new VoiceError('bad_request');
  }
}

/**
 * A client-supplied key, re-derived against the caller's own prefix.
 *
 * Built as `startsWith` on the server-composed prefix plus an anchored `<uuid>.<format>` tail, so
 * `..`, a second slash, a URL, another teacher's sub and a key outside `voice/` are all the same
 * single refusal — and `key_invalid` is returned for "not yours" as well as for "malformed", so a
 * probe learns nothing from the difference (requirement 10.3's reasoning, applied here).
 */
function ownKey(given, owner) {
  if (typeof given !== 'string') throw new VoiceError('key_invalid');

  const prefix = `${KEY_PREFIX}${owner}/`;
  if (!given.startsWith(prefix)) throw new VoiceError('key_invalid');

  const tail = given.slice(prefix.length);
  const dot = tail.lastIndexOf('.');
  if (dot < 0) throw new VoiceError('key_invalid');

  const name = tail.slice(0, dot);
  const format = tail.slice(dot + 1);
  if (!UUID.test(name) || !Object.hasOwn(FORMATS, format)) throw new VoiceError('key_invalid');

  return { key: given, format };
}

/** The same check for a job name. Without the sub segment, a poll could read another teacher's transcript. */
function ownJobName(given, owner) {
  if (typeof given !== 'string') throw new VoiceError('job_invalid');

  const prefix = `${JOB_PREFIX}${owner}-`;
  if (!given.startsWith(prefix) || !UUID.test(given.slice(prefix.length))) {
    throw new VoiceError('job_invalid');
  }
  return given;
}

// --- the honest fallback (requirement 3.6) -----------------------------------------------------

/**
 * The one shape every failure returns. 200, because a voice note that could not be transcribed is
 * an ordinary outcome the teacher must read — the same reasoning as `blockedBy` in the chat path.
 *
 * There is no `transcript` field and never a partial one: a half-heard fee amount is worse than
 * none. `reason` is the stable code the front-end localises on; `message` is the text to show when
 * it has no string for that code yet.
 */
function fallback(reason, lang) {
  const strings = FALLBACK[reason] ?? FALLBACK.transcribe_failed;
  return {
    status: 200,
    body: {
      status: 'failed',
      reason,
      message: strings[lang] ?? strings.en,
    },
  };
}

/**
 * Does this failure mean "that language"?
 *
 * Deliberately shallow: the only thing it changes is which honest message the teacher reads, and
 * both messages tell the truth. Anything unrecognised is `transcribe_failed`, which is the safer
 * of the two to be wrong about.
 */
const aboutLanguage = (text) => /language/i.test(String(text ?? ''));

// --- the routes --------------------------------------------------------------------------------

/**
 * `POST /voice/upload-url` → a presigned S3 PUT for one object the caller may write.
 *
 * `bytes` is required and signed into the URL, so the capability is one key, one method, one exact
 * length and two minutes — a URL that leaks cannot be reused for a different or larger object.
 * The content type is NOT signed: a browser sends `audio/webm;codecs=opus`, which would not match
 * the plain type and would fail the PUT on a signature mismatch for no security gain, since the
 * format is already fixed by the key and passed to Transcribe explicitly.
 *
 * ponytail: teacher only, although design §5 lists student too. The student microphone does not
 * exist yet (task 6.4), and a write capability nobody uses should not be handed out. Lifting the
 * ceiling means allowing `'student'` here and nothing else.
 *
 * @param deps injected `{ presignPut, bucket }` — see `index.mjs`
 */
export async function uploadUrl(event, deps) {
  const { role, sub } = claimsFromEvent(event);
  requireRole(role, 'teacher');
  const owner = keySafeSub(sub);

  const body = jsonBody(event);

  const bytes = Number(body.bytes);
  if (!Number.isInteger(bytes) || bytes <= 0) throw new VoiceError('bytes_required');
  if (bytes > MAX_AUDIO_BYTES) throw new VoiceError('bytes_too_large');

  // A hint, not a filename: it only selects a row of `FORMATS`. An unknown value is refused rather
  // than defaulted, so a recorder we have not tested is a visible 400 and not a failed job later.
  const format = body.format === undefined ? DEFAULT_FORMAT : String(body.format).toLowerCase();
  if (!Object.hasOwn(FORMATS, format)) throw new VoiceError('format_unsupported');

  const key = `${KEY_PREFIX}${owner}/${randomUUID()}.${format}`;

  const url = await deps.presignPut({
    bucket: deps.bucket,
    key,
    bytes,
    expiresIn: URL_TTL_SECONDS,
  });

  return {
    status: 200,
    body: { key, url, bytes, contentType: FORMATS[format], expiresIn: URL_TTL_SECONDS },
  };
}

/**
 * `POST /voice/transcript` — start the job, or collect it.
 *
 * `{ key, lang }`      starts a job and returns `{ status: 'in_progress', jobName }`.
 * `{ jobName, lang }`  polls that job: `in_progress`, `done` with the transcript, or `failed`.
 *
 * Polling is the client's job rather than the Lambda's: a batch job for a five-second note takes
 * longer than an API Gateway request may last, so a Lambda that waited would turn a slow success
 * into a timeout — which the teacher would read as a failure.
 *
 * On `done` the transcript goes to `POST /chat` as `message`, unchanged apart from trimming. It is
 * not re-punctuated or tidied here: a model's guess at a fee amount or a child's name is the one
 * kind of edit that must never happen silently between hearing and recording.
 *
 * @param deps injected `{ startTranscription, getTranscription, fetchTranscript, bucket }`
 */
export async function transcript(event, deps) {
  const { role, sub } = claimsFromEvent(event);
  requireRole(role, 'teacher');
  const owner = keySafeSub(sub);

  const body = jsonBody(event);
  const lang = typeof body.lang === 'string' ? body.lang.trim().toLowerCase() : 'en';

  // A poll carries the job name we issued. Checked against the caller's own prefix first, so an
  // invented or borrowed job name never reaches Transcribe.
  if (body.jobName !== undefined) {
    return collect(ownJobName(body.jobName, owner), lang, deps);
  }

  // Requirement 3.6, before any job exists: an unsupported or unknown UI language is answered
  // plainly rather than transcribed as something else. Nothing is written and nothing is spent.
  const languageCode = LANGUAGES[lang];
  if (!languageCode) return fallback('unsupported_language', lang);

  const { key, format } = ownKey(body.key, owner);
  const jobName = `${JOB_PREFIX}${owner}-${randomUUID()}`;

  try {
    await deps.startTranscription({
      jobName,
      mediaUri: `s3://${deps.bucket}/${key}`,
      mediaFormat: format,
      languageCode,
    });
  } catch (err) {
    // Transcribe refusing the language code is requirement 3.6 arriving at runtime instead of from
    // the table above, and it gets the identical honest answer.
    return fallback(aboutLanguage(err?.message) ? 'unsupported_language' : 'transcribe_failed', lang);
  }

  return { status: 200, body: { status: 'in_progress', jobName } };
}

/** One poll of a job this caller owns. Every outcome other than real text is a stated failure. */
async function collect(jobName, lang, deps) {
  let job;
  try {
    job = await deps.getTranscription({ jobName });
  } catch {
    return fallback('transcribe_failed', lang);
  }

  const state = String(job?.status ?? '');

  if (state === 'QUEUED' || state === 'IN_PROGRESS') {
    return { status: 200, body: { status: 'in_progress', jobName } };
  }

  // FAILED, and anything we do not recognise: an unknown state is not a success, and telling the
  // teacher to keep waiting for a job that will never finish is its own kind of dishonesty.
  if (state !== 'COMPLETED') {
    return fallback(aboutLanguage(job?.failureReason) ? 'unsupported_language' : 'transcribe_failed', lang);
  }

  let text;
  try {
    text = await deps.fetchTranscript(job.transcriptUri);
  } catch {
    return fallback('transcribe_failed', lang);
  }

  const spoken = typeof text === 'string' ? text.trim() : '';

  // A completed job with nothing in it is the quietest failure of the lot: silence, a dropped
  // microphone permission, or a language the model heard as noise. Say so.
  if (!spoken) return fallback('no_speech', lang);

  return { status: 200, body: { status: 'done', jobName, lang, transcript: spoken } };
}

/** The two voice routes of design §5, keyed by HTTP API `routeKey`. */
export const ROUTES = {
  'POST /voice/upload-url': uploadUrl,
  'POST /voice/transcript': transcript,
};
