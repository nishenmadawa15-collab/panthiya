// voice — the HTTP boundary for the two voice routes of design §5.
//
// This file is the boundary and nothing else: it picks the route, builds the AWS clients, and turns
// a return value or a thrown error into an API Gateway response. All the authorisation, all the
// server-decided names and the whole honest fallback live in `voice.mjs`, which is the file the
// unit tests drive — so the suite runs with no AWS, no network and no credentials.
//
// Status codes carry a closed-set code and never the client's own text, for the same reason
// `DenyError` does (`backend/lib/auth.mjs`): an echoed key or job name is a reflected payload.
//
//   403 denied        a session that is not a teacher, or a key or job name that is not theirs
//                     (`key_invalid`, `job_invalid` arrive as 400 — both are 'malformed' and 'not
//                     yours' at once, and the response does not say which).
//   400 bad_request   a malformed request: no `bytes`, audio over 1 MB, an unknown format.
//   404 not_found     a path this function does not serve.
//   500               a genuine fault. Never an empty transcript presented as a transcription.
//
// A transcription that did not work is *not* an error path: it returns 200 with
// `{ status: 'failed', reason, message }`, because the teacher has to read it (requirement 3.6).

import { DenyError } from '../../lib/auth.mjs';
import { ROUTES, VoiceError } from './voice.mjs';

const JSON_HEADERS = { 'content-type': 'application/json' };

const reply = (status, body) => ({ statusCode: status, headers: JSON_HEADERS, body: JSON.stringify(body) });

/**
 * The route this invocation is for. Same shape as `read/index.mjs`, kept local rather than imported
 * so the voice cold start does not load that function's module graph.
 */
export function routeKeyOf(event) {
  if (typeof event?.routeKey === 'string' && event.routeKey) return event.routeKey;

  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path ?? event?.rawPath;
  return method && path ? `${method} ${path}` : '';
}

// Lazy SDK imports: these packages exist only inside the Lambda runtime, and a cold start that
// never reaches them should not pay to load them. Same reasoning as `backend/lib/ddb.mjs`.
let s3;
async function presignPut({ bucket, key, bytes, expiresIn }) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  s3 ??= new S3Client({});

  // `ContentLength` is signed, so the URL is good for exactly this many bytes. The browser sets
  // the header itself from the Blob, so this costs the front-end nothing.
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentLength: bytes }),
    { expiresIn },
  );
}

let transcribe;
async function transcribeClient() {
  if (!transcribe) {
    const { TranscribeClient } = await import('@aws-sdk/client-transcribe');
    transcribe = new TranscribeClient({});
  }
  return transcribe;
}

/**
 * Start a batch job.
 *
 * No `OutputBucketName` and no `DataAccessRoleArn`: without a data access role Transcribe reads the
 * media with this Lambda role's own permissions, which is exactly the `voice/*` grant in
 * `template.yaml`, and writes the result to a service-managed bucket. That keeps the IAM policy as
 * narrow as it is and means no second write path into our own bucket.
 */
async function startTranscription({ jobName, mediaUri, mediaFormat, languageCode }) {
  const { StartTranscriptionJobCommand } = await import('@aws-sdk/client-transcribe');
  await (await transcribeClient()).send(new StartTranscriptionJobCommand({
    TranscriptionJobName: jobName,
    Media: { MediaFileUri: mediaUri },
    MediaFormat: mediaFormat,
    LanguageCode: languageCode,
  }));
}

/** Flattened to the three fields `voice.mjs` reads, so that file stays free of SDK shapes. */
async function getTranscription({ jobName }) {
  const { GetTranscriptionJobCommand } = await import('@aws-sdk/client-transcribe');
  const out = await (await transcribeClient())
    .send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));

  const job = out?.TranscriptionJob ?? {};
  return {
    status: job.TranscriptionJobStatus,
    transcriptUri: job.Transcript?.TranscriptFileUri,
    failureReason: job.FailureReason,
  };
}

/**
 * The transcript text itself.
 *
 * `TranscriptFileUri` for a service-managed output bucket is already a presigned HTTPS URL, so this
 * is a plain `fetch` with no credentials and no S3 permission of our own.
 */
async function fetchTranscript(uri) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`transcript fetch failed: ${response.status}`);
  const doc = await response.json();
  return doc?.results?.transcripts?.[0]?.transcript ?? '';
}

/**
 * @param event the HTTP API invocation
 * @param provided injected `{ presignPut, startTranscription, getTranscription, fetchTranscript,
 *   bucket }`. Omitted in Lambda, where the clients above are built on first use — a *static*
 *   import of the SDK would pull it into every test process, and the unit suite deliberately has no
 *   dependencies installed to pull it from.
 */
export const handler = async (event, provided) => {
  const handle = ROUTES[routeKeyOf(event)];
  if (!handle) return reply(404, { error: 'not_found' });

  const deps = provided ?? {
    presignPut,
    startTranscription,
    getTranscription,
    fetchTranscript,
    bucket: process.env.VOICE_BUCKET,
  };

  try {
    const { status, body } = await handle(event, deps);
    return reply(status, body);
  } catch (e) {
    if (e instanceof DenyError) return reply(403, { error: 'denied', reason: e.code });
    if (e instanceof VoiceError) return reply(400, { error: 'bad_request', reason: e.code });

    // A genuine fault. Surfaced rather than swallowed: a presign or a poll that failed for an
    // unknown reason must not look like a voice note that simply had no speech in it.
    throw e;
  }
};
