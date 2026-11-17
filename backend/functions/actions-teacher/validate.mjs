// Input validation for the Teacher action group.
//
// Everything in here validates a value the MODEL supplied (design §3.1: every `parameter` is a
// hint). Two rules shape the whole file:
//
//   1. Fail closed. An unparseable amount, score or date is refused, never coerced into something
//      plausible. "Rs. two thousand five hundred" must come back to the teacher as a question,
//      because a silently-wrong number in a fee ledger is worse than a slow one (req 4.5).
//   2. Never echo the input. Like `DenyError` in `backend/lib/auth.mjs`, the error carries a code
//      from a closed set and nothing else. Reflecting the offending string back would hand a
//      prompt-injection payload a second trip through the model.
//
// No clock is read anywhere in this file. `parseDate` takes today's date as an argument so the
// relative-date logic ("yesterday", "ඊයේ", "நேற்று") is deterministic under test (req 3.1).

/** Every refusal reason this module can produce. Unknown codes collapse to `invalid_input`. */
const INPUT_CODES = new Set([
  'invalid_input',
  'name_required',
  'student_id_required',      // DELETE /teacher/students/{id} with no id in the path (req 13.8)
  // `drafts.mjs` has thrown this since M2, but it was never listed here, so the closed set below
  // quietly collapsed it to `invalid_input` and the approve route answered a missing draft id with
  // the vaguest code it has. Found by the 2.10 lane while adding the line above.
  'draft_id_required',
  'class_name_required',
  'amount_invalid',
  'amount_out_of_range',
  'period_invalid',
  'date_invalid',
  'status_invalid',
  'score_invalid',
  'max_score_invalid',
  'score_above_max',
  'assessment_invalid',
]);

/** Thrown for anything the model got wrong. Carries a code, never attacker text. */
export class InputError extends Error {
  constructor(code = 'invalid_input') {
    const safe = INPUT_CODES.has(code) ? code : 'invalid_input';
    super(`invalid: ${safe}`);
    this.name = 'InputError';
    this.code = safe;
  }
}

/** Trim a model-supplied string and cap its length. Unbounded text is a cost and injection risk. */
export function text(value, max = 120) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

// --- names -------------------------------------------------------------------------------------

const MAX_NAMES = 60;   // one class register; more than this is not a chat message

/**
 * The list of student names the model named, as separate strings.
 *
 * Bedrock hands an array parameter over either as a real array or as its JSON text, and a teacher
 * dictating a register writes "Kasun, Dilmi saha Nimal" — so commas, newlines and `&` all split.
 * The words between them are NOT resolved here: resolution happens against the teacher's own
 * roster in `actions.mjs`, which is the only place that may decide who a name means.
 */
export function parseNames(raw) {
  let items = raw;

  if (typeof items === 'string' && items.trim().startsWith('[')) {
    try { items = JSON.parse(items); } catch { /* not JSON after all; fall through to splitting */ }
  }
  if (typeof items === 'string') items = items.split(/[,\n;&]+/);
  if (!Array.isArray(items)) items = [items];

  const names = items.map((n) => text(n, 80)).filter(Boolean).slice(0, MAX_NAMES);
  if (names.length === 0) throw new InputError('name_required');
  return names;
}

/** Exactly one student name. */
export function parseName(raw) {
  const name = text(raw, 80);
  if (!name) throw new InputError('name_required');
  return name;
}

/** Exactly one class name. Separate code so req 2.3's refusal stays distinguishable. */
export function parseClassName(raw) {
  const name = text(raw, 80);
  if (!name) throw new InputError('class_name_required');
  return name;
}

// --- dates -------------------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Relative dates a teacher actually types, in the four supported languages (req 3.1).
 * Values are day offsets from `today`.
 */
const RELATIVE_DAYS = new Map(Object.entries({
  today: 0, 'ada': 0, 'අද': 0, 'இன்று': 0,
  yesterday: -1, iye: -1, 'ඊයේ': -1, 'ඊයෙ': -1, 'நேற்று': -1,
}));

/** Shift an ISO date by whole days, in UTC. Never reads the clock. */
function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Does this ISO string name a real day? Rejects 2026-02-31, which `Date` would roll forward. */
function isRealDate(iso) {
  return ISO_DATE.test(iso) && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso;
}

/**
 * Resolve a model-supplied date to `YYYY-MM-DD`.
 *
 * @param {*} raw what the model supplied; empty means "today"
 * @param {string} today today's date as `YYYY-MM-DD`, supplied by the caller — NOT read from the
 *   clock here, so every test of relative dates is deterministic
 */
export function parseDate(raw, today) {
  if (!isRealDate(today)) throw new Error('parseDate: `today` must be a real YYYY-MM-DD date');

  const given = text(raw, 40);
  if (!given) return today;

  const relative = RELATIVE_DAYS.get(given.toLowerCase());
  if (relative !== undefined) return shiftDays(today, relative);

  if (isRealDate(given)) return given;
  throw new InputError('date_invalid');
}

// --- billing period ----------------------------------------------------------------------------

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Resolve a billing period to `YYYY-MM` (the `fees` sort key, design §4).
 *
 * Accepts `YYYY-MM`, a full date (truncated to its month) and an English month name with an
 * optional year, because "Nimal paid 2500 for November" is the demo line.
 *
 * ponytail: English month names only. Ceiling: a teacher writing "නොවැම්බර්" relies on the agent
 * normalising it to `2026-11` first; if that turns out to be unreliable, add the Sinhala and Tamil
 * month tables here — the same place, so the two callers cannot disagree.
 */
export function parsePeriod(raw, today) {
  if (!isRealDate(today)) throw new Error('parsePeriod: `today` must be a real YYYY-MM-DD date');

  const given = text(raw, 40).toLowerCase();
  if (!given) throw new InputError('period_invalid');

  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(given)) return given;
  if (isRealDate(given)) return given.slice(0, 7);

  const [, monthWord, yearWord] = given.match(/^([a-z]+)\s*(\d{4})?$/) ?? [];
  const month = MONTHS.indexOf(monthWord ?? '');
  if (month < 0) throw new InputError('period_invalid');

  return `${yearWord ?? today.slice(0, 4)}-${String(month + 1).padStart(2, '0')}`;
}

// --- attendance status -------------------------------------------------------------------------

/** The three stored values (design §4), and the words a teacher reaches for instead. */
const STATUSES = new Map(Object.entries({
  present: 'present', here: 'present', 'awa': 'present', 'ආවා': 'present', 'வந்தார்': 'present',
  absent: 'absent', missing: 'absent', 'awe nae': 'absent', 'ආවේ නැහැ': 'absent', 'வரவில்லை': 'absent',
  late: 'late', 'parakku': 'late', 'පරක්කු': 'late', 'தாமதம்': 'late',
}));

export function parseStatus(raw) {
  const status = STATUSES.get(text(raw, 40).toLowerCase());
  if (!status) throw new InputError('status_invalid');
  return status;
}

// --- money -------------------------------------------------------------------------------------

const MAX_AMOUNT = 100000;   // design §6.2; a tuition fee above this is a typo, not a payment

/**
 * Parse a fee amount in LKR. Requirement 4.5 and design §6.2: numeric, 0 < amount ≤ 100000.
 *
 * Deliberately strict. "2500 or 3000", "two thousand" and "2500; DROP TABLE" are all refused
 * rather than partially read, because a half-understood amount is the one thing worse than asking
 * the teacher again.
 */
export function parseAmount(raw) {
  const cleaned = text(raw, 40)
    .replace(/^(rs\.?|lkr|රු\.?|ரூ\.?)\s*/i, '')   // the currency a teacher says out loud
    .replace(/,/g, '')                               // 2,500
    .trim();

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new InputError('amount_invalid');

  const amount = Number(cleaned);
  if (!(amount > 0) || amount > MAX_AMOUNT) throw new InputError('amount_out_of_range');
  return amount;
}

// --- marks -------------------------------------------------------------------------------------

/** A plain number, or an InputError with the caller's code. Rejects '', 'ninety', NaN, 1e9999. */
function numeric(raw, code) {
  const given = text(raw, 20);
  if (!/^-?\d+(\.\d+)?$/.test(given)) throw new InputError(code);
  const n = Number(given);
  if (!Number.isFinite(n)) throw new InputError(code);
  return n;
}

/** Requirement 5.2: non-numeric, negative, or score above the stated maximum is refused. */
export function parseScore(rawScore, rawMax) {
  const score = numeric(rawScore, 'score_invalid');
  const maxScore = numeric(rawMax, 'max_score_invalid');

  if (!(maxScore > 0)) throw new InputError('max_score_invalid');
  if (score < 0) throw new InputError('score_invalid');
  if (score > maxScore) throw new InputError('score_above_max');

  return { score, maxScore };
}

/**
 * The `date#slug` sort key of a `marks` row (design §4).
 *
 * The slug is built from a narrow character class rather than by escaping, so model-supplied text
 * cannot shape a key: anything that is not a letter or digit becomes a hyphen, and an assessment
 * name that holds no letters or digits at all is refused.
 */
export function assessmentId(assessment, date) {
  const slug = text(assessment, 60)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  if (!slug) throw new InputError('assessment_invalid');
  return `${date}#${slug}`;
}
